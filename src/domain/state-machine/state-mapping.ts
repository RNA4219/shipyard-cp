/**
 * State Mapping Service
 *
 * Maps between shipyard-cp internal states (17 states) and agent-taskstate canonical states (7 states).
 * This enables interoperability with the agent-taskstate OSS specification.
 *
 * ## Mapping Logic
 *
 * | agent-taskstate | shipyard-cp states                    | Rationale                                      |
 * |-----------------|---------------------------------------|------------------------------------------------|
 * | proposed        | queued                                | Task created, awaiting confirmation           |
 * | ready           | planned, integrated                   | Planning complete, ready for next stage        |
 * | in_progress     | planning, developing, accepting,      | Active work in progress                        |
 * |                 | integrating, publishing               |                                                |
 * | blocked         | blocked, publish_pending_approval     | Cannot proceed without external action         |
 * | review          | dev_completed, accepted               | Work complete, awaiting review/approval        |
 * | done            | published, completed                  | Work fully complete                            |
 * | cancelled       | cancelled, failed                     | Task terminated early or with error            |
 */

import type { TaskState } from './types.js';

/**
 * agent-taskstate canonical states (7 states per MVP spec)
 */
export type AgentTaskState =
  | 'proposed'
  | 'ready'
  | 'in_progress'
  | 'blocked'
  | 'review'
  | 'done'
  | 'cancelled';

/**
 * Mapping from shipyard-cp internal states to agent-taskstate canonical states.
 */
export const SHIPYARD_TO_AGENT_TASKSTATE: Record<TaskState, AgentTaskState> = {
  // proposed: Task created but not yet confirmed/started
  queued: 'proposed',

  // ready: Planning complete, ready for development
  planned: 'ready',
  integrated: 'ready', // Integration complete, ready for next phase

  // in_progress: Active work being performed
  planning: 'in_progress',
  developing: 'in_progress',
  accepting: 'in_progress',
  integrating: 'in_progress',
  publishing: 'in_progress',

  // blocked: Cannot proceed without external action
  blocked: 'blocked',
  publish_pending_approval: 'blocked', // Waiting for approval

  // review: Work complete, awaiting verification/approval
  dev_completed: 'review',
  accepted: 'review', // Accepted by acceptance tests, pending integration
  rework_required: 'review', // Returned for rework, in review cycle

  // done: Fully complete
  published: 'done',
  completed: 'done',

  // cancelled: Terminated early or with error
  cancelled: 'cancelled',
  failed: 'cancelled',
};

/**
 * Reverse mapping from agent-taskstate to shipyard-cp states.
 * Maps to the canonical "entry point" state for each agent-taskstate state.
 */
export const AGENT_TASKSTATE_TO_SHIPYARD: Record<AgentTaskState, TaskState> = {
  proposed: 'queued',
  ready: 'planned',
  in_progress: 'developing',
  blocked: 'blocked',
  review: 'dev_completed',
  done: 'published',
  cancelled: 'cancelled',
};

/**
 * Human-readable descriptions for agent-taskstate states.
 */
export const AGENT_TASKSTATE_DESCRIPTIONS: Record<AgentTaskState, string> = {
  proposed: 'Task proposed, awaiting confirmation to start',
  ready: 'Task confirmed and ready to begin work',
  in_progress: 'Work actively in progress',
  blocked: 'Cannot proceed; blocked by external dependency',
  review: 'Work complete, awaiting review or verification',
  done: 'Task fully completed',
  cancelled: 'Task cancelled or terminated early',
};

/**
 * Converts a shipyard-cp internal state to agent-taskstate canonical state.
 */
export function toAgentTaskState(state: TaskState): AgentTaskState {
  return SHIPYARD_TO_AGENT_TASKSTATE[state];
}

/**
 * Converts an agent-taskstate canonical state to a shipyard-cp internal state.
 * Returns the canonical entry point state for the given agent-taskstate.
 */
export function fromAgentTaskState(state: AgentTaskState): TaskState {
  return AGENT_TASKSTATE_TO_SHIPYARD[state];
}

/**
 * Returns all shipyard-cp states that map to the given agent-taskstate.
 */
export function getShipyardStatesForAgentState(
  agentState: AgentTaskState
): TaskState[] {
  return Object.entries(SHIPYARD_TO_AGENT_TASKSTATE)
    .filter(([, mapped]) => mapped === agentState)
    .map(([shipyard]) => shipyard as TaskState);
}

/**
 * Validates if a state transition is allowed under agent-taskstate rules.
 *
 * agent-taskstate allowed transitions:
 * - proposed -> ready
 * - ready -> in_progress
 * - in_progress -> blocked
 * - blocked -> in_progress
 * - in_progress -> review
 * - review -> in_progress
 * - review -> done
 * - * -> cancelled
 */
export function isAgentTaskStateTransitionValid(
  from: AgentTaskState,
  to: AgentTaskState
): boolean {
  // Same state is always valid (no-op)
  if (from === to) return true;

  // Any state can transition to cancelled
  if (to === 'cancelled') return true;

  const validTransitions: Record<AgentTaskState, AgentTaskState[]> = {
    proposed: ['ready'],
    ready: ['in_progress'],
    in_progress: ['blocked', 'review'],
    blocked: ['in_progress'],
    review: ['in_progress', 'done'],
    done: [], // Terminal state
    cancelled: [], // Terminal state
  };

  return validTransitions[from]?.includes(to) ?? false;
}

/**
 * Checks if a shipyard-cp state transition is valid when mapped to agent-taskstate.
 * This provides a compatibility layer for the stricter agent-taskstate transition rules.
 */
export function isTransitionCompatibleWithAgentTaskState(
  from: TaskState,
  to: TaskState
): boolean {
  const fromAgent = toAgentTaskState(from);
  const toAgent = toAgentTaskState(to);
  return isAgentTaskStateTransitionValid(fromAgent, toAgent);
}

/**
 * Returns a summary of the state mapping for documentation/debugging.
 */
export function getStateMappingSummary(): string {
  const lines: string[] = [
    '# shipyard-cp ↔ agent-taskstate State Mapping',
    '',
    '| shipyard-cp state | agent-taskstate | Category |',
    '|------------------|-----------------|----------|',
  ];

  const categories: Record<string, string> = {
    proposed: 'Initialization',
    ready: 'Preparation',
    in_progress: 'Execution',
    blocked: 'Waiting',
    review: 'Verification',
    done: 'Completion',
    cancelled: 'Termination',
  };

  for (const [shipyard, agent] of Object.entries(SHIPYARD_TO_AGENT_TASKSTATE)) {
    lines.push(
      `| ${shipyard.padEnd(16)} | ${agent.padEnd(15)} | ${categories[agent]} |`
    );
  }

  return lines.join('\n');
}