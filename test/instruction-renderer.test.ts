import { describe, expect, it } from 'vitest';
import { InstructionCompiler, resolveWorkerPrompt } from '../src/domain/instruction/index.js';
import type { DispatchRequest, Task, WorkerJob } from '../src/types.js';

function createJob(overrides: Partial<WorkerJob> = {}): WorkerJob {
  return {
    job_id: 'job_001',
    task_id: 'task_001',
    typed_ref: 'agent-taskstate:task:local:task_001',
    stage: 'dev',
    worker_type: 'codex',
    status: 'pending',
    workspace_ref: { workspace_id: 'ws_001', kind: 'container' },
    input_prompt: 'Legacy fallback input',
    repo_ref: { provider: 'github', owner: 'owner', name: 'repo', default_branch: 'main' },
    capability_requirements: ['edit_repo', 'run_tests'],
    risk_level: 'medium',
    approval_policy: { mode: 'ask', sandbox_profile: 'workspace_write' },
    ...overrides,
  };
}

describe('InstructionRenderer', () => {
  it('renders all machine-verifiable instruction sections', () => {
    const task: Task = {
      task_id: 'task_001',
      title: 'Improve instructions',
      objective: 'Deliver precise worker instructions',
      typed_ref: 'agent-taskstate:task:local:task_001',
      state: 'planned',
      risk_level: 'medium',
      version: 1,
      repo_ref: { provider: 'github', owner: 'owner', name: 'repo', default_branch: 'main' },
      created_at: '2026-06-11T00:00:00Z',
      updated_at: '2026-06-11T00:00:00Z',
    };
    const job = createJob();
    const request: DispatchRequest = { target_stage: 'dev' };
    const envelope = new InstructionCompiler().compile(task, job, request);
    envelope.authority.reverse();

    const prompt = resolveWorkerPrompt({ ...job, instruction_envelope: envelope });

    expect(prompt).toContain('# Instruction Envelope 2.0');
    expect(prompt).toContain('Job ID: job_001');
    expect(prompt).toContain('Task ID: task_001');
    expect(prompt).toContain('Stage: dev');
    expect(prompt).toContain('## Authority');
    expect(prompt.indexOf('Tier 1')).toBeLessThan(prompt.indexOf('Tier 2'));
    expect(prompt.indexOf('Tier 2')).toBeLessThan(prompt.indexOf('Tier 3'));
    expect(prompt).toContain('Deliver precise worker instructions');
    expect(prompt).toContain('## Must');
    expect(prompt).toContain('## Must Not');
    expect(prompt).toContain('## Allowed Tools');
    expect(prompt).toContain('## Required Output');
    expect(prompt).toContain('"type": "object"');
  });

  it('rejects versioned jobs without an envelope body', () => {
    const job = createJob({ metadata: { instruction_envelope_version: '2.0' } });
    expect(() => resolveWorkerPrompt(job)).toThrow('has no instruction_envelope');
  });

  it('keeps a fallback prompt for legacy jobs', () => {
    const prompt = resolveWorkerPrompt(createJob({
      input_prompt: '',
      context: {
        objective: 'Fallback objective',
        constraints: ['Do not publish'],
        acceptance_criteria: ['Tests pass'],
      },
      requested_outputs: ['patch', 'tests'],
    }));

    expect(prompt).toContain('Fallback objective');
    expect(prompt).toContain('Do not publish');
    expect(prompt).toContain('Tests pass');
    expect(prompt).toContain('owner/repo');
  });

  it('preserves an existing legacy input prompt exactly', () => {
    expect(resolveWorkerPrompt(createJob())).toBe('Legacy fallback input');
  });
});
