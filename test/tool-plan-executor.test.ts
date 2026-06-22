import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ToolPlanExecutor } from '../src/domain/worker/tool-plan-executor.js';
import type { ToolPlanOutput, WorkerJob } from '../src/types.js';

let tempDirs: string[] = [];

function createJob(workspaceRoot: string): WorkerJob {
  return {
    job_id: 'job_tool_plan_executor',
    task_id: 'task_tool_plan_executor',
    typed_ref: 'shipyard:task:test:tool-plan-executor',
    stage: 'dev',
    worker_type: 'claude_code',
    status: 'pending',
    workspace_ref: { kind: 'host_path', workspace_id: workspaceRoot },
    input_prompt: 'test',
    repo_ref: { provider: 'github', owner: 'local', name: 'repo', default_branch: 'main' },
    capability_requirements: ['edit_repo', 'run_tests'],
    risk_level: 'medium',
    approval_policy: { mode: 'ask', sandbox_profile: 'workspace_write', operator_approval_required: false },
  };
}

async function createWorkspace(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'shipyard-tool-plan-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.map(dir => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

describe('ToolPlanExecutor', () => {
  it('writes files and applies exact locator replacements inside the workspace', async () => {
    const workspace = await createWorkspace();
    await writeFile(path.join(workspace, 'existing.txt'), 'alpha\nold\nomega\n', 'utf8');
    const plan: ToolPlanOutput = {
      summary: 'write and patch',
      calls: [
        { tool: 'write_file', args: { path: 'new/file.txt', content: 'hello\n' } },
        { tool: 'apply_patch_intent', args: { path: 'existing.txt', locator: 'old', replacement: 'new' } },
      ],
      evidence: ['existing.txt'],
    };

    const result = await new ToolPlanExecutor().execute(plan, createJob(workspace));

    expect(result.errors).toEqual([]);
    expect(result.execution_verdict).toBe('applied');
    expect(result.applied).toBe(true);
    expect(result.artifact_paths).toEqual([
      'artifacts/jobs/job_tool_plan_executor/tool-plan.json',
      'artifacts/jobs/job_tool_plan_executor/execution-verdict.json',
      'artifacts/jobs/job_tool_plan_executor/diff-stat.txt',
      'artifacts/jobs/job_tool_plan_executor/diff.patch',
      'artifacts/jobs/job_tool_plan_executor/test-summary.json',
    ]);
    await expect(readFile(path.join(workspace, 'new/file.txt'), 'utf8')).resolves.toBe('hello\n');
    await expect(readFile(path.join(workspace, 'existing.txt'), 'utf8')).resolves.toBe('alpha\nnew\nomega\n');
    await expect(
      readFile(path.join(workspace, 'artifacts/jobs/job_tool_plan_executor/diff.patch'), 'utf8'),
    ).resolves.toContain('diff --shipyard a/new/file.txt b/new/file.txt');
    await expect(
      readFile(path.join(workspace, 'artifacts/jobs/job_tool_plan_executor/diff-stat.txt'), 'utf8'),
    ).resolves.toContain('2 file(s) changed');
  });

  it('rejects paths that escape the workspace', async () => {
    const workspace = await createWorkspace();
    const plan: ToolPlanOutput = {
      summary: 'escape',
      calls: [{ tool: 'write_file', args: { path: '../escape.txt', content: 'nope' } }],
      evidence: ['../escape.txt'],
    };

    const result = await new ToolPlanExecutor().execute(plan, createJob(workspace));

    expect(result.applied).toBe(false);
    expect(result.execution_verdict).toBe('failed');
    expect(result.errors[0]).toContain('repo-relative');
  });

  it('skips execution when policy denies side effects', async () => {
    const workspace = await createWorkspace();
    const job = createJob(workspace);
    job.approval_policy = { mode: 'deny', sandbox_profile: 'workspace_write' };
    const plan: ToolPlanOutput = {
      summary: 'denied',
      calls: [{ tool: 'write_file', args: { path: 'file.txt', content: 'nope' } }],
      evidence: ['file.txt'],
    };

    const result = await new ToolPlanExecutor().execute(plan, job);

    expect(result.skipped).toBe(true);
    expect(result.applied).toBe(false);
    expect(result.execution_verdict).toBe('skipped');
  });

  it('supports dry-run without writing workspace files or artifacts', async () => {
    const workspace = await createWorkspace();
    const plan: ToolPlanOutput = {
      summary: 'dry run write',
      dry_run: true,
      calls: [{ tool: 'write_file', args: { path: 'planned.txt', content: 'not written\n' } }],
      evidence: ['planned.txt'],
    };

    const result = await new ToolPlanExecutor().execute(plan, createJob(workspace));

    expect(result.execution_verdict).toBe('dry_run');
    expect(result.dry_run).toBe(true);
    expect(result.applied).toBe(false);
    expect(result.operations).toMatchObject([
      { tool: 'write_file', status: 'planned', path: 'planned.txt' },
    ]);
    await expect(readFile(path.join(workspace, 'planned.txt'), 'utf8')).rejects.toThrow();
    expect(result.artifact_paths).toEqual([]);
  });

  it('rejects write operations outside allowed path prefixes', async () => {
    const workspace = await createWorkspace();
    const plan: ToolPlanOutput = {
      summary: 'allowed paths',
      allowed_paths: ['docs'],
      calls: [{ tool: 'write_file', args: { path: 'src/file.ts', content: 'nope\n' } }],
      evidence: ['src/file.ts'],
    };

    const result = await new ToolPlanExecutor().execute(plan, createJob(workspace));

    expect(result.execution_verdict).toBe('failed');
    expect(result.applied).toBe(false);
    expect(result.errors[0]).toContain('outside allowed_paths');
  });

  it('rejects writes that exceed file count and write size limits', async () => {
    const workspace = await createWorkspace();
    const tooManyFiles: ToolPlanOutput = {
      summary: 'too many',
      limits: { max_files: 1 },
      calls: [
        { tool: 'write_file', args: { path: 'a.txt', content: 'a' } },
        { tool: 'write_file', args: { path: 'b.txt', content: 'b' } },
      ],
      evidence: ['a.txt', 'b.txt'],
    };

    const tooManyResult = await new ToolPlanExecutor().execute(tooManyFiles, createJob(workspace));
    expect(tooManyResult.execution_verdict).toBe('failed');
    expect(tooManyResult.errors[0]).toContain('changes 2 files');

    const tooLarge: ToolPlanOutput = {
      summary: 'too large',
      limits: { max_write_bytes_per_file: 3 },
      calls: [{ tool: 'write_file', args: { path: 'large.txt', content: '1234' } }],
      evidence: ['large.txt'],
    };

    const tooLargeResult = await new ToolPlanExecutor().execute(tooLarge, createJob(workspace));
    expect(tooLargeResult.execution_verdict).toBe('failed');
    expect(tooLargeResult.errors[0]).toContain('exceeds limit 3');
  });

  it('rejects apply_patch_intent when the locator matches more than once', async () => {
    const workspace = await createWorkspace();
    await writeFile(path.join(workspace, 'duplicate.txt'), 'same\nsame\n', 'utf8');
    const plan: ToolPlanOutput = {
      summary: 'duplicate locator',
      calls: [
        { tool: 'apply_patch_intent', args: { path: 'duplicate.txt', locator: 'same', replacement: 'new' } },
      ],
      evidence: ['duplicate.txt'],
    };

    const result = await new ToolPlanExecutor().execute(plan, createJob(workspace));

    expect(result.execution_verdict).toBe('failed');
    expect(result.applied).toBe(false);
    expect(result.errors[0]).toContain('exactly once');
    await expect(readFile(path.join(workspace, 'duplicate.txt'), 'utf8')).resolves.toBe('same\nsame\n');
  });
});
