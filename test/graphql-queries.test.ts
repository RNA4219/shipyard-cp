import { describe, it, expect } from 'vitest';
import { QUERIES, MUTATIONS } from '../src/domain/github-projects/graphql-queries.js';

describe('GraphQL Queries', () => {
  describe('QUERIES', () => {
    it('should have getProject query', () => {
      expect(QUERIES.getProject).toBeDefined();
      expect(QUERIES.getProject).toContain('query($owner: String!, $number: Int!)');
      expect(QUERIES.getProject).toContain('projectV2');
    });

    it('should have getProjectItem query', () => {
      expect(QUERIES.getProjectItem).toBeDefined();
      expect(QUERIES.getProjectItem).toContain('query($projectId: ID!, $itemId: ID!)');
    });

    it('should query all required fields', () => {
      // Verify essential fields are queried
      expect(QUERIES.getProject).toContain('id');
      expect(QUERIES.getProject).toContain('title');
      expect(QUERIES.getProject).toContain('fields');
    });
  });

  describe('MUTATIONS', () => {
    it('should have addDraftIssue mutation', () => {
      expect(MUTATIONS.addDraftIssue).toBeDefined();
      expect(MUTATIONS.addDraftIssue).toContain('mutation($projectId: ID!');
    });

    it('should have addProjectItem mutation', () => {
      expect(MUTATIONS.addProjectItem).toBeDefined();
      expect(MUTATIONS.addProjectItem).toContain('addProjectV2ItemById');
    });

    it('should have updateTextField mutation', () => {
      expect(MUTATIONS.updateTextField).toBeDefined();
      expect(MUTATIONS.updateTextField).toContain('updateProjectV2ItemFieldValue');
    });

    it('should have updateNumberField mutation', () => {
      expect(MUTATIONS.updateNumberField).toBeDefined();
      expect(MUTATIONS.updateNumberField).toContain('number: $value');
    });

    it('should have updateDateField mutation', () => {
      expect(MUTATIONS.updateDateField).toBeDefined();
      expect(MUTATIONS.updateDateField).toContain('date: $value');
    });

    it('should have updateSingleSelectField mutation', () => {
      expect(MUTATIONS.updateSingleSelectField).toBeDefined();
      expect(MUTATIONS.updateSingleSelectField).toContain('singleSelectOptionId');
    });

    it('should have updateIterationField mutation', () => {
      expect(MUTATIONS.updateIterationField).toBeDefined();
      expect(MUTATIONS.updateIterationField).toContain('iterationId');
    });

    it('should have deleteItem mutation', () => {
      expect(MUTATIONS.deleteItem).toBeDefined();
      expect(MUTATIONS.deleteItem).toContain('deleteProjectV2Item');
    });
  });

  describe('Query Structure', () => {
    it('all queries should be valid GraphQL strings', () => {
      for (const [name, query] of Object.entries(QUERIES)) {
        expect(typeof query).toBe('string');
        expect(query.trim().length).toBeGreaterThan(0);
        expect(query).toContain('query');
      }
    });

    it('all mutations should be valid GraphQL strings', () => {
      for (const [name, mutation] of Object.entries(MUTATIONS)) {
        expect(typeof mutation).toBe('string');
        expect(mutation.trim().length).toBeGreaterThan(0);
        expect(mutation).toContain('mutation');
      }
    });
  });
});