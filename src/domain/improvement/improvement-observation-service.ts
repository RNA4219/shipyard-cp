import type {
  AuditEvent,
  EvidenceConsumptionObservation,
  GateCatalogEntry,
  GateObservation,
  ImprovementObservationBundle,
  ImprovementObservationQuery,
  ReflectionSummaryProjection,
  Retrospective,
} from '../../types.js';

type ExportItem =
  | { id: string; occurredAt: string; kind: 'gate'; value: GateObservation }
  | { id: string; occurredAt: string; kind: 'evidence'; value: EvidenceConsumptionObservation }
  | { id: string; occurredAt: string; kind: 'reflection'; value: ReflectionSummaryProjection };

/**
 * Builds a disposable improvement projection from canonical audit records.
 * No search index is persisted: a restart can always rebuild this view.
 */
export class ImprovementObservationService {
  export(
    auditEvents: AuditEvent[],
    retrospectives: Retrospective[],
    query: ImprovementObservationQuery = {},
    taskCount = new Set(auditEvents.map(event => event.task_id)).size,
  ): ImprovementObservationBundle {
    const since = parseTimestamp(query.since, 'since');
    const until = parseTimestamp(query.until, 'until');
    if (since !== undefined && until !== undefined && since > until) {
      throw new Error('since must be before or equal to until');
    }

    const limit = normalizeLimit(query.limit);
    const items: ExportItem[] = [
      ...auditEvents.flatMap(event => toExportItems(event)),
      ...retrospectives.map(retrospective => ({
        id: `reflection:${retrospective.retrospective_id}`,
        occurredAt: retrospective.generated_at,
        kind: 'reflection' as const,
        value: adaptRetrospectiveToReflectionSummary(retrospective),
      })),
    ];
    const selected = items
      .filter(item => isWithinWindow(item.occurredAt, since, until))
      .sort(compareExportItems);
    const start = resolveCursor(selected, query.cursor);
    const page = selected.slice(start, start + limit);
    const lastItem = page[page.length - 1];
    const next = selected.length > start + page.length ? lastItem?.id : undefined;
    const gateObservations = page
      .filter((item): item is Extract<ExportItem, { kind: 'gate' }> => item.kind === 'gate')
      .map(item => item.value);

    return {
      schema_version: 'self-improvement/v1',
      generated_at: new Date().toISOString(),
      task_count: taskCount,
      ...(query.since ? { since: query.since } : {}),
      ...(query.until ? { until: query.until } : {}),
      gate_catalog: catalogFrom(gateObservations),
      gate_observations: gateObservations,
      evidence_consumption_observations: page
        .filter((item): item is Extract<ExportItem, { kind: 'evidence' }> => item.kind === 'evidence')
        .map(item => item.value),
      reflection_summaries: page
        .filter((item): item is Extract<ExportItem, { kind: 'reflection' }> => item.kind === 'reflection')
        .map(item => item.value),
      ...(next ? { next_cursor: next } : {}),
    };
  }
}

/** Converts metrics only; narrative, token counters, prompts, and artifacts never leave Shipyard. */
export function adaptRetrospectiveToReflectionSummary(
  retrospective: Retrospective,
): ReflectionSummaryProjection {
  const metrics = retrospective.summary_metrics;
  return {
    session_id: `shipyard-retrospective:${retrospective.retrospective_id}`,
    task_id: retrospective.task_id,
    objective: `Runtime retrospective for task ${retrospective.task_id}`,
    changes: [{
      summary: `Jobs: ${metrics.job_count}; successful: ${metrics.job_success_count}; failed: ${metrics.job_failure_count}; blocked: ${metrics.job_blocked_count}.`,
    }],
    lessons: [{
      observation: `Risk level ${metrics.risk_level}; retries: ${metrics.retry_count}; checkpoints: ${metrics.checkpoint_count}.`,
      category: 'process',
      actionable: true,
    }],
    open_questions: [],
    next_actions: [],
    sources: [{ type: 'task', ref: retrospective.task_id }],
    created_at: retrospective.generated_at,
    schema_version: 'self-improvement/v1',
  };
}

function toExportItems(event: AuditEvent): ExportItem[] {
  if (event.event_type === 'run.systemGateEvaluated') {
    const observation = toGateObservation(event);
    return [{
      id: observation.observation_id,
      occurredAt: observation.occurred_at,
      kind: 'gate',
      value: observation,
    }];
  }
  if (event.event_type === 'evidence.acknowledged') {
    const observation = toEvidenceObservation(event);
    return observation ? [{
      id: observation.observation_id,
      occurredAt: observation.occurred_at,
      kind: 'evidence',
      value: observation,
    }] : [];
  }
  return [];
}

