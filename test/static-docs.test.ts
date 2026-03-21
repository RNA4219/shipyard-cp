import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadStaticDocs } from '../src/domain/static-docs.js';

describe('StaticDocs', () => {
  const testDir = join(tmpdir(), `static-docs-test-${Date.now()}`);
  const docsDir = join(testDir, 'docs');
  const schemasDir = join(docsDir, 'schemas');

  beforeAll(() => {
    // Create test directory structure
    mkdirSync(schemasDir, { recursive: true });

    // Create mock files
    writeFileSync(join(docsDir, 'openapi.yaml'), 'openapi: 3.0.0\ninfo:\n  title: Test API\n  version: 1.0.0');
    writeFileSync(join(schemasDir, 'task.schema.json'), '{"$schema": "http://json-schema.org/draft-07/schema#", "type": "object"}');
    writeFileSync(join(schemasDir, 'worker-job.schema.json'), '{"$schema": "http://json-schema.org/draft-07/schema#", "type": "object"}');
    writeFileSync(join(schemasDir, 'worker-result.schema.json'), '{"$schema": "http://json-schema.org/draft-07/schema#", "type": "object"}');
    writeFileSync(join(schemasDir, 'state-transition-event.schema.json'), '{"$schema": "http://json-schema.org/draft-07/schema#", "type": "object"}');
  });

  afterAll(() => {
    // Clean up test directory
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('loadStaticDocs', () => {
    it('should load openapi.yaml content', () => {
      const docs = loadStaticDocs(testDir);

      expect(docs.openapi).toContain('openapi: 3.0.0');
      expect(docs.openapi).toContain('Test API');
    });

    it('should load all schema files', () => {
      const docs = loadStaticDocs(testDir);

      expect(docs.schemas).toHaveProperty('task');
      expect(docs.schemas).toHaveProperty('workerJob');
      expect(docs.schemas).toHaveProperty('workerResult');
      expect(docs.schemas).toHaveProperty('stateTransitionEvent');
    });

    it('should load valid JSON schema content', () => {
      const docs = loadStaticDocs(testDir);

      // Verify the content is valid JSON
      const taskSchema = JSON.parse(docs.schemas.task);
      expect(taskSchema).toHaveProperty('$schema');
      expect(taskSchema).toHaveProperty('type', 'object');
    });

    it('should load all schemas with correct content', () => {
      const docs = loadStaticDocs(testDir);

      // All schemas should be non-empty strings
      for (const [name, content] of Object.entries(docs.schemas)) {
        expect(typeof content).toBe('string');
        expect(content.length).toBeGreaterThan(0);
        expect(() => JSON.parse(content)).not.toThrow();
      }
    });
  });
});