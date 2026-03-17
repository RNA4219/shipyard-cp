import { describe, it, expect } from 'vitest';
import { TaskValidator } from '../src/domain/task/task-validator.js';
import type { CreateTaskRequest } from '../src/types.js';

describe('TaskValidator', () => {
  const validRepoRef = {
    provider: 'github' as const,
    owner: 'testorg',
    name: 'testrepo',
    default_branch: 'main',
  };

  describe('validateObjective', () => {
    it('should accept valid objective', () => {
      expect(() => TaskValidator.validateObjective('Test objective')).not.toThrow();
    });

    it('should reject empty objective', () => {
      expect(() => TaskValidator.validateObjective('')).toThrow('objective is required');
    });

    it('should reject whitespace-only objective', () => {
      expect(() => TaskValidator.validateObjective('   ')).toThrow('objective is required');
    });

    it('should reject undefined objective', () => {
      expect(() => TaskValidator.validateObjective(undefined)).toThrow('objective is required');
    });
  });

  describe('validateTypedRef', () => {
    it('should accept valid 4-segment typed_ref', () => {
      expect(() => TaskValidator.validateTypedRef('agent-taskstate:task:github:test-123')).not.toThrow();
    });

    it('should accept underscores and hyphens in segments', () => {
      expect(() => TaskValidator.validateTypedRef('agent_taskstate:task_type:git_hub:test-123_abc')).not.toThrow();
    });

    it('should reject missing typed_ref', () => {
      expect(() => TaskValidator.validateTypedRef(undefined)).toThrow('typed_ref is required');
    });

    it('should reject 1-segment format', () => {
      expect(() => TaskValidator.validateTypedRef('invalid')).toThrow('typed_ref invalid format');
    });

    it('should reject 2-segment format', () => {
      expect(() => TaskValidator.validateTypedRef('shipyard:task')).toThrow('typed_ref invalid format');
    });

    it('should reject 3-segment format', () => {
      expect(() => TaskValidator.validateTypedRef('agent-taskstate:task:github')).toThrow('typed_ref invalid format');
    });

    it('should reject uppercase in segments', () => {
      expect(() => TaskValidator.validateTypedRef('Shipyard:task:github:test')).toThrow('typed_ref invalid format');
    });
  });

  describe('validateCreateRequest', () => {
    it('should accept valid request', () => {
      const request: CreateTaskRequest = {
        title: 'Test Task',
        objective: 'Test objective',
        typed_ref: 'agent-taskstate:task:github:test-001',
        repo_ref: validRepoRef,
      };

      expect(() => TaskValidator.validateCreateRequest(request)).not.toThrow();
    });

    it('should reject request without objective', () => {
      const request = {
        title: 'Test Task',
        typed_ref: 'agent-taskstate:task:github:test-001',
        repo_ref: validRepoRef,
      } as CreateTaskRequest;

      expect(() => TaskValidator.validateCreateRequest(request)).toThrow('objective is required');
    });

    it('should reject request without typed_ref', () => {
      const request = {
        title: 'Test Task',
        objective: 'Test objective',
        repo_ref: validRepoRef,
      } as CreateTaskRequest;

      expect(() => TaskValidator.validateCreateRequest(request)).toThrow('typed_ref is required');
    });

    it('should reject request with invalid typed_ref format', () => {
      const request: CreateTaskRequest = {
        title: 'Test Task',
        objective: 'Test objective',
        typed_ref: 'invalid',
        repo_ref: validRepoRef,
      };

      expect(() => TaskValidator.validateCreateRequest(request)).toThrow('typed_ref invalid format');
    });
  });
});