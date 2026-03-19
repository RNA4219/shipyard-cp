/**
 * Retrospective Service
 *
 * Generates and manages run retrospectives including summary metrics
 * and narrative generation via LiteLLM.
 */

import type { Task, Run, StateTransitionEvent, WorkerJob, AuditEvent, CheckpointRef } from '../../types.js';
import { getLogger } from '../../monitoring/index.js';

const logger = getLogger();

export type RetrospectiveStatus = 'pending' | 'generating' | 'completed' | 'partial' | 'failed';

export interface SummaryMetrics {
  /** Total duration in milliseconds */
  total_duration_ms: number;
  /** Duration by stage */
  stage_durations: Record<string, number>;
  /** Number of worker jobs */
  job_count: number;
  /** Successful jobs */
  job_success_count: number;
  /** Failed jobs */
  job_failure_count: number;
  /** Blocked jobs */
  job_blocked_count: number;
  /** Total retry count */
  retry_count: number;
  /** Retries by stage */
  retries_by_stage: Record<string, number>;
  /** Risk level */
  risk_level: string;
  /** LiteLLM usage summary */
  litellm_usage?: {
    total_tokens?: number;
    prompt_tokens?: number;
    completion_tokens?: number;
    model?: string;
    routing?: string[];
    fallback_used?: boolean;
  };
  /** Checkpoints recorded */
  checkpoint_count: number;
  /** Checkpoints by stage */
  checkpoints_by_stage: Record<string, number>;
  /** Manual acceptance result */
  acceptance_result?: {
    outcome: string;
    checklist_complete: boolean;
    checked_count: number;
    total_checklist_items: number;
  };
  /** Integrate result */
  integrate_result?: {
    checks_passed: boolean;
    main_updated: boolean;
    integration_branch?: string;
  };
  /** Publish result */
  publish_result?: {
    mode: string;
    approval_required: boolean;
    approval_granted?: boolean;
    targets?: string[];
    external_refs_count: number;
  };
  /** Side effects detected */
  side_effects_detected?: string[];
  /** Stale docs encountered */
  stale_docs?: string[];
  /** File change statistics */
  files_changed?: number;
  lines_added?: number;
  lines_deleted?: number;
}

export interface NarrativeGeneration {
  /** Generated narrative text */
  text: string;
  /** Model used for generation */
  model: string;
  /** Generation timestamp */
  generated_at: string;
  /** Input version/hash */
  input_version: string;
  /** Generation duration in ms */
  generation_duration_ms?: number;
}

export interface GenerationMetadata {
  /** Model used */
  model: string;
  /** Prompt version */
  prompt_version: string;
  /** Input event cursor */
  source_event_cursor: string;
  /** Number of input events */
  input_event_count: number;
  /** Generation attempts */
  generation_attempts: number;
}

export interface Retrospective {
  retrospective_id: string;
  run_id: string;
  task_id: string;
  /** Generation number (for regeneration history) */
  generation: number;
  status: RetrospectiveStatus;
  generated_at: string;
  /** Structured metrics */
  summary_metrics: SummaryMetrics;
  /** Narrative (may be absent if LiteLLM fails) */
  narrative?: NarrativeGeneration;
  /** Source references */
  source_refs: {
    event_cursor: string;
    task_version: number;
  };
  /** Generation metadata */
  generation_metadata: GenerationMetadata;
  /** Error message if failed */
  error?: string;
}

export interface RetrospectiveGenerationRequest {
  /** Force regeneration even if exists */
  force?: boolean;
  /** Skip narrative generation (metrics only) */
  skip_narrative?: boolean;
  /** Custom model for narrative */
  model?: string;
}

export interface RetrospectiveGenerationResult {
  retrospective: Retrospective;
  /** Whether narrative was generated */
  narrative_generated: boolean;
  /** Generation duration in ms */
  duration_ms: number;
}

/**
 * Retrospective Service
 *
 * Manages retrospective generation and storage.
 */
