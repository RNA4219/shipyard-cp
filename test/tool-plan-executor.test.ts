import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
  it('resolves local repos two levels above an Agent_tools repo cwd', async () => {
    const root = await createWorkspace();
    const repo = path.join(root, 'target-repo');
    const shipyard = path.join(root, 'Agent_tools', 'shipyard-cp');
    await mkdir(repo, { recursive: true });
    await mkdir(shipyard, { recursive: true });
    const originalCwd = process.cwd();
    process.chdir(shipyard);
    try {
      const job = createJob(repo);
      job.workspace_ref = { kind: 'container', workspace_id: 'ws_local_repo' };
      job.repo_ref = { provider: 'github', owner: 'local', name: 'target-repo', default_branch: 'main' };
      const plan: ToolPlanOutput = {
        summary: 'write through local repo resolution',
        calls: [{ tool: 'write_file', args: { path: 'resolved.txt', content: 'ok\n' } }],
        evidence: ['resolved.txt'],
      };

      const result = await new ToolPlanExecutor().execute(plan, job);

      expect(result.errors).toEqual([]);
      expect(result.workspace_root).toBe(repo);
      await expect(readFile(path.join(repo, 'resolved.txt'), 'utf8')).resolves.toBe('ok\n');
    } finally {
      process.chdir(originalCwd);
    }
  });

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

  it('rejects malformed metadata allowed path JSON instead of silently ignoring it', async () => {
    const workspace = await createWorkspace();
    const job: WorkerJob = {
      ...createJob(workspace),
      metadata: { tool_plan_allowed_paths: '["docs"' },
    };
    const plan: ToolPlanOutput = {
      summary: 'malformed allowed paths',
      calls: [{ tool: 'write_file', args: { path: 'docs/file.txt', content: 'nope\n' } }],
      evidence: ['docs/file.txt'],
    };

    const result = await new ToolPlanExecutor().execute(plan, job);

    expect(result.execution_verdict).toBe('failed');
    expect(result.applied).toBe(false);
    expect(result.errors[0]).toContain('allowed_paths must be valid JSON array syntax');
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

  it('runs explicitly allowlisted commands without invoking a shell', async () => {
    const workspace = await createWorkspace();
    const plan: ToolPlanOutput = {
      summary: 'run safe command',
      calls: [{ tool: 'run_command', args: { command: 'node --version', timeout_ms: 10000 } }],
      evidence: ['node runtime'],
    };

    const result = await new ToolPlanExecutor().execute(plan, createJob(workspace));

    expect(result.errors).toEqual([]);
    expect(result.execution_verdict).toBe('applied');
    expect(result.operations[0]).toMatchObject({ tool: 'run_command', status: 'applied' });
    expect(result.operations[0].message).toContain('node --version passed');
  });

  it('runs allowlisted commands from a safe cwd argument', async () => {
    const workspace = await createWorkspace();
    const nested = path.join(workspace, 'nested');
    await writeFile(path.join(workspace, 'package.json'), '{}\n', 'utf8');
    await import('node:fs/promises').then(fs => fs.mkdir(nested));
    const plan: ToolPlanOutput = {
      summary: 'run command in cwd',
      calls: [{ tool: 'run_command', args: { command: 'node --version', cwd: 'nested', timeout_ms: 10000 } }],
      evidence: ['node runtime'],
    };

    const result = await new ToolPlanExecutor().execute(plan, createJob(workspace));

    expect(result.errors).toEqual([]);
    expect(result.execution_verdict).toBe('applied');
    expect(result.operations[0]).toMatchObject({ tool: 'run_command', status: 'applied' });
  });

  it('resolves github repo refs from a sibling checkout when no host path is present', async () => {
    const root = await createWorkspace();
    const shipyard = path.join(root, 'shipyard-cp');
    const pokemonRepo = path.join(root, 'pokemon_card_ai_battle');
    await mkdir(shipyard);
    await mkdir(pokemonRepo);

    const previousCwd = process.cwd();
    process.chdir(shipyard);
    try {
      const job: WorkerJob = {
        ...createJob(pokemonRepo),
        workspace_ref: { kind: 'container', workspace_id: 'ws_test' },
        repo_ref: {
          provider: 'github',
          owner: 'RNA4219',
          name: 'pokemon_card_ai_battle',
          default_branch: 'phase2/implementation',
        },
      };
      const plan: ToolPlanOutput = {
        summary: 'sibling repo command',
        calls: [{ tool: 'run_command', args: { command: 'node --version', timeout_ms: 10000 } }],
        evidence: ['node runtime'],
      };

      const result = await new ToolPlanExecutor().execute(plan, job);

      expect(result.errors).toEqual([]);
      expect(result.workspace_root).toBe(pokemonRepo);
      expect(result.execution_verdict).toBe('applied');
      expect(result.operations[0]).toMatchObject({ tool: 'run_command', status: 'applied' });
    } finally {
      process.chdir(previousCwd);
    }
  });

  it('does not resolve a sibling checkout for an unsafe repo directory name', async () => {
    const root = await createWorkspace();
    const shipyard = path.join(root, 'shipyard-cp');
    await mkdir(shipyard);

    const previousCwd = process.cwd();
    process.chdir(shipyard);
    try {
      const job: WorkerJob = {
        ...createJob(root),
        workspace_ref: { kind: 'container', workspace_id: 'ws_test' },
        repo_ref: {
          provider: 'github',
          owner: 'RNA4219',
          name: '../outside',
          default_branch: 'main',
        },
      };
      const plan: ToolPlanOutput = {
        summary: 'unsafe sibling repo command',
        calls: [{ tool: 'run_command', args: { command: 'node --version', timeout_ms: 10000 } }],
        evidence: ['node runtime'],
      };

      const result = await new ToolPlanExecutor().execute(plan, job);

      expect(result.workspace_root).toBeUndefined();
      expect(result.execution_verdict).toBe('skipped');
    } finally {
      process.chdir(previousCwd);
    }
  });

  it('safely decomposes cd-and-run commands without invoking a shell', async () => {
    const workspace = await createWorkspace();
    const plan: ToolPlanOutput = {
      summary: 'legacy cd command',
      calls: [{ tool: 'run_command', args: { command: `cd ${workspace} && node --version`, timeout_ms: 10000 } }],
      evidence: ['node runtime'],
    };

    const result = await new ToolPlanExecutor().execute(plan, createJob(workspace));

    expect(result.errors).toEqual([]);
    expect(result.execution_verdict).toBe('applied');
    expect(result.operations[0].message).toContain('node --version');
  });

  it('rejects shell metacharacters and commands outside the safe allowlist', async () => {
    const workspace = await createWorkspace();
    const metacharPlan: ToolPlanOutput = {
      summary: 'unsafe shell',
      calls: [{ tool: 'run_command', args: { command: 'git status --short | cat' } }],
      evidence: ['unsafe'],
    };
    const unsupportedPlan: ToolPlanOutput = {
      summary: 'unsupported command',
      calls: [{ tool: 'run_command', args: { command: 'python script.py' } }],
      evidence: ['unsupported'],
    };

    const metacharResult = await new ToolPlanExecutor().execute(metacharPlan, createJob(workspace));
    expect(metacharResult.execution_verdict).toBe('failed');
    expect(metacharResult.errors[0]).toContain('unsupported shell metacharacters');

    const unsupportedResult = await new ToolPlanExecutor().execute(unsupportedPlan, createJob(workspace));
    expect(unsupportedResult.execution_verdict).toBe('failed');
    expect(unsupportedResult.errors[0]).toContain('safe allowlist');
  });
});
