import { describe, expect, it } from 'vitest';
import { buildOpenCodePermissions } from '../src/infrastructure/opencode-permissions.js';
import type { WorkerJob } from '../src/types.js';

function job(overrides: Partial<WorkerJob> = {}): WorkerJob {
  return {
    job_id: 'job_permissions_001',
    task_id: 'task_permissions_001',
    typed_ref: 'agent-taskstate:task:local:task_permissions_001',
    stage: 'dev',
    worker_type: 'codex',
    status: 'running',
    workspace_ref: {
      workspace_id: 'ws_permissions_001',
      kind: 'host_path',
      reusable: true,
    },
    input_prompt: 'permission projection',
    repo_ref: {
      provider: 'github',
      owner: 'local',
      name: 'shipyard-cp',
      default_branch: 'main',
    },
    capability_requirements: ['edit_repo', 'run_tests'],
    risk_level: 'medium',
    approval_policy: {
      mode: 'ask',
      sandbox_profile: 'workspace_write',
    },
    ...overrides,
  };
}

describe('OpenCode permission projection', () => {
  it('keeps plan read-only by default while allowing read tools', () => {
    const permissions = buildOpenCodePermissions(job({
      stage: 'plan',
      capability_requirements: ['plan'],
      approval_policy: {
        mode: 'deny',
        sandbox_profile: 'read_only',
      },
    }));

    expect(permissions).toMatchObject({
      read: 'allow',
      glob: 'allow',
      grep: 'allow',
      list: 'allow',
      edit: 'deny',
      bash: 'deny',
      webfetch: 'deny',
      task: 'deny',
    });
  });

  it('keeps plan effectful tools denied even with full-auto or network hints', () => {
    const permissions = buildOpenCodePermissions(job({
      stage: 'plan',
      approval_policy: {
        mode: 'allow',
        sandbox_profile: 'full_auto',
        allowed_side_effect_categories: ['network_access'],
      },
    }));

    expect(permissions).toMatchObject({
      read: 'allow',
      glob: 'allow',
      grep: 'allow',
      list: 'allow',
      edit: 'deny',
      bash: 'deny',
      webfetch: 'deny',
      task: 'deny',
    });
  });

  it('preserves ask-mode delegation for dev webfetch and sub-agent task', () => {
    const permissions = buildOpenCodePermissions(job());

    expect(permissions).toMatchObject({
      edit: 'allow',
      bash: 'allow',
      webfetch: 'ask',
      task: 'ask',
    });
  });

  it('allows network when approval policy explicitly permits it', () => {
    const permissions = buildOpenCodePermissions(job({
      approval_policy: {
        mode: 'ask',
        sandbox_profile: 'workspace_write',
        allowed_side_effect_categories: ['network_access'],
      },
    }));

    expect(permissions.webfetch).toBe('allow');
  });

  it('allows delegated tools in full-auto mode', () => {
    const permissions = buildOpenCodePermissions(job({
      approval_policy: {
        mode: 'allow',
        sandbox_profile: 'full_auto',
      },
    }));

    expect(permissions).toMatchObject({
      edit: 'allow',
      bash: 'allow',
      webfetch: 'allow',
      task: 'allow',
    });
  });

  it('keeps acceptance read-and-test oriented while allowing delegated network approval', () => {
    const permissions = buildOpenCodePermissions(job({
      stage: 'acceptance',
      capability_requirements: ['produces_verdict'],
    }));

    expect(permissions).toMatchObject({
      edit: 'deny',
      bash: 'allow',
      webfetch: 'ask',
      task: 'ask',
    });
  });
});
