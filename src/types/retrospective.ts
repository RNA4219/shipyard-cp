/**
 * Retrospective types
 */

// Retrospective status
export type RetrospectiveStatus = 'pending' | 'generating' | 'completed' | 'partial' | 'failed';

// Summary metrics for a run
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

// Generated narrative
export interface NarrativeGeneration {
  text: string;
  model: string;
  generated_at: string;
  input_version: string;
  generation_duration_ms?: number;
}

// Retrospective for a completed run
export interface Retrospective {
  retrospective_id: string;
  run_id: string;
  task_id: string;
  status: RetrospectiveStatus;
  metrics: SummaryMetrics;
  narrative?: NarrativeGeneration;
  generated_at?: string;
  generated_by?: string;
  created_at: string;
  updated_at: string;
}

// Retrospective generation request
export interface RetrospectiveGenerationRequest {
  run_id: string;
  model?: string;
  include_narrative?: boolean;
}