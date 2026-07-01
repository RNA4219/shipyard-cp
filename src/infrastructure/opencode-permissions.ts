import type { WorkerJob } from '../types.js';

export type OpenCodePermissionEffect = 'allow' | 'ask' | 'deny';

export interface OpenCodePermissionSet {
  read: OpenCodePermissionEffect;
  glob: OpenCodePermissionEffect;
  grep: OpenCodePermissionEffect;
  list: OpenCodePermissionEffect;
  edit: OpenCodePermissionEffect;
  bash: OpenCodePermissionEffect;
  webfetch: OpenCodePermissionEffect;
  task: OpenCodePermissionEffect;
}

/**
 * Projects Shipyard's approval policy into OpenCode's tool permission map.
 *
 * Deny remains a hard boundary. Ask is preserved as an interactive delegation
 * path instead of being collapsed into deny, so a parent operator can grant a
 * specific tool/sub-agent request without switching the whole job to full-auto.
 */
export function buildOpenCodePermissions(job: WorkerJob): OpenCodePermissionSet {
  const policy = job.approval_policy;
  const sandbox = policy.sandbox_profile ?? (job.stage === 'plan' ? 'read_only' : 'workspace_write');
  const denied = policy.mode === 'deny';
  const fullAuto = policy.mode === 'allow' || sandbox === 'full_auto';
  const workspaceWrite = sandbox === 'workspace_write' || sandbox === 'full_auto' || sandbox === 'custom';
  const networkAllowed = policy.allowed_side_effect_categories?.includes('network_access') ?? false;

  return {
    read: 'allow',
    glob: 'allow',
    grep: 'allow',
    list: 'allow',
    edit: resolveEditPermission(job, denied, workspaceWrite),
    bash: resolveBashPermission(job, denied, workspaceWrite, fullAuto),
    webfetch: resolveDelegatedPermission({
      denied,
      fullAuto,
      explicitlyAllowed: networkAllowed,
      stageHardDeny: job.stage === 'plan',
      mode: policy.mode,
    }),
    task: resolveTaskPermission(job, denied, fullAuto, workspaceWrite),
  };
}

function resolveEditPermission(job: WorkerJob, denied: boolean, workspaceWrite: boolean): OpenCodePermissionEffect {
  if (denied || !workspaceWrite) {
    return 'deny';
  }
  if (job.stage === 'dev') {
    return 'allow';
  }
  return 'deny';
}

function resolveBashPermission(
  job: WorkerJob,
  denied: boolean,
  workspaceWrite: boolean,
  fullAuto: boolean,
): OpenCodePermissionEffect {
  if (job.stage === 'plan') {
    return 'deny';
  }
  if (denied || !workspaceWrite) {
    return 'deny';
  }
  return 'allow';
}

function resolveTaskPermission(
  job: WorkerJob,
  denied: boolean,
  fullAuto: boolean,
  workspaceWrite: boolean,
): OpenCodePermissionEffect {
  if (job.stage === 'plan') {
    return 'deny';
  }
  if (denied || !workspaceWrite) {
    return 'deny';
  }
  if (fullAuto) {
    return 'allow';
  }
  if (job.approval_policy.mode === 'ask') {
    return 'ask';
  }
  return 'deny';
}

function resolveDelegatedPermission(input: {
  denied: boolean;
  fullAuto: boolean;
  explicitlyAllowed: boolean;
  stageHardDeny: boolean;
  mode: WorkerJob['approval_policy']['mode'];
}): OpenCodePermissionEffect {
  if (input.stageHardDeny) {
    return 'deny';
  }
  if (input.denied) {
    return 'deny';
  }
  if (input.fullAuto || input.explicitlyAllowed) {
    return 'allow';
  }
  if (input.mode === 'ask') {
    return 'ask';
  }
  return 'deny';
}
