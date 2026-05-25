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
import { ToolPlanValidator, createToolPlanValidator } from '../validation/tool-plan-validator.js';

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
  private toolPlanValidator: ToolPlanValidator;

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

    this.toolPlanValidator = createToolPlanValidator();

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
      const systemPrompt = this.getSystemPrompt(job);
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
          envelope_mode: this.isEnvelopeMode(job),
        },
      });

      // Convert to WorkerResult
      jobState.result = this.convertToWorkerResult(job, response);
      jobState.status = 'succeeded';

      this.logger.info('GLM-5 completion succeeded', {
        externalJobId,
        tokensUsed: response.usage.total_tokens,
        envelopeMode: this.isEnvelopeMode(job),
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
   * Get stage-specific system prompt.
   * For envelope mode, returns JSON-only structured prompt.
   */
  private getSystemPrompt(job: WorkerJob): string {
    const stage = job.stage;

    // Check for envelope mode
    if (this.isEnvelopeMode(job)) {
      return this.getEnvelopeSystemPrompt(stage, job);
    }

    // Legacy prompts for backward compatibility
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
   * Check if job uses envelope mode (InstructionEnvelopeV2).
   */
  private isEnvelopeMode(job: WorkerJob): boolean {
    return job.metadata?.instruction_envelope_version === '2.0';
  }

  /**
   * Get envelope-based JSON-only system prompt.
   */
  private getEnvelopeSystemPrompt(stage: string, job: WorkerJob): string {
    const allowedTools = this.extractAllowedTools(job);

    switch (stage) {
      case 'plan':
        return `You are a planning agent. Output ONLY valid JSON.
Output a plan_intent object with:
{
  "summary": "brief description of the plan",
  "steps": [{ "description": "step description", "files_to_modify": ["path"], "estimated_complexity": "low|medium|high" }],
  "risks": ["potential issues"],
  "dependencies": ["external dependencies needed"],
  "evidence": ["file refs, doc refs"]
}

Do not output any text outside JSON. Do not use tools outside allowed list.`;

      case 'dev':
        return `You are a development agent. Output ONLY valid JSON.
Output a tool_plan object with:
{
  "summary": "brief description of planned operations",
  "calls": [{ "tool": "tool_name", "args": { "arg": "value" } }],
  "evidence": ["affected file refs"]
}

Allowed tools: ${allowedTools.join(', ') || 'read_file, apply_patch_intent, run_test_suite'}.
Do not output any text outside JSON. Do not use tools outside allowed list.
Each call must have tool and args.`;

      case 'acceptance':
        return `You are an acceptance testing agent. Output ONLY valid JSON.
Output an acceptance_verdict object with:
{
  "outcome": "accept|reject|rework|needs_manual_review",
  "reason": "explanation of verdict",
  "evidence_refs": ["test refs, file refs"],
  "checklist_completed": true|false
}

Do not output any text outside JSON.`;

      default:
        return `Output ONLY valid JSON. No text outside JSON structure.`;
    }
  }

  /**
   * Extract allowed tools from job metadata.
   */
  private extractAllowedTools(job: WorkerJob): string[] {
    const envelopeTools = job.metadata?.allowed_tools as Array<{ name: string }> | undefined;
    if (envelopeTools && Array.isArray(envelopeTools)) {
      return envelopeTools.map(t => t.name);
    }
    return [];
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
    const isEnvelopeMode = this.isEnvelopeMode(job);

    // Always capture raw output as artifact
    result.artifacts = [
      {
        artifact_id: `${job.job_id}-raw-response`,
        kind: 'json',
        uri: `data:application/json;base64,${Buffer.from(content).toString('base64')}`,
      },
    ];

    // Try to parse response for structured data
    let parseError: string | undefined;

    try {
      const parsed = JSON.parse(content);

      if (job.stage === 'acceptance') {
        // Handle verdict for acceptance stage
        if (parsed.verdict) {
          result.verdict = {
            outcome: parsed.verdict.outcome || 'accept',
            reason: parsed.verdict.reason || '',
          };
        } else if (parsed.outcome) {
          // Direct verdict format
          result.verdict = {
            outcome: parsed.outcome,
            reason: parsed.reason || '',
          };
        }
      }

      if (job.stage === 'dev' && isEnvelopeMode) {
        // Validate tool_plan for envelope mode dev stage
        const allowedTools = this.extractAllowedTools(job);
        const validation = this.toolPlanValidator.validate(parsed, allowedTools);

        if (!validation.valid) {
          const validationErrors = validation.errors.map(e => `${e.path}: ${e.message}`);

          this.logger.warn('Tool plan validation failed', {
            jobId: job.job_id,
            errors: validationErrors,
          });

          // Store validation errors in metadata (as string for type compatibility)
          result.metadata = {
            ...result.metadata,
            validation_errors: validationErrors.join('; '),
            raw_output_preserved: true,
          };

          // Mark as failed for envelope mode
          result.status = 'failed';
          result.failure_class = 'non_retryable_logic';
          result.failure_code = 'structured_output_invalid';
          result.summary = `GLM-5 dev stage produced invalid tool_plan: ${validationErrors.join('; ')}`;
        } else {
          // Valid tool_plan - store as tool_plan artifact
          result.summary = parsed.summary || `GLM-5 completed dev stage`;
          result.artifacts.push({
            artifact_id: `${job.job_id}-tool-plan`,
            kind: 'json',
            uri: `artifact://tool_plan.json`,
          });
        }
      }

      if (job.stage === 'plan' && isEnvelopeMode) {
        // Handle plan_intent for envelope mode
        result.summary = parsed.summary || `GLM-5 completed plan stage`;
        if (parsed.steps || parsed.risks) {
          result.artifacts.push({
            artifact_id: `${job.job_id}-plan`,
            kind: 'json',
            uri: `artifact://plan_intent.json`,
          });
        }
      }

      // Legacy: handle patch content
      if (!isEnvelopeMode && (parsed.patch || content.includes('--- '))) {
        result.patch_ref = {
          format: 'unified_diff',
          content: parsed.patch || content,
        };
      }

      // Legacy: set summary from parsed content if not already set
      if (!result.summary) {
        result.summary = parsed.summary || `GLM-5 completed ${job.stage} stage`;
      }

    } catch (e) {
      parseError = e instanceof Error ? e.message : 'Unknown parse error';

      this.logger.warn('JSON parse failed for GLM response', {
        jobId: job.job_id,
        stage: job.stage,
        error: parseError,
        envelopeMode: isEnvelopeMode,
      });

      // For envelope mode, parse failure means failure
      if (isEnvelopeMode) {
        result.status = 'failed';
        result.failure_class = 'non_retryable_logic';
        result.failure_code = 'structured_output_parse_error';
        result.summary = `GLM-5 failed to produce valid JSON: ${parseError}`;
        result.metadata = {
          ...result.metadata,
          parse_error: parseError,
          raw_output_preserved: true,
        };
      } else {
        // Legacy mode: try to extract patch from raw content
        result.summary = `GLM-5 completed ${job.stage} stage`;
        if (content.includes('--- ') && content.includes('+++ ')) {
          result.patch_ref = {
            format: 'unified_diff',
            content,
          };
        }
      }
    }

    // Add usage info with litellm format
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

    // Set status to succeeded if not already set to failed
    if (!result.status) {
      result.status = 'succeeded';
    }

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