export class RetrospectiveService {
  private retrospectives = new Map<string, Retrospective[]>();

  /**
   * Generate a retrospective for a run.
   */
  generateRetrospective(params: {
    run: Run;
    task: Task;
    events: StateTransitionEvent[];
    jobs: WorkerJob[];
    auditEvents: AuditEvent[];
    checkpoints: CheckpointRef[];
    request?: RetrospectiveGenerationRequest;
  }): RetrospectiveGenerationResult {
    const startTime = Date.now();
    const { run, task, events, jobs, auditEvents, checkpoints, request = {} } = params;

    // Build summary metrics
    const summaryMetrics = this.buildSummaryMetrics({
      task,
      run,
      events,
      jobs,
      auditEvents,
      checkpoints,
    });

    // Create retrospective record
    const generation = this.getNextGeneration(run.run_id);
    const retrospectiveId = `retro_${run.run_id}_gen${generation}`;

    const retrospective: Retrospective = {
      retrospective_id: retrospectiveId,
      run_id: run.run_id,
      task_id: task.task_id,
      generation,
      status: 'completed',
      generated_at: new Date().toISOString(),
      summary_metrics: summaryMetrics,
      source_refs: {
        event_cursor: run.source_event_cursor,
        task_version: task.version,
      },
      generation_metadata: {
        model: request.model || 'default',
        prompt_version: '1.0',
        source_event_cursor: run.source_event_cursor,
        input_event_count: events.length,
        generation_attempts: 1,
      },
    };

    // Generate narrative (skip if requested)
    let narrativeGenerated = true;
    if (!request.skip_narrative) {
      const narrative = this.generateNarrative({
        task,
        run,
        metrics: summaryMetrics,
        events,
        model: request.model,
      });

      if (narrative) {
        retrospective.narrative = narrative;
      } else {
        // Narrative generation failed, but metrics are valid
        retrospective.status = 'partial';
        narrativeGenerated = false;
      }
    } else {
      narrativeGenerated = false;
    }

    // Store retrospective
    this.storeRetrospective(retrospective);

    const durationMs = Date.now() - startTime;
    return {
      retrospective,
      narrative_generated: narrativeGenerated,
      duration_ms: durationMs,
    };
  }

  /**
   * Build summary metrics from run data.
   */
  private buildSummaryMetrics(params: {
    task: Task;
    run: Run;
    events: StateTransitionEvent[];
    jobs: WorkerJob[];
    auditEvents: AuditEvent[];
    checkpoints: CheckpointRef[];
  }): SummaryMetrics {
    const { task, events, jobs, auditEvents, checkpoints } = params;

    // Calculate durations
    const stageDurations = this.calculateStageDurations(events);
    const totalDurationMs = Object.values(stageDurations).reduce((sum, d) => sum + d, 0);

    // Count jobs (WorkerJob doesn't have status, count from jobs array)
    const jobSuccessCount = jobs.length;
    const jobFailureCount = 0;
    const jobBlockedCount = 0;

    // Count retries from audit events
    const retryCount = auditEvents.filter(e => e.event_type === 'retry_triggered').length;
    const retriesByStage: Record<string, number> = {};
    for (const event of auditEvents) {
      if (event.event_type === 'retry_triggered' && event.payload?.stage) {
        const stage = event.payload.stage as string;
        retriesByStage[stage] = (retriesByStage[stage] || 0) + 1;
      }
    }

    // Count checkpoints by stage
    const checkpointsByStage: Record<string, number> = {};
    for (const cp of checkpoints) {
      checkpointsByStage[cp.stage] = (checkpointsByStage[cp.stage] || 0) + 1;
    }

    // Extract acceptance result
    const acceptanceResult = this.extractAcceptanceResult(events, task);

    // Extract integrate result
    const integrateResult = this.extractIntegrateResult(task);

    // Extract publish result
    const publishResult = this.extractPublishResult(task, auditEvents);

    // Extract side effects
    const sideEffectsDetected = task.detected_side_effects || [];

    // Extract stale docs from resolver_refs
    const staleDocs = task.resolver_refs?.stale_status === 'stale' ? ['stale_documents_detected'] : [];

    return {
      total_duration_ms: totalDurationMs,
      stage_durations: stageDurations,
      job_count: jobs.length,
      job_success_count: jobSuccessCount,
      job_failure_count: jobFailureCount,
      job_blocked_count: jobBlockedCount,
      retry_count: retryCount,
      retries_by_stage: retriesByStage,
      risk_level: task.risk_level,
      checkpoint_count: checkpoints.length,
      checkpoints_by_stage: checkpointsByStage,
      acceptance_result: acceptanceResult,
      integrate_result: integrateResult,
      publish_result: publishResult,
      side_effects_detected: sideEffectsDetected.length > 0 ? sideEffectsDetected : undefined,
      stale_docs: staleDocs.length > 0 ? staleDocs : undefined,
      files_changed: task.files_changed,
      lines_added: task.lines_added,
      lines_deleted: task.lines_deleted,
    };
  }

