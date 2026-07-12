import type { RiskLevel, WorkerJob, WorkerStage, WorkerType } from '../../types.js';

export type ExecutionBackend = 'external' | 'lmstudio';

export interface BackendRouterConfig {
  enabled: boolean;
  routeWorkers: WorkerType[];
  allowedStages: WorkerStage[];
  maxRisk: RiskLevel;
  fallbackStages: WorkerStage[];
}

export interface BackendRoute {
  execution_backend: ExecutionBackend;
  fallback_reason?: string;
  blocked_reason?: string;
}

const riskRank: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };

/** Selects a physical backend while preserving the public logical worker type. */
export class BackendRouter {
  constructor(private readonly config: BackendRouterConfig) {}

  route(
    job: WorkerJob,
    workerType: WorkerType,
    hasAdapter: (backend: ExecutionBackend) => boolean,
  ): BackendRoute {
    if (!this.config.enabled) return { execution_backend: 'external' };

    const eligible = this.config.routeWorkers.includes(workerType)
      && this.config.allowedStages.includes(job.stage)
      && riskRank[job.risk_level] <= riskRank[this.config.maxRisk];
    if (!eligible) return { execution_backend: 'external' };

    if (hasAdapter('lmstudio')) return { execution_backend: 'lmstudio' };

    if (this.config.fallbackStages.includes(job.stage) && hasAdapter('external')) {
      return {
        execution_backend: 'external',
        fallback_reason: 'lmstudio_adapter_unavailable',
      };
    }

    return {
      execution_backend: 'lmstudio',
      blocked_reason: 'WORKER_BACKEND_UNAVAILABLE: LM Studio adapter is unavailable',
    };
  }

  canFallbackToExternal(stage: WorkerStage): boolean {
    return this.config.fallbackStages.includes(stage);
  }
}
