import { describe, it, expect, beforeEach } from 'vitest';
import { AuditService } from '../src/store/services/audit-service.js';
import type { AuditEvent } from '../src/types.js';

describe('AuditService', () => {
  let service: AuditService;

  beforeEach(() => {
    service = new AuditService();
  });

  describe('emitAuditEvent', () => {
    it('should emit an audit event with required fields', () => {
      const event = service.emitAuditEvent('task_123', 'state_change', {
        from: 'queued',
        to: 'planning',
      });

      expect(event.event_id).toMatch(/^audit_/);
      expect(event.event_type).toBe('state_change');
      expect(event.task_id).toBe('task_123');
      expect(event.payload).toEqual({ from: 'queued', to: 'planning' });
      expect(event.occurred_at).toBeDefined();
    });

    it('should emit event with optional run_id', () => {
      const event = service.emitAuditEvent('task_123', 'job_started',
        { job_id: 'job_456' },
        { runId: 'run_789' }
      );

      expect(event.run_id).toBe('run_789');
      expect(event.payload.job_id).toBe('job_456');
    });

    it('should emit event with optional job_id', () => {
      const event = service.emitAuditEvent('task_123', 'job_completed',
        { result: 'success' },
        { jobId: 'job_456' }
      );

      expect(event.job_id).toBe('job_456');
    });

    it('should emit event with custom actor_type', () => {
      const event = service.emitAuditEvent('task_123', 'approval_granted',
        { approver: 'admin' },
        { actorType: 'human' }
      );

      expect(event.actor_type).toBe('human');
    });

    it('should emit event with custom actor_id', () => {
      const event = service.emitAuditEvent('task_123', 'manual_override',
        { reason: 'emergency' },
        { actorId: 'admin_user' }
      );

      expect(event.actor_id).toBe('admin_user');
    });

    it('should default actor_type to control_plane', () => {
      const event = service.emitAuditEvent('task_123', 'state_change', {});

      expect(event.actor_type).toBe('control_plane');
    });

    it('should default actor_id to control_plane', () => {
      const event = service.emitAuditEvent('task_123', 'state_change', {});

      expect(event.actor_id).toBe('control_plane');
    });

    it('should append multiple events for the same task', () => {
      service.emitAuditEvent('task_123', 'state_change', { from: 'queued', to: 'planning' });
      service.emitAuditEvent('task_123', 'job_started', { job_id: 'job_456' });
      service.emitAuditEvent('task_123', 'job_completed', { result: 'success' });

      const events = service.listAuditEvents('task_123');
      expect(events).toHaveLength(3);
    });

    it('should handle events for different tasks independently', () => {
      service.emitAuditEvent('task_123', 'state_change', { from: 'queued', to: 'planning' });
      service.emitAuditEvent('task_456', 'state_change', { from: 'queued', to: 'developing' });

      expect(service.listAuditEvents('task_123')).toHaveLength(1);
      expect(service.listAuditEvents('task_456')).toHaveLength(1);
    });
  });

  describe('listAuditEvents', () => {
    it('should return empty array for task with no events', () => {
      const events = service.listAuditEvents('nonexistent_task');
      expect(events).toEqual([]);
    });

    it('should return all events for a task', () => {
      service.emitAuditEvent('task_123', 'state_change', { from: 'queued', to: 'planning' });
      service.emitAuditEvent('task_123', 'job_started', { job_id: 'job_456' });

      const events = service.listAuditEvents('task_123');
      expect(events).toHaveLength(2);
      expect(events[0].event_type).toBe('state_change');
      expect(events[1].event_type).toBe('job_started');
    });
  });

  describe('getAuditEvents', () => {
    it('should return same result as listAuditEvents', () => {
      service.emitAuditEvent('task_123', 'state_change', { from: 'queued', to: 'planning' });

      const listResult = service.listAuditEvents('task_123');
      const getResult = service.getAuditEvents('task_123');

      expect(listResult).toEqual(getResult);
    });

    it('should return empty array for nonexistent task', () => {
      const events = service.getAuditEvents('nonexistent_task');
      expect(events).toEqual([]);
    });
  });

  describe('clear', () => {
    it('should clear all audit events', () => {
      service.emitAuditEvent('task_123', 'state_change', {});
      service.emitAuditEvent('task_456', 'state_change', {});

      service.clear();

      expect(service.listAuditEvents('task_123')).toEqual([]);
      expect(service.listAuditEvents('task_456')).toEqual([]);
    });
  });

  describe('event types', () => {
    it('should support all audit event types', () => {
      const eventTypes: Array<AuditEvent['event_type']> = [
        'state_change',
        'job_started',
        'job_completed',
        'approval_granted',
        'approval_denied',
        'manual_override',
        'risk_assessment',
        'policy_evaluation',
        'artifact_created',
        'task_created',
        'task_updated',
      ];

      eventTypes.forEach((eventType, index) => {
        const event = service.emitAuditEvent(`task_${index}`, eventType, {});
        expect(event.event_type).toBe(eventType);
      });
    });
  });
});