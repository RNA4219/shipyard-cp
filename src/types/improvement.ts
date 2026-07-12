/** Non-blocking runtime observations exported to workflow-cookbook. */
export interface GateCatalogEntry {
  gate_id: string;
  owner: string;
  policy_revision: string;
  hard_safety: boolean;
}

export interface GateObservation {
  observation_id: string;
  task_id: string;
  run_id?: string;
  occurred_at: string;
  gate_id: string;
  owner: string;
  policy_revision: string;
  decision: string;
  effective_action: string;
  transition_changed: boolean | 'unknown';
  risk: string;
  override: 'none' | 'applied' | 'unknown';
  source_event_id: string;
}

export interface EvidenceConsumptionObservation {
  observation_id: string;
  task_id: string;
  evidence_id: string;
  occurred_at: string;
  disposition: 'acknowledged';
  reviewed_by: string;
  purpose?: string;
  source_event_id: string;
}

/** A privacy-safe, one-way projection of a Shipyard retrospective. */
export interface ReflectionSummaryProjection {
  session_id: string;
  task_id: string;
  objective: string;
  changes: Array<{ summary: string }>;
  lessons: Array<{
    observation: string;
    category: 'technical' | 'process' | 'tooling' | 'communication' | 'other';
    actionable: boolean;
  }>;
  open_questions: Array<{
    question: string;
    priority: 'high' | 'medium' | 'low';
    blocking: boolean;
  }>;
  next_actions: Array<{ action: string }>;
  sources: Array<{ type: 'evidence' | 'task'; ref: string }>;
  created_at: string;
  schema_version: 'self-improvement/v1';
}

export interface ImprovementObservationBundle {
  schema_version: 'self-improvement/v1';
  generated_at: string;
  task_count: number;
  since?: string;
  until?: string;
  gate_catalog: GateCatalogEntry[];
  gate_observations: GateObservation[];
  evidence_consumption_observations: EvidenceConsumptionObservation[];
  reflection_summaries: ReflectionSummaryProjection[];
  next_cursor?: string;
}

export interface ImprovementObservationQuery {
  since?: string;
  until?: string;
  cursor?: string;
  limit?: number;
}

export interface EvidenceAcknowledgement {
  acknowledgement_id: string;
  task_id: string;
  evidence_id: string;
  reviewed_by: string;
  purpose?: string;
  acknowledged_at: string;
}