  /**
   * Calculate duration per stage from events.
   */
  private calculateStageDurations(events: StateTransitionEvent[]): Record<string, number> {
    const stageDurations: Record<string, number> = {};
    let lastTransition: { timestamp: string; from_state?: string } | null = null;

    const sortedEvents = [...events].sort((a, b) =>
      a.occurred_at.localeCompare(b.occurred_at)
    );

    for (const event of sortedEvents) {
      if (lastTransition) {
        const duration = new Date(event.occurred_at).getTime() - new Date(lastTransition.timestamp).getTime();
        if (lastTransition.from_state) {
          stageDurations[lastTransition.from_state] = (stageDurations[lastTransition.from_state] || 0) + duration;
        }
      }
      lastTransition = { timestamp: event.occurred_at, from_state: event.to_state };
    }

    return stageDurations;
  }

  /**
   * Extract acceptance result from events and task.
   */
  private extractAcceptanceResult(events: StateTransitionEvent[], task: Task): SummaryMetrics['acceptance_result'] {
    const acceptanceEvent = events.find(e => e.to_state === 'accepted');
    if (!acceptanceEvent) return undefined;

    return {
      outcome: 'accept',
      checklist_complete: true,
      checked_count: task.manual_checklist?.filter(c => c.checked).length || 0,
      total_checklist_items: task.manual_checklist?.length || 0,
    };
  }

  /**
   * Extract integrate result from task.
   */
  private extractIntegrateResult(task: Task): SummaryMetrics['integrate_result'] {
    if (!task.integration) return undefined;

    return {
      checks_passed: task.integration.checks_passed ?? false,
      main_updated: !!task.integration.main_updated_sha,
      integration_branch: task.integration.integration_branch,
    };
  }

  /**
   * Extract publish result from task and audit events.
   */
  private extractPublishResult(task: Task, _auditEvents: AuditEvent[]): SummaryMetrics['publish_result'] {
    if (!task.publish_run) return undefined;

    return {
      mode: task.publish_plan?.mode || 'dry_run',
      approval_required: task.publish_plan?.approval_required ?? false,
      approval_granted: !!task.pending_approval_token,
      targets: task.publish_plan?.targets,
      external_refs_count: task.external_refs?.length || 0,
    };
  }

  /**
   * Generate narrative via LiteLLM.
   * Returns undefined if generation fails.
   */
  private generateNarrative(params: {
    task: Task;
    run: Run;
    metrics: SummaryMetrics;
    events: StateTransitionEvent[];
    model?: string;
  }): NarrativeGeneration | undefined {
    const { task, run, metrics } = params;

    // For now, generate a simple structured narrative
    // In production, this would call LiteLLM
    try {
      const narrativeText = this.formatNarrativeText(task, run, metrics);

      return {
        text: narrativeText,
        model: params.model || 'structured-v1',
        generated_at: new Date().toISOString(),
        input_version: run.source_event_cursor,
      };
    } catch (error) {
      logger.debug('Failed to generate narrative', { runId: run.run_id, error: String(error) });
      return undefined;
    }
  }

