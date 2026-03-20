/**
 * Integration between shipyard-cp and agent-taskstate-js
 *
 * Uses agent-taskstate-js for decision and open question management
 * while keeping ControlPlaneStore's task management intact.
 */

import {
  AgentTaskState,
  type Task as AgentTask,
  type Decision,
  type OpenQuestion,
  type ContextBundle,
} from 'agent-taskstate-js';
import type { Task } from '../../types.js';

/**
 * Map shipyard-cp Task state to agent-taskstate state
 */
export function mapToAgentState(state: string): 'in_progress' | 'blocked' | 'review' | 'done' | 'cancelled' {
  switch (state) {
    case 'queued':
    case 'developing':
      return 'in_progress';
    case 'blocked':
      return 'blocked';
    case 'reviewing':
    case 'accepted':
      return 'review';
    case 'integrating':
    case 'integrated':
    case 'publish_pending_approval':
    case 'publishing':
    case 'published':
      return 'review';
    case 'failed':
    case 'cancelled':
      return 'cancelled';
    case 'completed':
      return 'done';
    default:
      return 'in_progress';
  }
}

/**
 * Create an agent-taskstate Task from a shipyard-cp Task
 */
export function createAgentTaskFromCPTask(cpTask: Task): Omit<AgentTask, 'status' | 'revision' | 'created_at' | 'updated_at'> {
  return {
    id: cpTask.task_id,
    kind: cpTask.objective.includes('bug') || cpTask.objective.includes('fix') ? 'bugfix' :
          cpTask.objective.includes('research') || cpTask.objective.includes('investigate') ? 'research' : 'feature',
    title: cpTask.title,
    goal: cpTask.objective,
    priority: cpTask.risk_level === 'high' ? 'high' :
              cpTask.risk_level === 'low' ? 'low' : 'medium',
    owner_type: 'system',
    owner_id: 'shipyard-cp',
  };
}

/**
 * TaskState Integration Service
 *
 * Provides decision and open question management using agent-taskstate-js
 */
export class TaskStateIntegration {
  private agentTaskState: AgentTaskState;

  constructor() {
    this.agentTaskState = new AgentTaskState();
  }

  /**
   * Get the underlying AgentTaskState instance
   */
  get agent(): AgentTaskState {
    return this.agentTaskState;
  }

  // ==================== Decision Management ====================

  /**
   * Create a decision for a task
   */
  async createDecision(taskId: string, question: string, options: string[]): Promise<Decision> {
    // Ensure agent task exists
    await this.ensureAgentTask(taskId);
    return this.agentTaskState.tasks.createDecision(taskId, question, options);
  }

  /**
   * Get all decisions for a task
   */
  async getDecisions(taskId: string): Promise<Decision[]> {
    return this.agentTaskState.tasks.getDecisions(taskId);
  }

  /**
   * Resolve a decision
   */
  async resolveDecision(decisionId: string, chosen: string, rationale?: string): Promise<Decision> {
    return this.agentTaskState.tasks.resolveDecision(decisionId, chosen, rationale);
  }

  /**
   * Reject a decision
   */
  async rejectDecision(decisionId: string, rationale: string): Promise<Decision> {
    return this.agentTaskState.tasks.rejectDecision(decisionId, rationale);
  }

  // ==================== Open Question Management ====================

  /**
   * Create an open question for a task
   */
  async createQuestion(taskId: string, question: string): Promise<OpenQuestion> {
    await this.ensureAgentTask(taskId);
    return this.agentTaskState.tasks.createQuestion(taskId, question);
  }

  /**
   * Get all open questions for a task
   */
  async getQuestions(taskId: string): Promise<OpenQuestion[]> {
    return this.agentTaskState.tasks.getQuestions(taskId);
  }

  /**
   * Answer a question
   */
  async answerQuestion(questionId: string, answer: string): Promise<OpenQuestion> {
    return this.agentTaskState.tasks.answerQuestion(questionId, answer);
  }

  /**
   * Defer a question
   */
  async deferQuestion(questionId: string): Promise<OpenQuestion> {
    return this.agentTaskState.tasks.deferQuestion(questionId);
  }

  // ==================== Context Bundle ====================

  /**
   * Generate a context bundle for task recovery
   */
  async generateContextBundle(
    taskId: string,
    purpose: 'continue_work' | 'review_prepare' | 'resume_after_block' | 'decision_support' | 'other',
    cpTask: Task,
  ): Promise<ContextBundle> {
    await this.ensureAgentTask(taskId);

    // Sync state from CP task
    const agentTask = await this.agentTaskState.tasks.getTask(taskId);
    if (agentTask) {
      const mappedState = mapToAgentState(cpTask.state);
      if (agentTask.status !== mappedState) {
        // Update state to match CP task
        await this.agentTaskState.transitions.transition(taskId, {
          to_status: mappedState,
          reason: `Synced from control plane state: ${cpTask.state}`,
          actor_type: 'system',
        });
      }
    }

    return this.agentTaskState.tasks.contextBundles.createBundle(taskId, purpose);
  }

  /**
   * Get the latest context bundle for a task
   */
  async getLatestBundle(taskId: string): Promise<ContextBundle | null> {
    return this.agentTaskState.tasks.contextBundles.getLatestBundle(taskId);
  }

  // ==================== Utility ====================

  /**
   * Ensure an agent task exists for the given task ID
   */
  private async ensureAgentTask(taskId: string): Promise<void> {
    let agentTask = await this.agentTaskState.tasks.getTask(taskId);
    if (!agentTask) {
      // Create a placeholder agent task
      const now = new Date().toISOString();
      agentTask = {
        id: taskId,
        kind: 'feature',
        title: `Task ${taskId}`,
        goal: 'Managed by shipyard-cp',
        status: 'in_progress',
        priority: 'medium',
        owner_type: 'system',
        owner_id: 'shipyard-cp',
        revision: 1,
        created_at: now,
        updated_at: now,
      };
      await this.agentTaskState.store.createTask(agentTask);
    }
  }

  /**
   * Close connections
   */
  async close(): Promise<void> {
    await this.agentTaskState.close();
  }
}

/**
 * Global TaskState integration instance
 */
let integration: TaskStateIntegration | null = null;

/**
 * Get the global TaskState integration instance
 */
export function getTaskStateIntegration(): TaskStateIntegration {
  if (!integration) {
    integration = new TaskStateIntegration();
  }
  return integration;
}

/**
 * Initialize the TaskState integration
 */
export function initTaskStateIntegration(): TaskStateIntegration {
  integration = new TaskStateIntegration();
  return integration;
}