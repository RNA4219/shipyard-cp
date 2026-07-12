import type { RiskLevel, WorkerStage, WorkerType } from '../../types.js';
import type { ChatCompletionRequest } from '../litellm/litellm-connector.js';
import type { JobSubmissionResult, WorkerCapabilities, WorkerJob } from './worker-adapter.js';
import { OpenAICompatibleCompletionAdapter, type OpenAICompatibleCompletionAdapterConfig } from './openai-compatible-completion-adapter.js';

/**
 * Configuration for LM Studio's OpenAI-compatible API.
 *
 * LM Link remains transparent to this adapter: LM Studio owns remote model
 * selection while Shipyard only calls the local OpenAI-compatible endpoint.
 */
export interface LMStudioAdapterConfig extends Omit<OpenAICompatibleCompletionAdapterConfig, 'provider' | 'providerLabel' | 'externalJobPrefix'> {
  workerType: WorkerType;
  maxConcurrentJobs?: number;
  allowedStages?: WorkerStage[];
  maxRisk?: RiskLevel;
}

/**
 * Structured-completion adapter for LM Studio and LM Link.
 *
 * It reuses Shipyard's envelope validation and safe ToolPlanExecutor; model
 * lifecycle and remote-device selection remain entirely in LM Studio.
 */
export class LMStudioAdapter extends OpenAICompatibleCompletionAdapter {
  private readonly maxConcurrentJobs: number;
  private readonly allowedStages: ReadonlySet<WorkerStage>;
  private readonly maxRisk: RiskLevel;

  constructor(config: LMStudioAdapterConfig) {
    super({
      ...config,
      provider: 'lmstudio',
      providerLabel: 'LM Studio',
      externalJobPrefix: 'lmstudio',
    });
    this.maxConcurrentJobs = config.maxConcurrentJobs ?? 1;
    this.allowedStages = new Set(config.allowedStages ?? ['plan', 'dev']);
    this.maxRisk = config.maxRisk ?? 'low';
  }

  override async submitJob(job: WorkerJob): Promise<JobSubmissionResult> {
    if (!this.allowedStages.has(job.stage) || !this.isRiskAllowed(job.risk_level)) {
      return {
        success: false,
        status: 'rejected',
        error: 'WORKER_BACKEND_POLICY_DENIED: LM Studio is limited by stage/risk policy',
      };
    }
    return super.submitJob(job);
  }

  private isRiskAllowed(risk: RiskLevel): boolean {
    const rank: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };
    return rank[risk] <= rank[this.maxRisk];
  }

  override async getCapabilities(): Promise<WorkerCapabilities> {
    const capabilities = await super.getCapabilities();
    return {
      ...capabilities,
      worker_type: this.workerType,
      max_concurrent_jobs: this.maxConcurrentJobs,
      metadata: {
        ...capabilities.metadata,
        provider: 'lmstudio',
        lm_link_transparent: true,
      },
    };
  }

  /** Local inference has no cloud-provider token price. */
  protected override calculateCost(): number {
    return 0;
  }

  /**
   * LM Studio supports grammar-constrained JSON schema through the OpenAI
   * compatible chat endpoint. Request it only for the LM Studio profile so
   * GLM compatibility keeps its existing prompt-only contract.
   */
  protected override getResponseFormat(job: WorkerJob): ChatCompletionRequest['response_format'] {
    return {
      type: 'json_schema',
      json_schema: {
        name: `${job.stage}_result`,
        strict: true,
        schema: this.getStructuredOutputSchema(job.stage),
      },
    };
  }

  private getStructuredOutputSchema(stage: WorkerStage): Record<string, unknown> {
    const stringArray = { type: 'array', items: { type: 'string' } };

    if (stage === 'plan') {
      return {
        type: 'object',
        additionalProperties: false,
        properties: {
          summary: { type: 'string' },
          steps: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                description: { type: 'string' },
                files_to_modify: stringArray,
                estimated_complexity: { type: 'string', enum: ['low', 'medium', 'high'] },
              },
              required: ['description', 'files_to_modify', 'estimated_complexity'],
            },
          },
          risks: stringArray,
          dependencies: stringArray,
          evidence: stringArray,
        },
        required: ['summary', 'steps', 'risks', 'dependencies', 'evidence'],
      };
    }

    if (stage === 'dev') {
      return {
        type: 'object',
        additionalProperties: false,
        properties: {
          summary: { type: 'string' },
          calls: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                tool: { type: 'string' },
                args: { type: 'object', additionalProperties: true },
              },
              required: ['tool', 'args'],
            },
          },
          evidence: stringArray,
        },
        required: ['summary', 'calls', 'evidence'],
      };
    }

    return {
      type: 'object',
      additionalProperties: false,
      properties: {
        outcome: { type: 'string', enum: ['accept', 'reject', 'rework', 'needs_manual_review'] },
        reason: { type: 'string' },
        evidence_refs: stringArray,
        checklist_completed: { type: 'boolean' },
      },
      required: ['outcome', 'reason', 'evidence_refs', 'checklist_completed'],
    };
  }
}

