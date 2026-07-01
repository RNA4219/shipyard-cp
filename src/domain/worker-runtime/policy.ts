import type { WorkerJob } from '../../types.js';
import type { WorkerRuntimePolicy } from './worker-runtime.js';

export interface WorkerRuntimePolicyOptions {
  allowed_paths?: string[];
  max_turns?: number;
  max_tool_calls?: number;
  restore_points?: WorkerRuntimePolicy['restore_points'];
}

const DEFAULT_MAX_TURNS = 20;
const DEFAULT_MAX_TOOL_CALLS = 50;

/**
 * Derives the common runtime policy from the WorkerJob approval contract.
 * Callers can still pass explicit overrides, but this keeps normal
 * workspace-write jobs from accidentally disabling shell and sub-agent tools.
 */
export function buildWorkerRuntimePolicy(
  job: WorkerJob,
  options: WorkerRuntimePolicyOptions = {},
): WorkerRuntimePolicy {
  const sandbox = job.approval_policy.sandbox_profile ?? (job.stage === 'plan' ? 'read_only' : 'workspace_write');
  const denied = job.approval_policy.mode === 'deny';
  const workspaceWrite = sandbox === 'workspace_write' || sandbox === 'full_auto' || sandbox === 'custom';
  const canUseEffectfulTools = !denied && workspaceWrite;

  return {
    mode: 'interactive',
    allowed_paths: options.allowed_paths,
    max_turns: options.max_turns ?? DEFAULT_MAX_TURNS,
    max_tool_calls: options.max_tool_calls ?? DEFAULT_MAX_TOOL_CALLS,
    restricted_tools: !canUseEffectfulTools,
    allow_subagents: canUseEffectfulTools,
    restore_points: options.restore_points ?? (canUseEffectfulTools ? 'snapshot' : 'disabled'),
  };
}
