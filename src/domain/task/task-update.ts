import type {
  Task,
  ArtifactRef,
  ExternalRef,
  ResolverRefs,
  Verdict,
  FailureClass,
  SideEffectCategory,
  BlockedContext,
  WorkerStage,
} from '../../types.js';

/**
 * Represents a partial update to a Task.
 * Services return these updates, and the Store applies them immutably.
 */
export interface TaskUpdate {
  artifacts?: ArtifactRef[];
  mergeArtifacts?: ArtifactRef[];
  resolver_refs?: Partial<ResolverRefs>;
  mergeResolverRefs?: Partial<ResolverRefs>;
  external_refs?: ExternalRef[];
  mergeExternalRefs?: ExternalRef[];
  context_bundle_ref?: string;
  rollback_notes?: string;
  last_verdict?: Verdict;
  retry_counts?: Partial<Record<WorkerStage, number>>;
  last_failure_class?: FailureClass;
  loop_fingerprint?: string;
  detected_side_effects?: SideEffectCategory[];
  blocked_context?: BlockedContext;
  active_job_id?: string;
  manual_checklist?: Task['manual_checklist'];
}

/**
 * Applies a TaskUpdate to a Task immutably.
 * Returns a new Task object with the updates applied.
 */
export function applyTaskUpdate(task: Task, update: TaskUpdate): Task {
  const updated = { ...task };

  // Direct replacements
  if (update.artifacts !== undefined) {
    updated.artifacts = update.artifacts;
  }
  if (update.resolver_refs !== undefined) {
    updated.resolver_refs = {
      ...updated.resolver_refs,
      ...update.resolver_refs,
    };
  }
  if (update.external_refs !== undefined) {
    updated.external_refs = update.external_refs;
  }
  if (update.context_bundle_ref !== undefined) {
    updated.context_bundle_ref = update.context_bundle_ref;
  }
  if (update.rollback_notes !== undefined) {
    updated.rollback_notes = update.rollback_notes;
  }
  if (update.last_verdict !== undefined) {
    updated.last_verdict = update.last_verdict;
  }
  if (update.last_failure_class !== undefined) {
    updated.last_failure_class = update.last_failure_class;
  }
  if (update.loop_fingerprint !== undefined) {
    updated.loop_fingerprint = update.loop_fingerprint;
  }
  if (update.detected_side_effects !== undefined) {
    updated.detected_side_effects = update.detected_side_effects;
  }
  if (update.blocked_context !== undefined) {
    updated.blocked_context = update.blocked_context;
  }
  if (update.active_job_id !== undefined) {
    updated.active_job_id = update.active_job_id;
  }
  if (update.manual_checklist !== undefined) {
    updated.manual_checklist = update.manual_checklist;
  }

  // Merge operations
  if (update.mergeArtifacts) {
    updated.artifacts = [...(updated.artifacts ?? []), ...update.mergeArtifacts];
  }

  if (update.mergeResolverRefs) {
    updated.resolver_refs = {
      ...updated.resolver_refs,
      ...update.mergeResolverRefs,
    };
  }

  if (update.mergeExternalRefs) {
    const existing = updated.external_refs ?? [];
    const existingValues = new Set(existing.map((e: ExternalRef) => e.value));
    const uniqueNew = update.mergeExternalRefs.filter(e => !existingValues.has(e.value));
    updated.external_refs = [...existing, ...uniqueNew];
  }

  if (update.retry_counts) {
    updated.retry_counts = {
      ...updated.retry_counts,
      ...update.retry_counts,
    };
  }

  // Touch the task
  updated.version += 1;
  updated.updated_at = new Date().toISOString();

  return updated;
}

/**
 * Merges multiple TaskUpdates into a single update.
 * Later updates override earlier ones for direct fields.
 * Merge operations are combined.
 */
export function mergeTaskUpdates(...updates: TaskUpdate[]): TaskUpdate {
  const merged: TaskUpdate = {};

  for (const update of updates) {
    // Direct fields - later wins
    if (update.artifacts !== undefined) merged.artifacts = update.artifacts;
    if (update.resolver_refs !== undefined) {
      merged.resolver_refs = {
        ...(merged.resolver_refs ?? {}),
        ...update.resolver_refs,
      };
    }
    if (update.external_refs !== undefined) merged.external_refs = update.external_refs;
    if (update.context_bundle_ref !== undefined) merged.context_bundle_ref = update.context_bundle_ref;
    if (update.rollback_notes !== undefined) merged.rollback_notes = update.rollback_notes;
    if (update.last_verdict !== undefined) merged.last_verdict = update.last_verdict;
    if (update.last_failure_class !== undefined) merged.last_failure_class = update.last_failure_class;
    if (update.loop_fingerprint !== undefined) merged.loop_fingerprint = update.loop_fingerprint;
    if (update.detected_side_effects !== undefined) merged.detected_side_effects = update.detected_side_effects;
    if (update.blocked_context !== undefined) merged.blocked_context = update.blocked_context;
    if (update.active_job_id !== undefined) merged.active_job_id = update.active_job_id;
    if (update.manual_checklist !== undefined) merged.manual_checklist = update.manual_checklist;

    // Merge fields - combine
    if (update.mergeArtifacts) {
      merged.mergeArtifacts = [...(merged.mergeArtifacts ?? []), ...update.mergeArtifacts];
    }
    if (update.mergeResolverRefs) {
      merged.mergeResolverRefs = {
        ...(merged.mergeResolverRefs ?? {}),
        ...update.mergeResolverRefs,
      };
    }
    if (update.mergeExternalRefs) {
      merged.mergeExternalRefs = [
        ...(merged.mergeExternalRefs ?? []),
        ...update.mergeExternalRefs,
      ];
    }
    if (update.retry_counts) {
      merged.retry_counts = {
        ...(merged.retry_counts ?? {}),
        ...update.retry_counts,
      };
    }
  }

  return merged;
}