import {
  BaseWorkerAdapter,
  type WorkerAdapterConfig,
  type WorkerCapabilities,
  type JobSubmissionResult,
  type JobPollResult,
  type CancelResult,
  type WorkerJob,
} from './worker-adapter.js';
import type { WorkerResult, WorkerType } from '../../types.js';
import { getLogger } from '../../monitoring/index.js';
import { getConfig } from '../../config/index.js';
import { LiteLLMConnector, type ChatCompletionRequest, type ChatCompletionResponse } from '../litellm/litellm-connector.js';
import { ToolPlanValidator, createToolPlanValidator } from '../validation/tool-plan-validator.js';
import { resolveWorkerPrompt } from '../instruction/index.js';
import { ToolPlanExecutor, createToolPlanExecutor } from './tool-plan-executor.js';
import type { ToolPlanOutput } from '../../types.js';

/**
 * Common OpenAI-compatible completion adapter configuration.
 */
export interface OpenAICompatibleCompletionAdapterConfig extends WorkerAdapterConfig {
  workerType: WorkerType;
  /** GLM model name */
  model?: string;
  /** API endpoint (Alibaba Cloud DashScope) */
  apiEndpoint?: string;
  /** API Key */
  apiKey?: string;
  /** Request timeout */
  timeout?: number;
  /** Provider name recorded in WorkerResult usage metadata. */
  provider?: string;
  /** Human-readable provider label used in logs and summaries. */
  providerLabel?: string;
  /** Prefix used for provider-side job ids. */
  externalJobPrefix?: string;
}

/** Backward-compatible GLM-5 profile configuration. */
export interface GLM5AdapterConfig extends OpenAICompatibleCompletionAdapterConfig {
  /** GLM model name */
  model?: string;
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
 * Generic stateless OpenAI-compatible completion adapter.
 *
 * It uses only /v1/models and /v1/chat/completions via LiteLLMConnector.
 */
export class OpenAICompatibleCompletionAdapter extends BaseWorkerAdapter {
  readonly workerType: WorkerType;
  protected readonly connector: LiteLLMConnector;
  protected readonly model: string;
  protected readonly provider: string;
  protected readonly providerLabel: string;
  protected readonly externalJobPrefix: string;
  protected readonly jobStates: Map<string, GLMJobState> = new Map();
  protected readonly logger = getLogger().child({ component: 'OpenAICompatibleCompletionAdapter' });
  protected readonly toolPlanValidator: ToolPlanValidator;
  protected readonly toolPlanExecutor: ToolPlanExecutor;

  constructor(config: OpenAICompatibleCompletionAdapterConfig = { workerType: 'claude_code' }) {
    super(config);

    this.workerType = config.workerType;
    this.provider = config.provider ?? 'openai_compatible';
    this.providerLabel = config.providerLabel ?? 'OpenAI-compatible API';
    this.externalJobPrefix = config.externalJobPrefix ?? 'oai';
    this.model = config.model || 'unknown-model';
    const endpoint = config.apiEndpoint || 'http://localhost:1234/v1';
    const apiKey = config.apiKey || config.auth?.value;

    this.connector = new LiteLLMConnector({
      baseUrl: endpoint,
      apiKey,
      defaultModel: this.model,
      timeout: config.timeout || 300000, // 5 minutes
    });

    this.toolPlanValidator = createToolPlanValidator();
    this.toolPlanExecutor = createToolPlanExecutor();

    this.logger.info('OpenAI-compatible completion adapter initialized', {
      provider: this.provider,
      model: this.model,
      endpoint,
      hasApiKey: !!apiKey,
    });
  }

