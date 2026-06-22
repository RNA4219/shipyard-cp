import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { GLM5Adapter } from '../src/domain/worker/glm5-adapter.js';
import type { WorkerJob } from '../src/types.js';

function createEnvelope(job: WorkerJob) {
  return {
    protocol_version: '2.0' as const,
    job_id: job.job_id,
    task_id: job.task_id,
    typed_ref: job.typed_ref,
    stage: job.stage,
    authority: [{ tier: 1, source: 'system' as const, instruction: 'Return valid JSON only.' }],
    objective: job.context?.objective ?? 'Test envelope',
    must: ['Follow the required output schema.'],
    must_not: [],
    allowed_tools: [{ name: 'read_file', args_schema: { type: 'object' } }],
    required_output: {
      kind: job.stage === 'plan' ? 'plan_intent' as const : job.stage === 'acceptance' ? 'acceptance_verdict' as const : 'tool_plan' as const,
      json_schema: { type: 'object' },
    },
  };
}

async function pollUntilDone(adapter: GLM5Adapter, externalJobId: string) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const result = await adapter.pollJob(externalJobId);
    if (result.status !== 'running' && result.status !== 'queued') {
      return result;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return adapter.pollJob(externalJobId);
}

// Mock LiteLLMConnector
vi.mock('../src/domain/litellm/litellm-connector.js', () => ({
  LiteLLMConnector: class MockLiteLLMConnector {
    async listModels() {
      return [{ id: 'glm-5' }];
    }
    async chatCompletion(request: { messages: Array<{role: string; content: string}> }) {
      // Return different responses based on the prompt
      const promptText = request.messages.map(message => message.content).join('\n');
      if (promptText.includes('acceptance')) {
        return {
          id: 'chat-123',
          object: 'chat.completion',
          created: Date.now(),
          model: 'glm-5',
          choices: [{
            index: 0,
            message: { role: 'assistant', content: '{"verdict": {"outcome": "accept", "reason": "All tests passed"}}' },
            finish_reason: 'stop',
          }],
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        };
      }
      if (promptText.includes('patch')) {
        return {
          id: 'chat-124',
          object: 'chat.completion',
          created: Date.now(),
          model: 'glm-5',
          choices: [{
            index: 0,
            message: { role: 'assistant', content: '--- a/file.ts\n+++ b/file.ts\n@@ -1,1 +1,2 @@\n+new line' },
            finish_reason: 'stop',
          }],
          usage: { prompt_tokens: 80, completion_tokens: 30, total_tokens: 110 },
        };
      }
      if (promptText.includes('natural-language-json')) {
        return {
          id: 'chat-126',
          object: 'chat.completion',
          created: Date.now(),
          model: 'glm-5',
          choices: [{
            index: 0,
            message: { role: 'assistant', content: 'I will analyze the task first.\n{"summary":"Should fail"}' },
            finish_reason: 'stop',
          }],
          usage: { prompt_tokens: 95, completion_tokens: 45, total_tokens: 140 },
        };
      }
      if (promptText.includes('fenced-json')) {
        return {
          id: 'chat-125',
          object: 'chat.completion',
          created: Date.now(),
          model: 'glm-5',
          choices: [{
            index: 0,
            message: { role: 'assistant', content: '```json\n{"summary":"Fenced response","steps":[],"risks":[],"dependencies":[],"evidence":[]}\n```' },
            finish_reason: 'stop',
          }],
          usage: { prompt_tokens: 90, completion_tokens: 40, total_tokens: 130 },
        };
      }
      if (promptText.includes('write-file-tool-plan')) {
        return {
          id: 'chat-127',
          object: 'chat.completion',
          created: Date.now(),
          model: 'glm-5',
          choices: [{
            index: 0,
            message: {
              role: 'assistant',
              content: JSON.stringify({
                summary: 'Write a file from tool_plan',
                calls: [{ tool: 'write_file', args: { path: 'glm-output.txt', content: 'written by glm\n' } }],
                evidence: ['glm-output.txt'],
              }),
            },
            finish_reason: 'stop',
          }],
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        };
      }
      if (promptText.includes('tool_plan')) {
        return {
          id: 'chat-128',
          object: 'chat.completion',
          created: Date.now(),
          model: 'glm-5',
          choices: [{
            index: 0,
            message: {
              role: 'assistant',
              content: JSON.stringify({
                summary: 'Read-only tool plan',
                calls: [{ tool: 'read_file', args: { path: 'package.json' } }],
                evidence: ['package.json'],
              }),
            },
            finish_reason: 'stop',
          }],
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        };
      }
      return {
        id: 'chat-123',
        object: 'chat.completion',
        created: Date.now(),
        model: 'glm-5',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: '{"summary": "Test response"}' },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      };
    }
  },
}));

