import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AcceptanceService, type AcceptanceContext } from '../src/domain/acceptance/acceptance-service.js';
import type { ManualChecklistService } from '../src/domain/checklist/manual-checklist-service.js';
import type { CheckpointService } from '../src/domain/checkpoint/checkpoint-service.js';
import type { StaleDocsValidator } from '../src/domain/stale-check/stale-docs-validator.js';
import type { Task, StateTransitionEvent, CompleteAcceptanceRequest, AuditEventType } from '../src/types.js';

describe('AcceptanceService', () => {
  let service: AcceptanceService;
  let mockChecklistService: ManualChecklistService;
  let mockCheckpointService: CheckpointService;
  let mockStaleDocsValidator: StaleDocsValidator;
  let mockContext: AcceptanceContext;
  let mockTask: Task;

  beforeEach(() => {
    // Setup mock checklist service
    mockChecklistService = {
      checkItem: vi.fn().mockReturnValue([
        { id: 'tests-passed', description: 'Tests passed', required: true, checked: true },
      ]),
      validateChecklist: vi.fn().mockReturnValue({ valid: true, missing: [] }),
    } as any;

    // Setup mock checkpoint service
    mockCheckpointService = {
      recordCheckpoint: vi.fn().mockReturnValue({
        checkpoint_id: 'cp_123',
        task_id: 'task_123',
        checkpoint_type: 'approval',
        stage: 'acceptance',
        ref: 'approval:task_123:accepted',
      }),
    } as any;

    // Setup mock stale docs validator
    mockStaleDocsValidator = {
      checkStale: vi.fn().mockReturnValue({ can_proceed: true, action: 'proceed' as const }),
    } as any;

    // Setup mock task
    mockTask = {
      task_id: 'task_123',
      state: 'accepting',
      typed_ref: 'agent-taskstate:task:test:123',
      title: 'Test Task',
      objective: 'Test objective',
      last_verdict: {
        outcome: 'accept',
        reason: 'All tests passed',
        timestamp: new Date().toISOString(),
      },
      manual_checklist: [
        { id: 'tests-passed', description: 'Tests passed', required: true, checked: false },
      ],
      artifacts: [
        { artifact_id: 'art_1', kind: 'log', uri: 's3://logs/1', created_at: new Date().toISOString() },
      ],
    } as any;

    // Setup mock context
    mockContext = {
      requireTask: vi.fn().mockReturnValue(mockTask),
      transitionTask: vi.fn().mockImplementation((task, toState, _input) => ({
        event: { event_id: 'evt_1', task_id: task.task_id, from_state: 'accepting', to_state: toState, occurred_at: new Date().toISOString() } as StateTransitionEvent,
        task: { ...task, state: toState },
      })),
      updateTask: vi.fn(),
      emitAuditEvent: vi.fn(),
    };

    service = new AcceptanceService({
      checklistService: mockChecklistService,
      checkpointService: mockCheckpointService,
      staleDocsValidator: mockStaleDocsValidator,
    });
  });

  describe('completeAcceptance', () => {
    it('should complete acceptance successfully', () => {
      const request: CompleteAcceptanceRequest = {
        checked_items: [{ id: 'tests-passed', checked_by: 'user_1' }],
      };

      const result = service.completeAcceptance('task_123', request, mockContext);

      expect(result.task_id).toBe('task_123');
      expect(result.state).toBe('accepted');
      expect(result.checklist_complete).toBe(true);
      expect(result.verdict_outcome).toBe('accept');
      expect(mockContext.transitionTask).toHaveBeenCalledWith(
        expect.anything(),
        'accepted',
        expect.objectContaining({
          actor_type: 'human',
          actor_id: 'manual_acceptance',
          reason: 'manual acceptance completed',
        })
      );
    });

    it('should throw if task is not in accepting state', () => {
      mockTask.state = 'developing';

      expect(() =>
        service.completeAcceptance('task_123', {}, mockContext)
      ).toThrow('task is not in accepting state');
    });

    it('should throw if checklist is not complete', () => {
      vi.mocked(mockChecklistService.validateChecklist).mockReturnValue({
        valid: false,
        missing: ['tests-passed', 'code-review'],
      });

      expect(() =>
        service.completeAcceptance('task_123', {}, mockContext)
      ).toThrow('manual checklist not complete');
    });

    it('should throw if no verdict is available', () => {
      mockTask.last_verdict = undefined;

      expect(() =>
        service.completeAcceptance('task_123', {}, mockContext)
      ).toThrow('no verdict available');
    });

    it('should throw if verdict outcome is not accept', () => {
      mockTask.last_verdict = {
        outcome: 'reject',
        reason: 'Tests failed',
        timestamp: new Date().toISOString(),
      };

      expect(() =>
        service.completeAcceptance('task_123', {}, mockContext)
      ).toThrow("verdict outcome must be 'accept'");
    });

    it('should use override verdict if provided', () => {
      mockTask.last_verdict = undefined;
      const request: CompleteAcceptanceRequest = {
        verdict: {
          outcome: 'accept',
          reason: 'Manual override',
          timestamp: new Date().toISOString(),
        },
      };

      const result = service.completeAcceptance('task_123', request, mockContext);

      expect(result.verdict_outcome).toBe('accept');
    });

    it('should require log artifacts when configured', () => {
      service = new AcceptanceService({
        checklistService: mockChecklistService,
        checkpointService: mockCheckpointService,
        staleDocsValidator: mockStaleDocsValidator,
        requireLogArtifacts: true,
      });

      mockTask.artifacts = [];

      expect(() =>
        service.completeAcceptance('task_123', {}, mockContext)
      ).toThrow('at least one log artifact is required for acceptance completion');
    });

    it('should pass when log artifacts are present and required', () => {
      service = new AcceptanceService({
        checklistService: mockChecklistService,
        checkpointService: mockCheckpointService,
        staleDocsValidator: mockStaleDocsValidator,
        requireLogArtifacts: true,
      });

      const result = service.completeAcceptance('task_123', {}, mockContext);
      expect(result.state).toBe('accepted');
    });

    describe('stale docs validation', () => {
      it('should block acceptance if docs are stale', () => {
        mockTask.resolver_refs = {
          doc_refs: [],
          stale_status: 'stale',
        };

        vi.mocked(mockStaleDocsValidator.checkStale).mockReturnValue({
          can_proceed: false,
          action: 'blocked',
          reason: 'stale_docs_require_reread',
        });

        expect(() =>
          service.completeAcceptance('task_123', {}, mockContext)
        ).toThrow('stale docs detected');
      });

      it('should require rework if docs still stale after reread', () => {
        mockTask.resolver_refs = {
          doc_refs: [],
          stale_status: 'stale',
        };

        vi.mocked(mockStaleDocsValidator.checkStale).mockReturnValue({
          can_proceed: false,
          action: 'rework',
          reason: 'docs_still_stale_after_reread',
        });

        expect(() =>
          service.completeAcceptance('task_123', {}, mockContext)
        ).toThrow('Rework required before acceptance');
      });

      it('should proceed when docs are fresh', () => {
        mockTask.resolver_refs = {
          doc_refs: [],
          stale_status: 'fresh',
        };

        const result = service.completeAcceptance('task_123', {}, mockContext);
        expect(result.state).toBe('accepted');
      });
    });

    it('should update checklist items when provided', () => {
      const request: CompleteAcceptanceRequest = {
        checked_items: [
          { id: 'tests-passed', checked_by: 'user_1', notes: 'All good' },
          { id: 'code-review', checked_by: 'user_2' },
        ],
      };

      service.completeAcceptance('task_123', request, mockContext);

      expect(mockChecklistService.checkItem).toHaveBeenCalledTimes(2);
      expect(mockContext.updateTask).toHaveBeenCalled();
    });

    it('should record checkpoint for acceptance', () => {
      service.completeAcceptance('task_123', {}, mockContext);

      expect(mockCheckpointService.recordCheckpoint).toHaveBeenCalledWith(
        expect.objectContaining({
          task_id: 'task_123',
          checkpoint_type: 'approval',
          stage: 'acceptance',
        })
      );
    });

    it('should emit audit event for verdict', () => {
      service.completeAcceptance('task_123', {}, mockContext);

      expect(mockContext.emitAuditEvent).toHaveBeenCalledWith(
        'task_123',
        'task.verdictSubmitted',
        expect.objectContaining({
          verdict_outcome: 'accept',
          checklist_complete: true,
        })
      );
    });

    it('should handle task without manual checklist', () => {
      mockTask.manual_checklist = undefined;

      const result = service.completeAcceptance('task_123', {}, mockContext);

      expect(result.checklist_complete).toBe(true);
    });

    it('should handle task without artifacts', () => {
      mockTask.artifacts = undefined;

      const result = service.completeAcceptance('task_123', {}, mockContext);
      expect(result.state).toBe('accepted');
    });
  });
});