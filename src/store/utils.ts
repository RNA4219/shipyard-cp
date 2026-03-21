import { randomUUID, randomBytes } from 'node:crypto';
import type { ExternalRef, WorkerResult, WorkerStage, WorkerType } from '../types.js';
import type { Capability } from '../domain/capability/types.js';

export function nowIso(): string {
  return new Date().toISOString();
}

export function createId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '')}`;
}

export function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

export function generateLoopFingerprint(taskId: string, stage: WorkerStage): string {
  const timestamp = new Date().toISOString();
  const hash = simpleHash(`${taskId}:${stage}:${timestamp}`);
  return `loop:${taskId}:${stage}:${hash}`;
}

export function mergeExternalRefs(existing: ExternalRef[] | undefined, newRefs: ExternalRef[]): ExternalRef[] {
  const existingValues = new Set(existing?.map(e => e.value) ?? []);
  const uniqueNew = newRefs.filter(e => !existingValues.has(e.value));
  return [...(existing ?? []), ...uniqueNew];
}

export function getArtifactIds(result: WorkerResult): string[] {
  return result.artifacts.map(a => a.artifact_id);
}

export function generateApprovalToken(): string {
  // Generate 32 bytes of random data, encoded as hex
  return randomBytes(32).toString('hex');
}

/** Approval token expiration in milliseconds (24 hours) */
export const APPROVAL_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_WORKER_CAPABILITIES: Record<WorkerType, Capability[]> = {
  codex: ['plan', 'edit_repo', 'run_tests', 'produces_patch', 'produces_verdict'],
  claude_code: ['plan', 'edit_repo', 'run_tests', 'needs_approval', 'produces_patch', 'produces_verdict', 'networked'],
  google_antigravity: ['plan', 'produces_verdict'],
};

export const DEFAULT_REPO_POLICY = {
  update_strategy: 'fast_forward_only' as const,
  main_push_actor: 'bot' as const,
  require_ci_pass: true,
};