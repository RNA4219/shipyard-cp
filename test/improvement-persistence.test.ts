import { describe, expect, it } from 'vitest';

import { ImprovementObservationService } from '../src/domain/improvement/improvement-observation-service.js';
import { InMemoryControlPlaneRepository } from '../src/store/control-plane-repository.js';
import type { AuditEvent } from '../src/types.js';

describe('Improvement observation persistence boundary', () => {
  it('rebuilds explicit Evidence ack from restored canonical Audit records', async () => {
    const repository = new InMemoryControlPlaneRepository();
    const event: AuditEvent = {
      event_id: 'audit_ack_1',
      event_type: 'evidence.acknowledged',
      task_id: 'task_1',
      actor_type: 'human',
      actor_id: 'reviewer',
      payload: { evidence_id: 'EV-1', reviewed_by: 'reviewer', purpose: 'acceptance' },
      occurred_at: '2026-07-12T00:00:00.000Z',
    };
    await repository.setRecord('audit', event.task_id, { taskId: event.task_id, events: [event] }, 365 * 86400);

    const restored = await repository.listRecords<{ taskId: string; events: AuditEvent[] }>('audit');
    const afterRestart = new ImprovementObservationService().export(restored.flatMap(item => item.events), []);

    expect(afterRestart.evidence_consumption_observations).toMatchObject([{
      evidence_id: 'EV-1',
      reviewed_by: 'reviewer',
      disposition: 'acknowledged',
    }]);
  });
});
