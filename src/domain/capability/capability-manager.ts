import type { Capability, ValidateCapabilitiesParams, ValidateCapabilitiesResult } from './types.js';
import { STAGE_CAPABILITIES } from './types.js';

export class CapabilityManager {
  private readonly workerCapabilities = new Map<string, Capability[]>();

  validateCapabilities(params: ValidateCapabilitiesParams): ValidateCapabilitiesResult {
    const { stage, worker_capabilities } = params;
    const required = this.getRequiredCapabilities(stage);

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

  getRequiredCapabilities(stage: string): Capability[] {
    return STAGE_CAPABILITIES[stage] ?? [];
  }

  registerWorkerCapabilities(workerId: string, capabilities: Capability[]): void {
    this.workerCapabilities.set(workerId, [...capabilities]);
  }

  getWorkerCapabilities(workerId: string): Capability[] {
    return this.workerCapabilities.get(workerId) ?? [];
  }

  canWorkerHandleStage(workerId: string, stage: string): boolean {
    const workerCaps = this.getWorkerCapabilities(workerId);
    const required = this.getRequiredCapabilities(stage);

    for (const cap of required) {
      if (!workerCaps.includes(cap)) {
        return false;
      }
    }

    return true;
  }

  findCapableWorkers(stage: string): string[] {
    const required = this.getRequiredCapabilities(stage);
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