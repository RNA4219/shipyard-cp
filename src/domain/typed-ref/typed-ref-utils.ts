/**
 * typed_ref Utilities
 *
 * Provides validation and canonical form utilities for typed_ref format:
 * `<domain>:<entity_type>:<provider>:<entity_id>`
 *
 * @see spec-compliance-checklist.md section 1.3
 */

/**
 * Canonical typed_ref pattern (case-insensitive for parsing)
 */
export const TYPED_REF_PATTERN = /^([a-zA-Z0-9_-]+):([a-zA-Z0-9_-]+):([a-zA-Z0-9_-]+):(.+)$/;

/**
 * Strict pattern for validated (lowercase) typed_refs
 */
export const STRICT_TYPED_REF_PATTERN = /^([a-z0-9_-]+):([a-z0-9_-]+):([a-z0-9_-]+):(.+)$/;

/**
 * Valid domains per OSS specification
 */
export const VALID_DOMAINS = [
  'agent-taskstate',
  'memx',
  'tracker',
  'shipyard', // Internal use
] as const;

/**
 * Valid entity types per domain
 */
export const ENTITY_TYPES_BY_DOMAIN: Record<string, string[]> = {
  'agent-taskstate': ['task', 'decision', 'question'],
  'memx': ['evidence', 'doc', 'chunk', 'contract'],
  'tracker': ['issue', 'pr', 'project_item', 'comment'],
  'shipyard': ['task', 'job', 'workspace', 'artifact'],
};

/**
 * Parsed typed_ref components
 */
export interface TypedRefComponents {
  domain: string;
  entity_type: string;
  provider: string;
  entity_id: string;
}

/**
 * Validates a typed_ref string against the canonical format.
 *
 * @param typedRef - The typed_ref string to validate
 * @returns true if valid, false otherwise
 */
export function isValidTypedRef(typedRef: string): boolean {
  if (!typedRef || typeof typedRef !== 'string') {
    return false;
  }

  const match = typedRef.match(TYPED_REF_PATTERN);
  if (!match) {
    return false;
  }

  const [, domain] = match;
  const normalizedDomain = domain.toLowerCase();
  return VALID_DOMAINS.includes(normalizedDomain as typeof VALID_DOMAINS[number]);
}

/**
 * Validates a typed_ref string strictly, checking domain and entity_type.
 *
 * @param typedRef - The typed_ref string to validate
 * @returns Validation result with error message if invalid
 */
export function validateTypedRef(typedRef: string): { valid: boolean; error?: string } {
  if (!typedRef || typeof typedRef !== 'string') {
    return { valid: false, error: 'typed_ref is required and must be a string' };
  }

  const match = typedRef.match(TYPED_REF_PATTERN);
  if (!match) {
    return {
      valid: false,
      error: `typed_ref must match pattern <domain>:<entity_type>:<provider>:<entity_id>, got: ${typedRef}`,
    };
  }

  const [, domainRaw, entity_typeRaw, provider, entity_id] = match;
  const domain = domainRaw.toLowerCase();
  const entity_type = entity_typeRaw.toLowerCase();

  // Validate domain
  if (!VALID_DOMAINS.includes(domain as typeof VALID_DOMAINS[number])) {
    return {
      valid: false,
      error: `Invalid domain '${domain}'. Valid domains: ${VALID_DOMAINS.join(', ')}`,
    };
  }

  // Validate entity_type for domain
  const validEntityTypes = ENTITY_TYPES_BY_DOMAIN[domain];
  if (validEntityTypes && !validEntityTypes.includes(entity_type)) {
    return {
      valid: false,
      error: `Invalid entity_type '${entity_type}' for domain '${domain}'. Valid types: ${validEntityTypes.join(', ')}`,
    };
  }

  // Validate provider is not empty
  if (!provider) {
    return { valid: false, error: 'Provider segment cannot be empty' };
  }

  // Validate entity_id is not empty
  if (!entity_id) {
    return { valid: false, error: 'Entity ID segment cannot be empty' };
  }

  return { valid: true };
}

