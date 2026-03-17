import { describe, it, expect } from 'vitest';
import {
  type AgentTaskState,
  SHIPYARD_TO_AGENT_TASKSTATE,
  AGENT_TASKSTATE_TO_SHIPYARD,
  AGENT_TASKSTATE_DESCRIPTIONS,
  toAgentTaskState,
  fromAgentTaskState,
  getShipyardStatesForAgentState,
  isAgentTaskStateTransitionValid,
  isTransitionCompatibleWithAgentTaskState,
  getStateMappingSummary,
} from '../src/domain/state-machine/state-mapping.js';
import type { TaskState } from '../src/domain/state-machine/types.js';

describe('State Mapping', () => {
  describe('SHIPYARD_TO_AGENT_TASKSTATE', () => {
    it('should map all 17 shipyard-cp states to agent-taskstate', () => {
      const shipyardStates: TaskState[] = [
        'queued',
        'planning',
        'planned',
        'developing',
        'dev_completed',
        'accepting',
        'accepted',
        'rework_required',
        'integrating',
        'integrated',
        'publish_pending_approval',
        'publishing',
        'published',
        'completed',
        'cancelled',
        'failed',
        'blocked',
      ];

      expect(Object.keys(SHIPYARD_TO_AGENT_TASKSTATE)).toHaveLength(17);

      for (const state of shipyardStates) {
        expect(SHIPYARD_TO_AGENT_TASKSTATE[state]).toBeDefined();
      }
    });

    it('should map to only valid agent-taskstate states', () => {
      const validAgentStates: AgentTaskState[] = [
        'proposed',
        'ready',
        'in_progress',
        'blocked',
        'review',
        'done',
        'cancelled',
      ];

      for (const mapped of Object.values(SHIPYARD_TO_AGENT_TASKSTATE)) {
        expect(validAgentStates).toContain(mapped);
      }
    });

    it('should map queued to proposed', () => {
      expect(SHIPYARD_TO_AGENT_TASKSTATE.queued).toBe('proposed');
    });

    it('should map planning/developing/accepting to in_progress', () => {
      expect(SHIPYARD_TO_AGENT_TASKSTATE.planning).toBe('in_progress');
      expect(SHIPYARD_TO_AGENT_TASKSTATE.developing).toBe('in_progress');
      expect(SHIPYARD_TO_AGENT_TASKSTATE.accepting).toBe('in_progress');
      expect(SHIPYARD_TO_AGENT_TASKSTATE.integrating).toBe('in_progress');
      expect(SHIPYARD_TO_AGENT_TASKSTATE.publishing).toBe('in_progress');
    });

    it('should map blocked and publish_pending_approval to blocked', () => {
      expect(SHIPYARD_TO_AGENT_TASKSTATE.blocked).toBe('blocked');
      expect(SHIPYARD_TO_AGENT_TASKSTATE.publish_pending_approval).toBe('blocked');
    });

    it('should map dev_completed, accepted, and rework_required to review', () => {
      expect(SHIPYARD_TO_AGENT_TASKSTATE.dev_completed).toBe('review');
      expect(SHIPYARD_TO_AGENT_TASKSTATE.accepted).toBe('review');
      expect(SHIPYARD_TO_AGENT_TASKSTATE.rework_required).toBe('review');
    });

    it('should map published and completed to done', () => {
      expect(SHIPYARD_TO_AGENT_TASKSTATE.published).toBe('done');
      expect(SHIPYARD_TO_AGENT_TASKSTATE.completed).toBe('done');
    });

    it('should map cancelled and failed to cancelled', () => {
      expect(SHIPYARD_TO_AGENT_TASKSTATE.cancelled).toBe('cancelled');
      expect(SHIPYARD_TO_AGENT_TASKSTATE.failed).toBe('cancelled');
    });
  });

  describe('AGENT_TASKSTATE_TO_SHIPYARD', () => {
    it('should have all 7 agent-taskstate states', () => {
      const agentStates: AgentTaskState[] = [
        'proposed',
        'ready',
        'in_progress',
        'blocked',
        'review',
        'done',
        'cancelled',
      ];

      expect(Object.keys(AGENT_TASKSTATE_TO_SHIPYARD)).toHaveLength(7);

      for (const state of agentStates) {
        expect(AGENT_TASKSTATE_TO_SHIPYARD[state]).toBeDefined();
      }
    });
  });

  describe('toAgentTaskState', () => {
    it('should convert shipyard state to agent-taskstate', () => {
      expect(toAgentTaskState('queued')).toBe('proposed');
      expect(toAgentTaskState('planned')).toBe('ready');
      expect(toAgentTaskState('developing')).toBe('in_progress');
      expect(toAgentTaskState('blocked')).toBe('blocked');
      expect(toAgentTaskState('dev_completed')).toBe('review');
      expect(toAgentTaskState('published')).toBe('done');
      expect(toAgentTaskState('cancelled')).toBe('cancelled');
    });
  });

  describe('fromAgentTaskState', () => {
    it('should convert agent-taskstate to canonical shipyard state', () => {
      expect(fromAgentTaskState('proposed')).toBe('queued');
      expect(fromAgentTaskState('ready')).toBe('planned');
      expect(fromAgentTaskState('in_progress')).toBe('developing');
      expect(fromAgentTaskState('blocked')).toBe('blocked');
      expect(fromAgentTaskState('review')).toBe('dev_completed');
      expect(fromAgentTaskState('done')).toBe('published');
      expect(fromAgentTaskState('cancelled')).toBe('cancelled');
    });
  });

  describe('getShipyardStatesForAgentState', () => {
    it('should return all shipyard states mapping to proposed', () => {
      const states = getShipyardStatesForAgentState('proposed');
      expect(states).toEqual(['queued']);
    });

    it('should return all shipyard states mapping to in_progress', () => {
      const states = getShipyardStatesForAgentState('in_progress');
      expect(states).toEqual(
        expect.arrayContaining(['planning', 'developing', 'accepting', 'integrating', 'publishing'])
      );
      expect(states).toHaveLength(5);
    });

    it('should return all shipyard states mapping to blocked', () => {
      const states = getShipyardStatesForAgentState('blocked');
      expect(states).toEqual(expect.arrayContaining(['blocked', 'publish_pending_approval']));
      expect(states).toHaveLength(2);
    });

    it('should return all shipyard states mapping to review', () => {
      const states = getShipyardStatesForAgentState('review');
      expect(states).toEqual(expect.arrayContaining(['dev_completed', 'accepted', 'rework_required']));
      expect(states).toHaveLength(3);
    });

    it('should return all shipyard states mapping to done', () => {
      const states = getShipyardStatesForAgentState('done');
      expect(states).toEqual(expect.arrayContaining(['published', 'completed']));
      expect(states).toHaveLength(2);
    });

    it('should return all shipyard states mapping to cancelled', () => {
      const states = getShipyardStatesForAgentState('cancelled');
      expect(states).toEqual(expect.arrayContaining(['cancelled', 'failed']));
      expect(states).toHaveLength(2);
    });
  });

  describe('isAgentTaskStateTransitionValid', () => {
    it('should allow valid transitions from proposed', () => {
      expect(isAgentTaskStateTransitionValid('proposed', 'ready')).toBe(true);
      expect(isAgentTaskStateTransitionValid('proposed', 'in_progress')).toBe(false);
    });

    it('should allow valid transitions from ready', () => {
      expect(isAgentTaskStateTransitionValid('ready', 'in_progress')).toBe(true);
      expect(isAgentTaskStateTransitionValid('ready', 'blocked')).toBe(false);
    });

    it('should allow valid transitions from in_progress', () => {
      expect(isAgentTaskStateTransitionValid('in_progress', 'blocked')).toBe(true);
      expect(isAgentTaskStateTransitionValid('in_progress', 'review')).toBe(true);
      expect(isAgentTaskStateTransitionValid('in_progress', 'done')).toBe(false);
    });

    it('should allow valid transitions from blocked', () => {
      expect(isAgentTaskStateTransitionValid('blocked', 'in_progress')).toBe(true);
      expect(isAgentTaskStateTransitionValid('blocked', 'ready')).toBe(false);
    });

    it('should allow valid transitions from review', () => {
      expect(isAgentTaskStateTransitionValid('review', 'in_progress')).toBe(true);
      expect(isAgentTaskStateTransitionValid('review', 'done')).toBe(true);
      expect(isAgentTaskStateTransitionValid('review', 'blocked')).toBe(false);
    });

    it('should allow transition to cancelled from any state', () => {
      const allStates: AgentTaskState[] = [
        'proposed',
        'ready',
        'in_progress',
        'blocked',
        'review',
        'done',
        'cancelled',
      ];

      for (const from of allStates) {
        expect(isAgentTaskStateTransitionValid(from, 'cancelled')).toBe(true);
      }
    });

    it('should allow same state transition (no-op)', () => {
      const allStates: AgentTaskState[] = [
        'proposed',
        'ready',
        'in_progress',
        'blocked',
        'review',
        'done',
        'cancelled',
      ];

      for (const state of allStates) {
        expect(isAgentTaskStateTransitionValid(state, state)).toBe(true);
      }
    });

    it('should not allow transitions from terminal states', () => {
      expect(isAgentTaskStateTransitionValid('done', 'in_progress')).toBe(false);
      expect(isAgentTaskStateTransitionValid('cancelled', 'ready')).toBe(false);
    });
  });

  describe('isTransitionCompatibleWithAgentTaskState', () => {
    it('should validate shipyard transitions via agent-taskstate mapping', () => {
      // queued (proposed) -> planned (ready) should be valid
      expect(isTransitionCompatibleWithAgentTaskState('queued', 'planned')).toBe(true);

      // queued (proposed) -> developing (in_progress) should be invalid
      expect(isTransitionCompatibleWithAgentTaskState('queued', 'developing')).toBe(false);

      // developing (in_progress) -> blocked should be valid
      expect(isTransitionCompatibleWithAgentTaskState('developing', 'blocked')).toBe(true);

      // developing (in_progress) -> dev_completed (review) should be valid
      expect(isTransitionCompatibleWithAgentTaskState('developing', 'dev_completed')).toBe(true);

      // blocked -> developing should be valid
      expect(isTransitionCompatibleWithAgentTaskState('blocked', 'developing')).toBe(true);

      // dev_completed (review) -> published (done) should be valid
      expect(isTransitionCompatibleWithAgentTaskState('dev_completed', 'published')).toBe(true);

      // Any state -> cancelled should be valid
      expect(isTransitionCompatibleWithAgentTaskState('developing', 'cancelled')).toBe(true);
    });
  });

  describe('getStateMappingSummary', () => {
    it('should return a formatted markdown table', () => {
      const summary = getStateMappingSummary();
      expect(summary).toContain('# shipyard-cp ↔ agent-taskstate State Mapping');
      expect(summary).toContain('| shipyard-cp state | agent-taskstate | Category |');
      expect(summary).toContain('queued');
      expect(summary).toContain('proposed');
    });
  });

  describe('AGENT_TASKSTATE_DESCRIPTIONS', () => {
    it('should have descriptions for all 7 states', () => {
      const agentStates: AgentTaskState[] = [
        'proposed',
        'ready',
        'in_progress',
        'blocked',
        'review',
        'done',
        'cancelled',
      ];

      expect(Object.keys(AGENT_TASKSTATE_DESCRIPTIONS)).toHaveLength(7);

      for (const state of agentStates) {
        expect(AGENT_TASKSTATE_DESCRIPTIONS[state]).toBeDefined();
        expect(typeof AGENT_TASKSTATE_DESCRIPTIONS[state]).toBe('string');
        expect(AGENT_TASKSTATE_DESCRIPTIONS[state].length).toBeGreaterThan(0);
      }
    });
  });

  describe('Round-trip mapping', () => {
    it('should maintain consistency: toAgent -> fromAgent', () => {
      // For canonical entry points, round-trip should be identity
      expect(fromAgentTaskState(toAgentTaskState('queued'))).toBe('queued');
      expect(fromAgentTaskState(toAgentTaskState('blocked'))).toBe('blocked');
      expect(fromAgentTaskState(toAgentTaskState('cancelled'))).toBe('cancelled');
    });

    it('should map multiple shipyard states to single agent state', () => {
      // Multiple shipyard states map to in_progress
      const inProgressStates = getShipyardStatesForAgentState('in_progress');
      for (const state of inProgressStates) {
        expect(toAgentTaskState(state)).toBe('in_progress');
      }
    });
  });
});