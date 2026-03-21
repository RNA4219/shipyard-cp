import {
  BaseWorkerAdapter,
  type WorkerAdapterConfig,
  type WorkerCapabilities,
  type JobSubmissionResult,
  type JobPollResult,
  type CancelResult,
  type WorkerJob,
} from './worker-adapter.js';
import type { WorkerResult } from '../../types.js';
import { getLogger } from '../../monitoring/index.js';
import { getConfig } from '../../config/index.js';
import { LiteLLMConnector, type ChatCompletionResponse } from '../litellm/litellm-connector.js';

/**
 * GLM-5 adapter configuration
 */
export interface GLM5AdapterConfig extends WorkerAdapterConfig {
  workerType: 'claude_code'; // Use claude_code type for compatibility
  /** GLM model name */
  model?: string;
  /** API endpoint (Alibaba Cloud DashScope) */
  apiEndpoint?: string;
  /** API Key */
  apiKey?: string;
  /** Request timeout */
  timeout?: number;
}

/**
 * Job execution state for GLM-5
 */
interface GLMJobState {
  job: WorkerJob;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  result?: WorkerResult;
  error?: string;
  startedAt: number;
  completionPromise?: Promise<ChatCompletionResponse>;
}

/**
 * GLM-5 Worker Adapter
 *
 * Uses Alibaba Cloud's GLM-5 model via OpenAI-compatible API.
 * This is the same model powering this conversation.
 */
export class GLM5Adapter extends BaseWorkerAdapter {
  readonly workerType = 'claude_code' as const;
  private connector: LiteLLMConnector;
  private model: string;
  private jobStates: Map<string, GLMJobState> = new Map();
  private logger = getLogger().child({ component: 'GLM5Adapter' });

  constructor(config: GLM5AdapterConfig = { workerType: 'claude_code' }) {
    super(config);

    const globalConfig = getConfig();

    this.model = config.model || globalConfig.worker.glmModel || 'glm-5';
    const endpoint = config.apiEndpoint || globalConfig.worker.glmApiEndpoint ||
      'https://coding-intl.dashscope.aliyuncs.com';
    const apiKey = config.apiKey || config.auth?.value || globalConfig.apiKeys.glmApiKey;

    this.connector = new LiteLLMConnector({
      baseUrl: endpoint,
      apiKey,
      defaultModel: this.model,
      timeout: config.timeout || 300000, // 5 minutes
    });

    this.logger.info('GLM5Adapter initialized', {
      model: this.model,
      endpoint,
      hasApiKey: !!apiKey,
    });
  }

