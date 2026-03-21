import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DecisionService } from '../src/store/services/decision-service.js';

// Mock the taskstate integration
vi.mock('../src/domain/taskstate/index.js', () => ({
  getTaskStateIntegration: () => ({
    createDecision: vi.fn().mockResolvedValue({
      decision_id: 'decision_123',
      task_id: 'task_456',
      question: 'Which approach?',
      options: ['A', 'B'],
      status: 'pending',
      created_at: '2024-01-01T00:00:00Z',
    }),
    getDecisions: vi.fn().mockResolvedValue([
      {
        decision_id: 'decision_123',
        task_id: 'task_456',
        question: 'Which approach?',
        options: ['A', 'B'],
        status: 'pending',
      },
    ]),
    resolveDecision: vi.fn().mockResolvedValue({
      decision_id: 'decision_123',
      status: 'resolved',
      chosen: 'A',
      rationale: 'Best option',
    }),
    rejectDecision: vi.fn().mockResolvedValue({
      decision_id: 'decision_123',
      status: 'rejected',
      rationale: 'Not needed',
    }),
    createQuestion: vi.fn().mockResolvedValue({
      question_id: 'question_123',
      task_id: 'task_456',
      question: 'What about X?',
      status: 'open',
    }),
    getQuestions: vi.fn().mockResolvedValue([
      {
        question_id: 'question_123',
        task_id: 'task_456',
        question: 'What about X?',
        status: 'open',
      },
    ]),
    answerQuestion: vi.fn().mockResolvedValue({
      question_id: 'question_123',
      status: 'answered',
      answer: 'Yes',
    }),
    deferQuestion: vi.fn().mockResolvedValue({
      question_id: 'question_123',
      status: 'deferred',
    }),
    generateContextBundle: vi.fn().mockResolvedValue({
      bundle_id: 'bundle_123',
      task_id: 'task_456',
      purpose: 'continue_work',
      sections: [],
    }),
    getLatestBundle: vi.fn().mockResolvedValue({
      bundle_id: 'bundle_123',
      task_id: 'task_456',
    }),
  }),
}));

describe('DecisionService', () => {
  let service: DecisionService;

  beforeEach(() => {
    service = new DecisionService();
    vi.clearAllMocks();
  });

  describe('createDecision', () => {
    it('should create a decision for a task', async () => {
      const result = await service.createDecision('task_456', 'Which approach?', ['A', 'B']);

      expect(result.decision_id).toBe('decision_123');
      expect(result.task_id).toBe('task_456');
      expect(result.question).toBe('Which approach?');
      expect(result.options).toEqual(['A', 'B']);
    });
  });

  describe('getDecisions', () => {
    it('should get all decisions for a task', async () => {
      const result = await service.getDecisions('task_456');

      expect(result).toHaveLength(1);
      expect(result[0].decision_id).toBe('decision_123');
    });
  });

  describe('resolveDecision', () => {
    it('should resolve a decision with chosen option', async () => {
      const result = await service.resolveDecision('decision_123', 'A', 'Best option');

      expect(result.decision_id).toBe('decision_123');
      expect(result.status).toBe('resolved');
      expect(result.chosen).toBe('A');
    });

    it('should resolve a decision without rationale', async () => {
      const result = await service.resolveDecision('decision_123', 'B');

      expect(result.decision_id).toBe('decision_123');
      expect(result.status).toBe('resolved');
    });
  });

  describe('rejectDecision', () => {
    it('should reject a decision with rationale', async () => {
      const result = await service.rejectDecision('decision_123', 'Not needed');

      expect(result.decision_id).toBe('decision_123');
      expect(result.status).toBe('rejected');
    });
  });

  describe('createOpenQuestion', () => {
    it('should create an open question for a task', async () => {
      const result = await service.createOpenQuestion('task_456', 'What about X?');

      expect(result.question_id).toBe('question_123');
      expect(result.question).toBe('What about X?');
      expect(result.status).toBe('open');
    });
  });

  describe('getOpenQuestions', () => {
    it('should get all open questions for a task', async () => {
      const result = await service.getOpenQuestions('task_456');

      expect(result).toHaveLength(1);
      expect(result[0].question_id).toBe('question_123');
    });
  });

  describe('answerOpenQuestion', () => {
    it('should answer an open question', async () => {
      const result = await service.answerOpenQuestion('question_123', 'Yes');

      expect(result.question_id).toBe('question_123');
      expect(result.status).toBe('answered');
    });
  });

  describe('deferOpenQuestion', () => {
    it('should defer an open question', async () => {
      const result = await service.deferOpenQuestion('question_123');

      expect(result.question_id).toBe('question_123');
      expect(result.status).toBe('deferred');
    });
  });

  describe('generateContextBundle', () => {
    it('should generate a context bundle for task recovery', async () => {
      const task = { task_id: 'task_456', state: 'planning' } as any;
      const result = await service.generateContextBundle('task_456', 'continue_work', task);

      expect(result.bundle_id).toBe('bundle_123');
      expect(result.task_id).toBe('task_456');
    });

    it('should support different purposes', async () => {
      const task = { task_id: 'task_456', state: 'planning' } as any;
      const purposes = ['continue_work', 'review_prepare', 'resume_after_block', 'decision_support', 'other'] as const;

      for (const purpose of purposes) {
        const result = await service.generateContextBundle('task_456', purpose, task);
        expect(result.bundle_id).toBe('bundle_123');
      }
    });
  });

  describe('getLatestContextBundle', () => {
    it('should get the latest context bundle for a task', async () => {
      const result = await service.getLatestContextBundle('task_456');

      expect(result?.bundle_id).toBe('bundle_123');
    });
  });
});