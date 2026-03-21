// Retrospective types: Retrospective, RetrospectiveStatus, SummaryMetrics, NarrativeGeneration, RetrospectiveGenerationRequest

/** Retrospective status */
export type RetrospectiveStatus = 'pending' | 'generating' | 'completed' | 'partial' | 'failed';

/** Summary metrics for a run */
export interface SummaryMetrics {
  total_duration_ms: number;
  stage_durations: Record<string, number>;
  job_count: number;
  job_success_count: number;
  job_failure_count: number;
  job_blocked_count: number;
  retry_count: number;
  retries_by_stage: Record<string, number>;
  risk_level: string;
  forced_high_reasons?: string[];
  litellm_usage?: {
    total_tokens?: number;
    prompt_tokens?: number;
    completion_tokens?: number;
    model?: string;
    routing?: string[];
    fallback_used?: boolean;
  };
  files_changed?: number;
  lines_added?: number;
  lines_deleted?: number;
  checkpoint_count: number;
  checkpoints_by_stage: Record<string, number>;
  acceptance_result?: {
    outcome: string;
    checklist_complete: boolean;
    checked_count: number;
    total_checklist_items: number;
  };
  integrate_result?: {
    checks_passed: boolean;
    main_updated: boolean;
    integration_branch?: string;
  };
  publish_result?: {
    mode: string;
    approval_required: boolean;
    approval_granted?: boolean;
    targets?: string[];
    external_refs_count: number;
  };
  side_effects_detected?: string[];
  stale_docs?: string[];
}

/** Generated narrative */
export interface NarrativeGeneration {
  text: string;
  model: string;
  generated_at: string;
  input_version: string;
  generation_duration_ms?: number;
}

/** Retrospective for a completed run */
export interface Retrospective {
  retrospective_id: string;
  run_id: string;
  task_id: string;
  generation: number;
  status: RetrospectiveStatus;
  generated_at: string;
  summary_metrics: SummaryMetrics;
  narrative?: NarrativeGeneration;
  source_refs: {
    event_cursor: string;
    task_version: number;
  };
  generation_metadata: {
    model: string;
    prompt_version: string;
    source_event_cursor: string;
    input_event_count: number;
    generation_attempts: number;
  };
  error?: string;
}

/** Request for retrospective generation */
export interface RetrospectiveGenerationRequest {
  force?: boolean;
  skip_narrative?: boolean;
  model?: string;
}