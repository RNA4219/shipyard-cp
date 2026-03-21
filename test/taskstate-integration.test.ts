import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  TaskStateIntegration,
  createAgentTaskFromCPTask,
  getTaskStateIntegration,
  initTaskStateIntegration,
} from '../src/domain/taskstate/taskstate-integration.js';
import type { Task } from '../src/types.js';

describe('TaskStateIntegration', () => {
  let integration: TaskStateIntegration;

  const createTestTask = (): Task => ({
    task_id: 'task_test123',
    title: 'Test Task',
    objective: 'Fix the bug in the system',
    typed_ref: 'agent-taskstate:task:github:issue-123',
    state: 'queued',
    version: 1,
    risk_level: 'medium',
    repo_ref: {
      provider: 'github',
      owner: 'testowner',
      name: 'testrepo',
      default_branch: 'main',
    },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  beforeEach(async () => {
    integration = new TaskStateIntegration();
  });

  afterEach(async () => {
    await integration.close();
  });

  describe('createAgentTaskFromCPTask', () => {
    it('should create agent task with correct kind for bugfix', () => {
      const cpTask = createTestTask();
      cpTask.objective = 'Fix the bug in authentication';

      const agentTask = createAgentTaskFromCPTask(cpTask);

      expect(agentTask.id).toBe(cpTask.task_id);
      expect(agentTask.kind).toBe('bugfix');
      expect(agentTask.title).toBe(cpTask.title);
      expect(agentTask.goal).toBe(cpTask.objective);
      expect(agentTask.priority).toBe('medium');
    });

    it('should create agent task with kind research for research objective', () => {
      const cpTask = createTestTask();
      cpTask.objective = 'investigate the best approach for authentication';

      const agentTask = createAgentTaskFromCPTask(cpTask);

      expect(agentTask.kind).toBe('research');
    });

    it('should create agent task with kind feature by default', () => {
      const cpTask = createTestTask();
      cpTask.objective = 'Add new feature for user profiles';

      const agentTask = createAgentTaskFromCPTask(cpTask);

      expect(agentTask.kind).toBe('feature');
    });

    it('should map high risk to high priority', () => {
      const cpTask = createTestTask();
      cpTask.risk_level = 'high';

      const agentTask = createAgentTaskFromCPTask(cpTask);

      expect(agentTask.priority).toBe('high');
    });

    it('should map low risk to low priority', () => {
      const cpTask = createTestTask();
      cpTask.risk_level = 'low';

      const agentTask = createAgentTaskFromCPTask(cpTask);

      expect(agentTask.priority).toBe('low');
    });
  });

  describe('TaskStateIntegration class', () => {
    describe('agent accessor', () => {
      it('should return the underlying AgentTaskState instance', () => {
        expect(integration.agent).toBeDefined();
      });
    });

    describe('Decision Management', () => {
      it('should create a decision for a task', async () => {
        const taskId = 'task_decision_test';
        const decision = await integration.createDecision(
          taskId,
          'Which approach should we use?',
          ['Option A', 'Option B', 'Option C']
        );

        expect(decision.question).toBe('Which approach should we use?');
        expect(decision.options).toHaveLength(3);
        expect(decision.status).toBe('pending');
      });

      it('should get decisions for a task', async () => {
        const taskId = 'task_get_decisions';
        await integration.createDecision(taskId, 'Question 1?', ['A', 'B']);
        await integration.createDecision(taskId, 'Question 2?', ['C', 'D']);

        const decisions = await integration.getDecisions(taskId);

        expect(decisions).toHaveLength(2);
      });

      it('should resolve a decision', async () => {
        const taskId = 'task_resolve_decision';
        const decision = await integration.createDecision(taskId, 'Choose?', ['A', 'B']);

        const resolved = await integration.resolveDecision(decision.id, 'A', 'Option A is better');

        expect(resolved.status).toBe('accepted');
        expect(resolved.chosen).toBe('A');
        expect(resolved.rationale).toBe('Option A is better');
      });

      it('should reject a decision', async () => {
        const taskId = 'task_reject_decision';
        const decision = await integration.createDecision(taskId, 'Choose?', ['A', 'B']);

        const rejected = await integration.rejectDecision(decision.id, 'None of the options work');

        expect(rejected.status).toBe('rejected');
        expect(rejected.rationale).toBe('None of the options work');
      });
    });

    describe('Open Question Management', () => {
      it('should create a question for a task', async () => {
        const taskId = 'task_question_test';
        const question = await integration.createQuestion(taskId, 'What is the expected behavior?');

        expect(question.question).toBe('What is the expected behavior?');
        expect(question.status).toBe('open');
      });

      it('should get questions for a task', async () => {
        const taskId = 'task_get_questions';
        await integration.createQuestion(taskId, 'Question 1?');
        await integration.createQuestion(taskId, 'Question 2?');

        const questions = await integration.getQuestions(taskId);

        expect(questions).toHaveLength(2);
      });

      it('should answer a question', async () => {
        const taskId = 'task_answer_question';
        const question = await integration.createQuestion(taskId, 'What should we do?');

        const answered = await integration.answerQuestion(question.id, 'We should implement X');

        expect(answered.status).toBe('answered');
        expect(answered.answer).toBe('We should implement X');
      });

      it('should defer a question', async () => {
        const taskId = 'task_defer_question';
        const question = await integration.createQuestion(taskId, 'What about edge cases?');

        const deferred = await integration.deferQuestion(question.id);

        expect(deferred.status).toBe('deferred');
      });
    });

    describe('Context Bundle', () => {
      it('should generate a context bundle for task recovery', async () => {
        const cpTask = createTestTask();
        // Use 'planning' which maps to 'in_progress', matching the created task status
        cpTask.state = 'planning';

        const bundle = await integration.generateContextBundle(
          cpTask.task_id,
          'continue_work',
          cpTask
        );

        expect(bundle.task_id).toBe(cpTask.task_id);
        expect(bundle.purpose).toBe('continue_work');
      });

      it('should get latest bundle for a task', async () => {
        const cpTask = createTestTask();
        cpTask.state = 'planning';  // Use a state that matches 'in_progress'

        await integration.generateContextBundle(cpTask.task_id, 'continue_work', cpTask);
        const bundle = await integration.getLatestBundle(cpTask.task_id);

        expect(bundle).not.toBeNull();
        expect(bundle?.task_id).toBe(cpTask.task_id);
      });

      it('should return null for task with no bundles', async () => {
        const bundle = await integration.getLatestBundle('nonexistent_task');
        expect(bundle).toBeNull();
      });
    });

    describe('close', () => {
      it('should close the integration without error', async () => {
        const newIntegration = new TaskStateIntegration();
        await expect(newIntegration.close()).resolves.not.toThrow();
      });
    });
  });

  describe('Global instance functions', () => {
    it('should return the same instance from getTaskStateIntegration', () => {
      const instance1 = getTaskStateIntegration();
      const instance2 = getTaskStateIntegration();

      expect(instance1).toBe(instance2);
    });

    it('should create new instance from initTaskStateIntegration', () => {
      const instance1 = initTaskStateIntegration();
      const instance2 = initTaskStateIntegration();

      expect(instance1).not.toBe(instance2);
    });
  });
});