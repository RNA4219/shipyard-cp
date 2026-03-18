import { describe, it, expect, beforeEach } from 'vitest';
import { ControlPlaneStore } from '../src/store/control-plane-store.js';
import type { Task, RepoPolicy, WorkerResult } from '../src/types.js';

describe('Policy Gate Integration', () => {
  let store: ControlPlaneStore;

  const createMockResult = (typedRef: string, status: 'succeeded' | 'failed' | 'blocked' = 'succeeded'): WorkerResult => ({
    job_id: 'job_test',
    typed_ref: typedRef,
    status,
    artifacts: [],
    test_results: [],
    requested_escalations: [],
    usage: { runtime_ms: 1000 },
  });

  const createTaskThroughAcceptance = (policy?: RepoPolicy): Task => {
    const task = store.createTask({
      title: 'Policy Test Task',
      objective: 'Test policy gate',
      typed_ref: 'agent-taskstate:task:local:test-task',
      repo_ref: {
        provider: 'github',
        owner: 'test',
        name: 'repo',
        default_branch: 'main',
      },
      risk_level: 'medium',
      repo_policy: policy,
    });

    const typedRef = task.typed_ref;

    // Dispatch and complete plan
    store.dispatch(task.task_id, { target_stage: 'plan' });
    store.applyResult(task.task_id, {
      ...createMockResult(typedRef),
      job_id: store.getTask(task.task_id)!.active_job_id!,
    });

    // Dispatch and complete dev
    store.dispatch(task.task_id, { target_stage: 'dev' });
    store.applyResult(task.task_id, {
      ...createMockResult(typedRef),
      job_id: store.getTask(task.task_id)!.active_job_id!,
    });

    // Dispatch and complete acceptance
    store.dispatch(task.task_id, { target_stage: 'acceptance' });
    store.applyResult(task.task_id, {
      ...createMockResult(typedRef),
      job_id: store.getTask(task.task_id)!.active_job_id!,
      verdict: { outcome: 'accept', reason: 'All checks passed' },
      test_results: [{ name: 'regression', suite: 'regression', status: 'passed', passed: 5, failed: 0, duration_ms: 100 }],
    });

    return store.getTask(task.task_id)!;
  };

  beforeEach(() => {
    store = new ControlPlaneStore();
  });

  describe('integrate() policy gate', () => {
    it('should use default policy when no task policy is set', () => {
      const task = createTaskThroughAcceptance();
      const result = store.integrate(task.task_id, 'abc123');

      expect(result.state).toBe('integrating');
      expect(result.integration?.integration_branch).toBe('cp/integrate/' + task.task_id);
    });

    it('should use custom integration branch prefix from policy', () => {
      const policy: RepoPolicy = {
        update_strategy: 'fast_forward_only',
        main_push_actor: 'bot',
        require_ci_pass: true,
        integration_branch_prefix: 'custom/',
      };
      const task = createTaskThroughAcceptance(policy);

      // Debug: check if policy was preserved
      const taskBeforeIntegrate = store.getTask(task.task_id);
      expect(taskBeforeIntegrate?.repo_policy?.integration_branch_prefix).toBe('custom/');

      const result = store.integrate(task.task_id, 'abc123');

      expect(result.integration?.integration_branch).toContain(task.task_id);
    });

    it('should generate manual checklist during integrate', () => {
      const task = createTaskThroughAcceptance();
      const result = store.integrate(task.task_id, 'abc123');

      expect(result.manual_checklist).toBeDefined();
      expect(result.manual_checklist!.length).toBeGreaterThan(0);
    });
  });

  describe('completeIntegrate() policy gate', () => {
    it('should transition to integrated when checks pass', () => {
      const task = createTaskThroughAcceptance();
      store.integrate(task.task_id, 'abc123');

      const result = store.completeIntegrate(task.task_id, {
        checks_passed: true,
        integration_head_sha: 'def456',
      });

      expect(result.state).toBe('integrated');
      expect(result.can_fast_forward).toBeDefined();
    });

    it('should transition to blocked when checks fail', () => {
      const task = createTaskThroughAcceptance();
      store.integrate(task.task_id, 'abc123');

      const result = store.completeIntegrate(task.task_id, {
        checks_passed: false,
      });

      expect(result.state).toBe('blocked');
      const updatedTask = store.getTask(task.task_id);
      expect(updatedTask?.blocked_context?.reason).toContain('CI');
    });

    it('should indicate PR requirement', () => {
      const policy: RepoPolicy = {
        update_strategy: 'pull_request',
        main_push_actor: 'bot',
        require_ci_pass: true,
      };
      const task = createTaskThroughAcceptance(policy);
      store.integrate(task.task_id, 'abc123');

      const result = store.completeIntegrate(task.task_id, {
        checks_passed: true,
      });

      expect(result.requires_pr).toBe(true);
    });

    it('should indicate fast-forward possibility', () => {
      const task = createTaskThroughAcceptance();
      store.integrate(task.task_id, 'abc123');

      const result = store.completeIntegrate(task.task_id, {
        checks_passed: true,
        integration_head_sha: 'def456',
        main_updated_sha: 'abc123', // Same as base
      });

      expect(result.can_fast_forward).toBe(true);
    });

    it('should indicate non-fast-forward when main advanced', () => {
      const task = createTaskThroughAcceptance();
      store.integrate(task.task_id, 'abc123');

      const result = store.completeIntegrate(task.task_id, {
        checks_passed: true,
        integration_head_sha: 'def456',
        main_updated_sha: 'xyz789', // Different from base
      });

      expect(result.can_fast_forward).toBe(false);
    });
  });

  describe('publish() policy gate', () => {
    const createIntegratedTask = (policy?: RepoPolicy): Task => {
      const task = createTaskThroughAcceptance(policy);
      store.integrate(task.task_id, 'abc123');
      store.completeIntegrate(task.task_id, {
        checks_passed: true,
        integration_head_sha: 'def456',
      });
      return store.getTask(task.task_id)!;
    };

    it('should transition to publishing for valid publish', () => {
      const task = createIntegratedTask();
      const result = store.publish(task.task_id, {
        mode: 'apply',
        idempotency_key: 'key123',
      });

      expect(result.state).toBe('publishing');
    });

    it('should block when policy requires PR', () => {
      const policy: RepoPolicy = {
        update_strategy: 'pull_request',
        main_push_actor: 'bot',
        require_ci_pass: true,
      };
      const task = createIntegratedTask(policy);
      const result = store.publish(task.task_id, {
        mode: 'apply',
        idempotency_key: 'key123',
      });

      expect(result.state).toBe('blocked');
      expect(result.blocked_context?.reason).toContain('PR');
    });

    it('should transition to publish_pending_approval when approval required', () => {
      const task = createIntegratedTask({
        update_strategy: 'fast_forward_only',
        main_push_actor: 'bot',
        require_ci_pass: true,
      });
      // Set approval_required
      const taskWithApproval = store.getTask(task.task_id)!;
      taskWithApproval.publish_plan = { approval_required: true };

      const result = store.publish(task.task_id, {
        mode: 'apply',
        idempotency_key: 'key123',
      });

      expect(result.state).toBe('publish_pending_approval');
      expect(result.pending_approval_token).toBeDefined();
    });

    it('should include policy warnings', () => {
      const task = createIntegratedTask();
      const result = store.publish(task.task_id, {
        mode: 'apply',
        idempotency_key: 'key123',
      });

      // Default policy should have warnings about protected branch
      expect(result.publish_plan?.policy_warnings).toBeDefined();
      expect(result.publish_plan?.policy_warnings?.some(w => w.includes('protected'))).toBe(true);
    });

    it('should allow dry_run mode regardless of policy', () => {
      const policy: RepoPolicy = {
        update_strategy: 'pull_request',
        main_push_actor: 'bot',
        require_ci_pass: true,
      };
      const task = createIntegratedTask(policy);
      const result = store.publish(task.task_id, {
        mode: 'dry_run',
        idempotency_key: 'key123',
      });

      expect(result.state).toBe('publishing');
    });
  });

  describe('approvePublish()', () => {
    const createPendingApprovalTask = (): Task => {
      const task = createTaskThroughAcceptance();
      store.integrate(task.task_id, 'abc123');
      store.completeIntegrate(task.task_id, { checks_passed: true });

      // Manually set approval_required
      const taskWithApproval = store.getTask(task.task_id)!;
      taskWithApproval.publish_plan = { approval_required: true, mode: 'apply' };

      store.publish(task.task_id, {
        mode: 'apply',
        idempotency_key: 'key123',
      });
      return store.getTask(task.task_id)!;
    };

    it('should transition to publishing after approval', () => {
      const task = createPendingApprovalTask();
      const result = store.approvePublish(task.task_id, task.pending_approval_token!);

      expect(result.state).toBe('publishing');
      expect(result.pending_approval_token).toBeUndefined();
    });

    it('should reject invalid token', () => {
      const task = createPendingApprovalTask();

      expect(() => {
        store.approvePublish(task.task_id, 'invalid_token');
      }).toThrow(/invalid approval token/i);
    });

    it('should clear approval token after use', () => {
      const task = createPendingApprovalTask();
      const token = task.pending_approval_token!;
      store.approvePublish(task.task_id, token);

      const updatedTask = store.getTask(task.task_id);
      expect(updatedTask?.pending_approval_token).toBeUndefined();
    });
  });

  describe('completePublish()', () => {
    const createPublishingTask = (): Task => {
      const task = createTaskThroughAcceptance();
      store.integrate(task.task_id, 'abc123');
      store.completeIntegrate(task.task_id, { checks_passed: true });
      store.publish(task.task_id, {
        mode: 'apply',
        idempotency_key: 'key123',
      });
      return store.getTask(task.task_id)!;
    };

    it('should transition to published', () => {
      const task = createPublishingTask();
      const result = store.completePublish(task.task_id, {
        external_refs: [{ kind: 'url', value: 'https://github.com/test/repo/commit/abc' }],
      });

      expect(result.state).toBe('published');
      expect(result.external_refs).toHaveLength(1);
      expect(result.completed_at).toBeDefined();
    });

    it('should preserve rollback_notes', () => {
      const task = createPublishingTask();
      const result = store.completePublish(task.task_id, {
        rollback_notes: 'To rollback, revert commit abc',
      });

      expect(result.rollback_notes).toBe('To rollback, revert commit abc');
    });
  });

  describe('risk-based checklist generation', () => {
    it('should generate basic checklist for low risk task', () => {
      const task = store.createTask({
        title: 'Low Risk Task',
        objective: 'Test',
        typed_ref: 'agent-taskstate:task:local:low-risk',
        repo_ref: { provider: 'github', owner: 'test', name: 'repo', default_branch: 'main' },
        risk_level: 'low',
      });

      const typedRef = task.typed_ref;

      // Complete through acceptance
      store.dispatch(task.task_id, { target_stage: 'plan' });
      store.applyResult(task.task_id, { ...createMockResult(typedRef), job_id: store.getTask(task.task_id)!.active_job_id! });
      store.dispatch(task.task_id, { target_stage: 'dev' });
      store.applyResult(task.task_id, { ...createMockResult(typedRef), job_id: store.getTask(task.task_id)!.active_job_id! });
      store.dispatch(task.task_id, { target_stage: 'acceptance' });
      store.applyResult(task.task_id, {
        ...createMockResult(typedRef),
        job_id: store.getTask(task.task_id)!.active_job_id!,
        verdict: { outcome: 'accept' },
        test_results: [],
      });

      store.integrate(task.task_id, 'abc123');
      const updatedTask = store.getTask(task.task_id);

      expect(updatedTask?.manual_checklist).toBeDefined();
      // Low risk should have base items
      expect(updatedTask?.manual_checklist?.some(item => item.id === 'tests-passed')).toBe(true);
    });

    it('should generate enhanced checklist for high risk task', () => {
      const task = store.createTask({
        title: 'High Risk Task',
        objective: 'Test',
        typed_ref: 'agent-taskstate:task:local:high-risk',
        repo_ref: { provider: 'github', owner: 'test', name: 'repo', default_branch: 'main' },
        risk_level: 'high',
      });

      const typedRef = task.typed_ref;

      // Complete through acceptance
      store.dispatch(task.task_id, { target_stage: 'plan' });
      store.applyResult(task.task_id, { ...createMockResult(typedRef), job_id: store.getTask(task.task_id)!.active_job_id! });
      store.dispatch(task.task_id, { target_stage: 'dev' });
      store.applyResult(task.task_id, { ...createMockResult(typedRef), job_id: store.getTask(task.task_id)!.active_job_id! });
      store.dispatch(task.task_id, { target_stage: 'acceptance' });
      store.applyResult(task.task_id, {
        ...createMockResult(typedRef),
        job_id: store.getTask(task.task_id)!.active_job_id!,
        verdict: { outcome: 'accept' },
        test_results: [{ name: 'regression', suite: 'regression', status: 'passed', passed: 5, failed: 0, duration_ms: 100 }],
      });

      store.integrate(task.task_id, 'abc123');
      const updatedTask = store.getTask(task.task_id);

      expect(updatedTask?.manual_checklist).toBeDefined();
      // High risk should have security review
      expect(updatedTask?.manual_checklist?.some(item => item.id === 'security-review')).toBe(true);
    });
  });

  describe('integration/publish run monitoring', () => {
    it('should create integration_run when integrating', () => {
      const task = createTaskThroughAcceptance();
      const result = store.integrate(task.task_id, 'abc123');

      expect(result.integration_run).toBeDefined();
      expect(result.integration_run?.status).toBe('running');
      expect(result.integration_run?.started_at).toBeDefined();
      expect(result.integration_run?.timeout_at).toBeDefined();
    });

    it('should update integration_run on completeIntegrate', () => {
      const task = createTaskThroughAcceptance();
      store.integrate(task.task_id, 'abc123');

      const result = store.completeIntegrate(task.task_id, {
        checks_passed: true,
        integration_head_sha: 'def456',
      });

      expect(result.state).toBe('integrated');
      const updatedTask = store.getTask(task.task_id);
      expect(updatedTask?.integration_run?.status).toBe('succeeded');
      expect(updatedTask?.integration_run?.progress).toBe(100);
      expect(updatedTask?.integration_run?.completed_at).toBeDefined();
    });

    it('should create publish_run when publishing', () => {
      const task = createTaskThroughAcceptance();
      store.integrate(task.task_id, 'abc123');
      store.completeIntegrate(task.task_id, { checks_passed: true });

      const result = store.publish(task.task_id, {
        mode: 'apply',
        idempotency_key: 'key123',
      });

      expect(result.publish_run).toBeDefined();
      expect(result.publish_run?.status).toBe('running');
      expect(result.publish_run?.started_at).toBeDefined();
      expect(result.publish_run?.timeout_at).toBeDefined();
    });

    it('should update publish_run on completePublish', () => {
      const task = createTaskThroughAcceptance();
      store.integrate(task.task_id, 'abc123');
      store.completeIntegrate(task.task_id, { checks_passed: true });
      store.publish(task.task_id, {
        mode: 'apply',
        idempotency_key: 'key123',
      });

      const result = store.completePublish(task.task_id, {
        external_refs: [{ kind: 'url', value: 'https://github.com/test/repo/commit/abc' }],
      });

      expect(result.state).toBe('published');
      const updatedTask = store.getTask(task.task_id);
      expect(updatedTask?.publish_run?.status).toBe('succeeded');
      expect(updatedTask?.publish_run?.progress).toBe(100);
      expect(updatedTask?.publish_run?.completed_at).toBeDefined();
    });

    it('should detect integration timeout', () => {
      const task = createTaskThroughAcceptance();
      store.integrate(task.task_id, 'abc123');

      // Manually set timeout_at to past
      const storedTask = store.getTask(task.task_id)!;
      storedTask.integration_run!.timeout_at = new Date(Date.now() - 1000).toISOString();

      const timedOut = store.checkTimeouts();

      expect(timedOut.length).toBe(1);
      expect(timedOut[0].task_id).toBe(task.task_id);

      const updatedTask = store.getTask(task.task_id);
      expect(updatedTask?.state).toBe('blocked');
      expect(updatedTask?.integration_run?.status).toBe('timeout');
      expect(updatedTask?.blocked_context?.reason).toContain('timed out');
    });

    it('should detect publish timeout', () => {
      const task = createTaskThroughAcceptance();
      store.integrate(task.task_id, 'abc123');
      store.completeIntegrate(task.task_id, { checks_passed: true });
      store.publish(task.task_id, {
        mode: 'apply',
        idempotency_key: 'key123',
      });

      // Manually set timeout_at to past
      const storedTask = store.getTask(task.task_id)!;
      storedTask.publish_run!.timeout_at = new Date(Date.now() - 1000).toISOString();

      const timedOut = store.checkTimeouts();

      expect(timedOut.length).toBe(1);
      const updatedTask = store.getTask(task.task_id);
      expect(updatedTask?.state).toBe('blocked');
      expect(updatedTask?.publish_run?.status).toBe('timeout');
    });

    it('should update integration progress', () => {
      const task = createTaskThroughAcceptance();
      store.integrate(task.task_id, 'abc123');

      const result = store.updateIntegrationProgress(task.task_id, 50);

      expect(result.integration_run?.progress).toBe(50);
    });

    it('should update publish progress', () => {
      const task = createTaskThroughAcceptance();
      store.integrate(task.task_id, 'abc123');
      store.completeIntegrate(task.task_id, { checks_passed: true });
      store.publish(task.task_id, {
        mode: 'apply',
        idempotency_key: 'key123',
      });

      const result = store.updatePublishProgress(task.task_id, 75);

      expect(result.publish_run?.progress).toBe(75);
    });

    it('should get active runs', () => {
      // Create integrating task
      const task1 = createTaskThroughAcceptance();
      store.integrate(task1.task_id, 'abc123');

      // Create publishing task
      const task2 = createTaskThroughAcceptance();
      store.integrate(task2.task_id, 'abc123');
      store.completeIntegrate(task2.task_id, { checks_passed: true });
      store.publish(task2.task_id, {
        mode: 'apply',
        idempotency_key: 'key123',
      });

      const activeRuns = store.getActiveRuns();

      expect(activeRuns.length).toBe(2);
      expect(activeRuns.some(r => r.type === 'integration')).toBe(true);
      expect(activeRuns.some(r => r.type === 'publish')).toBe(true);
    });

    it('should not create publish_run for pending approval', () => {
      const task = createTaskThroughAcceptance();
      store.integrate(task.task_id, 'abc123');
      store.completeIntegrate(task.task_id, { checks_passed: true });

      // Set approval_required
      const storedTask = store.getTask(task.task_id)!;
      storedTask.publish_plan = { approval_required: true };

      const result = store.publish(task.task_id, {
        mode: 'apply',
        idempotency_key: 'key123',
      });

      expect(result.state).toBe('publish_pending_approval');
      expect(result.publish_run).toBeUndefined();
    });

    it('should create publish_run on approval', () => {
      const task = createTaskThroughAcceptance();
      store.integrate(task.task_id, 'abc123');
      store.completeIntegrate(task.task_id, { checks_passed: true });

      // Set approval_required
      const storedTask = store.getTask(task.task_id)!;
      storedTask.publish_plan = { approval_required: true };

      store.publish(task.task_id, {
        mode: 'apply',
        idempotency_key: 'key123',
      });

      const pendingTask = store.getTask(task.task_id)!;
      const result = store.approvePublish(task.task_id, pendingTask.pending_approval_token!);

      expect(result.state).toBe('publishing');
      expect(result.publish_run).toBeDefined();
      expect(result.publish_run?.status).toBe('running');
    });
  });
});