import { describe, it, expect, beforeEach } from 'vitest';
import { CapabilityManager } from '../src/domain/capability/index.js';

describe('CapabilityManager', () => {
  let capabilityManager: CapabilityManager;

  beforeEach(() => {
    capabilityManager = new CapabilityManager();
  });

  describe('validateCapabilities', () => {
    it('should pass for plan stage with read capability', () => {
      const result = capabilityManager.validateCapabilities({
        stage: 'plan',
        worker_capabilities: ['read', 'analyze'],
      });

      expect(result.valid).toBe(true);
    });

    it('should fail for plan stage without read capability', () => {
      const result = capabilityManager.validateCapabilities({
        stage: 'plan',
        worker_capabilities: ['write'],
      });

      expect(result.valid).toBe(false);
      expect(result.missing).toContain('read');
    });

    it('should pass for dev stage with required capabilities', () => {
      const result = capabilityManager.validateCapabilities({
        stage: 'dev',
        worker_capabilities: ['read', 'write', 'execute'],
      });

      expect(result.valid).toBe(true);
    });

    it('should fail for dev stage without write capability', () => {
      const result = capabilityManager.validateCapabilities({
        stage: 'dev',
        worker_capabilities: ['read', 'execute'],
      });

      expect(result.valid).toBe(false);
      expect(result.missing).toContain('write');
    });

    it('should pass for acceptance stage with required capabilities', () => {
      const result = capabilityManager.validateCapabilities({
        stage: 'acceptance',
        worker_capabilities: ['read', 'test', 'analyze'],
      });

      expect(result.valid).toBe(true);
    });

    it('should fail for acceptance stage without test capability', () => {
      const result = capabilityManager.validateCapabilities({
        stage: 'acceptance',
        worker_capabilities: ['read', 'write'],
      });

      expect(result.valid).toBe(false);
      expect(result.missing).toContain('test');
    });

    it('should pass for integrate stage with required capabilities', () => {
      const result = capabilityManager.validateCapabilities({
        stage: 'integrate',
        worker_capabilities: ['read', 'write', 'git', 'execute'],
      });

      expect(result.valid).toBe(true);
    });

    it('should fail for integrate stage without git capability', () => {
      const result = capabilityManager.validateCapabilities({
        stage: 'integrate',
        worker_capabilities: ['read', 'write', 'execute'],
      });

      expect(result.valid).toBe(false);
      expect(result.missing).toContain('git');
    });

    it('should pass for publish stage with required capabilities', () => {
      const result = capabilityManager.validateCapabilities({
        stage: 'publish',
        worker_capabilities: ['read', 'git', 'publish'],
      });

      expect(result.valid).toBe(true);
    });

    it('should fail for publish stage without publish capability', () => {
      const result = capabilityManager.validateCapabilities({
        stage: 'publish',
        worker_capabilities: ['read', 'git'],
      });

      expect(result.valid).toBe(false);
      expect(result.missing).toContain('publish');
    });
  });

  describe('getRequiredCapabilities', () => {
    it('should return required capabilities for plan stage', () => {
      const caps = capabilityManager.getRequiredCapabilities('plan');
      expect(caps).toContain('read');
      expect(caps).toContain('analyze');
    });

    it('should return required capabilities for dev stage', () => {
      const caps = capabilityManager.getRequiredCapabilities('dev');
      expect(caps).toContain('read');
      expect(caps).toContain('write');
      expect(caps).toContain('execute');
    });

    it('should return required capabilities for acceptance stage', () => {
      const caps = capabilityManager.getRequiredCapabilities('acceptance');
      expect(caps).toContain('read');
      expect(caps).toContain('test');
      expect(caps).toContain('analyze');
    });

    it('should return required capabilities for integrate stage', () => {
      const caps = capabilityManager.getRequiredCapabilities('integrate');
      expect(caps).toContain('read');
      expect(caps).toContain('write');
      expect(caps).toContain('git');
      expect(caps).toContain('execute');
    });

    it('should return required capabilities for publish stage', () => {
      const caps = capabilityManager.getRequiredCapabilities('publish');
      expect(caps).toContain('read');
      expect(caps).toContain('git');
      expect(caps).toContain('publish');
    });
  });

  describe('registerWorkerCapabilities', () => {
    it('should register capabilities for a worker', () => {
      capabilityManager.registerWorkerCapabilities('worker_1', ['read', 'write', 'execute']);

      const caps = capabilityManager.getWorkerCapabilities('worker_1');
      expect(caps).toEqual(['read', 'write', 'execute']);
    });

    it('should overwrite existing capabilities', () => {
      capabilityManager.registerWorkerCapabilities('worker_1', ['read']);
      capabilityManager.registerWorkerCapabilities('worker_1', ['read', 'write']);

      const caps = capabilityManager.getWorkerCapabilities('worker_1');
      expect(caps).toEqual(['read', 'write']);
    });
  });

  describe('getWorkerCapabilities', () => {
    it('should return empty array for unknown worker', () => {
      const caps = capabilityManager.getWorkerCapabilities('unknown');
      expect(caps).toEqual([]);
    });
  });

  describe('canWorkerHandleStage', () => {
    it('should return true for capable worker', () => {
      capabilityManager.registerWorkerCapabilities('worker_1', ['read', 'write', 'execute']);

      const result = capabilityManager.canWorkerHandleStage('worker_1', 'dev');
      expect(result).toBe(true);
    });

    it('should return false for incapable worker', () => {
      capabilityManager.registerWorkerCapabilities('worker_1', ['read']);

      const result = capabilityManager.canWorkerHandleStage('worker_1', 'dev');
      expect(result).toBe(false);
    });
  });

  describe('findCapableWorkers', () => {
    it('should return workers with required capabilities', () => {
      capabilityManager.registerWorkerCapabilities('worker_1', ['read', 'write', 'execute']);
      capabilityManager.registerWorkerCapabilities('worker_2', ['read']);
      capabilityManager.registerWorkerCapabilities('worker_3', ['read', 'write', 'execute', 'git']);

      const workers = capabilityManager.findCapableWorkers('dev');

      expect(workers).toContain('worker_1');
      expect(workers).toContain('worker_3');
      expect(workers).not.toContain('worker_2');
    });

    it('should return empty array when no capable workers', () => {
      capabilityManager.registerWorkerCapabilities('worker_1', ['read']);

      const workers = capabilityManager.findCapableWorkers('dev');

      expect(workers).toEqual([]);
    });
  });
});