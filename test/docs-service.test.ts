import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { DocsService, type DocsContext } from '../src/domain/docs/docs-service.js';
import type { Task, ResolveDocsRequest, AckDocsRequest, StaleCheckRequest } from '../src/types.js';
import { ResolverService, getMemxResolverClient, getResolver } from '../src/domain/resolver/index.js';

// Mock the resolver module
vi.mock('../src/domain/resolver/index.js', () => ({
  ResolverService: {
    resolveDocs: vi.fn(),
    buildAckRef: vi.fn(),
    checkStale: vi.fn(),
  },
  getMemxResolverClient: vi.fn().mockReturnValue(null),
  getResolver: vi.fn().mockReturnValue({
    chunks: {
      get: vi.fn().mockResolvedValue({ chunks: [] }),
    },
    contracts: {
      resolve: vi.fn().mockResolvedValue({ contracts: [] }),
    },
  }),
}));

describe('DocsService', () => {
  let service: DocsService;
  let mockContext: DocsContext;
  let mockTask: Task;

  beforeEach(() => {
    vi.clearAllMocks();

    // Set up default mock implementations
    vi.mocked(ResolverService.resolveDocs).mockReturnValue({
      doc_refs: ['doc_1', 'doc_2'],
      chunk_refs: ['chunk_1'],
      contract_refs: ['contract_1'],
      stale_status: 'fresh',
    });
    vi.mocked(ResolverService.buildAckRef).mockImplementation((taskId, docId, version) => `ack:${taskId}:${docId}:${version}`);
    vi.mocked(ResolverService.checkStale).mockResolvedValue({
      fresh: ['doc_1'],
      stale: [],
      unknown: [],
    });

    service = new DocsService();

    mockTask = {
      task_id: 'task_123',
      typed_ref: 'agent-taskstate:task:test:123',
      state: 'planning',
      resolver_refs: {
        doc_refs: ['doc_1'],
        chunk_refs: [],
        contract_refs: [],
        ack_refs: ['ack:task_123:doc_0:v1'],
      },
    } as any;

    mockContext = {
      requireTask: vi.fn().mockReturnValue(mockTask),
      updateTask: vi.fn(),
    };
  });

  describe('resolveDocs', () => {
    it('should resolve documents for a task', () => {
      const request: ResolveDocsRequest = {
        doc_ids: ['doc_1', 'doc_2'],
        include_chunks: true,
      };

      const result = service.resolveDocs('task_123', request, mockContext);

      expect(result.doc_refs).toEqual(['doc_1', 'doc_2']);
      expect(result.chunk_refs).toEqual(['chunk_1']);
      expect(result.contract_refs).toEqual(['contract_1']);
      expect(result.stale_status).toBe('fresh');
    });

    it('should update task with resolver refs', () => {
      const request: ResolveDocsRequest = {
        doc_ids: ['doc_1'],
      };

      service.resolveDocs('task_123', request, mockContext);

      expect(mockContext.updateTask).toHaveBeenCalledWith(
        'task_123',
        expect.objectContaining({
          resolver_refs: expect.objectContaining({
            doc_refs: ['doc_1', 'doc_2'],
            stale_status: 'fresh',
          }),
        })
      );
    });

    it('should require task from context', () => {
      service.resolveDocs('task_123', { doc_ids: [] }, mockContext);

      expect(mockContext.requireTask).toHaveBeenCalledWith('task_123');
    });
  });

  describe('ackDocs', () => {
    it('should acknowledge reading a document', () => {
      const request: AckDocsRequest = {
        doc_id: 'doc_1',
        version: 'v2',
      };

      const result = service.ackDocs('task_123', request, mockContext);

      expect(result.ack_ref).toBe('ack:task_123:doc_1:v2');
    });

    it('should add ack ref to existing refs', () => {
      const request: AckDocsRequest = {
        doc_id: 'doc_1',
        version: 'v2',
      };

      service.ackDocs('task_123', request, mockContext);

      expect(mockContext.updateTask).toHaveBeenCalledWith(
        'task_123',
        expect.objectContaining({
          resolver_refs: expect.objectContaining({
            ack_refs: expect.arrayContaining(['ack:task_123:doc_0:v1', 'ack:task_123:doc_1:v2']),
          }),
        })
      );
    });

    it('should not duplicate existing ack refs', () => {
      const request: AckDocsRequest = {
        doc_id: 'doc_0',
        version: 'v1',
      };

      service.ackDocs('task_123', request, mockContext);

      const updateCall = vi.mocked(mockContext.updateTask).mock.calls[0];
      const ackRefs = updateCall[1].resolver_refs?.ack_refs;

      expect(ackRefs).toHaveLength(1);
      expect(ackRefs).toContain('ack:task_123:doc_0:v1');
    });

    it('should handle task without existing ack refs', () => {
      mockTask.resolver_refs = undefined;

      const request: AckDocsRequest = {
        doc_id: 'doc_1',
        version: 'v1',
      };

      const result = service.ackDocs('task_123', request, mockContext);

      expect(result.ack_ref).toBe('ack:task_123:doc_1:v1');
    });
  });

  describe('staleCheck', () => {
    it('should check for stale documents', async () => {
      const request: StaleCheckRequest = {
        doc_ids: ['doc_1'],
      };

      const result = await service.staleCheck('task_123', request, mockContext);

      expect(result.fresh).toEqual(['doc_1']);
      expect(result.stale).toEqual([]);
    });

    it('should update task when stale documents found', async () => {
      vi.mocked(ResolverService.checkStale).mockResolvedValueOnce({
        fresh: [],
        stale: ['doc_1'],
        unknown: [],
      });

      const request: StaleCheckRequest = {
        doc_ids: ['doc_1'],
      };

      await service.staleCheck('task_123', request, mockContext);

      expect(mockContext.updateTask).toHaveBeenCalledWith(
        'task_123',
        expect.objectContaining({
          resolver_refs: expect.objectContaining({
            stale_status: 'stale',
          }),
        })
      );
    });

    it('should not update task when no stale documents', async () => {
      const request: StaleCheckRequest = {
        doc_ids: ['doc_1'],
      };

      mockContext.updateTask.mockClear();

      await service.staleCheck('task_123', request, mockContext);

      expect(mockContext.updateTask).not.toHaveBeenCalled();
    });
  });

  describe('getChunks', () => {
    it('should get chunks by IDs', async () => {
      const result = await service.getChunks({ chunk_ids: ['chunk_1', 'chunk_2'] });

      expect(result).toEqual({ chunks: [] });
    });
  });

  describe('resolveContracts', () => {
    it('should resolve contracts', async () => {
      const result = await service.resolveContracts({ contract_ids: ['contract_1'] });

      expect(result).toEqual({ contracts: [] });
    });
  });
});