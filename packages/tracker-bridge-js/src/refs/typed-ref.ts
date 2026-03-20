/**
 * Typed reference utilities for tracker-bridge
 *
 * Canonical format: <domain>:<entity_type>:<provider>:<entity_id>
 *
 * Examples:
 * - memx:evidence:local:01JXYZ...
 * - agent-taskstate:task:local:01JABCDEF...
 * - tracker:issue:jira:PROJ-123
 * - tracker:issue:github:owner/repo#45
 */

/** Known domains for typed refs */
export const KNOWN_DOMAINS = new Set(['tracker', 'agent-taskstate', 'memx']);

/** Default provider for local entities */
export const LOCAL_PROVIDER = 'local';

/** Tracker domain constant */
export const TRACKER_DOMAIN = 'tracker';

/** Default entity type for tracker */
export const TRACKER_DEFAULT_ENTITY_TYPE = 'issue';

/** Domains that use local provider by default */
export const LOCAL_DOMAINS = new Set(['memx', 'agent-taskstate']);

/**
 * Typed reference with canonical 4-segment format
 */
export class TypedRef {
  readonly domain: string;
  readonly entity_type: string;
  readonly entity_id: string;
  readonly provider: string;

  constructor(
    domain: string,
    entity_type: string,
    entity_id: string,
    provider?: string
  ) {
    if (!KNOWN_DOMAINS.has(domain)) {
      throw new Error(`Unknown typed_ref domain: ${domain}`);
    }
    if (!entity_type || !entity_id) {
      throw new Error('Invalid typed_ref: empty segment');
    }

    // Auto-fill provider for local domains
    let resolvedProvider = provider;
    if (!resolvedProvider && LOCAL_DOMAINS.has(domain)) {
      resolvedProvider = LOCAL_PROVIDER;
    }
    if (!resolvedProvider) {
      throw new Error('Invalid typed_ref: provider is required');
    }

    this.domain = domain;
    this.entity_type = entity_type;
    this.entity_id = entity_id;
    this.provider = resolvedProvider;
  }

  /**
   * String representation in canonical format
   */
  toString(): string {
    return `${this.domain}:${this.entity_type}:${this.provider}:${this.entity_id}`;
  }

  /**
   * Parse a typed_ref string into a TypedRef object
   */
  static parse(value: string): TypedRef {
    const parts = value.split(':');

    if (parts.length === 3) {
      const [domain, second, third] = parts;
      if (!domain || !second || !third) {
        throw new Error(`Invalid typed_ref: empty segment in ${value}`);
      }

      if (LOCAL_DOMAINS.has(domain)) {
        return new TypedRef(domain, second, third, LOCAL_PROVIDER);
      }

      if (domain === TRACKER_DOMAIN) {
        // Format: tracker:provider:entity_id -> tracker:issue:provider:entity_id
        return new TypedRef(domain, TRACKER_DEFAULT_ENTITY_TYPE, third, second);
      }

      throw new Error(`Unknown typed_ref domain: ${domain}`);
    }

    if (parts.length === 4) {
      const [domain, entity_type, provider, entity_id] = parts;
      if (!domain || !entity_type || !provider || !entity_id) {
        throw new Error(`Invalid typed_ref: empty segment in ${value}`);
      }
      return new TypedRef(domain, entity_type, entity_id, provider);
    }

    throw new Error(`Invalid typed_ref format: ${value}`);
  }

  /**
   * Check if this is a memx reference
   */
  get is_memx(): boolean {
    return this.domain === 'memx';
  }

  /**
   * Check if this is an agent-taskstate reference
   */
  get is_agent_taskstate(): boolean {
    return this.domain === 'agent-taskstate';
  }

  /**
   * Check if this is a tracker reference
   */
  get is_tracker(): boolean {
    return this.domain === 'tracker';
  }
}

/**
 * Create a canonical typed_ref string
 */
export function makeRef(
  domain: string,
  entityType: string,
  entityId: string,
  provider?: string
): string {
  return new TypedRef(domain, entityType, entityId, provider).toString();
}

/**
 * Create a tracker issue reference
 */
export function makeTrackerIssueRef(trackerType: string, issueKey: string): string {
  return makeRef('tracker', 'issue', issueKey, trackerType);
}

/**
 * Create an agent-taskstate task reference
 */
export function makeAgentTaskstateTaskRef(taskId: string): string {
  return makeRef('agent-taskstate', 'task', taskId);
}

/**
 * Create a memx evidence reference
 */
export function makeMemxEvidenceRef(evidenceId: string): string {
  return makeRef('memx', 'evidence', evidenceId);
}

/**
 * Create a memx knowledge reference
 */
export function makeMemxKnowledgeRef(knowledgeId: string): string {
  return makeRef('memx', 'knowledge', knowledgeId);
}

/**
 * Create a memx artifact reference
 */
export function makeMemxArtifactRef(artifactId: string): string {
  return makeRef('memx', 'artifact', artifactId);
}

/**
 * Validate a typed_ref string
 */
export function validateTypedRef(value: string): boolean {
  try {
    TypedRef.parse(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Canonicalize a typed_ref string
 */
export function canonicalize(value: string): string {
  return TypedRef.parse(value).toString();
}

/**
 * Check if a typed_ref is a memx reference
 */
export function isMemxRef(value: string): boolean {
  try {
    return TypedRef.parse(value).is_memx;
  } catch {
    return false;
  }
}

/**
 * Check if a typed_ref is an agent-taskstate reference
 */
export function isAgentTaskstateRef(value: string): boolean {
  try {
    return TypedRef.parse(value).is_agent_taskstate;
  } catch {
    return false;
  }
}

/**
 * Check if a typed_ref is a tracker reference
 */
export function isTrackerRef(value: string): boolean {
  try {
    return TypedRef.parse(value).is_tracker;
  } catch {
    return false;
  }
}