  async initialize(): Promise<void> {
    // Verify connection
    try {
      const models = await this.connector.listModels();
      this.logger.info('Connected to OpenAI-compatible API', {
        provider: this.provider,
        modelCount: models.length,
        models: models.slice(0, 5).map(m => m.id),
      });
    } catch (error) {
      this.logger.warn('Could not verify OpenAI-compatible API connection', {
        provider: this.provider,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    await super.initialize();
  }

  async getCapabilities(): Promise<WorkerCapabilities> {
    return {
      worker_type: this.workerType,
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
        provider: this.provider,
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
      const externalJobId = `${this.externalJobPrefix}-${job.job_id}-${Date.now()}`;

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

      this.logger.info('Job submitted to OpenAI-compatible backend', {
        provider: this.provider,
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
      const userPrompt = resolveWorkerPrompt(job);

      const response = await this.connector.chatCompletion({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
          { role: 'user', content: this.getJsonOnlyReminder(job) },
        ],
        temperature: 0,
        max_tokens: 4096,
        response_format: this.getResponseFormat(job),
        metadata: {
          task_id: job.task_id,
          stage: job.stage,
          envelope_mode: this.isEnvelopeMode(job),
        },
      });

      // Convert to WorkerResult
      jobState.result = await this.convertToWorkerResult(job, response, externalJobId);
      jobState.status = 'succeeded';

      this.logger.info('OpenAI-compatible completion succeeded', {
        provider: this.provider,
        externalJobId,
        tokensUsed: response.usage.total_tokens,
        envelopeMode: this.isEnvelopeMode(job),
      });

      return response;
    } catch (error) {
      jobState.status = 'failed';
      jobState.error = error instanceof Error ? error.message : String(error);

      this.logger.error('OpenAI-compatible completion failed', {
        provider: this.provider,
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
Do not wrap the JSON in Markdown code fences.
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
Do not wrap the JSON in Markdown code fences.
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
Do not wrap the JSON in Markdown code fences.
Output an acceptance_verdict object with:
{
  "outcome": "accept|reject|rework|needs_manual_review",
  "reason": "explanation of verdict",
  "evidence_refs": ["test refs, file refs"],
  "checklist_completed": true|false
}

Do not output any text outside JSON.`;

      default:
        return `Output ONLY valid JSON. Do not wrap the JSON in Markdown code fences. No text outside JSON structure.`;
    }
  }

  /**
   * Add a final short instruction after the rendered envelope so chat models do
   * not answer with analysis prose before the machine-readable object.
   */
  private getJsonOnlyReminder(job: WorkerJob): string {
    const kind = job.instruction_envelope?.required_output.kind ?? `${job.stage}_result`;
    return [
      'Return the final answer now.',
      `Output exactly one raw JSON object for ${kind}.`,
      'The first character must be "{" and the last character must be "}".',
      'Do not include Markdown, code fences, prose, analysis, explanations, or comments.',
    ].join('\n');
  }

  /**
   * Provider profiles may opt into OpenAI-compatible JSON-schema output.
   * The common and GLM profiles keep their existing prompt-only behavior.
   */
  protected getResponseFormat(_job: WorkerJob): ChatCompletionRequest['response_format'] | undefined {
    return undefined;
  }

  /**
   * Remove a single Markdown JSON fence while preserving the raw output artifact.
   */
  private normalizeJsonContent(content: string): string {
    const trimmed = content.trim();
    const fenced = trimmed.match(/^```(?:json|JSON)?\s*([\s\S]*?)\s*```$/);
    return fenced ? fenced[1].trim() : trimmed;
  }

  /**
   * Extract allowed tools from job metadata.
   */
  private extractAllowedTools(job: WorkerJob): string[] {
    return job.instruction_envelope?.allowed_tools.map(tool => tool.name) ?? [];
  }

  /**
   * Convert GLM response to WorkerResult
   */
  protected async convertToWorkerResult(job: WorkerJob, response: ChatCompletionResponse, externalJobId: string): Promise<WorkerResult> {
    const content = response.choices[0]?.message?.content || '';
    const duration = Date.now() - (this.jobStates.get(externalJobId)?.startedAt || Date.now());

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
      const parsed = JSON.parse(this.normalizeJsonContent(content));

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
        delete result.patch_ref;
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
          result.summary = `${this.providerLabel} dev stage produced invalid tool_plan: ${validationErrors.join('; ')}`;
        } else {
          // Valid tool_plan - store as tool_plan artifact and execute local safe tools.
          result.summary = parsed.summary || `${this.providerLabel} completed dev stage`;
          result.artifacts.push({
            artifact_id: `${job.job_id}-tool-plan`,
            kind: 'json',
            uri: `artifact://artifacts/jobs/${job.job_id}/tool-plan.json`,
          });
          const execution = await this.toolPlanExecutor.execute(parsed as ToolPlanOutput, job);
          result.metadata = {
            ...result.metadata,
            tool_plan_execution_verdict: execution.execution_verdict,
            tool_plan_dry_run: execution.dry_run,
            tool_plan_executed: !execution.skipped,
            tool_plan_applied: execution.applied,
            tool_plan_workspace_root: execution.workspace_root ?? null,
            tool_plan_operations: JSON.stringify(execution.operations),
            tool_plan_artifact_paths: JSON.stringify(execution.artifact_paths),
          };
          for (const artifactPath of execution.artifact_paths) {
            result.artifacts.push({
              artifact_id: `${job.job_id}-${artifactPath.replace(/[^A-Za-z0-9_.-]/g, '-')}`,
              kind: artifactPath.endsWith('.json') ? 'json' : 'other',
              uri: `artifact://${artifactPath}`,
            });
          }
          result.test_results.push(...execution.test_results);

          if (execution.errors.length > 0) {
            result.status = 'failed';
            result.failure_class = 'non_retryable_logic';
            result.failure_code = 'tool_plan_execution_failed';
            result.summary = `${this.providerLabel} tool_plan execution failed: ${execution.errors.join('; ')}`;
            result.metadata = {
              ...result.metadata,
              tool_plan_errors: execution.errors.join('; '),
              tool_plan_test_failure_summaries: JSON.stringify(execution.test_failure_summaries),
            };
          } else if (execution.skipped) {
            result.summary = `${result.summary}; tool_plan execution skipped`;
          } else if (execution.dry_run) {
            result.summary = `${result.summary}; tool_plan dry-run completed without workspace writes`;
          } else {
            result.summary = `${result.summary}; tool_plan execution ${execution.applied ? 'applied changes' : 'completed without edits'}`;
          }
        }
      }

      if (job.stage === 'plan' && isEnvelopeMode) {
        // Handle plan_intent for envelope mode
        result.summary = parsed.summary || `${this.providerLabel} completed plan stage`;
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
        result.summary = parsed.summary || `${this.providerLabel} completed ${job.stage} stage`;
      }

    } catch (e) {
      parseError = e instanceof Error ? e.message : 'Unknown parse error';

      this.logger.warn('JSON parse failed for OpenAI-compatible response', {
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
        result.summary = `${this.providerLabel} failed to produce valid JSON: ${parseError}`;
        result.metadata = {
          ...result.metadata,
          parse_error: parseError,
          raw_output_preserved: true,
        };
      } else {
        // Legacy mode: try to extract patch from raw content
        result.summary = `${this.providerLabel} completed ${job.stage} stage`;
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
        provider: this.provider,
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
  protected calculateCost(usage: { prompt_tokens: number; completion_tokens: number }): number {
    // GLM-5 pricing (approximate)
    const inputCostPer1k = 0.001; // $0.001 per 1k input tokens
    const outputCostPer1k = 0.002; // $0.002 per 1k output tokens

    return (usage.prompt_tokens / 1000 * inputCostPer1k) +
           (usage.completion_tokens / 1000 * outputCostPer1k);
  }
}

/** Thin GLM-5 provider profile over the common OpenAI-compatible adapter. */
export class GLM5Adapter extends OpenAICompatibleCompletionAdapter {
  constructor(config: GLM5AdapterConfig = { workerType: 'claude_code' }) {
    const globalConfig = getConfig();
    super({
      ...config,
      provider: config.provider ?? 'alibaba_cloud',
      providerLabel: config.providerLabel ?? 'GLM-5',
      externalJobPrefix: config.externalJobPrefix ?? 'glm',
      model: config.model || globalConfig.worker.glmModel || 'glm-5',
      apiEndpoint: config.apiEndpoint || globalConfig.worker.glmApiEndpoint || 'https://coding-intl.dashscope.aliyuncs.com',
      apiKey: config.apiKey || config.auth?.value || globalConfig.apiKeys.glmApiKey,
    });
  }
}

/**
 * Create GLM-5 adapter instance
 */
export function createGLM5Adapter(config?: GLM5AdapterConfig): GLM5Adapter {
  return new GLM5Adapter(config);
}