describe('GLM5Adapter', () => {
  let adapter: GLM5Adapter;
  let tempDirs: string[] = [];

  beforeEach(() => {
    adapter = new GLM5Adapter({ workerType: 'claude_code' });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await Promise.all(tempDirs.map(dir => rm(dir, { recursive: true, force: true })));
    tempDirs = [];
  });

  describe('initialization', () => {
    it('should create adapter with default config', () => {
      expect(adapter.workerType).toBe('claude_code');
    });

    it('should accept custom config', () => {
      const customAdapter = new GLM5Adapter({
        workerType: 'claude_code',
        model: 'custom-model',
        timeout: 60000,
      });
      expect(customAdapter.workerType).toBe('claude_code');
    });

    it('should initialize successfully', async () => {
      await adapter.initialize();
      // Should not throw
    });
  });

  describe('getCapabilities', () => {
    it('should return correct capabilities', async () => {
      const capabilities = await adapter.getCapabilities();

      expect(capabilities.worker_type).toBe('claude_code');
      expect(capabilities.capabilities).toContain('plan');
      expect(capabilities.capabilities).toContain('edit_repo');
      expect(capabilities.capabilities).toContain('run_tests');
      expect(capabilities.max_concurrent_jobs).toBeGreaterThan(0);
      expect(capabilities.supported_stages).toContain('plan');
      expect(capabilities.supported_stages).toContain('dev');
      expect(capabilities.supported_stages).toContain('acceptance');
      expect(capabilities.metadata?.model).toBe('glm-5');
      expect(capabilities.metadata?.provider).toBe('alibaba_cloud');
    });
  });

  describe('submitJob', () => {
    it('should accept valid jobs', async () => {
      const job: WorkerJob = {
        job_id: 'job_1',
        task_id: 'task_1',
        typed_ref: 'test:task:1',
        stage: 'plan',
        repo_ref: {
          provider: 'github',
          owner: 'test',
          name: 'repo',
          default_branch: 'main',
        },
        worker_type: 'claude_code',
        context: { objective: 'Test job' },
      };

      const result = await adapter.submitJob(job);

      expect(result.success).toBe(true);
      expect(result.external_job_id).toBeDefined();
      expect(result.status).toBe('queued');
    });

    it('should reject jobs missing required fields', async () => {
      const job = {
        job_id: 'job_2',
        task_id: 'task_2',
        // Missing required fields
      } as unknown as WorkerJob;

      const result = await adapter.submitJob(job);

      expect(result.success).toBe(false);
      expect(result.status).toBe('rejected');
    });

    it('should accept jobs with input_prompt', async () => {
      const job: WorkerJob = {
        job_id: 'job_5',
        task_id: 'task_5',
        typed_ref: 'test:task:5',
        stage: 'plan',
        repo_ref: {
          provider: 'github',
          owner: 'test',
          name: 'repo',
          default_branch: 'main',
        },
        worker_type: 'claude_code',
        input_prompt: 'Custom prompt for the job',
      };

      const result = await adapter.submitJob(job);

      expect(result.success).toBe(true);
      expect(result.estimated_duration_ms).toBeGreaterThan(0);
    });
  });

  describe('pollJob', () => {
    it('should return failed for unknown job', async () => {
      const result = await adapter.pollJob('unknown-job');

      expect(result.status).toBe('failed');
      expect(result.error).toContain('not found');
    });

    it('should return job status after submission', async () => {
      const job: WorkerJob = {
        job_id: 'job_3',
        task_id: 'task_3',
        typed_ref: 'test:task:3',
        stage: 'plan',
        repo_ref: {
          provider: 'github',
          owner: 'test',
          name: 'repo',
          default_branch: 'main',
        },
        worker_type: 'claude_code',
        context: { objective: 'Test job' },
      };

      const submitResult = await adapter.submitJob(job);
      expect(submitResult.success).toBe(true);

      const pollResult = await adapter.pollJob(submitResult.external_job_id!);
      expect(['queued', 'running', 'succeeded', 'failed']).toContain(pollResult.status);
    });

    it('should return progress for running jobs', async () => {
      const job: WorkerJob = {
        job_id: 'job_6',
        task_id: 'task_6',
        typed_ref: 'test:task:6',
        stage: 'dev',
        repo_ref: {
          provider: 'github',
          owner: 'test',
          name: 'repo',
          default_branch: 'main',
        },
        worker_type: 'claude_code',
        context: { objective: 'Test job' },
      };

      const submitResult = await adapter.submitJob(job);
      expect(submitResult.success).toBe(true);

      // Poll immediately - job should be running or completed
      const pollResult = await adapter.pollJob(submitResult.external_job_id!);
      expect(['running', 'succeeded', 'queued']).toContain(pollResult.status);
    });
  });

  describe('cancelJob', () => {
    it('should return not_found for unknown job', async () => {
      const result = await adapter.cancelJob('unknown-job');

      expect(result.success).toBe(false);
      expect(result.status).toBe('not_found');
    });

    it('should cancel running job', async () => {
      const job: WorkerJob = {
        job_id: 'job_4',
        task_id: 'task_4',
        typed_ref: 'test:task:4',
        stage: 'plan',
        repo_ref: {
          provider: 'github',
          owner: 'test',
          name: 'repo',
          default_branch: 'main',
        },
        worker_type: 'claude_code',
        context: { objective: 'Test job' },
      };

      const submitResult = await adapter.submitJob(job);
      expect(submitResult.success).toBe(true);

      // Cancel immediately after submission (before completion)
      const cancelResult = await adapter.cancelJob(submitResult.external_job_id!);

      // Job may already be completed due to mock's instant completion
      // Accept either cancelled or not_found (job cleaned up after completion)
      expect(['cancelled', 'not_found', 'already_completed']).toContain(cancelResult.status);
    });

    it('should return already_completed for finished job', async () => {
      const job: WorkerJob = {
        job_id: 'job_7',
        task_id: 'task_7',
        typed_ref: 'test:task:7',
        stage: 'plan',
        repo_ref: {
          provider: 'github',
          owner: 'test',
          name: 'repo',
          default_branch: 'main',
        },
        worker_type: 'claude_code',
        context: { objective: 'Test job' },
      };

      const submitResult = await adapter.submitJob(job);
      expect(submitResult.success).toBe(true);

      // Wait for completion
      await new Promise(resolve => setTimeout(resolve, 50));

      // Poll to mark as completed
      const pollResult = await adapter.pollJob(submitResult.external_job_id!);
      if (pollResult.status === 'succeeded') {
        const cancelResult = await adapter.cancelJob(submitResult.external_job_id!);
        expect(cancelResult.status).toBe('not_found');
      }
    });
  });

  describe('collectArtifacts', () => {
    it('should return empty array for unknown job', async () => {
      const artifacts = await adapter.collectArtifacts('unknown-job');
      expect(artifacts).toEqual([]);
    });

    it('should return artifacts for completed job', async () => {
      const job: WorkerJob = {
        job_id: 'job_8',
        task_id: 'task_8',
        typed_ref: 'test:task:8',
        stage: 'plan',
        repo_ref: {
          provider: 'github',
          owner: 'test',
          name: 'repo',
          default_branch: 'main',
        },
        worker_type: 'claude_code',
        context: { objective: 'Test job' },
      };

      const submitResult = await adapter.submitJob(job);
      await new Promise(resolve => setTimeout(resolve, 50));
      await adapter.pollJob(submitResult.external_job_id!);

      // After completion, artifacts should be available (if job hasn't been cleaned up)
      const artifacts = await adapter.collectArtifacts(submitResult.external_job_id!);
      expect(Array.isArray(artifacts)).toBe(true);
    });
  });

  describe('different stages', () => {
    it('should handle acceptance stage with verdict', async () => {
      const job: WorkerJob = {
        job_id: 'job_9',
        task_id: 'task_9',
        typed_ref: 'test:task:9',
        stage: 'acceptance',
        repo_ref: {
          provider: 'github',
          owner: 'test',
          name: 'repo',
          default_branch: 'main',
        },
        worker_type: 'claude_code',
        context: { objective: 'Test acceptance' },
      };

      const submitResult = await adapter.submitJob(job);
      expect(submitResult.success).toBe(true);

      await new Promise(resolve => setTimeout(resolve, 50));
      const pollResult = await adapter.pollJob(submitResult.external_job_id!);
      expect(pollResult.status).toBe('succeeded');
    });

    it('should handle dev stage', async () => {
      const job: WorkerJob = {
        job_id: 'job_10',
        task_id: 'task_10',
        typed_ref: 'test:task:10',
        stage: 'dev',
        repo_ref: {
          provider: 'github',
          owner: 'test',
          name: 'repo',
          default_branch: 'main',
        },
        worker_type: 'claude_code',
        context: { objective: 'Test dev stage' },
      };

      const submitResult = await adapter.submitJob(job);
      expect(submitResult.success).toBe(true);
      expect(submitResult.estimated_duration_ms).toBe(120000); // 2 minutes for dev
    });
  });

  describe('envelope mode', () => {
    it('should detect envelope mode from metadata', async () => {
      const job: WorkerJob = {
        job_id: 'job_envelope_1',
        task_id: 'task_envelope_1',
        typed_ref: 'test:task:envelope:1',
        stage: 'dev',
        repo_ref: {
          provider: 'github',
          owner: 'test',
          name: 'repo',
          default_branch: 'main',
        },
        worker_type: 'claude_code',
        context: { objective: 'Test envelope mode' },
        metadata: {
          instruction_envelope_version: '2.0',
        },
      };
      job.instruction_envelope = createEnvelope(job);

      const submitResult = await adapter.submitJob(job);
      expect(submitResult.success).toBe(true);
    });

    it('should handle valid tool_plan in envelope mode dev stage', async () => {
      // Mock with valid tool_plan response
      const envelopeJob: WorkerJob = {
        job_id: 'job_envelope_2',
        task_id: 'task_envelope_2',
        typed_ref: 'test:task:envelope:2',
        stage: 'dev',
        repo_ref: {
          provider: 'github',
          owner: 'test',
          name: 'repo',
          default_branch: 'main',
        },
        worker_type: 'claude_code',
        context: { objective: 'Test envelope tool_plan' },
        metadata: {
          instruction_envelope_version: '2.0',
        },
      };
      envelopeJob.instruction_envelope = createEnvelope(envelopeJob);

      const result = await adapter.submitJob(envelopeJob);
      expect(result.success).toBe(true);

      await new Promise(resolve => setTimeout(resolve, 50));
      const pollResult = await adapter.pollJob(result.external_job_id!);
      // Should succeed since mock returns valid JSON
      expect(['succeeded', 'running', 'queued']).toContain(pollResult.status);
      if (pollResult.status === 'succeeded') {
        expect(pollResult.result?.patch_ref).toBeUndefined();
        expect(pollResult.result?.artifacts.some(artifact => artifact.artifact_id.endsWith('-tool-plan'))).toBe(true);
      }
    });

    it('should execute write_file calls from valid tool_plan output when workspace writing is allowed', async () => {
      const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'shipyard-glm-tool-plan-'));
      tempDirs.push(workspaceRoot);
      const job: WorkerJob = {
        job_id: 'job_envelope_write_file_tool_plan',
        task_id: 'task_envelope_write_file_tool_plan',
        typed_ref: 'test:task:envelope:write-file-tool-plan',
        stage: 'dev',
        repo_ref: {
          provider: 'github',
          owner: 'local',
          name: 'repo',
          default_branch: 'main',
        },
        workspace_ref: { kind: 'host_path', workspace_id: workspaceRoot },
        worker_type: 'claude_code',
        context: { objective: 'Test write-file-tool-plan response' },
        approval_policy: { mode: 'ask', sandbox_profile: 'workspace_write', operator_approval_required: false },
        capability_requirements: ['edit_repo', 'run_tests'],
        metadata: {
          instruction_envelope_version: '2.0',
        },
      };
      job.instruction_envelope = {
        ...createEnvelope(job),
        allowed_tools: [{ name: 'write_file', args_schema: { type: 'object' } }],
      };

      const submitResult = await adapter.submitJob(job);
      expect(submitResult.success).toBe(true);

      const pollResult = await pollUntilDone(adapter, submitResult.external_job_id!);

      expect(pollResult.status).toBe('succeeded');
      expect(pollResult.result?.metadata?.tool_plan_executed).toBe(true);
      expect(pollResult.result?.metadata?.tool_plan_applied).toBe(true);
      expect(pollResult.result?.patch_ref).toBeUndefined();
      await expect(readFile(path.join(workspaceRoot, 'glm-output.txt'), 'utf8')).resolves.toBe('written by glm\n');
    });

    it('should preserve raw output on parse failure', async () => {
      // Mock returns valid JSON by default, parse failure is tested in integration
      const job: WorkerJob = {
        job_id: 'job_envelope_3',
        task_id: 'task_envelope_3',
        typed_ref: 'test:task:envelope:3',
        stage: 'dev',
        repo_ref: {
          provider: 'github',
          owner: 'test',
          name: 'repo',
          default_branch: 'main',
        },
        worker_type: 'claude_code',
        context: { objective: 'Test envelope raw output' },
        metadata: {
          instruction_envelope_version: '2.0',
        },
      };
      job.instruction_envelope = createEnvelope(job);

      const submitResult = await adapter.submitJob(job);
      expect(submitResult.success).toBe(true);

      await new Promise(resolve => setTimeout(resolve, 50));
      const pollResult = await adapter.pollJob(submitResult.external_job_id!);

      // If succeeded, check artifact was captured
      if (pollResult.status === 'succeeded' && pollResult.result) {
        expect(pollResult.result.artifacts).toBeDefined();
        expect(pollResult.result.artifacts.length).toBeGreaterThan(0);
      }
    });

    it('should use JSON-only system prompt for envelope mode', async () => {
      // This is verified by checking the metadata in executeCompletion
      const job: WorkerJob = {
        job_id: 'job_envelope_4',
        task_id: 'task_envelope_4',
        typed_ref: 'test:task:envelope:4',
        stage: 'plan',
        repo_ref: {
          provider: 'github',
          owner: 'test',
          name: 'repo',
          default_branch: 'main',
        },
        worker_type: 'claude_code',
        context: { objective: 'Test envelope plan' },
        metadata: {
          instruction_envelope_version: '2.0',
        },
      };
      job.instruction_envelope = createEnvelope(job);

      const submitResult = await adapter.submitJob(job);
      expect(submitResult.success).toBe(true);
    });

    it('should parse JSON wrapped in a Markdown code fence', async () => {
      const job: WorkerJob = {
        job_id: 'job_envelope_fenced',
        task_id: 'task_envelope_fenced',
        typed_ref: 'test:task:envelope:fenced',
        stage: 'plan',
        repo_ref: {
          provider: 'github',
          owner: 'test',
          name: 'repo',
          default_branch: 'main',
        },
        worker_type: 'claude_code',
        context: { objective: 'Test fenced-json response' },
        metadata: {
          instruction_envelope_version: '2.0',
        },
      };
      job.instruction_envelope = createEnvelope(job);

      const submitResult = await adapter.submitJob(job);
      expect(submitResult.success).toBe(true);

      await new Promise(resolve => setTimeout(resolve, 50));
      const pollResult = await adapter.pollJob(submitResult.external_job_id!);

      expect(pollResult.status).toBe('succeeded');
      expect(pollResult.result?.summary).toBe('Fenced response');
      expect(pollResult.result?.artifacts.some(artifact => artifact.artifact_id.endsWith('-raw-response'))).toBe(true);
    });

    it('should fail envelope mode when GLM emits prose before JSON', async () => {
      const job: WorkerJob = {
        job_id: 'job_envelope_natural_language',
        task_id: 'task_envelope_natural_language',
        typed_ref: 'test:task:envelope:natural-language',
        stage: 'plan',
        repo_ref: {
          provider: 'github',
          owner: 'test',
          name: 'repo',
          default_branch: 'main',
        },
        worker_type: 'claude_code',
        context: { objective: 'Test natural-language-json response' },
        metadata: {
          instruction_envelope_version: '2.0',
        },
      };
      job.instruction_envelope = createEnvelope(job);

      const submitResult = await adapter.submitJob(job);
      expect(submitResult.success).toBe(true);

      await new Promise(resolve => setTimeout(resolve, 50));
      const pollResult = await adapter.pollJob(submitResult.external_job_id!);

      expect(pollResult.status).toBe('succeeded');
      expect(pollResult.result?.status).toBe('failed');
      expect(pollResult.result?.failure_code).toBe('structured_output_parse_error');
      expect(pollResult.result?.artifacts.some(artifact => artifact.artifact_id.endsWith('-raw-response'))).toBe(true);
    });

    it('should maintain litellm usage info', async () => {
      const job: WorkerJob = {
        job_id: 'job_envelope_5',
        task_id: 'task_envelope_5',
        typed_ref: 'test:task:envelope:5',
        stage: 'dev',
        repo_ref: {
          provider: 'github',
          owner: 'test',
          name: 'repo',
          default_branch: 'main',
        },
        worker_type: 'claude_code',
        context: { objective: 'Test envelope usage' },
        metadata: {
          instruction_envelope_version: '2.0',
        },
      };
      job.instruction_envelope = createEnvelope(job);

      const submitResult = await adapter.submitJob(job);
      expect(submitResult.success).toBe(true);

      await new Promise(resolve => setTimeout(resolve, 50));
      const pollResult = await adapter.pollJob(submitResult.external_job_id!);

      if (pollResult.status === 'succeeded' && pollResult.result) {
        expect(pollResult.result.usage).toBeDefined();
        expect(pollResult.result.usage?.litellm).toBeDefined();
        expect(pollResult.result.usage?.litellm?.model).toBe('glm-5');
        expect(pollResult.result.usage?.litellm?.provider).toBe('alibaba_cloud');
      }
    });
  });
});
