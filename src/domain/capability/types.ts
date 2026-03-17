export type Capability = 'read' | 'write' | 'execute' | 'test' | 'analyze' | 'git' | 'publish';

export interface ValidateCapabilitiesParams {
  stage: string;
  worker_capabilities: string[];
}

export interface ValidateCapabilitiesResult {
  valid: boolean;
  missing: string[];
}

export const STAGE_CAPABILITIES: Record<string, Capability[]> = {
  plan: ['read', 'analyze'],
  dev: ['read', 'write', 'execute'],
  acceptance: ['read', 'test', 'analyze'],
  integrate: ['read', 'write', 'git', 'execute'],
  publish: ['read', 'git', 'publish'],
};