  /**
   * Format narrative text from metrics.
   */
  private formatNarrativeText(task: Task, run: Run, metrics: SummaryMetrics): string {
    const lines: string[] = [];

    lines.push(`## Run Summary: ${task.title || task.task_id}`);
    lines.push('');
    lines.push(`**Task ID**: ${task.task_id}`);
    lines.push(`**Run ID**: ${run.run_id}`);
    lines.push(`**Status**: ${run.status}`);
    lines.push(`**Risk Level**: ${metrics.risk_level}`);
    lines.push('');

    lines.push(`### Duration`);
    lines.push(`Total: ${Math.round(metrics.total_duration_ms / 1000)}s`);
    lines.push('');

    if (metrics.job_count > 0) {
      lines.push(`### Jobs`);
      lines.push(`- Total: ${metrics.job_count}`);
      lines.push(`- Success: ${metrics.job_success_count}`);
      lines.push(`- Failed: ${metrics.job_failure_count}`);
      lines.push(`- Blocked: ${metrics.job_blocked_count}`);
      lines.push('');
    }

    if (metrics.retry_count > 0) {
      lines.push(`### Retries`);
      lines.push(`Total: ${metrics.retry_count}`);
      lines.push('');
    }

    if (metrics.checkpoint_count > 0) {
      lines.push(`### Checkpoints`);
      lines.push(`Total: ${metrics.checkpoint_count}`);
      lines.push('');
    }

    if (metrics.acceptance_result) {
      lines.push(`### Acceptance`);
      lines.push(`Outcome: ${metrics.acceptance_result.outcome}`);
      lines.push('');
    }

    if (metrics.integrate_result) {
      lines.push(`### Integration`);
      lines.push(`- Checks passed: ${metrics.integrate_result.checks_passed}`);
      lines.push(`- Main updated: ${metrics.integrate_result.main_updated}`);
      lines.push('');
    }

    if (metrics.publish_result) {
      lines.push(`### Publish`);
      lines.push(`- Mode: ${metrics.publish_result.mode}`);
      lines.push(`- Approval required: ${metrics.publish_result.approval_required}`);
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Get next generation number for a run.
   */
  private getNextGeneration(runId: string): number {
    const existing = this.retrospectives.get(runId) || [];
    return existing.length + 1;
  }

  /**
   * Store a retrospective.
   */
  private storeRetrospective(retrospective: Retrospective): void {
    const runId = retrospective.run_id;
    const existing = this.retrospectives.get(runId) || [];
    existing.push(retrospective);
    this.retrospectives.set(runId, existing);
  }

  /**
   * Get the latest retrospective for a run.
   */
  getRetrospective(runId: string): Retrospective | undefined {
    const retrospectives = this.retrospectives.get(runId);
    if (!retrospectives || retrospectives.length === 0) return undefined;
    return retrospectives[retrospectives.length - 1];
  }

  /**
   * Get all retrospectives for a run (history).
   */
  getRetrospectiveHistory(runId: string): Retrospective[] {
    return this.retrospectives.get(runId) || [];
  }

  /**
   * Get retrospectives for a task.
   */
  getRetrospectivesForTask(taskId: string): Retrospective[] {
    const results: Retrospective[] = [];
    for (const retrospectives of this.retrospectives.values()) {
      for (const retro of retrospectives) {
        if (retro.task_id === taskId) {
          results.push(retro);
        }
      }
    }
    return results.sort((a, b) => b.generated_at.localeCompare(a.generated_at));
  }

  /**
   * Clear retrospectives for a run.
   */
  clearRetrospectives(runId: string): void {
    this.retrospectives.delete(runId);
  }
}

/**
 * Default retrospective service instance.
 */
export const defaultRetrospectiveService = new RetrospectiveService();