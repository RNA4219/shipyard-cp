/**
 * OpenCode Serve Adapter Tests
 *
 * Tests for serve adapter with fallback scenarios.
 */

import { describe, it, expect, beforeEach, afterEach, vi, Mock } from 'vitest';
import {
  OpenCodeServeAdapter,
  type OpenCodeServeAdapterConfig,
} from '../src/domain/worker/opencode-serve-adapter.js';
import {
  OpenCodeSessionRegistry,
  createOpenCodeSessionRegistry,
} from '../src/domain/worker/session-registry/index.js';
import {
  OpenCodeServerManager,
} from '../src/infrastructure/opencode-server-manager.js';
import {
  OpenCodeSessionExecutor,
} from '../src/infrastructure/opencode-session-executor.js';
import type { WorkerJob } from '../src/types.js';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock server manager
vi.mock('../src/infrastructure/opencode-server-manager.js', () => ({
  OpenCodeServerManager: vi.fn().mockImplementation(() => ({
    ensureServerReady: vi.fn().mockResolvedValue(false),
    getStatus: vi.fn().mockReturnValue({ healthy: false, baseUrl: 'http://localhost:3001' }),
    stop: vi.fn().mockResolvedValue(undefined),
  })),
  createOpenCodeServerManager: vi.fn(),
}));

// Mock session executor
vi.mock('../src/infrastructure/opencode-session-executor.js', () => ({
  OpenCodeSessionExecutor: vi.fn().mockImplementation(() => ({
    execute: vi.fn().mockResolvedValue({
      success: false,
      error: 'Session execution failed',
      duration_ms: 1000,
    }),
    cancel: vi.fn().mockResolvedValue(true),
  })),
  createOpenCodeSessionExecutor: vi.fn(),
}));

// Mock fallback executor
vi.mock('../src/infrastructure/opencode-executor.js', () => ({
  createOpenCodeExecutor: vi.fn().mockImplementation(() => ({
    execute: vi.fn().mockResolvedValue({
      success: true,
      output: 'Mock output',
      artifacts: [],
      duration_ms: 500,
    }),
    cancel: vi.fn().mockResolvedValue(true),
  })),
}));