  async initialize(): Promise<void> {
    // Verify connection
    try {
      const models = await this.connector.listModels();
      this.logger.info('Connected to GLM API', {
        modelCount: models.length,
        models: models.slice(0, 5).map(m => m.id),
      });
    } catch (error) {
      this.logger.warn('Could not verify GLM API connection', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    await super.initialize();
  }

  async getCapabilities(): Promise<WorkerCapabilities> {
    return {
      worker_type: 'claude_code',
      capabilities: [
        'plan',
        'edit_repo',
        'run_tests',
        'needs_approval',
        'produces_patch',
        'produces_verdict',
      ],
      max_concurrent_jobs: 10,
      supported_stages: ['plan', 'dev', 'acceptance'],
      version: '1.0.0',
      metadata: {
        model: this.model,
        provider: 'alibaba_cloud',
        supports_mcp: false,
        supports_tools: true,
      },
    };
  }

  async submitJob(job: WorkerJob): Promise<JobSubmissionResult> {
    const validation = this.validateJob(job);
    if (!validation.valid) {
      return {
        success: false,
        status: 'rejected',
        error: validation.errors.join(', '),
      };
    }

    try {
      const externalJobId = `glm-${job.job_id}-${Date.now()}`;

      // Initialize job state
      const jobState: GLMJobState = {
        job,
        status: 'queued',
        startedAt: Date.now(),
      };

      this.jobStates.set(externalJobId, jobState);

      // Start completion in background with error handling to prevent unhandled rejection
      jobState.completionPromise = this.executeCompletion(job, externalJobId).catch(error => {
        // Error is already logged in executeCompletion, just prevent unhandled rejection
        this.logger.debug('Completion promise settled with error', {
          externalJobId,
          error: error instanceof Error ? error.message : String(error),
        });
        // Return a minimal error response instead of null cast
        return {
          id: 'error',
          object: 'chat.completion',
          created: Date.now(),
          model: this.model,
          choices: [],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        } as ChatCompletionResponse;
      });
      jobState.status = 'running';

      this.logger.info('Job submitted to GLM-5', {
        externalJobId,
        taskId: job.task_id,
        stage: job.stage,
        model: this.model,
      });

      return {
        success: true,
        external_job_id: externalJobId,
        status: 'queued',
        estimated_duration_ms: this.estimateDuration(job.stage),
      };
    } catch (error) {
      return {
        success: false,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async pollJob(externalJobId: string): Promise<JobPollResult> {
    const jobState = this.jobStates.get(externalJobId);

    if (!jobState) {
      return {
        external_job_id: externalJobId,
        status: 'failed',
        error: 'Job not found',
      };
    }

    const elapsed = Date.now() - jobState.startedAt;
    const estimated = this.estimateDuration(jobState.job.stage);

    switch (jobState.status) {
      case 'queued':
        return {
          external_job_id: externalJobId,
          status: 'queued',
          progress: 0,
        };

      case 'running': {
        const progress = Math.min(95, Math.floor((elapsed / estimated) * 100));
        return {
          external_job_id: externalJobId,
          status: 'running',
          progress,
          estimated_remaining_ms: Math.max(0, estimated - elapsed),
        };
      }

      case 'succeeded':
        this.jobStates.delete(externalJobId);
        return {
          external_job_id: externalJobId,
          status: 'succeeded',
          progress: 100,
          result: jobState.result,
        };

      case 'failed':
        this.jobStates.delete(externalJobId);
        return {
          external_job_id: externalJobId,
          status: 'failed',
          error: jobState.error,
        };
    }
  }

  async cancelJob(externalJobId: string): Promise<CancelResult> {
    const jobState = this.jobStates.get(externalJobId);

    if (!jobState) {
      return {
        success: false,
        status: 'not_found',
        error: 'Job not found',
      };
    }

    if (jobState.status === 'succeeded' || jobState.status === 'failed') {
      return {
        success: false,
        status: 'already_completed',
      };
    }

    jobState.status = 'failed';
    jobState.error = 'Job cancelled by user';
    this.jobStates.delete(externalJobId);

    return {
      success: true,
      status: 'cancelled',
    };
  }

  async collectArtifacts(externalJobId: string): Promise<Array<{
    artifact_id: string;
    kind: 'log' | 'report' | 'screenshot' | 'trace' | 'json' | 'html' | 'other';
    uri: string;
    size_bytes?: number;
  }>> {
    const jobState = this.jobStates.get(externalJobId);
    if (!jobState || !jobState.result) {
      return [];
    }
    return jobState.result.artifacts || [];
  }

  /**
   * Execute completion with GLM-5
   */
  private async executeCompletion(job: WorkerJob, externalJobId: string): Promise<ChatCompletionResponse> {
    const jobState = this.jobStates.get(externalJobId);
    if (!jobState) {
      throw new Error('Job state not found');
    }

    try {
      const systemPrompt = this.getSystemPrompt(job.stage);
      const userPrompt = job.input_prompt || this.buildPrompt(job);

      const response = await this.connector.chatCompletion({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.7,
        max_tokens: 4096,
        metadata: {
          task_id: job.task_id,
          stage: job.stage,
        },
      });

      // Convert to WorkerResult
      jobState.result = this.convertToWorkerResult(job, response);
      jobState.status = 'succeeded';

      this.logger.info('GLM-5 completion succeeded', {
        externalJobId,
        tokensUsed: response.usage.total_tokens,
      });

      return response;
    } catch (error) {
      jobState.status = 'failed';
      jobState.error = error instanceof Error ? error.message : String(error);

      this.logger.error('GLM-5 completion failed', {
        externalJobId,
        error: jobState.error,
      });

      throw error;
    }
  }

  /**
   * Get stage-specific system prompt
   */
  private getSystemPrompt(stage: string): string {
    const prompts: Record<string, string> = {
      plan: `You are a planning agent. Analyze the task and create a detailed implementation plan.
Output your plan as a structured JSON object with:
- summary: brief description of the approach
- steps: array of { description, files_to_modify, estimated_complexity }
- risks: potential issues to watch for
- dependencies: external dependencies needed

Be thorough but concise. Focus on practical implementation details.`,
      dev: `You are a development agent. Implement the planned changes.
Write clean, well-tested code following project conventions.
Output unified diff format for code changes when applicable.
Include test coverage for new functionality.`,
      acceptance: `You are an acceptance testing agent. Verify the implementation meets requirements.
Run tests and validate all acceptance criteria.
Output your verdict as JSON: { outcome: "accept"|"reject"|"rework", reason, test_results, checklist }`,
    };

    return prompts[stage] || prompts.plan;
  }

  /**
   * Build prompt from job
   */
  protected buildPrompt(job: WorkerJob): string {
    const lines: string[] = [];

    lines.push(`# Task: ${job.task_id}`);
    lines.push(`## Stage: ${job.stage}`);
    lines.push('');

    if (job.context?.objective) {
      lines.push(`### Objective`);
      lines.push(job.context.objective);
      lines.push('');
    }

    lines.push(`### Repository`);
    lines.push(`- Provider: ${job.repo_ref.provider}`);
    lines.push(`- Owner: ${job.repo_ref.owner}`);
    lines.push(`- Name: ${job.repo_ref.name}`);
    lines.push(`- Default Branch: ${job.repo_ref.default_branch}`);
    lines.push('');

    return lines.join('\n');
  }

  /**
   * Convert GLM response to WorkerResult
   */
  private convertToWorkerResult(job: WorkerJob, response: ChatCompletionResponse): WorkerResult {
    const content = response.choices[0]?.message?.content || '';
    const duration = Date.now() - (this.jobStates.get(`glm-${job.job_id}`)?.startedAt || Date.now());

    const result = this.createBaseResult(job, duration);
    result.summary = `GLM-5 completed ${job.stage} stage`;

    // Parse response for structured data
    try {
      const parsed = JSON.parse(content);

      if (job.stage === 'acceptance' && parsed.verdict) {
        result.verdict = {
          outcome: parsed.verdict.outcome || 'accept',
          reason: parsed.verdict.reason || '',
        };
      }

      if (parsed.patch || content.includes('--- ')) {
        result.patch_ref = {
          format: 'unified_diff',
          content: parsed.patch || content,
        };
      }
    } catch {
      // Not JSON, use raw content
      if (content.includes('--- ') && content.includes('+++ ')) {
        result.patch_ref = {
          format: 'unified_diff',
          content,
        };
      }
    }

    // Add usage info
    result.usage = {
      runtime_ms: duration,
      litellm: {
        model: this.model,
        provider: 'alibaba_cloud',
        input_tokens: response.usage.prompt_tokens,
        output_tokens: response.usage.completion_tokens,
        cost_usd: this.calculateCost(response.usage),
      },
    };

    // Add artifacts
    result.artifacts = [
      {
        artifact_id: `${job.job_id}-response`,
        kind: 'json',
        uri: `data:application/json;base64,${Buffer.from(content).toString('base64')}`,
      },
    ];

    return result;
  }

  /**
   * Estimate job duration
   */
  protected estimateDuration(stage: string): number {
    const estimates: Record<string, number> = {
      'plan': 30000,       // 30 seconds
      'dev': 120000,       // 2 minutes
      'acceptance': 60000, // 1 minute
    };
    return estimates[stage] || 60000;
  }

  /**
   * Calculate cost based on tokens
   */
  private calculateCost(usage: { prompt_tokens: number; completion_tokens: number }): number {
    // GLM-5 pricing (approximate)
    const inputCostPer1k = 0.001; // $0.001 per 1k input tokens
    const outputCostPer1k = 0.002; // $0.002 per 1k output tokens

    return (usage.prompt_tokens / 1000 * inputCostPer1k) +
           (usage.completion_tokens / 1000 * outputCostPer1k);
  }
}

/**
 * Create GLM-5 adapter instance
 */
export function createGLM5Adapter(config?: GLM5AdapterConfig): GLM5Adapter {
  return new GLM5Adapter(config);
}