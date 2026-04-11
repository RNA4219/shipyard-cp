/**
 * OpenCode Session Registry Tests
 *
 * Tests for session lifecycle, reuse eligibility, and lease management.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  OpenCodeSessionRegistry,
  createOpenCodeSessionRegistry,
  generatePolicyFingerprint,
  determineAgentProfile,
  type SessionSearchCriteria,
  type SessionRecord,
  type AgentProfile,
  type TranscriptIndexMetadata,
} from '../src/domain/worker/opencode-session-registry.js';
import type { WorkerJob } from '../src/types.js';

describe('OpenCodeSessionRegistry', () => {
  let registry: OpenCodeSessionRegistry;

  beforeEach(() => {
    registry = createOpenCodeSessionRegistry({
      sessionTtlMs: 3600000, // 1 hour
      leaseTtlMs: 300000, // 5 minutes
      debug: true,
    });
  });

  afterEach(() => {
    registry.shutdown();
  });

  describe('createSessionRecord', () => {
    it('should create a session record with correct initial state', () => {
      const criteria: SessionSearchCriteria = {
        taskId: 'task-1',
        workspaceRef: { kind: 'host_path', workspace_id: '/workspace/1' },
        logicalWorker: 'claude_code',
        stageBucket: 'dev',
        policyFingerprint: 'fp-123',
      };

      const record = registry.createSessionRecord('session-1', criteria, 'http://localhost:3001');

      expect(record.sessionId).toBe('session-1');
      expect(record.taskId).toBe('task-1');
      expect(record.logicalWorker).toBe('claude_code');
      expect(record.stageBucket).toBe('dev');
      expect(record.state).toBe('initializing');
      expect(record.leasedBy).toBeUndefined();
    });

    it('should store session in registry', () => {
      const criteria: SessionSearchCriteria = {
        taskId: 'task-1',
        workspaceRef: { kind: 'host_path', workspace_id: '/workspace/1' },
        logicalWorker: 'claude_code',
        stageBucket: 'dev',
        policyFingerprint: 'fp-123',
      };

      registry.createSessionRecord('session-1', criteria, 'http://localhost:3001');

      const retrieved = registry.getSession('session-1');
      expect(retrieved).toBeDefined();
      expect(retrieved?.sessionId).toBe('session-1');
    });
  });

  describe('findReusableSession', () => {
    beforeEach(() => {
      // Create a ready session for reuse testing
      const criteria: SessionSearchCriteria = {
        taskId: 'task-1',
        workspaceRef: { kind: 'host_path', workspace_id: '/workspace/1' },
        logicalWorker: 'claude_code',
        stageBucket: 'dev',
        policyFingerprint: 'fp-123',
      };

      registry.createSessionRecord('session-dev-1', criteria, 'http://localhost:3001');
      registry.markSessionReady('session-dev-1');
    });

    it('should find reusable session for same-stage reuse (dev->dev)', () => {
      const criteria: SessionSearchCriteria = {
        taskId: 'task-1',
        workspaceRef: { kind: 'host_path', workspace_id: '/workspace/1' },
        logicalWorker: 'claude_code',
        stageBucket: 'dev',
        policyFingerprint: 'fp-123',
      };

      const found = registry.findReusableSession(criteria);
      expect(found).toBeDefined();
      expect(found?.sessionId).toBe('session-dev-1');
    });

    it('should NOT find session for dev->acceptance reuse (cross-stage forbidden)', () => {
      const criteria: SessionSearchCriteria = {
        taskId: 'task-1',
        workspaceRef: { kind: 'host_path', workspace_id: '/workspace/1' },
        logicalWorker: 'claude_code',
        stageBucket: 'acceptance',
        policyFingerprint: 'fp-123',
      };

      const found = registry.findReusableSession(criteria);
      expect(found).toBeNull();
    });

    it('should NOT find session for policy fingerprint mismatch', () => {
      const criteria: SessionSearchCriteria = {
        taskId: 'task-1',
        workspaceRef: { kind: 'host_path', workspace_id: '/workspace/1' },
        logicalWorker: 'claude_code',
        stageBucket: 'dev',
        policyFingerprint: 'fp-different', // Different fingerprint
      };

      const found = registry.findReusableSession(criteria);
      expect(found).toBeNull();
    });

    it('should NOT find session for different task_id', () => {
      const criteria: SessionSearchCriteria = {
        taskId: 'task-2', // Different task
        workspaceRef: { kind: 'host_path', workspace_id: '/workspace/1' },
        logicalWorker: 'claude_code',
        stageBucket: 'dev',
        policyFingerprint: 'fp-123',
      };

      const found = registry.findReusableSession(criteria);
      expect(found).toBeNull();
    });

    it('should NOT find session for different logical_worker', () => {
      const criteria: SessionSearchCriteria = {
        taskId: 'task-1',
        workspaceRef: { kind: 'host_path', workspace_id: '/workspace/1' },
        logicalWorker: 'codex', // Different worker
        stageBucket: 'dev',
        policyFingerprint: 'fp-123',
      };

      const found = registry.findReusableSession(criteria);
      expect(found).toBeNull();
    });

    it('should NOT find session if already leased', () => {
      // Lease the existing session
      registry.leaseSession('session-dev-1', 'job-1');

      const criteria: SessionSearchCriteria = {
        taskId: 'task-1',
        workspaceRef: { kind: 'host_path', workspace_id: '/workspace/1' },
        logicalWorker: 'claude_code',
        stageBucket: 'dev',
        policyFingerprint: 'fp-123',
      };

      const found = registry.findReusableSession(criteria);
      expect(found).toBeNull();
    });

    it('should find session after lease expires', () => {
      // Lease the existing session
      registry.leaseSession('session-dev-1', 'job-1');

      // Get the record and verify it's leased
      const leasedRecord = registry.getSession('session-dev-1');
      expect(leasedRecord?.leasedBy).toBe('job-1');
      expect(leasedRecord?.leaseExpiresAt).toBeDefined();

      // Manually set the lease to expired in the actual stored record
      // We need to access the internal storage to make this work in test
      // The lease expiration check happens inside findReusableSession
      // So we need to simulate time passing by modifying the stored record
      const storedRecord = registry.getSession('session-dev-1');
      if (storedRecord) {
        // Make lease expired - set to 1 second ago
        storedRecord.leaseExpiresAt = Date.now() - 1000;
      }

      // Now try to find reusable session - it should clear the expired lease
      // and return the session
      const criteria: SessionSearchCriteria = {
        taskId: 'task-1',
        workspaceRef: { kind: 'host_path', workspace_id: '/workspace/1' },
        logicalWorker: 'claude_code',
        stageBucket: 'dev',
        policyFingerprint: 'fp-123',
      };

      const found = registry.findReusableSession(criteria);

      // After findReusableSession clears expired lease, session should be found
      expect(found).toBeDefined();
      expect(found?.sessionId).toBe('session-dev-1');
      // The lease should have been cleared by findReusableSession
      expect(found?.leasedBy).toBeUndefined();
    });

    it('should NOT find session if state is dead', () => {
      registry.markSessionDead('session-dev-1', 'Error');

      const criteria: SessionSearchCriteria = {
        taskId: 'task-1',
        workspaceRef: { kind: 'host_path', workspace_id: '/workspace/1' },
        logicalWorker: 'claude_code',
        stageBucket: 'dev',
        policyFingerprint: 'fp-123',
      };

      const found = registry.findReusableSession(criteria);
      expect(found).toBeNull();
    });
  });

  describe('leaseSession', () => {
    beforeEach(() => {
      const criteria: SessionSearchCriteria = {
        taskId: 'task-1',
        workspaceRef: { kind: 'host_path', workspace_id: '/workspace/1' },
        logicalWorker: 'claude_code',
        stageBucket: 'dev',
        policyFingerprint: 'fp-123',
      };

      registry.createSessionRecord('session-1', criteria, 'http://localhost:3001');
      registry.markSessionReady('session-1');
    });

    it('should successfully lease a ready session', () => {
      const result = registry.leaseSession('session-1', 'job-1');
      expect(result).toBe(true);

      const record = registry.getSession('session-1');
      expect(record?.leasedBy).toBe('job-1');
      expect(record?.state).toBe('active');
      expect(record?.leaseExpiresAt).toBeDefined();
    });

    it('should fail to lease non-existent session', () => {
      const result = registry.leaseSession('non-existent', 'job-1');
      expect(result).toBe(false);
    });

    it('should fail to lease already leased session', () => {
      registry.leaseSession('session-1', 'job-1');
      const result = registry.leaseSession('session-1', 'job-2');
      expect(result).toBe(false);
    });

    it('should allow leasing after previous lease expires', () => {
      registry.leaseSession('session-1', 'job-1');

      // Expire the lease
      const record = registry.getSession('session-1');
      if (record) {
        record.leaseExpiresAt = Date.now() - 1000;
      }

      const result = registry.leaseSession('session-1', 'job-2');
      expect(result).toBe(true);
      expect(record?.leasedBy).toBe('job-2');
    });
  });

  describe('releaseSession', () => {
    beforeEach(() => {
      const criteria: SessionSearchCriteria = {
        taskId: 'task-1',
        workspaceRef: { kind: 'host_path', workspace_id: '/workspace/1' },
        logicalWorker: 'claude_code',
        stageBucket: 'dev',
        policyFingerprint: 'fp-123',
      };

      registry.createSessionRecord('session-1', criteria, 'http://localhost:3001');
      registry.markSessionReady('session-1');
      registry.leaseSession('session-1', 'job-1');
    });

    it('should successfully release a leased session', () => {
      const result = registry.releaseSession('session-1', 'job-1');
      expect(result).toBe(true);

      const record = registry.getSession('session-1');
      expect(record?.leasedBy).toBeUndefined();
      expect(record?.state).toBe('idle');
    });

    it('should fail to release session not leased by given job', () => {
      const result = registry.releaseSession('session-1', 'job-2');
      expect(result).toBe(false);
    });

    it('should fail to release non-existent session', () => {
      const result = registry.releaseSession('non-existent', 'job-1');
      expect(result).toBe(false);
    });
  });

  describe('markSessionDead', () => {
    beforeEach(() => {
      const criteria: SessionSearchCriteria = {
        taskId: 'task-1',
        workspaceRef: { kind: 'host_path', workspace_id: '/workspace/1' },
        logicalWorker: 'claude_code',
        stageBucket: 'dev',
        policyFingerprint: 'fp-123',
      };

      registry.createSessionRecord('session-1', criteria, 'http://localhost:3001');
      registry.markSessionReady('session-1');
    });

    it('should mark session as dead', () => {
      registry.markSessionDead('session-1', 'Connection error');

      const record = registry.getSession('session-1');
      expect(record?.state).toBe('dead');
      expect(record?.error).toBe('Connection error');
    });

    it('should mark dead session as non-reusable', () => {
      registry.markSessionDead('session-1', 'Error');

      const criteria: SessionSearchCriteria = {
        taskId: 'task-1',
        workspaceRef: { kind: 'host_path', workspace_id: '/workspace/1' },
        logicalWorker: 'claude_code',
        stageBucket: 'dev',
        policyFingerprint: 'fp-123',
      };

      const found = registry.findReusableSession(criteria);
      expect(found).toBeNull();
    });
  });

  describe('getStats', () => {
    it('should return correct stats', () => {
      const criteria: SessionSearchCriteria = {
        taskId: 'task-1',
        workspaceRef: { kind: 'host_path', workspace_id: '/workspace/1' },
        logicalWorker: 'claude_code',
        stageBucket: 'dev',
        policyFingerprint: 'fp-123',
      };

      registry.createSessionRecord('session-1', criteria, 'http://localhost:3001');
      registry.markSessionReady('session-1');

      registry.createSessionRecord('session-2', {
        ...criteria,
        stageBucket: 'plan',
      }, 'http://localhost:3001');

      registry.createSessionRecord('session-3', {
        ...criteria,
        stageBucket: 'acceptance',
      }, 'http://localhost:3001');
      registry.markSessionDead('session-3', 'Error');

      const stats = registry.getStats();

      expect(stats.total).toBe(3);
      expect(stats.byState.ready).toBe(1);
      expect(stats.byState.initializing).toBe(1);
      expect(stats.byState.dead).toBe(1);
      expect(stats.leased).toBe(0);
    });
  });

  describe('getSessionsForTask', () => {
    it('should return all sessions for a task', () => {
      const criteria: SessionSearchCriteria = {
        taskId: 'task-1',
        workspaceRef: { kind: 'host_path', workspace_id: '/workspace/1' },
        logicalWorker: 'claude_code',
        stageBucket: 'dev',
        policyFingerprint: 'fp-123',
      };

      registry.createSessionRecord('session-dev', criteria, 'http://localhost:3001');
      registry.createSessionRecord('session-plan', {
        ...criteria,
        stageBucket: 'plan',
      }, 'http://localhost:3001');

      // Session for different task
      registry.createSessionRecord('session-other', {
        ...criteria,
        taskId: 'task-2',
      }, 'http://localhost:3001');

      const sessions = registry.getSessionsForTask('task-1');
      expect(sessions.length).toBe(2);
      expect(sessions.map(s => s.sessionId)).toContain('session-dev');
      expect(sessions.map(s => s.sessionId)).toContain('session-plan');
    });
  });
});

describe('generatePolicyFingerprint', () => {
  it('should generate consistent fingerprint for same policy', () => {
    const job1: WorkerJob = {
      job_id: 'job-1',
      task_id: 'task-1',
      stage: 'dev',
      worker_type: 'claude_code',
      input_prompt: 'prompt',
      repo_ref: { owner: 'owner', name: 'repo', base_sha: 'sha' },
      workspace_ref: { kind: 'host_path', workspace_id: '/workspace' },
      approval_policy: {
        mode: 'auto',
        allowed_side_effect_categories: ['network_access'],
      },
      typed_ref: { type: 'issue', id: 'issue-1' },
      created_at: new Date().toISOString(),
    };

    const job2: WorkerJob = {
      ...job1,
      job_id: 'job-2',
    };

    const fp1 = generatePolicyFingerprint(job1);
    const fp2 = generatePolicyFingerprint(job2);

    expect(fp1).toBe(fp2);
  });

  it('should generate different fingerprint for different policy', () => {
    const job1: WorkerJob = {
      job_id: 'job-1',
      task_id: 'task-1',
      stage: 'dev',
      worker_type: 'claude_code',
      input_prompt: 'prompt',
      repo_ref: { owner: 'owner', name: 'repo', base_sha: 'sha' },
      workspace_ref: { kind: 'host_path', workspace_id: '/workspace' },
      approval_policy: {
        mode: 'auto',
        allowed_side_effect_categories: ['network_access'],
      },
      typed_ref: { type: 'issue', id: 'issue-1' },
      created_at: new Date().toISOString(),
    };

    const job2: WorkerJob = {
      ...job1,
      approval_policy: {
        mode: 'strict',
        allowed_side_effect_categories: [],
      },
    };

    const fp1 = generatePolicyFingerprint(job1);
    const fp2 = generatePolicyFingerprint(job2);

    expect(fp1).not.toBe(fp2);
  });

  it('should generate different fingerprint for different workspace', () => {
    const job1: WorkerJob = {
      job_id: 'job-1',
      task_id: 'task-1',
      stage: 'dev',
      worker_type: 'claude_code',
      input_prompt: 'prompt',
      repo_ref: { owner: 'owner', name: 'repo', base_sha: 'sha' },
      workspace_ref: { kind: 'host_path', workspace_id: '/workspace/1' },
      approval_policy: {
        mode: 'auto',
        allowed_side_effect_categories: [],
      },
      typed_ref: { type: 'issue', id: 'issue-1' },
      created_at: new Date().toISOString(),
    };

    const job2: WorkerJob = {
      ...job1,
      workspace_ref: { kind: 'host_path', workspace_id: '/workspace/2' },
    };

    const fp1 = generatePolicyFingerprint(job1);
    const fp2 = generatePolicyFingerprint(job2);

    expect(fp1).not.toBe(fp2);
  });
});

// ========================================
// Phase 2C Tests
// ========================================

describe('Phase 2C: Agent Profile', () => {
  let registry: OpenCodeSessionRegistry;

  beforeEach(() => {
    registry = createOpenCodeSessionRegistry({
      sessionTtlMs: 3600000,
      leaseTtlMs: 300000,
      debug: true,
      enableWarmPool: true,
    });
  });

  afterEach(() => {
    registry.shutdown();
  });

  describe('determineAgentProfile', () => {
    it('should return planning-oriented for plan stage', () => {
      expect(determineAgentProfile('plan')).toBe('planning-oriented');
    });

    it('should return build-oriented for dev stage', () => {
      expect(determineAgentProfile('dev')).toBe('build-oriented');
    });

    it('should return verification-oriented for acceptance stage', () => {
      expect(determineAgentProfile('acceptance')).toBe('verification-oriented');
    });
  });

  describe('createSessionRecord with agent profile', () => {
    it('should set agent profile based on stage bucket', () => {
      const criteria: SessionSearchCriteria = {
        taskId: 'task-1',
        workspaceRef: { kind: 'host_path', workspace_id: '/workspace/1' },
        logicalWorker: 'claude_code',
        stageBucket: 'plan',
        policyFingerprint: 'fp-123',
      };

      const record = registry.createSessionRecord('session-plan-1', criteria, 'http://localhost:3001');

      expect(record.agentProfile).toBe('planning-oriented');
    });

    it('should allow explicit agent profile override', () => {
      const criteria: SessionSearchCriteria = {
        taskId: 'task-1',
        workspaceRef: { kind: 'host_path', workspace_id: '/workspace/1' },
        logicalWorker: 'claude_code',
        stageBucket: 'dev',
        policyFingerprint: 'fp-123',
        agentProfile: 'planning-oriented',
      };

      const record = registry.createSessionRecord('session-dev-custom', criteria, 'http://localhost:3001');

      expect(record.agentProfile).toBe('planning-oriented');
    });

    it('should initialize health score', () => {
      const criteria: SessionSearchCriteria = {
        taskId: 'task-1',
        workspaceRef: { kind: 'host_path', workspace_id: '/workspace/1' },
        logicalWorker: 'claude_code',
        stageBucket: 'dev',
        policyFingerprint: 'fp-123',
      };

      const record = registry.createSessionRecord('session-1', criteria, 'http://localhost:3001');

      expect(record.healthScore).toBeDefined();
      expect(record.healthScore?.score).toBe(100);
      expect(record.healthScore?.isHealthy).toBe(true);
      expect(record.healthScore?.errorCount).toBe(0);
    });
  });

  describe('agent profile mismatch reuse forbidden (FR-C2)', () => {
    it('should NOT reuse session with different agent profile', () => {
      // Create a planning-oriented session
      const criteriaPlan: SessionSearchCriteria = {
        taskId: 'task-1',
        workspaceRef: { kind: 'host_path', workspace_id: '/workspace/1' },
        logicalWorker: 'claude_code',
        stageBucket: 'plan',
        policyFingerprint: 'fp-123',
      };

      registry.createSessionRecord('session-plan-1', criteriaPlan, 'http://localhost:3001');
      registry.markSessionReady('session-plan-1');

      // Try to reuse for dev stage (build-oriented) - should NOT match
      const criteriaDev: SessionSearchCriteria = {
        taskId: 'task-1',
        workspaceRef: { kind: 'host_path', workspace_id: '/workspace/1' },
        logicalWorker: 'claude_code',
        stageBucket: 'dev',
        policyFingerprint: 'fp-123',
      };

      const found = registry.findReusableSession(criteriaDev);

      expect(found).toBeNull();
    });

    it('should reuse session with same agent profile', () => {
      // Create a dev session (build-oriented)
      const criteriaDev1: SessionSearchCriteria = {
        taskId: 'task-1',
        workspaceRef: { kind: 'host_path', workspace_id: '/workspace/1' },
        logicalWorker: 'claude_code',
        stageBucket: 'dev',
        policyFingerprint: 'fp-123',
      };

      registry.createSessionRecord('session-dev-1', criteriaDev1, 'http://localhost:3001');
      registry.markSessionReady('session-dev-1');

      // Try to reuse for another dev job - should match
      const criteriaDev2: SessionSearchCriteria = {
        taskId: 'task-1',
        workspaceRef: { kind: 'host_path', workspace_id: '/workspace/1' },
        logicalWorker: 'claude_code',
        stageBucket: 'dev',
        policyFingerprint: 'fp-123',
      };

      const found = registry.findReusableSession(criteriaDev2);

      expect(found).toBeDefined();
      expect(found?.sessionId).toBe('session-dev-1');
      expect(found?.agentProfile).toBe('build-oriented');
    });
  });
});

describe('Phase 2C: Warm Pool', () => {
  let registry: OpenCodeSessionRegistry;

  beforeEach(() => {
    registry = createOpenCodeSessionRegistry({
      sessionTtlMs: 3600000,
      leaseTtlMs: 300000,
      debug: true,
      enableWarmPool: true,
    });
  });

  afterEach(() => {
    registry.shutdown();
  });

  describe('warm pool operations (FR-C3)', () => {
    it('should add idle session to warm pool', () => {
      const criteria: SessionSearchCriteria = {
        taskId: 'task-1',
        workspaceRef: { kind: 'host_path', workspace_id: '/workspace/1' },
        logicalWorker: 'claude_code',
        stageBucket: 'dev',
        policyFingerprint: 'fp-123',
      };

      const record = registry.createSessionRecord('session-1', criteria, 'http://localhost:3001');
      registry.markSessionReady('session-1');

      // Session should be in warm pool after being marked ready
      expect(record.inWarmPool).toBe(true);
      expect(registry.getWarmPoolSize()).toBe(1);
    });

    it('should get warm pool session matching criteria', () => {
      const criteria: SessionSearchCriteria = {
        taskId: 'task-1',
        workspaceRef: { kind: 'host_path', workspace_id: '/workspace/1' },
        logicalWorker: 'claude_code',
        stageBucket: 'dev',
        policyFingerprint: 'fp-123',
      };

      registry.createSessionRecord('session-1', criteria, 'http://localhost:3001');
      registry.markSessionReady('session-1');

      const warmPoolSession = registry.getWarmPoolSession(criteria);

      expect(warmPoolSession).toBeDefined();
      expect(warmPoolSession?.sessionId).toBe('session-1');
    });

    it('should NOT get warm pool session with mismatched criteria', () => {
      const criteria1: SessionSearchCriteria = {
        taskId: 'task-1',
        workspaceRef: { kind: 'host_path', workspace_id: '/workspace/1' },
        logicalWorker: 'claude_code',
        stageBucket: 'dev',
        policyFingerprint: 'fp-123',
      };

      registry.createSessionRecord('session-1', criteria1, 'http://localhost:3001');
      registry.markSessionReady('session-1');

      // Different task should not match
      const criteria2: SessionSearchCriteria = {
        taskId: 'task-2', // Different task
        workspaceRef: { kind: 'host_path', workspace_id: '/workspace/1' },
        logicalWorker: 'claude_code',
        stageBucket: 'dev',
        policyFingerprint: 'fp-123',
      };

      const warmPoolSession = registry.getWarmPoolSession(criteria2);

      expect(warmPoolSession).toBeNull();
    });

    it('should remove session from warm pool when leased', () => {
      const criteria: SessionSearchCriteria = {
        taskId: 'task-1',
        workspaceRef: { kind: 'host_path', workspace_id: '/workspace/1' },
        logicalWorker: 'claude_code',
        stageBucket: 'dev',
        policyFingerprint: 'fp-123',
      };

      const record = registry.createSessionRecord('session-1', criteria, 'http://localhost:3001');
      registry.markSessionReady('session-1');

      expect(record.inWarmPool).toBe(true);

      // Lease the session
      registry.leaseSession('session-1', 'job-1');

      expect(record.inWarmPool).toBe(false);
      expect(registry.getWarmPoolSize()).toBe(0);
    });

    it('should re-add to warm pool after successful release', () => {
      const criteria: SessionSearchCriteria = {
        taskId: 'task-1',
        workspaceRef: { kind: 'host_path', workspace_id: '/workspace/1' },
        logicalWorker: 'claude_code',
        stageBucket: 'dev',
        policyFingerprint: 'fp-123',
      };

      const record = registry.createSessionRecord('session-1', criteria, 'http://localhost:3001');
      registry.markSessionReady('session-1');
      registry.leaseSession('session-1', 'job-1');

      expect(record.inWarmPool).toBe(false);

      // Release successfully
      registry.releaseSession('session-1', 'job-1');

      expect(record.inWarmPool).toBe(true);
      expect(registry.getWarmPoolSize()).toBe(1);
    });
  });

  describe('warm pool safety (SR-C1)', () => {
    it('should NOT add unhealthy session to warm pool', () => {
      const criteria: SessionSearchCriteria = {
        taskId: 'task-1',
        workspaceRef: { kind: 'host_path', workspace_id: '/workspace/1' },
        logicalWorker: 'claude_code',
        stageBucket: 'dev',
        policyFingerprint: 'fp-123',
      };

      const record = registry.createSessionRecord('session-1', criteria, 'http://localhost:3001');
      registry.markSessionReady('session-1');

      // Make session unhealthy
      registry.updateHealthScore('session-1', false);
      registry.updateHealthScore('session-1', false);
      registry.updateHealthScore('session-1', false);
      registry.updateHealthScore('session-1', false); // 4 errors, exceeds threshold

      expect(record.healthScore?.isHealthy).toBe(false);
      expect(record.inWarmPool).toBe(false);
    });
  });
});

describe('Phase 2C: Reuse Ranking', () => {
  let registry: OpenCodeSessionRegistry;

  beforeEach(() => {
    registry = createOpenCodeSessionRegistry({
      sessionTtlMs: 3600000,
      leaseTtlMs: 300000,
      debug: true,
      enableWarmPool: true,
    });
  });

  afterEach(() => {
    registry.shutdown();
  });

  describe('reuse ranking (FR-C4)', () => {
    it('should rank healthier session higher', () => {
      const criteria: SessionSearchCriteria = {
        taskId: 'task-1',
        workspaceRef: { kind: 'host_path', workspace_id: '/workspace/1' },
        logicalWorker: 'claude_code',
        stageBucket: 'dev',
        policyFingerprint: 'fp-123',
      };

      // Create two sessions
      registry.createSessionRecord('session-1', criteria, 'http://localhost:3001');
      registry.createSessionRecord('session-2', criteria, 'http://localhost:3001');

      registry.markSessionReady('session-1');
      registry.markSessionReady('session-2');

      // Make session-1 healthier (more successes)
      registry.updateHealthScore('session-1', true);
      registry.updateHealthScore('session-1', true);

      // Make session-2 less healthy (some errors)
      registry.updateHealthScore('session-2', false);

      // Release both to make them available for reuse
      registry.releaseSession('session-1', 'warm-pool-test-1');
      registry.releaseSession('session-2', 'warm-pool-test-2');

      // Find reusable - should pick session-1 (healthier)
      const found = registry.findReusableSession(criteria);

      expect(found).toBeDefined();
      expect(found?.sessionId).toBe('session-1');
    });

    it('should prefer warm pool session', () => {
      const criteria: SessionSearchCriteria = {
        taskId: 'task-1',
        workspaceRef: { kind: 'host_path', workspace_id: '/workspace/1' },
        logicalWorker: 'claude_code',
        stageBucket: 'dev',
        policyFingerprint: 'fp-123',
      };

      // Create two sessions
      registry.createSessionRecord('session-1', criteria, 'http://localhost:3001');
      registry.createSessionRecord('session-2', criteria, 'http://localhost:3001');

      registry.markSessionReady('session-1');
      registry.markSessionReady('session-2');

      // Session-1 should be in warm pool (added when marked ready)
      const record1Before = registry.getSession('session-1');
      expect(record1Before?.inWarmPool).toBe(true);

      // Check stats to verify warm pool hit
      const statsBefore = registry.getPhase2CStats();
      expect(statsBefore.warmPoolSize).toBeGreaterThan(0);

      // Find reusable - warm pool session is preferred (has bonus score)
      const found = registry.findReusableSession(criteria);

      expect(found).toBeDefined();
      // Session was in warm pool before being acquired (removed on acquisition)
    });
  });

  describe('reuse skip reason tracking (OR-C2)', () => {
    it('should track skip reasons in stats', () => {
      const criteria1: SessionSearchCriteria = {
        taskId: 'task-1',
        workspaceRef: { kind: 'host_path', workspace_id: '/workspace/1' },
        logicalWorker: 'claude_code',
        stageBucket: 'dev',
        policyFingerprint: 'fp-123',
      };

      registry.createSessionRecord('session-1', criteria1, 'http://localhost:3001');
      registry.markSessionReady('session-1');

      // Try to find with different criteria
      const criteria2: SessionSearchCriteria = {
        taskId: 'task-2', // Different task
        workspaceRef: { kind: 'host_path', workspace_id: '/workspace/1' },
        logicalWorker: 'claude_code',
        stageBucket: 'dev',
        policyFingerprint: 'fp-123',
      };

      registry.findReusableSession(criteria2);

      const stats = registry.getPhase2CStats();
      expect(stats.reuseSkipReasons['task_mismatch']).toBeGreaterThan(0);
    });
  });
});

describe('Phase 2C: Health Score', () => {
  let registry: OpenCodeSessionRegistry;

  beforeEach(() => {
    registry = createOpenCodeSessionRegistry({
      sessionTtlMs: 3600000,
      leaseTtlMs: 300000,
      debug: true,
      maxErrorCountForReuse: 3,
      minHealthScoreForReuse: 50,
    });
  });

  afterEach(() => {
    registry.shutdown();
  });

  describe('health scoring (FR-C6)', () => {
    it('should decrease health score on errors', () => {
      const criteria: SessionSearchCriteria = {
        taskId: 'task-1',
        workspaceRef: { kind: 'host_path', workspace_id: '/workspace/1' },
        logicalWorker: 'claude_code',
        stageBucket: 'dev',
        policyFingerprint: 'fp-123',
      };

      registry.createSessionRecord('session-1', criteria, 'http://localhost:3001');

      registry.updateHealthScore('session-1', false);

      const record = registry.getSession('session-1');
      expect(record?.healthScore?.errorCount).toBe(1);
      expect(record?.healthScore?.score).toBeLessThan(100);
    });

    it('should increase health score on successes', () => {
      const criteria: SessionSearchCriteria = {
        taskId: 'task-1',
        workspaceRef: { kind: 'host_path', workspace_id: '/workspace/1' },
        logicalWorker: 'claude_code',
        stageBucket: 'dev',
        policyFingerprint: 'fp-123',
      };

      registry.createSessionRecord('session-1', criteria, 'http://localhost:3001');

      registry.updateHealthScore('session-1', true);
      registry.updateHealthScore('session-1', true);

      const record = registry.getSession('session-1');
      expect(record?.healthScore?.successCount).toBe(2);
      // Score stays at 100 (max) with successful operations (capped)
      expect(record?.healthScore?.score).toBe(100);
    });

    it('should mark session unhealthy after threshold errors', () => {
      const criteria: SessionSearchCriteria = {
        taskId: 'task-1',
        workspaceRef: { kind: 'host_path', workspace_id: '/workspace/1' },
        logicalWorker: 'claude_code',
        stageBucket: 'dev',
        policyFingerprint: 'fp-123',
      };

      registry.createSessionRecord('session-1', criteria, 'http://localhost:3001');

      // Exceed error threshold (maxErrorCountForReuse = 3)
      registry.updateHealthScore('session-1', false);
      registry.updateHealthScore('session-1', false);
      registry.updateHealthScore('session-1', false);
      registry.updateHealthScore('session-1', false);

      const record = registry.getSession('session-1');
      expect(record?.healthScore?.isHealthy).toBe(false);
    });

    it('should NOT reuse unhealthy session', () => {
      const criteria: SessionSearchCriteria = {
        taskId: 'task-1',
        workspaceRef: { kind: 'host_path', workspace_id: '/workspace/1' },
        logicalWorker: 'claude_code',
        stageBucket: 'dev',
        policyFingerprint: 'fp-123',
      };

      registry.createSessionRecord('session-1', criteria, 'http://localhost:3001');
      registry.markSessionReady('session-1');

      // Make unhealthy
      registry.updateHealthScore('session-1', false);
      registry.updateHealthScore('session-1', false);
      registry.updateHealthScore('session-1', false);
      registry.updateHealthScore('session-1', false);

      const found = registry.findReusableSession(criteria);

      expect(found).toBeNull();
    });
  });
});

describe('Phase 2C: Transcript Indexing', () => {
  let registry: OpenCodeSessionRegistry;

  beforeEach(() => {
    registry = createOpenCodeSessionRegistry({
      sessionTtlMs: 3600000,
      leaseTtlMs: 300000,
      debug: true,
    });
  });

  afterEach(() => {
    registry.shutdown();
  });

  describe('transcript indexing (FR-C5)', () => {
    it('should update transcript index metadata', () => {
      const criteria: SessionSearchCriteria = {
        taskId: 'task-1',
        workspaceRef: { kind: 'host_path', workspace_id: '/workspace/1' },
        logicalWorker: 'claude_code',
        stageBucket: 'dev',
        policyFingerprint: 'fp-123',
      };

      registry.createSessionRecord('session-1', criteria, 'http://localhost:3001');

      const metadata: TranscriptIndexMetadata = {
        messageCount: 10,
        toolCount: 5,
        permissionRequestCount: 2,
        summaryKeywords: ['fix', 'bug', 'implementation'],
        lastToolNames: ['read', 'write', 'bash'],
      };

      registry.updateTranscriptIndex('session-1', metadata);

      const index = registry.getTranscriptIndex('session-1');

      expect(index).toBeDefined();
      expect(index?.messageCount).toBe(10);
      expect(index?.toolCount).toBe(5);
      expect(index?.permissionRequestCount).toBe(2);
      expect(index?.summaryKeywords).toContain('fix');
      expect(index?.lastToolNames).toContain('read');
    });

    it('should accumulate transcript index updates', () => {
      const criteria: SessionSearchCriteria = {
        taskId: 'task-1',
        workspaceRef: { kind: 'host_path', workspace_id: '/workspace/1' },
        logicalWorker: 'claude_code',
        stageBucket: 'dev',
        policyFingerprint: 'fp-123',
      };

      registry.createSessionRecord('session-1', criteria, 'http://localhost:3001');

      registry.updateTranscriptIndex('session-1', {
        messageCount: 5,
        toolCount: 3,
        permissionRequestCount: 1,
        summaryKeywords: ['initial'],
        lastToolNames: ['read'],
      });

      registry.updateTranscriptIndex('session-1', {
        messageCount: 15,
        toolCount: 8,
        // Note: arrays are replaced by spread, not accumulated
        summaryKeywords: ['final', 'result'],
        lastToolNames: ['write', 'bash'],
      });

      const index = registry.getTranscriptIndex('session-1');

      expect(index?.messageCount).toBe(15); // Updated
      expect(index?.toolCount).toBe(8); // Updated
      expect(index?.permissionRequestCount).toBe(1); // Preserved (not in second update)
      expect(index?.summaryKeywords).toContain('final'); // Replaced
      expect(index?.lastToolNames).toContain('write'); // Replaced
    });
  });
});

describe('Phase 2C: Statistics', () => {
  let registry: OpenCodeSessionRegistry;

  beforeEach(() => {
    registry = createOpenCodeSessionRegistry({
      sessionTtlMs: 3600000,
      leaseTtlMs: 300000,
      debug: true,
      enableWarmPool: true,
    });
  });

  afterEach(() => {
    registry.shutdown();
  });

  describe('Phase 2C stats (OR-C1, OR-C2)', () => {
    it('should return warm pool size in stats', () => {
      const criteria: SessionSearchCriteria = {
        taskId: 'task-1',
        workspaceRef: { kind: 'host_path', workspace_id: '/workspace/1' },
        logicalWorker: 'claude_code',
        stageBucket: 'dev',
        policyFingerprint: 'fp-123',
      };

      registry.createSessionRecord('session-1', criteria, 'http://localhost:3001');
      registry.markSessionReady('session-1');

      const stats = registry.getStats();

      expect(stats.warmPool).toBe(1);
    });

    it('should return Phase 2C specific stats', () => {
      const criteria: SessionSearchCriteria = {
        taskId: 'task-1',
        workspaceRef: { kind: 'host_path', workspace_id: '/workspace/1' },
        logicalWorker: 'claude_code',
        stageBucket: 'dev',
        policyFingerprint: 'fp-123',
      };

      registry.createSessionRecord('session-1', criteria, 'http://localhost:3001');
      registry.markSessionReady('session-1');

      // Trigger reuse
      registry.findReusableSession(criteria);

      const stats = registry.getPhase2CStats();

      expect(stats.warmPoolSize).toBeDefined();
      expect(stats.warmPoolHits).toBeDefined();
      expect(stats.warmPoolMisses).toBeDefined();
      expect(stats.reuseHitReasons).toBeDefined();
      expect(stats.reuseSkipReasons).toBeDefined();
      expect(stats.avgHealthScore).toBeDefined();
    });
  });
});

describe('Phase 2C: Safety Constraints (FR-C7)', () => {
  let registry: OpenCodeSessionRegistry;

  beforeEach(() => {
    registry = createOpenCodeSessionRegistry({
      sessionTtlMs: 3600000,
      leaseTtlMs: 300000,
      debug: true,
      enableWarmPool: true,
    });
  });

  afterEach(() => {
    registry.shutdown();
  });

  describe('dev->acceptance reuse forbidden maintained', () => {
    it('should NOT reuse dev session for acceptance (AC-C3)', () => {
      // Create dev session
      const devCriteria: SessionSearchCriteria = {
        taskId: 'task-1',
        workspaceRef: { kind: 'host_path', workspace_id: '/workspace/1' },
        logicalWorker: 'claude_code',
        stageBucket: 'dev',
        policyFingerprint: 'fp-dev',
      };

      registry.createSessionRecord('session-dev-1', devCriteria, 'http://localhost:3001');
      registry.markSessionReady('session-dev-1');

      // Try to reuse for acceptance - MUST NOT match
      const acceptanceCriteria: SessionSearchCriteria = {
        taskId: 'task-1',
        workspaceRef: { kind: 'host_path', workspace_id: '/workspace/1' },
        logicalWorker: 'claude_code',
        stageBucket: 'acceptance',
        policyFingerprint: 'fp-acceptance',
      };

      const found = registry.findReusableSession(acceptanceCriteria);

      expect(found).toBeNull();
    });

    it('should NOT reuse acceptance session for dev', () => {
      // Create acceptance session
      const acceptanceCriteria: SessionSearchCriteria = {
        taskId: 'task-1',
        workspaceRef: { kind: 'host_path', workspace_id: '/workspace/1' },
        logicalWorker: 'claude_code',
        stageBucket: 'acceptance',
        policyFingerprint: 'fp-acceptance',
      };

      registry.createSessionRecord('session-acc-1', acceptanceCriteria, 'http://localhost:3001');
      registry.markSessionReady('session-acc-1');

      // Try to reuse for dev - MUST NOT match
      const devCriteria: SessionSearchCriteria = {
        taskId: 'task-1',
        workspaceRef: { kind: 'host_path', workspace_id: '/workspace/1' },
        logicalWorker: 'claude_code',
        stageBucket: 'dev',
        policyFingerprint: 'fp-dev',
      };

      const found = registry.findReusableSession(devCriteria);

      expect(found).toBeNull();
    });
  });

  describe('task/workspace/policy boundary maintained (SR-C1, SR-C2, SR-C3)', () => {
    it('should NOT reuse session from different task', () => {
      const criteria1: SessionSearchCriteria = {
        taskId: 'task-1',
        workspaceRef: { kind: 'host_path', workspace_id: '/workspace/1' },
        logicalWorker: 'claude_code',
        stageBucket: 'dev',
        policyFingerprint: 'fp-123',
      };

      registry.createSessionRecord('session-1', criteria1, 'http://localhost:3001');
      registry.markSessionReady('session-1');

      const criteria2: SessionSearchCriteria = {
        taskId: 'task-2',
        workspaceRef: { kind: 'host_path', workspace_id: '/workspace/1' },
        logicalWorker: 'claude_code',
        stageBucket: 'dev',
        policyFingerprint: 'fp-123',
      };

      const found = registry.findReusableSession(criteria2);

      expect(found).toBeNull();
    });

    it('should NOT reuse session from different workspace', () => {
      const criteria1: SessionSearchCriteria = {
        taskId: 'task-1',
        workspaceRef: { kind: 'host_path', workspace_id: '/workspace/1' },
        logicalWorker: 'claude_code',
        stageBucket: 'dev',
        policyFingerprint: 'fp-123',
      };

      registry.createSessionRecord('session-1', criteria1, 'http://localhost:3001');
      registry.markSessionReady('session-1');

      const criteria2: SessionSearchCriteria = {
        taskId: 'task-1',
        workspaceRef: { kind: 'host_path', workspace_id: '/workspace/2' },
        logicalWorker: 'claude_code',
        stageBucket: 'dev',
        policyFingerprint: 'fp-123',
      };

      const found = registry.findReusableSession(criteria2);

      expect(found).toBeNull();
    });

    it('should NOT reuse session with different policy fingerprint', () => {
      const criteria1: SessionSearchCriteria = {
        taskId: 'task-1',
        workspaceRef: { kind: 'host_path', workspace_id: '/workspace/1' },
        logicalWorker: 'claude_code',
        stageBucket: 'dev',
        policyFingerprint: 'fp-123',
      };

      registry.createSessionRecord('session-1', criteria1, 'http://localhost:3001');
      registry.markSessionReady('session-1');

      const criteria2: SessionSearchCriteria = {
        taskId: 'task-1',
        workspaceRef: { kind: 'host_path', workspace_id: '/workspace/1' },
        logicalWorker: 'claude_code',
        stageBucket: 'dev',
        policyFingerprint: 'fp-456',
      };

      const found = registry.findReusableSession(criteria2);

      expect(found).toBeNull();
    });
  });
});