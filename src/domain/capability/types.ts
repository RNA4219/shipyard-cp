import type { Capability as GlobalCapability, WorkerStage } from '../../types.js';

// Re-export Capability from global types for consistency
export type Capability = GlobalCapability;

/**
 * Capability check result for stage transitions
 */
export interface CapabilityCheckResult {
  required: Capability[];
  present: Capability[];
  missing: Capability[];
  passed: boolean;
}

export interface ValidateCapabilitiesParams {
  stage: string;
  worker_capabilities: string[];
}

export interface ValidateCapabilitiesResult {
  valid: boolean;
  missing: string[];
}

/**
 * Required capabilities for worker-dispatched stages (ADD_REQUIREMENTS.md section 4)
 */
export const STAGE_CAPABILITIES: Record<WorkerStage, Capability[]> = {
  plan: ['plan'],
  dev: ['edit_repo', 'run_tests'],
  acceptance: ['produces_verdict'],
};

/**
 * Additional conditional capabilities based on job requirements
 */
export const CONDITIONAL_CAPABILITIES = {
  /** Required when job needs network access */
  networked: 'networked' as Capability,
  /** Required when job operates under approval flow */
  needs_approval: 'needs_approval' as Capability,
  /** Required when job produces patch artifacts */
  produces_patch: 'produces_patch' as Capability,
};