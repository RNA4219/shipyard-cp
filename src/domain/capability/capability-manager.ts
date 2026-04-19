import type { Capability, ValidateCapabilitiesParams, ValidateCapabilitiesResult, CapabilityCheckResult } from './types.js';
import { STAGE_CAPABILITIES, CONDITIONAL_CAPABILITIES } from './types.js';
import type { WorkerStage } from '../../types.js';

/**
 * Options for capability checking with conditional requirements
 */
export interface CapabilityCheckOptions {
  stage: WorkerStage;
  worker_capabilities: Capability[];
  /** Set to true if job requires network access */
  requires_network?: boolean;
  /** Set to true if job operates under approval flow */
  under_approval_flow?: boolean;
  /** Set to true if job produces patch artifacts */
  produces_patch_artifact?: boolean;
}

export class CapabilityManager {
  private readonly workerCapabilities = new Map<string, Capability[]>();

  /**
   * Check capabilities against required set.
   * This is the main method for validating worker capabilities before dispatch.
   */
  checkCapabilities(required: Capability[], available: Capability[]): CapabilityCheckResult {
    const present: Capability[] = [];
    const missing: Capability[] = [];

    for (const cap of required) {
      if (available.includes(cap)) {
        present.push(cap);
      } else {
        missing.push(cap);
      }
    }

    return {
      required,
      present,
      missing,
      passed: missing.length === 0,
    };
  }

  /**
   * Get required capabilities for a worker-dispatched stage.
   * Returns base requirements from STAGE_CAPABILITIES.
   */
  getRequiredCapabilitiesForStage(stage: WorkerStage): Capability[] {
    const capabilities = STAGE_CAPABILITIES[stage];
    return capabilities ? [...capabilities] : [];
  }

  /**
   * Get all required capabilities including conditional ones.
   * Use this for comprehensive capability checking before job dispatch.
   */
  getAllRequiredCapabilities(options: CapabilityCheckOptions): Capability[] {
    const base = this.getRequiredCapabilitiesForStage(options.stage);
    const additional: Capability[] = [];

    if (options.requires_network) {
      additional.push(CONDITIONAL_CAPABILITIES.networked);
    }
    if (options.under_approval_flow) {
      additional.push(CONDITIONAL_CAPABILITIES.needs_approval);
    }
    if (options.produces_patch_artifact) {
      additional.push(CONDITIONAL_CAPABILITIES.produces_patch);
    }

    return [...base, ...additional];
  }

  validateCapabilities(params: ValidateCapabilitiesParams): ValidateCapabilitiesResult {
    const { stage, worker_capabilities } = params;
    const required = this.getRequiredCapabilitiesForStage(stage);

    const missing: string[] = [];
    for (const cap of required) {
      if (!worker_capabilities.includes(cap)) {
        missing.push(cap);
      }
    }

    return {
      valid: missing.length === 0,
      missing,
    };
  }

  registerWorkerCapabilities(workerId: string, capabilities: Capability[]): void {
    this.workerCapabilities.set(workerId, [...capabilities]);
  }

  getWorkerCapabilities(workerId: string): Capability[] {
    return this.workerCapabilities.get(workerId) ?? [];
  }

  canWorkerHandleStage(workerId: string, stage: WorkerStage): boolean {
    const workerCaps = this.getWorkerCapabilities(workerId);
    const required = this.getRequiredCapabilitiesForStage(stage);

    for (const cap of required) {
      if (!workerCaps.includes(cap)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Check if worker can handle stage with additional conditional requirements.
   */
  canWorkerHandleStageWithOptions(
    workerId: string,
    options: CapabilityCheckOptions,
  ): CapabilityCheckResult {
    const workerCaps = this.getWorkerCapabilities(workerId);
    const required = this.getAllRequiredCapabilities(options);
    return this.checkCapabilities(required, workerCaps);
  }

  findCapableWorkers(stage: WorkerStage): string[] {
    const required = this.getRequiredCapabilitiesForStage(stage);
    const capable: string[] = [];

    for (const [workerId, caps] of this.workerCapabilities) {
      const hasAll = required.every(cap => caps.includes(cap));
      if (hasAll) {
        capable.push(workerId);
      }
    }

    return capable;
  }

  /**
   * Find workers that satisfy all requirements including conditional ones.
   */
  findCapableWorkersWithOptions(options: CapabilityCheckOptions): string[] {
    const required = this.getAllRequiredCapabilities(options);
    const capable: string[] = [];

    for (const [workerId, caps] of this.workerCapabilities) {
      const hasAll = required.every(cap => caps.includes(cap));
      if (hasAll) {
        capable.push(workerId);
      }
    }

    return capable;
  }
}