/**
 * Parses a typed_ref string into its components.
 *
 * @param typedRef - The typed_ref string to parse
 * @returns Parsed components or null if invalid
 */
export function parseTypedRef(typedRef: string): TypedRefComponents | null {
  const match = typedRef.match(TYPED_REF_PATTERN);
  if (!match) {
    return null;
  }

  const [, domain, entity_type, provider, entity_id] = match;
  return { domain, entity_type, provider, entity_id };
}

/**
 * Builds a typed_ref string from components.
 *
 * @param components - The typed_ref components
 * @returns The canonical typed_ref string
 */
export function buildTypedRef(components: TypedRefComponents): string {
  const { domain, entity_type, provider, entity_id } = components;
  return `${domain}:${entity_type}:${provider}:${entity_id}`;
}

/**
 * Normalizes a typed_ref to canonical form.
 * - Lowercases all segments
 * - Validates format
 *
 * @param typedRef - The typed_ref string to normalize
 * @returns Normalized typed_ref or null if invalid
 */
export function normalizeTypedRef(typedRef: string): string | null {
  const parsed = parseTypedRef(typedRef);
  if (!parsed) {
    return null;
  }

  // Validate domain is valid
  if (!VALID_DOMAINS.includes(parsed.domain.toLowerCase() as typeof VALID_DOMAINS[number])) {
    return null;
  }

  return buildTypedRef({
    domain: parsed.domain.toLowerCase(),
    entity_type: parsed.entity_type.toLowerCase(),
    provider: parsed.provider.toLowerCase(),
    entity_id: parsed.entity_id, // Keep entity_id case as-is
  });
}

/**
 * Checks if two typed_refs refer to the same entity (case-insensitive comparison).
 *
 * @param ref1 - First typed_ref
 * @param ref2 - Second typed_ref
 * @returns true if they refer to the same entity
 */
export function areTypedRefsEqual(ref1: string, ref2: string): boolean {
  const norm1 = normalizeTypedRef(ref1);
  const norm2 = normalizeTypedRef(ref2);

  if (!norm1 || !norm2) {
    return false;
  }

  return norm1 === norm2;
}

/**
 * Extracts the entity ID from a typed_ref.
 *
 * @param typedRef - The typed_ref string
 * @returns The entity ID or null if invalid
 */
export function getEntityId(typedRef: string): string | null {
  const parsed = parseTypedRef(typedRef);
  return parsed?.entity_id ?? null;
}

/**
 * Extracts the domain from a typed_ref.
 *
 * @param typedRef - The typed_ref string
 * @returns The domain or null if invalid
 */
export function getDomain(typedRef: string): string | null {
  const parsed = parseTypedRef(typedRef);
  return parsed?.domain ?? null;
}

/**
 * Creates a task typed_ref for agent-taskstate.
 *
 * @param provider - The provider (e.g., 'github', 'local')
 * @param taskId - The task ID
 * @returns The canonical typed_ref string
 */
export function createTaskTypedRef(provider: string, taskId: string): string {
  return buildTypedRef({
    domain: 'agent-taskstate',
    entity_type: 'task',
    provider,
    entity_id: taskId,
  });
}

/**
 * Creates an issue typed_ref for tracker-bridge.
 *
 * @param provider - The provider (e.g., 'github', 'jira')
 * @param issueId - The issue ID
 * @returns The canonical typed_ref string
 */
export function createIssueTypedRef(provider: string, issueId: string): string {
  return buildTypedRef({
    domain: 'tracker',
    entity_type: 'issue',
    provider,
    entity_id: issueId,
  });
}

/**
 * Generates a SHA-256 fingerprint for idempotency from typed_ref.
 *
 * @param typedRef - The typed_ref string
 * @returns SHA-256 fingerprint
 */
export async function typedRefFingerprint(typedRef: string): Promise<string> {
  const normalized = normalizeTypedRef(typedRef);
  if (!normalized) {
    throw new Error(`Cannot create fingerprint for invalid typed_ref: ${typedRef}`);
  }

  const encoder = new TextEncoder();
  const data = encoder.encode(normalized);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}