function toGateObservation(event: AuditEvent): GateObservation {
  return {
    observation_id: `gate:${event.event_id}`,
    task_id: event.task_id,
    ...(event.run_id ? { run_id: event.run_id } : {}),
    occurred_at: event.occurred_at,
    gate_id: readString(event.payload, 'gate_id') ?? 'unknown',
    owner: readString(event.payload, 'gate_owner') ?? 'unknown',
    policy_revision: readString(event.payload, 'policy_revision') ?? 'unknown',
    decision: readString(event.payload, 'decision')
      ?? readNestedString(event.payload, 'gatefield', 'verdict')
      ?? 'unknown',
    effective_action: readString(event.payload, 'effective_action') ?? 'unknown',
    transition_changed: readBoolean(event.payload, 'transition_changed') ?? 'unknown',
    risk: readString(event.payload, 'risk') ?? 'unknown',
    override: readOverride(event.payload),
    source_event_id: event.event_id,
  };
}

function toEvidenceObservation(event: AuditEvent): EvidenceConsumptionObservation | undefined {
  const evidenceId = readString(event.payload, 'evidence_id');
  const reviewedBy = readString(event.payload, 'reviewed_by');
  if (!evidenceId || !reviewedBy) return undefined;
  const purpose = readString(event.payload, 'purpose');
  return {
    observation_id: `evidence:${event.event_id}`,
    task_id: event.task_id,
    evidence_id: evidenceId,
    occurred_at: event.occurred_at,
    disposition: 'acknowledged',
    reviewed_by: reviewedBy,
    ...(purpose ? { purpose } : {}),
    source_event_id: event.event_id,
  };
}

function catalogFrom(observations: GateObservation[]): GateCatalogEntry[] {
  const entries = new Map<string, GateCatalogEntry>();
  entries.set('run-system:shipyard-cp:1.0', {
    gate_id: 'run-system',
    owner: 'shipyard-cp',
    policy_revision: '1.0',
    hard_safety: false,
  });
  for (const observation of observations) {
    const key = `${observation.gate_id}:${observation.owner}:${observation.policy_revision}`;
    if (!entries.has(key)) {
      entries.set(key, {
        gate_id: observation.gate_id,
        owner: observation.owner,
        policy_revision: observation.policy_revision,
        hard_safety: observation.gate_id.startsWith('hard-safety:'),
      });
    }
  }
  return [...entries.values()].sort((left, right) => left.gate_id.localeCompare(right.gate_id));
}

function parseTimestamp(value: string | undefined, label: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) throw new Error(`${label} must be an ISO timestamp`);
  return parsed;
}

function isWithinWindow(value: string, since?: number, until?: number): boolean {
  const timestamp = Date.parse(value);
  return !Number.isNaN(timestamp)
    && (since === undefined || timestamp >= since)
    && (until === undefined || timestamp <= until);
}

function normalizeLimit(value: number | undefined): number {
  if (value === undefined) return 100;
  if (!Number.isInteger(value) || value < 1 || value > 500) {
    throw new Error('limit must be an integer from 1 through 500');
  }
  return value;
}

function resolveCursor(items: ExportItem[], cursor: string | undefined): number {
  if (!cursor) return 0;
  const index = items.findIndex(item => item.id === cursor);
  if (index < 0) {
    throw new Error('cursor does not reference an observation in the selected window');
  }
  return index + 1;
}

function compareExportItems(left: ExportItem, right: ExportItem): number {
  return left.occurredAt.localeCompare(right.occurredAt) || left.id.localeCompare(right.id);
}

function readString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readBoolean(payload: Record<string, unknown>, key: string): boolean | undefined {
  const value = payload[key];
  return typeof value === 'boolean' ? value : undefined;
}

function readNestedString(
  payload: Record<string, unknown>,
  key: string,
  nestedKey: string,
): string | undefined {
  const value = payload[key];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const nested = (value as Record<string, unknown>)[nestedKey];
  return typeof nested === 'string' ? nested : undefined;
}

function readOverride(payload: Record<string, unknown>): GateObservation['override'] {
  const value = payload.override;
  if (value === 'none' || value === 'applied') return value;
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const applied = (value as Record<string, unknown>).applied;
    if (typeof applied === 'boolean') return applied ? 'applied' : 'none';
  }
  return 'unknown';
}