describe('OpenCodeServeAdapter', () => {
  let adapter: OpenCodeServeAdapter;
  let mockServerManager: OpenCodeServerManager;
  let mockSessionRegistry: OpenCodeSessionRegistry;
  let mockSessionExecutor: OpenCodeSessionExecutor;

  const createMockJob = (): WorkerJob => ({
    job_id: 'job-1',
    task_id: 'task-1',
    stage: 'dev',
    worker_type: 'claude_code',
    input_prompt: 'Test prompt',
    repo_ref: { owner: 'owner', name: 'repo', base_sha: 'sha' },
    workspace_ref: { kind: 'host_path', workspace_id: '/workspace' },
    approval_policy: {
      mode: 'auto',
      allowed_side_effect_categories: [],
    },
    typed_ref: { type: 'issue', id: 'issue-1' },
    created_at: new Date().toISOString(),
  });

  beforeEach(() => {
    vi.clearAllMocks();

    // Create real session registry for testing reuse logic
    mockSessionRegistry = createOpenCodeSessionRegistry({
      sessionTtlMs: 3600000,
      leaseTtlMs: 300000,
    });

    // Create mock server manager
    mockServerManager = new OpenCodeServerManager({
      servePath: 'opencode',
      baseUrl: 'http://localhost:3001',
      startupTimeout: 30000,
    });

    // Create mock session executor
    mockSessionExecutor = new OpenCodeSessionExecutor({
      baseUrl: 'http://localhost:3001',
      timeout: 60000,
    }, mockSessionRegistry);

    adapter = new OpenCodeServeAdapter({
      workerType: 'claude_code',
      serverManager: mockServerManager,
      sessionRegistry: mockSessionRegistry,
      sessionExecutor: mockSessionExecutor,
      model: 'glm-5',
      debug: true,
    });
  });

  afterEach(async () => {
    mockSessionRegistry.shutdown();
    await adapter.shutdown();
  });

  describe('initialize', () => {
    it('should initialize successfully', async () => {
      await adapter.initialize();
      expect(adapter.workerType).toBe('claude_code');
    });
  });

  describe('getCapabilities', () => {
    it('should return correct capabilities', async () => {
      const caps = await adapter.getCapabilities();

      expect(caps.worker_type).toBe('claude_code');
      expect(caps.capabilities).toContain('plan');
      expect(caps.capabilities).toContain('edit_repo');
      expect(caps.supported_stages).toContain('dev');
      expect(caps.metadata?.substrate).toBe('opencode');
      expect(caps.metadata?.execution_mode).toBe('serve');
      expect(caps.metadata?.supports_session_reuse).toBe(true);
    });
  });

  describe('submitJob', () => {
    it('should submit job and return external job id', async () => {
      await adapter.initialize();

      const job = createMockJob();
      const result = await adapter.submitJob(job);

      expect(result.success).toBe(true);
      expect(result.external_job_id).toBeDefined();
      expect(result.status).toBe('queued');
    });

    it('should reject invalid job', async () => {
      await adapter.initialize();

      const invalidJob: WorkerJob = {
        ...createMockJob(),
        job_id: '', // Invalid - empty job_id
      };

      const result = await adapter.submitJob(invalidJob);
      expect(result.success).toBe(false);
      expect(result.status).toBe('rejected');
    });

    it('should use fallback when serve unavailable', async () => {
      // Mock server manager to return false (unavailable)
      (mockServerManager.ensureServerReady as Mock).mockResolvedValue(false);

      await adapter.initialize();

      const job = createMockJob();
      const submitResult = await adapter.submitJob(job);

      expect(submitResult.success).toBe(true);
      expect(submitResult.external_job_id).toBeDefined();
    });
  });

  describe('pollJob', () => {
    it('should return job status', async () => {
      await adapter.initialize();

      const job = createMockJob();
      const submitResult = await adapter.submitJob(job);

      // Poll immediately - job should be queued or running
      const pollResult = await adapter.pollJob(submitResult.external_job_id!);

      expect(pollResult.external_job_id).toBe(submitResult.external_job_id);
      expect(['queued', 'running', 'succeeded', 'failed']).toContain(pollResult.status);
    });

    it('should return failed for non-existent job', async () => {
      await adapter.initialize();

      const pollResult = await adapter.pollJob('non-existent-job');

      expect(pollResult.status).toBe('failed');
      expect(pollResult.error).toBe('Job not found');
    });
  });

  describe('cancelJob', () => {
    it('should return not_found for non-existent job', async () => {
      await adapter.initialize();

      const result = await adapter.cancelJob('non-existent-job');

      expect(result.success).toBe(false);
      expect(result.status).toBe('not_found');
    });
  });

  describe('collectArtifacts', () => {
    it('should return empty array for non-existent job', async () => {
      await adapter.initialize();

      const artifacts = await adapter.collectArtifacts('non-existent-job');

      expect(artifacts).toEqual([]);
    });
  });

  describe('normalizeEscalation', () => {
    it('should normalize permission request escalation', () => {
      const escalation = {
        permission: 'ask',
        reason: 'Test permission',
        tool: 'bash',
      };

      const result = adapter.normalizeEscalation(escalation);

      expect(result?.kind).toBe('human_verdict');
      expect(result?.reason).toBe('Test permission');
    });

    it('should normalize webfetch escalation', () => {
      const escalation = {
        type: 'permission_request',
        tool: 'webfetch',
        reason: 'Network access needed',
        approved: false,
      };

      const result = adapter.normalizeEscalation(escalation);

      expect(result?.kind).toBe('network_access');
      expect(result?.reason).toBe('Network access needed');
    });

    it('should return null for invalid escalation', () => {
      const result = adapter.normalizeEscalation(null);
      expect(result).toBeNull();

      const result2 = adapter.normalizeEscalation('invalid');
      expect(result2).toBeNull();
    });
  });
});

describe('Serve Adapter Fallback Behavior', () => {
  it('should use run fallback when serve fails', async () => {
    // This test verifies that the adapter gracefully falls back to run mode
    // when serve is unavailable

    const mockSessionRegistry = createOpenCodeSessionRegistry({
      sessionTtlMs: 3600000,
      leaseTtlMs: 300000,
    });

    const mockServerManager = new OpenCodeServerManager({
      servePath: 'opencode',
      baseUrl: 'http://localhost:3001',
      startupTimeout: 30000,
    });

    // Mock ensureServerReady to return false
    (mockServerManager.ensureServerReady as Mock).mockResolvedValue(false);

    const mockSessionExecutor = new OpenCodeSessionExecutor({
      baseUrl: 'http://localhost:3001',
      timeout: 60000,
    }, mockSessionRegistry);

    const adapter = new OpenCodeServeAdapter({
      workerType: 'claude_code',
      serverManager: mockServerManager,
      sessionRegistry: mockSessionRegistry,
      sessionExecutor: mockSessionExecutor,
      model: 'glm-5',
      debug: true,
    });

    await adapter.initialize();

    const job: WorkerJob = {
      job_id: 'job-fallback-1',
      task_id: 'task-1',
      stage: 'dev',
      worker_type: 'claude_code',
      input_prompt: 'Test prompt',
      repo_ref: { owner: 'owner', name: 'repo', base_sha: 'sha' },
      workspace_ref: { kind: 'host_path', workspace_id: '/workspace' },
      approval_policy: { mode: 'auto', allowed_side_effect_categories: [] },
      typed_ref: { type: 'issue', id: 'issue-1' },
      created_at: new Date().toISOString(),
    };

    const submitResult = await adapter.submitJob(job);

    // Even when serve fails, the job should be submitted successfully
    // because fallback is used
    expect(submitResult.success).toBe(true);

    mockSessionRegistry.shutdown();
    await adapter.shutdown();
  });
});