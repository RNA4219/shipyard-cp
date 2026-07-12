import { describe, expect, it } from 'vitest';

import {
  ImprovementObservationService,
  adaptRetrospectiveToReflectionSummary,
} from '../src/domain/improvement/improvement-observation-service.js';
import type { AuditEvent, Retrospective } from '../src/types.js';

function audit(
  eventType: AuditEvent['event_type'],
  payload: Record<string, unknown>,
  eventId: string,
  occurredAt = '2026-07-12T00:00:00.000Z',
): AuditEvent {
  return {
    event_id: eventId,
    event_type: eventType,
    task_id: 'task_1',
    run_id: 'run_1',
    actor_type: 'system',
    actor_id: 'test',
    payload,
    occurred_at: occurredAt,
  };
}

describe('ImprovementObservationService', () => {
  it('exports sanitized Gate and Evidence acknowledgement observations', () => {
    const service = new ImprovementObservationService();
    const bundle = service.export([
      audit('run.systemGateEvaluated', {
        gate_id: 'run-system',
        gate_owner: 'shipyard-cp',
        policy_revision: '1.0',
        decision: 'hold',
        effective_action: 'block',
        transition_changed: true,
        risk: 'conditional_go',
        override: 'none',
        prompt: 'must not export',
        token_count: 123,
      }, 'audit_gate'),
      audit('evidence.acknowledged', {
        evidence_id: 'EV-1',
        reviewed_by: 'operator',
        purpose: 'acceptance',
      }, 'audit_ack', '2026-07-12T00:01:00.000Z'),
    ], []);

    expect(bundle.gate_observations).toMatchObject([{
      gate_id: 'run-system',
      decision: 'hold',
      transition_changed: true,
    }]);
    expect(bundle.evidence_consumption_observations).toMatchObject([{
      evidence_id: 'EV-1',
      reviewed_by: 'operator',
    }]);
    expect(JSON.stringify(bundle)).not.toContain('must not export');
    expect(JSON.stringify(bundle)).not.toContain('token_count');
  });

  it('uses unknown for legacy gaps and supports cursor paging', () => {
    const service = new ImprovementObservationService();
    const events = [
      audit('run.systemGateEvaluated', { gatefield: { verdict: 'pass' } }, 'audit_old'),
      audit('evidence.acknowledged', {
        evidence_id: 'EV-1',
        reviewed_by: 'operator',
      }, 'audit_ack', '2026-07-12T00:01:00.000Z'),
    ];
    const first = service.export(events, [], { limit: 1 });
    const second = service.export(events, [], { limit: 1, cursor: first.next_cursor });

    expect(first.gate_observations[0]).toMatchObject({
      gate_id: 'unknown',
      policy_revision: 'unknown',
      transition_changed: 'unknown',
    });
    expect(second.evidence_consumption_observations).toHaveLength(1);
  });

  it('adapts retrospectives without narrative or token data', () => {
    const retrospective: Retrospective = {
      retrospective_id: 'retro_1',
      run_id: 'run_1',
      task_id: 'task_1',
      generation: 1,
      status: 'completed',
      generated_at: '2026-07-12T00:00:00.000Z',
      summary_metrics: {
        total_duration_ms: 12,
        stage_durations: {},
        job_count: 1,
        job_success_count: 1,
        job_failure_count: 0,
        job_blocked_count: 0,
        retry_count: 0,
        retries_by_stage: {},
        risk_level: 'low',
        checkpoint_count: 0,
        checkpoints_by_stage: {},
        litellm_usage: { total_tokens: 999, prompt_tokens: 100, completion_tokens: 899 },
      },
      narrative: {
        text: 'raw worker output',
        model: 'test',
        generated_at: '2026-07-12T00:00:00.000Z',
        input_version: 'v1',
      },
      source_refs: { event_cursor: 'cursor', task_version: 1 },
      generation_metadata: {
        model: 'test',
        prompt_version: 'v1',
        source_event_cursor: 'cursor',
        input_event_count: 1,
        generation_attempts: 1,
      },
    };

    const projection = adaptRetrospectiveToReflectionSummary(retrospective);
    expect(JSON.stringify(projection)).not.toContain('raw worker output');
    expect(JSON.stringify(projection)).not.toContain('999');
    expect(projection.sources).toEqual([{ type: 'task', ref: 'task_1' }]);
  });
});
