import { describe, it, expect, beforeEach } from 'vitest';
import {
  MemxResolver,
  InMemoryBackend,
  chunkMarkdown,
  estimateTokens,
  type Document,
  type DocumentChunk,
} from '../src/index.js';

describe('MemxResolver', () => {
  let resolver: MemxResolver;

  beforeEach(() => {
    resolver = new MemxResolver({ backend: new InMemoryBackend() });
  });

  describe('DocsService', () => {
    it('should ingest a document', async () => {
      const result = await resolver.docs.ingest({
        doc_type: 'spec',
        title: 'Test Document',
        version: '1.0.0',
        body: '# Test\n\nThis is a test document.',
      });

      expect(result.doc_id).toBeDefined();
      expect(result.version).toBe('1.0.0');
      expect(result.chunk_count).toBeGreaterThan(0);
      expect(result.status).toBe('ingested');
    });

    it('should resolve documents', async () => {
      await resolver.docs.ingest({
        doc_type: 'spec',
        title: 'Feature Spec',
        version: '1.0.0',
        body: 'Content',
        feature_keys: ['auth'],
      });

      const result = await resolver.docs.resolve({
        feature: 'auth',
      });

      expect(result.required).toBeDefined();
      expect(result.recommended).toBeDefined();
    });

    it('should get a document by ID', async () => {
      const ingested = await resolver.docs.ingest({
        doc_type: 'spec',
        title: 'Test',
        version: '1.0.0',
        body: 'Content',
      });

      const doc = await resolver.docs.getDocument(ingested.doc_id);
      expect(doc).toBeDefined();
      expect(doc?.title).toBe('Test');
    });

    it('should search documents', async () => {
      await resolver.docs.ingest({
        doc_type: 'spec',
        title: 'Authentication Guide',
        version: '1.0.0',
        body: 'How to authenticate users',
        tags: ['auth', 'security'],
      });

      const result = await resolver.docs.search({
        query: 'auth',
        tags: ['auth'],
      });

      expect(result.results).toBeDefined();
      expect(result.results.length).toBeGreaterThan(0);
    });
  });

  describe('ChunksService', () => {
    it('should get chunks for a document', async () => {
      const ingested = await resolver.docs.ingest({
        doc_type: 'spec',
        title: 'Test',
        version: '1.0.0',
        body: '# Section 1\n\nContent 1\n\n# Section 2\n\nContent 2',
      });

      const result = await resolver.chunks.get({
        doc_id: ingested.doc_id,
      });

      expect(result.chunks).toBeDefined();
      expect(result.chunks.length).toBeGreaterThan(0);
    });

    it('should get specific chunks by ID', async () => {
      const ingested = await resolver.docs.ingest({
        doc_type: 'spec',
        title: 'Test',
        version: '1.0.0',
        body: '# Test\n\nContent',
      });

      const allChunks = await resolver.chunks.get({ doc_id: ingested.doc_id });
      const chunkIds = allChunks.chunks.map(c => c.chunk_id);

      const result = await resolver.chunks.get({ chunk_ids: chunkIds });
      expect(result.chunks.length).toBe(chunkIds.length);
    });
  });

  describe('ReadsService', () => {
    it('should acknowledge a read', async () => {
      const ingested = await resolver.docs.ingest({
        doc_type: 'spec',
        title: 'Test',
        version: '1.0.0',
        body: 'Content',
      });

      const result = await resolver.reads.ack({
        task_id: 'task-1',
        doc_id: ingested.doc_id,
        version: '1.0.0',
      });

      expect(result.status).toBe('acknowledged');
      expect(result.task_id).toBe('task-1');
    });

    it('should detect stale documents', async () => {
      // First ingest and ack
      const ingested = await resolver.docs.ingest({
        doc_type: 'spec',
        title: 'Test',
        version: '1.0.0',
        body: 'Content',
      });

      await resolver.reads.ack({
        task_id: 'task-1',
        doc_id: ingested.doc_id,
        version: '1.0.0',
      });

      // Update the document (new version)
      await resolver.docs.ingest({
        doc_type: 'spec',
        title: 'Test',
        version: '2.0.0',
        body: 'Updated content',
      });

      // Check for stale
      const staleCheck = await resolver.reads.staleCheck({
        task_id: 'task-1',
      });

      expect(staleCheck.status).toBe('stale');
      expect(staleCheck.stale_reasons.length).toBeGreaterThan(0);
    });

    it('should return fresh when no updates', async () => {
      const ingested = await resolver.docs.ingest({
        doc_type: 'spec',
        title: 'Test',
        version: '1.0.0',
        body: 'Content',
      });

      await resolver.reads.ack({
        task_id: 'task-2',
        doc_id: ingested.doc_id,
        version: '1.0.0',
      });

      const staleCheck = await resolver.reads.staleCheck({
        task_id: 'task-2',
      });

      expect(staleCheck.status).toBe('fresh');
    });
  });

  describe('ContractsService', () => {
    it('should resolve contracts', async () => {
      const result = await resolver.contracts.resolve({
        feature: 'test-feature',
      });

      expect(result.feature).toBe('test-feature');
    });
  });
});

describe('Markdown Chunker', () => {
  it('should chunk markdown by headings', () => {
    const markdown = `# Title

Intro paragraph.

## Section 1

Content for section 1.

## Section 2

Content for section 2.`;

    const chunks = chunkMarkdown('doc-1', markdown);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].body).toBeDefined();
  });

  it('should estimate tokens correctly', () => {
    const text = 'This is a test sentence.';
    const tokens = estimateTokens(text);

    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBeLessThan(text.length);
  });

  it('should chunk fixed mode', () => {
    const markdown = 'A'.repeat(1000);
    const chunks = chunkMarkdown('doc-1', markdown, { mode: 'fixed', maxChars: 100 });

    // Verify chunks are created
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[0].doc_id).toBe('doc-1');
  });
});

describe('InMemoryBackend', () => {
  let backend: InMemoryBackend;

  beforeEach(() => {
    backend = new InMemoryBackend();
  });

  it('should store and retrieve documents', async () => {
    const doc: Document = {
      doc_id: 'doc-1',
      doc_type: 'spec',
      title: 'Test',
      version: '1.0.0',
      updated_at: new Date().toISOString(),
    };

    await backend.setDocument(doc);
    const retrieved = await backend.getDocument('doc-1');
    expect(retrieved).toEqual(doc);
  });

  it('should store and retrieve chunks', async () => {
    const chunk: DocumentChunk = {
      chunk_id: 'chunk-1',
      doc_id: 'doc-1',
      ordinal: 1,
      body: 'Test content',
    };

    await backend.setChunks('doc-1', [chunk]);
    const retrieved = await backend.getChunk('chunk-1');
    expect(retrieved).toEqual(chunk);
  });

  it('should return null for non-existent document', async () => {
    const doc = await backend.getDocument('non-existent');
    expect(doc).toBeNull();
  });

  it('should list chunks by document', async () => {
    await backend.setChunks('doc-1', [
      {
        chunk_id: 'chunk-1',
        doc_id: 'doc-1',
        ordinal: 1,
        body: 'Content 1',
      },
      {
        chunk_id: 'chunk-2',
        doc_id: 'doc-1',
        ordinal: 2,
        body: 'Content 2',
      },
    ]);

    const chunks = await backend.getChunksByDocId('doc-1');
    expect(chunks).toHaveLength(2);
  });
});