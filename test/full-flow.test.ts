import { describe, it, expect, beforeAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

describe('Full Flow Integration Test', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ logger: false });
  });

  it('should complete full task lifecycle: create -> plan -> dev -> acceptance -> integrate -> publish', async () => {
    // Step 1: Create task
    const createResponse = await app.inject({
      method: 'POST',
      url: '/v1/tasks',
      payload: {
        title: 'Full Flow Test',
        objective: 'Test complete lifecycle',
        typed_ref: 'agent-taskstate:task:github:full-flow-test',
        repo_ref: {
          provider: 'github',
          owner: 'testorg',
          name: 'testrepo',
          default_branch: 'main',
        },
        risk_level: 'high',
        publish_plan: { mode: 'apply', approval_required: true },
        external_refs: [{ kind: 'github_issue', value: '42' }],
      },
    });

    expect(createResponse.statusCode).toBe(201);
    const task = createResponse.json();
    expect(task.state).toBe('queued');
    expect(task.risk_level).toBe('high');
    const taskId = task.task_id;

    // Step 2: Resolve docs
    const resolveResponse = await app.inject({
      method: 'POST',
      url: `/v1/tasks/${taskId}/docs/resolve`,
      payload: { feature: 'core', topic: 'testing' },
    });
    expect(resolveResponse.statusCode).toBe(200);
    expect(resolveResponse.json().doc_refs.length).toBeGreaterThan(0);

    // Step 3: Link tracker
    const trackerResponse = await app.inject({
      method: 'POST',
      url: `/v1/tasks/${taskId}/tracker/link`,
      payload: {
        typed_ref: task.typed_ref,
        entity_ref: 'github_project_item:PVT_item_100',
      },
    });
    expect(trackerResponse.statusCode).toBe(200);

    // Step 4: Dispatch and complete Plan
    const planDispatch = await app.inject({
      method: 'POST',
      url: `/v1/tasks/${taskId}/dispatch`,
      payload: { target_stage: 'plan' },
    });
    expect(planDispatch.statusCode).toBe(202);
    const planJob = planDispatch.json();
    expect(planJob.context?.resolver_refs?.doc_refs).toBeDefined();

    const planResult = await app.inject({
      method: 'POST',
      url: `/v1/tasks/${taskId}/results`,
      payload: {
        job_id: planJob.job_id,
        typed_ref: task.typed_ref,
        status: 'succeeded',
        summary: 'Plan created',
        artifacts: [{ artifact_id: 'plan_art', kind: 'log', uri: 'file:///plan.log' }],
        test_results: [],
        requested_escalations: [],
        usage: { runtime_ms: 2000 },
      },
    });
    expect(planResult.statusCode).toBe(200);
    expect(planResult.json().task.state).toBe('planned');
    expect(planResult.json().next_action).toBe('dispatch_dev');

    // Step 5: Dispatch and complete Dev
    const devDispatch = await app.inject({
      method: 'POST',
      url: `/v1/tasks/${taskId}/dispatch`,
      payload: { target_stage: 'dev' },
    });
    expect(devDispatch.statusCode).toBe(202);
    const devJob = devDispatch.json();

    const devResult = await app.inject({
      method: 'POST',
      url: `/v1/tasks/${taskId}/results`,
      payload: {
        job_id: devJob.job_id,
        typed_ref: task.typed_ref,
        status: 'succeeded',
        summary: 'Implementation complete',
        artifacts: [{ artifact_id: 'dev_art', kind: 'log', uri: 'file:///dev.log' }],
        test_results: [{ suite: 'unit', status: 'passed', passed: 10, failed: 0 }],
        requested_escalations: [],
        usage: { runtime_ms: 5000 },
      },
    });
    expect(devResult.statusCode).toBe(200);
    expect(devResult.json().task.state).toBe('dev_completed');

    // Step 6: Dispatch and complete Acceptance (with regression for high risk)
    const acceptanceDispatch = await app.inject({
      method: 'POST',
      url: `/v1/tasks/${taskId}/dispatch`,
      payload: { target_stage: 'acceptance' },
    });
    expect(acceptanceDispatch.statusCode).toBe(202);
    const acceptanceJob = acceptanceDispatch.json();

    const acceptanceResult = await app.inject({
      method: 'POST',
      url: `/v1/tasks/${taskId}/results`,
      payload: {
        job_id: acceptanceJob.job_id,
        typed_ref: task.typed_ref,
        status: 'succeeded',
        summary: 'Acceptance passed',
        artifacts: [{ artifact_id: 'acceptance_art', kind: 'report', uri: 'file:///acceptance.log' }],
        test_results: [
          { suite: 'acceptance', status: 'passed', passed: 5, failed: 0 },
          { suite: 'regression', status: 'passed', passed: 3, failed: 0 },
        ],
        verdict: { outcome: 'accept', reason: 'All checks passed' },
        requested_escalations: [],
        usage: { runtime_ms: 3000 },
        rollback_notes: 'Rollback: revert to previous version',
      },
    });
    expect(acceptanceResult.statusCode).toBe(200);
    expect(acceptanceResult.json().task.state).toBe('accepted');
    expect(acceptanceResult.json().task.rollback_notes).toBe('Rollback: revert to previous version');

    // Step 7: Integrate
    const integrateResponse = await app.inject({
      method: 'POST',
      url: `/v1/tasks/${taskId}/integrate`,
      payload: { base_sha: 'base123abc' },
    });
    expect(integrateResponse.statusCode).toBe(202);
    expect(integrateResponse.json().state).toBe('integrating');

    const completeIntegrateResponse = await app.inject({
      method: 'POST',
      url: `/v1/tasks/${taskId}/integrate/complete`,
      payload: {
        checks_passed: true,
        integration_head_sha: 'head456def',
        main_updated_sha: 'base123abc',
      },
    });
    expect(completeIntegrateResponse.statusCode).toBe(200);
    expect(completeIntegrateResponse.json().state).toBe('integrated');

    // Step 8: Publish (requires approval)
    const publishResponse = await app.inject({
      method: 'POST',
      url: `/v1/tasks/${taskId}/publish`,
      payload: { mode: 'apply', idempotency_key: 'publish-001' },
    });
    expect(publishResponse.statusCode).toBe(202);
    expect(publishResponse.json().state).toBe('publish_pending_approval');

    // Use the generated approval token
    const approvalToken = publishResponse.json().approval_token;
    expect(approvalToken).toBeDefined();

    const approveResponse = await app.inject({
      method: 'POST',
      url: `/v1/tasks/${taskId}/publish/approve`,
      payload: { approval_token: approvalToken },
    });
    expect(approveResponse.statusCode).toBe(200);
    expect(approveResponse.json().state).toBe('publishing');

    const completePublishResponse = await app.inject({
      method: 'POST',
      url: `/v1/tasks/${taskId}/publish/complete`,
      payload: {
        external_refs: [
          { kind: 'deployment', value: 'prod-deploy-001' },
          { kind: 'release', value: 'v1.2.3' },
        ],
      },
    });
    expect(completePublishResponse.statusCode).toBe(200);
    expect(completePublishResponse.json().state).toBe('published');
    expect(completePublishResponse.json().completed_at).toBeDefined();

    // Verify final task state
    const finalTask = await app.inject({
      method: 'GET',
      url: `/v1/tasks/${taskId}`,
    });
    expect(finalTask.json().state).toBe('published');
    expect(finalTask.json().artifacts.length).toBe(3); // plan, dev, acceptance artifacts
    expect(finalTask.json().external_refs.length).toBeGreaterThan(0);
  });

  it('should handle blocked and rework scenarios', async () => {
    // Create task
    const createResponse = await app.inject({
      method: 'POST',
      url: '/v1/tasks',
      payload: {
        title: 'Rework Test',
        objective: 'Test rework flow',
        typed_ref: 'agent-taskstate:task:github:rework-test',
        repo_ref: {
          provider: 'github',
          owner: 'test',
          name: 'repo',
          default_branch: 'main',
        },
      },
    });
    const task = createResponse.json();
    const taskId = task.task_id;

    // Dispatch plan
    const planDispatch = await app.inject({
      method: 'POST',
      url: `/v1/tasks/${taskId}/dispatch`,
      payload: { target_stage: 'plan' },
    });
    const planJob = planDispatch.json();

    // Plan blocked
    const blockedResult = await app.inject({
      method: 'POST',
      url: `/v1/tasks/${taskId}/results`,
      payload: {
        job_id: planJob.job_id,
        typed_ref: task.typed_ref,
        status: 'blocked',
        summary: 'Missing requirements',
        artifacts: [],
        test_results: [],
        requested_escalations: [{ kind: 'human_verdict', reason: 'Need clarification' }],
        usage: { runtime_ms: 500 },
      },
    });
    expect(blockedResult.statusCode).toBe(200);
    expect(blockedResult.json().task.state).toBe('blocked');

    // Get events
    const eventsResponse = await app.inject({
      method: 'GET',
      url: `/v1/tasks/${taskId}/events`,
    });
    expect(eventsResponse.statusCode).toBe(200);
    expect(eventsResponse.json().items.length).toBeGreaterThan(0);

    // Cancel the task
    const cancelResponse = await app.inject({
      method: 'POST',
      url: `/v1/tasks/${taskId}/cancel`,
    });
    expect(cancelResponse.statusCode).toBe(200);
    expect(cancelResponse.json().state).toBe('cancelled');
  });

  it('should reject high-risk acceptance without regression tests', async () => {
    const createResponse = await app.inject({
      method: 'POST',
      url: '/v1/tasks',
      payload: {
        title: 'High Risk Test',
        objective: 'Test high risk flow',
        typed_ref: 'agent-taskstate:task:github:highrisk-test',
        repo_ref: {
          provider: 'github',
          owner: 'test',
          name: 'repo',
          default_branch: 'main',
        },
        risk_level: 'high',
      },
    });
    const task = createResponse.json();
    const taskId = task.task_id;

    // Complete plan and dev
    const planDispatch = await app.inject({
      method: 'POST',
      url: `/v1/tasks/${taskId}/dispatch`,
      payload: { target_stage: 'plan' },
    });
    await app.inject({
      method: 'POST',
      url: `/v1/tasks/${taskId}/results`,
      payload: {
        job_id: planDispatch.json().job_id,
        typed_ref: task.typed_ref,
        status: 'succeeded',
        artifacts: [{ artifact_id: 'a', kind: 'log', uri: 'x' }],
        test_results: [],
        requested_escalations: [],
        usage: { runtime_ms: 1 },
      },
    });

    const devDispatch = await app.inject({
      method: 'POST',
      url: `/v1/tasks/${taskId}/dispatch`,
      payload: { target_stage: 'dev' },
    });
    await app.inject({
      method: 'POST',
      url: `/v1/tasks/${taskId}/results`,
      payload: {
        job_id: devDispatch.json().job_id,
        typed_ref: task.typed_ref,
        status: 'succeeded',
        artifacts: [{ artifact_id: 'b', kind: 'log', uri: 'x' }],
        test_results: [],
        requested_escalations: [],
        usage: { runtime_ms: 1 },
      },
    });

    // Acceptance without regression
    const acceptanceDispatch = await app.inject({
      method: 'POST',
      url: `/v1/tasks/${taskId}/dispatch`,
      payload: { target_stage: 'acceptance' },
    });
    const acceptanceResult = await app.inject({
      method: 'POST',
      url: `/v1/tasks/${taskId}/results`,
      payload: {
        job_id: acceptanceDispatch.json().job_id,
        typed_ref: task.typed_ref,
        status: 'succeeded',
        artifacts: [],
        test_results: [{ suite: 'acceptance', status: 'passed', passed: 1 }],
        verdict: { outcome: 'accept' },
        requested_escalations: [],
        usage: { runtime_ms: 1 },
      },
    });

    // High risk without regression should go to rework_required
    expect(acceptanceResult.json().task.state).toBe('rework_required');
  });
});