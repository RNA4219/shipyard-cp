import { describe, it, expect } from 'vitest';
import {
  TYPED_REF_PATTERN,
  VALID_DOMAINS,
  isValidTypedRef,
  validateTypedRef,
  parseTypedRef,
  buildTypedRef,
  normalizeTypedRef,
  areTypedRefsEqual,
  getEntityId,
  getDomain,
  createTaskTypedRef,
  createIssueTypedRef,
  typedRefFingerprint,
} from '../src/domain/typed-ref/typed-ref-utils.js';

describe('typed_ref Utilities', () => {
  describe('TYPED_REF_PATTERN', () => {
    it('should match valid 4-segment typed_ref', () => {
      const match = 'agent-taskstate:task:github:issue-123'.match(TYPED_REF_PATTERN);
      expect(match).not.toBeNull();
      expect(match?.[1]).toBe('agent-taskstate');
      expect(match?.[2]).toBe('task');
      expect(match?.[3]).toBe('github');
      expect(match?.[4]).toBe('issue-123');
    });

    it('should match with underscores and hyphens', () => {
      expect('memx:evidence:local:ev_01JABC-DEF'.match(TYPED_REF_PATTERN)).not.toBeNull();
    });

    it('should not match 3-segment format', () => {
      expect('agent-taskstate:task:github'.match(TYPED_REF_PATTERN)).toBeNull();
    });

    it('should match with uppercase domain', () => {
      expect('Agent-Taskstate:task:github:123'.match(TYPED_REF_PATTERN)).not.toBeNull();
    });
  });

  describe('isValidTypedRef', () => {
    it('should return true for valid typed_refs', () => {
      expect(isValidTypedRef('agent-taskstate:task:github:issue-456')).toBe(true);
      expect(isValidTypedRef('agent-taskstate:task:local:task_01JABCDEF')).toBe(true);
      expect(isValidTypedRef('memx:evidence:local:ev_01JABCDEF')).toBe(true);
      expect(isValidTypedRef('tracker:issue:github:RNA4219/agent-taskstate#12')).toBe(true);
    });

    it('should return false for invalid formats', () => {
      expect(isValidTypedRef('invalid-format')).toBe(false);
      expect(isValidTypedRef('task:github:123')).toBe(false);
      expect(isValidTypedRef('')).toBe(false);
      expect(isValidTypedRef('unknown:task:github:123')).toBe(false);
    });

    it('should return false for non-string inputs', () => {
      expect(isValidTypedRef(null as unknown as string)).toBe(false);
      expect(isValidTypedRef(undefined as unknown as string)).toBe(false);
      expect(isValidTypedRef(123 as unknown as string)).toBe(false);
    });
  });

  describe('validateTypedRef', () => {
    it('should return valid for correct typed_refs', () => {
      const result = validateTypedRef('agent-taskstate:task:github:issue-123');
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should return error for missing typed_ref', () => {
      const result = validateTypedRef('');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('required');
    });

    it('should return error for invalid format', () => {
      const result = validateTypedRef('invalid');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('pattern');
    });

    it('should return error for invalid domain', () => {
      const result = validateTypedRef('unknown:task:github:123');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid domain');
    });
  });

  describe('parseTypedRef', () => {
    it('should parse valid typed_ref into components', () => {
      const parsed = parseTypedRef('agent-taskstate:task:github:issue-123');
      expect(parsed).toEqual({
        domain: 'agent-taskstate',
        entity_type: 'task',
        provider: 'github',
        entity_id: 'issue-123',
      });
    });

    it('should return null for invalid typed_ref', () => {
      expect(parseTypedRef('invalid')).toBeNull();
      expect(parseTypedRef('')).toBeNull();
    });

    it('should preserve entity_id with special characters', () => {
      const parsed = parseTypedRef('tracker:issue:github:RNA4219/repo#123');
      expect(parsed?.entity_id).toBe('RNA4219/repo#123');
    });
  });

  describe('buildTypedRef', () => {
    it('should build typed_ref from components', () => {
      const ref = buildTypedRef({
        domain: 'agent-taskstate',
        entity_type: 'task',
        provider: 'github',
        entity_id: 'issue-123',
      });
      expect(ref).toBe('agent-taskstate:task:github:issue-123');
    });
  });

  describe('normalizeTypedRef', () => {
    it('should lowercase segments except entity_id', () => {
      const normalized = normalizeTypedRef('Agent-Taskstate:TASK:GitHub:Issue-123');
      expect(normalized).toBe('agent-taskstate:task:github:Issue-123');
    });

    it('should return null for invalid typed_ref', () => {
      expect(normalizeTypedRef('invalid')).toBeNull();
    });
  });

  describe('areTypedRefsEqual', () => {
    it('should return true for identical refs', () => {
      expect(areTypedRefsEqual(
        'agent-taskstate:task:github:issue-123',
        'agent-taskstate:task:github:issue-123'
      )).toBe(true);
    });

    it('should return true for case-different refs', () => {
      expect(areTypedRefsEqual(
        'Agent-Taskstate:Task:GitHub:Issue-123',
        'agent-taskstate:task:github:Issue-123'
      )).toBe(true);
    });

    it('should return false for different entity_ids', () => {
      expect(areTypedRefsEqual(
        'agent-taskstate:task:github:issue-123',
        'agent-taskstate:task:github:issue-456'
      )).toBe(false);
    });

    it('should return false for invalid refs', () => {
      expect(areTypedRefsEqual('invalid', 'also-invalid')).toBe(false);
    });
  });

  describe('getEntityId', () => {
    it('should extract entity_id', () => {
      expect(getEntityId('agent-taskstate:task:github:issue-123')).toBe('issue-123');
      expect(getEntityId('tracker:issue:jira:PROJ-456')).toBe('PROJ-456');
    });

    it('should return null for invalid typed_ref', () => {
      expect(getEntityId('invalid')).toBeNull();
    });
  });

  describe('getDomain', () => {
    it('should extract domain', () => {
      expect(getDomain('agent-taskstate:task:github:issue-123')).toBe('agent-taskstate');
      expect(getDomain('memx:evidence:local:ev-123')).toBe('memx');
    });

    it('should return null for invalid typed_ref', () => {
      expect(getDomain('invalid')).toBeNull();
    });
  });

  describe('createTaskTypedRef', () => {
    it('should create agent-taskstate task typed_ref', () => {
      const ref = createTaskTypedRef('github', 'task-123');
      expect(ref).toBe('agent-taskstate:task:github:task-123');
    });

    it('should create with local provider', () => {
      const ref = createTaskTypedRef('local', 'task_01JABCDEF');
      expect(ref).toBe('agent-taskstate:task:local:task_01JABCDEF');
    });
  });

  describe('createIssueTypedRef', () => {
    it('should create tracker issue typed_ref', () => {
      const ref = createIssueTypedRef('github', 'issue-123');
      expect(ref).toBe('tracker:issue:github:issue-123');
    });

    it('should create with jira provider', () => {
      const ref = createIssueTypedRef('jira', 'PROJ-456');
      expect(ref).toBe('tracker:issue:jira:PROJ-456');
    });
  });

  describe('typedRefFingerprint', () => {
    it('should generate consistent SHA-256 fingerprint', async () => {
      const fp1 = await typedRefFingerprint('agent-taskstate:task:github:issue-123');
      const fp2 = await typedRefFingerprint('agent-taskstate:task:github:issue-123');

      expect(fp1).toBe(fp2);
      expect(fp1).toHaveLength(64); // SHA-256 hex string
      expect(fp1).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should generate same fingerprint for case-different refs', async () => {
      const fp1 = await typedRefFingerprint('agent-taskstate:task:github:issue-123');
      const fp2 = await typedRefFingerprint('Agent-Taskstate:Task:GitHub:issue-123');

      expect(fp1).toBe(fp2);
    });

    it('should generate different fingerprints for different refs', async () => {
      const fp1 = await typedRefFingerprint('agent-taskstate:task:github:issue-123');
      const fp2 = await typedRefFingerprint('agent-taskstate:task:github:issue-456');

      expect(fp1).not.toBe(fp2);
    });

    it('should throw for invalid typed_ref', async () => {
      await expect(typedRefFingerprint('invalid')).rejects.toThrow('invalid typed_ref');
    });
  });

  describe('VALID_DOMAINS', () => {
    it('should contain expected domains', () => {
      expect(VALID_DOMAINS).toContain('agent-taskstate');
      expect(VALID_DOMAINS).toContain('memx');
      expect(VALID_DOMAINS).toContain('tracker');
      expect(VALID_DOMAINS).toContain('shipyard');
    });
  });

  describe('Round-trip', () => {
    it('should be identity for parse -> build', () => {
      const original = 'agent-taskstate:task:github:issue-123';
      const parsed = parseTypedRef(original);
      const rebuilt = parsed ? buildTypedRef(parsed) : null;

      expect(rebuilt).toBe(original);
    });

    it('should be identity for parse -> build with complex entity_id', () => {
      const original = 'tracker:issue:github:RNA4219/agent-taskstate#12';
      const parsed = parseTypedRef(original);
      const rebuilt = parsed ? buildTypedRef(parsed) : null;

      expect(rebuilt).toBe(original);
    });
  });
});