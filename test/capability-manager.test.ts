import { describe, it, expect, beforeEach } from 'vitest';
import { CapabilityManager } from '../src/domain/capability/index.js';
import type { Capability, WorkerStage } from '../src/types.js';

describe('CapabilityManager', () => {
  let capabilityManager: CapabilityManager;

  beforeEach(() => {
    capabilityManager = new CapabilityManager();
  });

  describe('validateCapabilities', () => {
    it('should pass for plan stage with plan capability', () => {
      const result = capabilityManager.validateCapabilities({
        stage: 'plan',
        worker_capabilities: ['plan'],
      });

      expect(result.valid).toBe(true);
    });

    it('should fail for plan stage without plan capability', () => {
      const result = capabilityManager.validateCapabilities({
        stage: 'plan',
        worker_capabilities: ['edit_repo'],
      });

      expect(result.valid).toBe(false);
      expect(result.missing).toContain('plan');
    });

    it('should pass for dev stage with required capabilities', () => {
      const result = capabilityManager.validateCapabilities({
        stage: 'dev',
        worker_capabilities: ['edit_repo', 'run_tests'],
      });

      expect(result.valid).toBe(true);
    });

    it('should fail for dev stage without run_tests capability', () => {
      const result = capabilityManager.validateCapabilities({
        stage: 'dev',
        worker_capabilities: ['edit_repo'],
      });

      expect(result.valid).toBe(false);
      expect(result.missing).toContain('run_tests');
    });

    it('should fail for dev stage without edit_repo capability', () => {
      const result = capabilityManager.validateCapabilities({
        stage: 'dev',
        worker_capabilities: ['run_tests'],
      });

      expect(result.valid).toBe(false);
      expect(result.missing).toContain('edit_repo');
    });

    it('should pass for acceptance stage with produces_verdict capability', () => {
      const result = capabilityManager.validateCapabilities({
        stage: 'acceptance',
        worker_capabilities: ['produces_verdict'],
      });

      expect(result.valid).toBe(true);
    });

    it('should fail for acceptance stage without produces_verdict capability', () => {
      const result = capabilityManager.validateCapabilities({
        stage: 'acceptance',
        worker_capabilities: ['plan'],
      });

      expect(result.valid).toBe(false);
      expect(result.missing).toContain('produces_verdict');
    });
  });

  describe('getRequiredCapabilitiesForStage', () => {
    it('should return required capabilities for plan stage', () => {
      const caps = capabilityManager.getRequiredCapabilitiesForStage('plan');
      expect(caps).toEqual(['plan']);
    });

    it('should return required capabilities for dev stage', () => {
      const caps = capabilityManager.getRequiredCapabilitiesForStage('dev');
      expect(caps).toContain('edit_repo');
      expect(caps).toContain('run_tests');
    });

    it('should return required capabilities for acceptance stage', () => {
      const caps = capabilityManager.getRequiredCapabilitiesForStage('acceptance');
      expect(caps).toEqual(['produces_verdict']);
    });
  });

  describe('registerWorkerCapabilities', () => {
    it('should register capabilities for a worker', () => {
      capabilityManager.registerWorkerCapabilities('worker_1', ['plan', 'edit_repo']);

      const caps = capabilityManager.getWorkerCapabilities('worker_1');
      expect(caps).toEqual(['plan', 'edit_repo']);
    });

    it('should overwrite existing capabilities', () => {
      capabilityManager.registerWorkerCapabilities('worker_1', ['plan']);
      capabilityManager.registerWorkerCapabilities('worker_1', ['plan', 'edit_repo']);

      const caps = capabilityManager.getWorkerCapabilities('worker_1');
      expect(caps).toEqual(['plan', 'edit_repo']);
    });
  });

  describe('getWorkerCapabilities', () => {
    it('should return empty array for unknown worker', () => {
      const caps = capabilityManager.getWorkerCapabilities('unknown');
      expect(caps).toEqual([]);
    });
  });

  describe('canWorkerHandleStage', () => {
    it('should return true for capable worker on plan stage', () => {
      capabilityManager.registerWorkerCapabilities('worker_1', ['plan']);

      const result = capabilityManager.canWorkerHandleStage('worker_1', 'plan');
      expect(result).toBe(true);
    });

    it('should return true for capable worker on dev stage', () => {
      capabilityManager.registerWorkerCapabilities('worker_1', ['edit_repo', 'run_tests']);

      const result = capabilityManager.canWorkerHandleStage('worker_1', 'dev');
      expect(result).toBe(true);
    });

    it('should return false for incapable worker on dev stage', () => {
      capabilityManager.registerWorkerCapabilities('worker_1', ['plan']);

      const result = capabilityManager.canWorkerHandleStage('worker_1', 'dev');
      expect(result).toBe(false);
    });

    it('should return true for capable worker on acceptance stage', () => {
      capabilityManager.registerWorkerCapabilities('worker_1', ['produces_verdict']);

      const result = capabilityManager.canWorkerHandleStage('worker_1', 'acceptance');
      expect(result).toBe(true);
    });
  });

  describe('findCapableWorkers', () => {
    it('should return workers with required capabilities for dev stage', () => {
      capabilityManager.registerWorkerCapabilities('worker_1', ['edit_repo', 'run_tests']);
      capabilityManager.registerWorkerCapabilities('worker_2', ['plan']);
      capabilityManager.registerWorkerCapabilities('worker_3', ['edit_repo', 'run_tests', 'produces_verdict']);

      const workers = capabilityManager.findCapableWorkers('dev');

      expect(workers).toContain('worker_1');
      expect(workers).toContain('worker_3');
      expect(workers).not.toContain('worker_2');
    });

    it('should return empty array when no capable workers', () => {
      capabilityManager.registerWorkerCapabilities('worker_1', ['plan']);

      const workers = capabilityManager.findCapableWorkers('dev');

      expect(workers).toEqual([]);
    });
  });

  describe('checkCapabilities', () => {
    it('should return passed=true when all capabilities present', () => {
      const result = capabilityManager.checkCapabilities(
        ['plan', 'edit_repo'],
        ['plan', 'edit_repo', 'run_tests'],
      );

      expect(result.passed).toBe(true);
      expect(result.present).toEqual(['plan', 'edit_repo']);
      expect(result.missing).toEqual([]);
    });

    it('should return passed=false when some capabilities missing', () => {
      const result = capabilityManager.checkCapabilities(
        ['plan', 'edit_repo', 'run_tests'],
        ['plan', 'edit_repo'],
      );

      expect(result.passed).toBe(false);
      expect(result.present).toEqual(['plan', 'edit_repo']);
      expect(result.missing).toEqual(['run_tests']);
    });
  });

  describe('getAllRequiredCapabilities', () => {
    it('should include networked capability when requires_network is true', () => {
      const caps = capabilityManager.getAllRequiredCapabilities({
        stage: 'dev',
        worker_capabilities: [],
        requires_network: true,
      });

      expect(caps).toContain('networked');
    });

    it('should include needs_approval capability when under_approval_flow is true', () => {
      const caps = capabilityManager.getAllRequiredCapabilities({
        stage: 'dev',
        worker_capabilities: [],
        under_approval_flow: true,
      });

      expect(caps).toContain('needs_approval');
    });

    it('should include produces_patch capability when produces_patch_artifact is true', () => {
      const caps = capabilityManager.getAllRequiredCapabilities({
        stage: 'dev',
        worker_capabilities: [],
        produces_patch_artifact: true,
      });

      expect(caps).toContain('produces_patch');
    });

    it('should return only base capabilities when no conditional flags are set', () => {
      const caps = capabilityManager.getAllRequiredCapabilities({
        stage: 'dev',
        worker_capabilities: [],
      });

      expect(caps).toEqual(['edit_repo', 'run_tests']);
    });

    it('should include all conditional capabilities when all flags are true', () => {
      const caps = capabilityManager.getAllRequiredCapabilities({
        stage: 'dev',
        worker_capabilities: [],
        requires_network: true,
        under_approval_flow: true,
        produces_patch_artifact: true,
      });

      expect(caps).toContain('edit_repo');
      expect(caps).toContain('run_tests');
      expect(caps).toContain('networked');
      expect(caps).toContain('needs_approval');
      expect(caps).toContain('produces_patch');
      expect(caps).toHaveLength(5);
    });

    it('should include conditional capabilities with plan stage', () => {
      const caps = capabilityManager.getAllRequiredCapabilities({
        stage: 'plan',
        worker_capabilities: [],
        requires_network: true,
      });

      expect(caps).toContain('plan');
      expect(caps).toContain('networked');
    });

    it('should include conditional capabilities with acceptance stage', () => {
      const caps = capabilityManager.getAllRequiredCapabilities({
        stage: 'acceptance',
        worker_capabilities: [],
        under_approval_flow: true,
      });

      expect(caps).toContain('produces_verdict');
      expect(caps).toContain('needs_approval');
    });
  });

  describe('canWorkerHandleStageWithOptions', () => {
    it('should return passed=true when worker has all required capabilities including conditional', () => {
      capabilityManager.registerWorkerCapabilities('worker_1', ['edit_repo', 'run_tests', 'networked']);

      const result = capabilityManager.canWorkerHandleStageWithOptions('worker_1', {
        stage: 'dev',
        worker_capabilities: [],
        requires_network: true,
      });

      expect(result.passed).toBe(true);
      expect(result.missing).toEqual([]);
    });

    it('should return passed=false when worker missing conditional capability', () => {
      capabilityManager.registerWorkerCapabilities('worker_1', ['edit_repo', 'run_tests']);

      const result = capabilityManager.canWorkerHandleStageWithOptions('worker_1', {
        stage: 'dev',
        worker_capabilities: [],
        requires_network: true,
      });

      expect(result.passed).toBe(false);
      expect(result.missing).toContain('networked');
    });

    it('should return passed=false when worker missing base capability', () => {
      capabilityManager.registerWorkerCapabilities('worker_1', ['plan']);

      const result = capabilityManager.canWorkerHandleStageWithOptions('worker_1', {
        stage: 'dev',
        worker_capabilities: [],
      });

      expect(result.passed).toBe(false);
      expect(result.missing).toContain('edit_repo');
      expect(result.missing).toContain('run_tests');
    });

    it('should handle multiple conditional requirements', () => {
      capabilityManager.registerWorkerCapabilities('worker_1', ['edit_repo', 'run_tests', 'networked', 'needs_approval']);

      const result = capabilityManager.canWorkerHandleStageWithOptions('worker_1', {
        stage: 'dev',
        worker_capabilities: [],
        requires_network: true,
        under_approval_flow: true,
      });

      expect(result.passed).toBe(true);
    });

    it('should identify all missing capabilities', () => {
      capabilityManager.registerWorkerCapabilities('worker_1', ['plan']);

      const result = capabilityManager.canWorkerHandleStageWithOptions('worker_1', {
        stage: 'dev',
        worker_capabilities: [],
        requires_network: true,
        produces_patch_artifact: true,
      });

      expect(result.passed).toBe(false);
      expect(result.missing).toContain('edit_repo');
      expect(result.missing).toContain('run_tests');
      expect(result.missing).toContain('networked');
      expect(result.missing).toContain('produces_patch');
    });

    it('should return passed=true for capable acceptance worker with conditional', () => {
      capabilityManager.registerWorkerCapabilities('worker_1', ['produces_verdict', 'needs_approval']);

      const result = capabilityManager.canWorkerHandleStageWithOptions('worker_1', {
        stage: 'acceptance',
        worker_capabilities: [],
        under_approval_flow: true,
      });

      expect(result.passed).toBe(true);
    });
  });

  describe('findCapableWorkersWithOptions', () => {
    it('should return workers that satisfy base and conditional requirements', () => {
      capabilityManager.registerWorkerCapabilities('worker_1', ['edit_repo', 'run_tests', 'networked']);
      capabilityManager.registerWorkerCapabilities('worker_2', ['edit_repo', 'run_tests']);
      capabilityManager.registerWorkerCapabilities('worker_3', ['plan']);

      const workers = capabilityManager.findCapableWorkersWithOptions({
        stage: 'dev',
        worker_capabilities: [],
        requires_network: true,
      });

      expect(workers).toContain('worker_1');
      expect(workers).not.toContain('worker_2');
      expect(workers).not.toContain('worker_3');
    });

    it('should return empty array when no workers satisfy requirements', () => {
      capabilityManager.registerWorkerCapabilities('worker_1', ['plan']);

      const workers = capabilityManager.findCapableWorkersWithOptions({
        stage: 'dev',
        worker_capabilities: [],
      });

      expect(workers).toEqual([]);
    });

    it('should find workers for multiple conditional requirements', () => {
      capabilityManager.registerWorkerCapabilities('worker_1', ['edit_repo', 'run_tests', 'networked', 'needs_approval', 'produces_patch']);
      capabilityManager.registerWorkerCapabilities('worker_2', ['edit_repo', 'run_tests', 'networked']);

      const workers = capabilityManager.findCapableWorkersWithOptions({
        stage: 'dev',
        worker_capabilities: [],
        requires_network: true,
        under_approval_flow: true,
        produces_patch_artifact: true,
      });

      expect(workers).toContain('worker_1');
      expect(workers).not.toContain('worker_2');
    });

    it('should find all capable workers when only base requirements needed', () => {
      capabilityManager.registerWorkerCapabilities('worker_1', ['edit_repo', 'run_tests']);
      capabilityManager.registerWorkerCapabilities('worker_2', ['edit_repo', 'run_tests', 'networked']);
      capabilityManager.registerWorkerCapabilities('worker_3', ['plan']);

      const workers = capabilityManager.findCapableWorkersWithOptions({
        stage: 'dev',
        worker_capabilities: [],
      });

      expect(workers).toContain('worker_1');
      expect(workers).toContain('worker_2');
      expect(workers).not.toContain('worker_3');
    });

    it('should handle acceptance stage with conditional requirements', () => {
      capabilityManager.registerWorkerCapabilities('worker_1', ['produces_verdict', 'needs_approval']);
      capabilityManager.registerWorkerCapabilities('worker_2', ['produces_verdict']);

      const workers = capabilityManager.findCapableWorkersWithOptions({
        stage: 'acceptance',
        worker_capabilities: [],
        under_approval_flow: true,
      });

      expect(workers).toContain('worker_1');
      expect(workers).not.toContain('worker_2');
    });
  });

  describe('checkCapabilities edge cases', () => {
    it('should return passed=true when required array is empty', () => {
      const result = capabilityManager.checkCapabilities([], ['plan', 'edit_repo']);

      expect(result.passed).toBe(true);
      expect(result.present).toEqual([]);
      expect(result.missing).toEqual([]);
    });

    it('should return passed=false when available array is empty', () => {
      const result = capabilityManager.checkCapabilities(['plan', 'edit_repo'], []);

      expect(result.passed).toBe(false);
      expect(result.present).toEqual([]);
      expect(result.missing).toEqual(['plan', 'edit_repo']);
    });

    it('should return passed=true when both arrays are empty', () => {
      const result = capabilityManager.checkCapabilities([], []);

      expect(result.passed).toBe(true);
      expect(result.present).toEqual([]);
      expect(result.missing).toEqual([]);
    });

    it('should return all missing when no capabilities match', () => {
      const result = capabilityManager.checkCapabilities(
        ['plan', 'edit_repo', 'run_tests'],
        ['produces_verdict', 'networked'],
      );

      expect(result.passed).toBe(false);
      expect(result.present).toEqual([]);
      expect(result.missing).toEqual(['plan', 'edit_repo', 'run_tests']);
    });

    it('should return correct present and missing when partial match', () => {
      const result = capabilityManager.checkCapabilities(
        ['plan', 'edit_repo', 'run_tests', 'produces_verdict'],
        ['edit_repo', 'networked'],
      );

      expect(result.passed).toBe(false);
      expect(result.present).toEqual(['edit_repo']);
      expect(result.missing).toContain('plan');
      expect(result.missing).toContain('run_tests');
      expect(result.missing).toContain('produces_verdict');
    });
  });

  describe('validateCapabilities edge cases', () => {
    it('should fail with empty worker_capabilities', () => {
      const result = capabilityManager.validateCapabilities({
        stage: 'dev',
        worker_capabilities: [],
      });

      expect(result.valid).toBe(false);
      expect(result.missing).toContain('edit_repo');
      expect(result.missing).toContain('run_tests');
    });

    it('should pass with empty worker_capabilities for unknown stage', () => {
      const result = capabilityManager.validateCapabilities({
        stage: 'unknown_stage',
        worker_capabilities: [],
      });

      expect(result.valid).toBe(true);
      expect(result.missing).toEqual([]);
    });

    it('should handle extra capabilities gracefully', () => {
      const result = capabilityManager.validateCapabilities({
        stage: 'plan',
        worker_capabilities: ['plan', 'edit_repo', 'run_tests', 'extra_capability'],
      });

      expect(result.valid).toBe(true);
      expect(result.missing).toEqual([]);
    });
  });

  describe('findCapableWorkers edge cases', () => {
    it('should return empty array when no workers are registered', () => {
      const workers = capabilityManager.findCapableWorkers('dev');
      expect(workers).toEqual([]);
    });

    it('should return all workers that have required capabilities for plan stage', () => {
      capabilityManager.registerWorkerCapabilities('worker_1', ['plan']);
      capabilityManager.registerWorkerCapabilities('worker_2', ['plan', 'edit_repo']);
      capabilityManager.registerWorkerCapabilities('worker_3', ['edit_repo', 'run_tests']);

      const workers = capabilityManager.findCapableWorkers('plan');

      expect(workers).toContain('worker_1');
      expect(workers).toContain('worker_2');
      expect(workers).not.toContain('worker_3');
    });
  });

  describe('canWorkerHandleStage edge cases', () => {
    it('should return false for unknown worker', () => {
      const result = capabilityManager.canWorkerHandleStage('unknown_worker', 'dev');
      expect(result).toBe(false);
    });

    it('should return false when worker has empty capabilities', () => {
      capabilityManager.registerWorkerCapabilities('worker_1', []);

      const result = capabilityManager.canWorkerHandleStage('worker_1', 'plan');
      expect(result).toBe(false);
    });

    it('should return true for plan stage when worker only has plan capability', () => {
      capabilityManager.registerWorkerCapabilities('worker_1', ['plan']);

      const result = capabilityManager.canWorkerHandleStage('worker_1', 'plan');
      expect(result).toBe(true);
    });
  });

  describe('getWorkerCapabilities edge cases', () => {
    it('should return empty array after worker is re-registered with empty capabilities', () => {
      capabilityManager.registerWorkerCapabilities('worker_1', ['plan', 'edit_repo']);
      capabilityManager.registerWorkerCapabilities('worker_1', []);

      const caps = capabilityManager.getWorkerCapabilities('worker_1');
      expect(caps).toEqual([]);
    });
  });

  describe('registerWorkerCapabilities edge cases', () => {
    it('should register empty capabilities array', () => {
      capabilityManager.registerWorkerCapabilities('worker_1', []);

      const caps = capabilityManager.getWorkerCapabilities('worker_1');
      expect(caps).toEqual([]);
    });

    it('should handle multiple workers independently', () => {
      capabilityManager.registerWorkerCapabilities('worker_1', ['plan']);
      capabilityManager.registerWorkerCapabilities('worker_2', ['edit_repo', 'run_tests']);

      expect(capabilityManager.getWorkerCapabilities('worker_1')).toEqual(['plan']);
      expect(capabilityManager.getWorkerCapabilities('worker_2')).toEqual(['edit_repo', 'run_tests']);
    });
  });

  describe('getRequiredCapabilitiesForStage immutability', () => {
    it('should return a copy of capabilities array', () => {
      const caps1 = capabilityManager.getRequiredCapabilitiesForStage('dev');
      const caps2 = capabilityManager.getRequiredCapabilitiesForStage('dev');

      expect(caps1).toEqual(caps2);
      expect(caps1).not.toBe(caps2);
    });
  });
});