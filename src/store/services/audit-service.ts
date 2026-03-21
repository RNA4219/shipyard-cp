import type { AuditEvent, AuditEventType } from '../../types.js';
import { nowIso, createId } from '../utils.js';

/**
 * Service for audit event management.
 * Extracted from ControlPlaneStore to reduce complexity.
 */
export class AuditService {
  private readonly auditEvents = new Map<string, AuditEvent[]>();

  /**
   * Emit an audit event for a task.
   */
  emitAuditEvent(
    taskId: string,
    eventType: AuditEventType,
    payload: Record<string, unknown>,
    options: {
      runId?: string;
      jobId?: string;
      actorType?: 'control_plane' | 'worker' | 'human' | 'policy_engine' | 'system';
      actorId?: string;
    } = {},
  ): AuditEvent {
    const event: AuditEvent = {
      event_id: createId('audit'),
      event_type: eventType,
      task_id: taskId,
      run_id: options.runId,
      job_id: options.jobId,
      actor_type: options.actorType ?? 'control_plane',
      actor_id: options.actorId ?? 'control_plane',
      payload,
      occurred_at: nowIso(),
    };

    const existing = this.auditEvents.get(taskId) ?? [];
    existing.push(event);
    this.auditEvents.set(taskId, existing);
    return event;
  }

  /**
   * List all audit events for a task.
   */
  listAuditEvents(taskId: string): AuditEvent[] {
    return this.auditEvents.get(taskId) ?? [];
  }

  /**
   * Get audit events for use by RunContext.
   */
  getAuditEvents(taskId: string): AuditEvent[] {
    return this.auditEvents.get(taskId) ?? [];
  }

  /**
   * Clear all audit events (useful for testing).
   */
  clear(): void {
    this.auditEvents.clear();
  }
}