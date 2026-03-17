import { describe, it, expect, beforeEach } from 'vitest';
import { ClaudeCodeAdapter, type ClaudeCodeAdapterConfig } from '../src/domain/worker/claude-code-adapter.js';
import type { WorkerJob } from '../src/types.js';

describe('ClaudeCodeAdapter', () => {
  let adapter: ClaudeCodeAdapter;

  beforeEach(() => {
    const config: ClaudeCodeAdapterConfig = {
      workerType: 'claude_code',
      model: 'claude-sonnet-4-6',
      auth: {
        type: 'api_key',
        value: 'test-api-key',
      },
    };

    adapter = new ClaudeCodeAdapter(config);
  });

  describe('constructor', () => {
    it('should create adapter with default model', () => {
      const config: ClaudeCodeAdapterConfig = {
        workerType: 'claude_code',
        auth: { type: 'api_key', value: 'key' },
      };
      const adapter = new ClaudeCodeAdapter(config);
      expect(adapter).toBeDefined();
    });

    it('should accept custom model', () => {
      const config: ClaudeCodeAdapterConfig = {
        workerType: 'claude_code',
        model: 'claude-opus-4-6',
        auth: { type: 'api_key', value: 'key' },
      };
      const adapter = new ClaudeCodeAdapter(config);
      expect(adapter).toBeDefined();
    });
  });

  describe('initialize', () => {
    it('should initialize with API key', async () => {
      await adapter.initialize();
      expect(await adapter.isReady()).toBe(true);
    });

    it('should warn without API key but still initialize', async () => {
      const noKeyAdapter = new ClaudeCodeAdapter({
        workerType: 'claude_code',
      });
      // Should not throw
      await noKeyAdapter.initialize();
      expect(await noKeyAdapter.isReady()).toBe(true);
    });
  });

  describe('getCapabilities', () => {
    it('should return Claude Code capabilities', async () => {
      const caps = await adapter.getCapabilities();

      expect(caps.worker_type).toBe('claude_code');
      expect(caps.capabilities).toContain('plan');
      expect(caps.capabilities).toContain('edit_repo');
      expect(caps.capabilities).toContain('needs_approval');
      expect(caps.max_concurrent_jobs).toBe(5);
      expect(caps.metadata?.model).toBe('claude-sonnet-4-6');
      expect(caps.metadata?.supports_mcp).toBe(true);
    });
  });

  describe('submitJob', () => {
    beforeEach(async () => {
      await adapter.initialize();
    });

    it('should submit valid job', async () => {
      const job: WorkerJob = {
        job_id: 'job_123',
        task_id: 'task_123',
        typed_ref: 'shipyard:task:github:123',
        stage: 'plan',
        worker_type: 'claude_code',
        workspace_ref: { workspace_id: 'ws_1', kind: 'container' },
        input_prompt: 'Create a plan',
        repo_ref: { provider: 'github', owner: 'test', name: 'repo', default_branch: 'main' },
        capability_requirements: ['plan'],
        risk_level: 'low',
        approval_policy: { mode: 'ask' },
      };

      const result = await adapter.submitJob(job);

      expect(result.success).toBe(true);
      expect(result.external_job_id).toBeDefined();
      expect(result.status).toBe('queued');
    });

    it('should estimate duration based on stage', async () => {
      const baseJob: WorkerJob = {
        job_id: 'job_123',
        task_id: 'task_123',
        typed_ref: 'shipyard:task:github:123',
        stage: 'plan',
        worker_type: 'claude_code',
        workspace_ref: { workspace_id: 'ws_1', kind: 'container' },
        input_prompt: 'Test',
        repo_ref: { provider: 'github', owner: 'test', name: 'repo', default_branch: 'main' },
        capability_requirements: ['plan'],
        risk_level: 'low',
        approval_policy: { mode: 'ask' },
      };

      const planResult = await adapter.submitJob({ ...baseJob, stage: 'plan' });
      expect(planResult.estimated_duration_ms).toBe(45000);

      const devResult = await adapter.submitJob({ ...baseJob, stage: 'dev' });
      expect(devResult.estimated_duration_ms).toBe(180000);

      const accResult = await adapter.submitJob({ ...baseJob, stage: 'acceptance' });
      expect(accResult.estimated_duration_ms).toBe(90000);
    });
  });

  describe('pollJob', () => {
    beforeEach(async () => {
      await adapter.initialize();
    });

    it('should return failed for non-existent job', async () => {
      const result = await adapter.pollJob('non-existent');
      expect(result.status).toBe('failed');
    });

    it('should return running status for new job', async () => {
      const job: WorkerJob = {
        job_id: 'job_123',
        task_id: 'task_123',
        typed_ref: 'shipyard:task:github:123',
        stage: 'plan',
        worker_type: 'claude_code',
        workspace_ref: { workspace_id: 'ws_1', kind: 'container' },
        input_prompt: 'Test',
        repo_ref: { provider: 'github', owner: 'test', name: 'repo', default_branch: 'main' },
        capability_requirements: ['plan'],
        risk_level: 'low',
        approval_policy: { mode: 'ask' },
      };

      const submitResult = await adapter.submitJob(job);
      const pollResult = await adapter.pollJob(submitResult.external_job_id!);

      expect(pollResult.status).toBe('running');
    });
  });

  describe('cancelJob', () => {
    beforeEach(async () => {
      await adapter.initialize();
    });

    it('should cancel existing job', async () => {
      const job: WorkerJob = {
        job_id: 'job_123',
        task_id: 'task_123',
        typed_ref: 'shipyard:task:github:123',
        stage: 'plan',
        worker_type: 'claude_code',
        workspace_ref: { workspace_id: 'ws_1', kind: 'container' },
        input_prompt: 'Test',
        repo_ref: { provider: 'github', owner: 'test', name: 'repo', default_branch: 'main' },
        capability_requirements: ['plan'],
        risk_level: 'low',
        approval_policy: { mode: 'ask' },
      };

      const submitResult = await adapter.submitJob(job);
      const cancelResult = await adapter.cancelJob(submitResult.external_job_id!);

      expect(cancelResult.success).toBe(true);
      expect(cancelResult.status).toBe('cancelled');
    });
  });

  describe('collectArtifacts', () => {
    beforeEach(async () => {
      await adapter.initialize();
    });

    it('should collect artifacts from job', async () => {
      const job: WorkerJob = {
        job_id: 'job_123',
        task_id: 'task_123',
        typed_ref: 'shipyard:task:github:123',
        stage: 'plan',
        worker_type: 'claude_code',
        workspace_ref: { workspace_id: 'ws_1', kind: 'container' },
        input_prompt: 'Test',
        repo_ref: { provider: 'github', owner: 'test', name: 'repo', default_branch: 'main' },
        capability_requirements: ['plan'],
        risk_level: 'low',
        approval_policy: { mode: 'ask' },
      };

      const submitResult = await adapter.submitJob(job);
      const artifacts = await adapter.collectArtifacts(submitResult.external_job_id!);

      expect(artifacts.length).toBeGreaterThan(0);
    });
  });

  describe('normalizeEscalation', () => {
    it('should normalize WebFetch tool use', () => {
      const raw = {
        tool_use_request: {
          tool_name: 'WebFetch',
          reason: 'Fetch documentation',
          approved: false,
        },
      };

      const result = adapter.normalizeEscalation(raw);

      expect(result).not.toBeNull();
      expect(result?.kind).toBe('network_access');
    });

    it('should normalize WebSearch tool use', () => {
      const raw = {
        tool_use_request: {
          tool_name: 'WebSearch',
          reason: 'Search for solutions',
        },
      };

      const result = adapter.normalizeEscalation(raw);

      expect(result).not.toBeNull();
      expect(result?.kind).toBe('network_access');
    });

    it('should normalize destructive bash commands', () => {
      const raw = {
        tool_use_request: {
          tool_name: 'bash',
          input: {
            command: 'rm -rf node_modules',
          },
          reason: 'Clean up',
        },
      };

      const result = adapter.normalizeEscalation(raw);

      expect(result).not.toBeNull();
      expect(result?.kind).toBe('destructive_tool');
      expect(result?.reason).toContain('rm -rf');
    });

    it('should normalize permission mode change', () => {
      const raw = {
        permission_mode_change: {
          from: 'read_only',
          to: 'full_auto',
        },
      };

      const result = adapter.normalizeEscalation(raw);

      expect(result).not.toBeNull();
      expect(result?.kind).toBe('human_verdict');
      expect(result?.approved).toBe(false);
    });

    it('should fall back to default for standard format', () => {
      const raw = {
        kind: 'secret_access',
        reason: 'Need credentials',
      };

      const result = adapter.normalizeEscalation(raw);

      expect(result).not.toBeNull();
      expect(result?.kind).toBe('secret_access');
    });
  });
});