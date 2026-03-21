import type { Decision, OpenQuestion, ContextBundle } from 'agent-taskstate-js';
import type { Task } from '../../types.js';
import { getTaskStateIntegration } from '../../domain/taskstate/index.js';

/**
 * Service for Decision and Question management.
 * Delegates to agent-taskstate-js for actual operations.
 * Extracted from ControlPlaneStore to reduce complexity.
 */
export class DecisionService {
  /**
   * Create a decision for a task.
   */
  async createDecision(taskId: string, question: string, options: string[]): Promise<Decision> {
    return getTaskStateIntegration().createDecision(taskId, question, options);
  }

  /**
   * Get all decisions for a task.
   */
  async getDecisions(taskId: string): Promise<Decision[]> {
    return getTaskStateIntegration().getDecisions(taskId);
  }

  /**
   * Resolve a decision.
   */
  async resolveDecision(decisionId: string, chosen: string, rationale?: string): Promise<Decision> {
    return getTaskStateIntegration().resolveDecision(decisionId, chosen, rationale);
  }

  /**
   * Reject a decision.
   */
  async rejectDecision(decisionId: string, rationale: string): Promise<Decision> {
    return getTaskStateIntegration().rejectDecision(decisionId, rationale);
  }

  /**
   * Create an open question for a task.
   */
  async createOpenQuestion(taskId: string, question: string): Promise<OpenQuestion> {
    return getTaskStateIntegration().createQuestion(taskId, question);
  }

  /**
   * Get all open questions for a task.
   */
  async getOpenQuestions(taskId: string): Promise<OpenQuestion[]> {
    return getTaskStateIntegration().getQuestions(taskId);
  }

  /**
   * Answer an open question.
   */
  async answerOpenQuestion(questionId: string, answer: string): Promise<OpenQuestion> {
    return getTaskStateIntegration().answerQuestion(questionId, answer);
  }

  /**
   * Defer an open question.
   */
  async deferOpenQuestion(questionId: string): Promise<OpenQuestion> {
    return getTaskStateIntegration().deferQuestion(questionId);
  }

  /**
   * Generate a context bundle for task recovery.
   */
  async generateContextBundle(
    taskId: string,
    purpose: 'continue_work' | 'review_prepare' | 'resume_after_block' | 'decision_support' | 'other',
    task: Task,
  ): Promise<ContextBundle> {
    return getTaskStateIntegration().generateContextBundle(taskId, purpose, task);
  }

  /**
   * Get the latest context bundle for a task.
   */
  async getLatestContextBundle(taskId: string): Promise<ContextBundle | null> {
    return getTaskStateIntegration().getLatestBundle(taskId);
  }
}