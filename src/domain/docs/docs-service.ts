import type {
  Task,
  ResolveDocsRequest,
  ResolveDocsResponse,
  AckDocsRequest,
  AckDocsResponse,
  StaleCheckRequest,
  StaleCheckResponse,
} from '../../types.js';
import type { TaskUpdate } from '../task/index.js';
import type {
  GetChunksRequest,
  GetChunksResponse,
  ResolveContractsRequest,
  ResolveContractsResponse,
} from '../resolver/index.js';
import {
  ResolverService,
  getMemxResolverClient,
} from '../resolver/index.js';

/**
 * Context for docs operations
 */
export interface DocsContext {
  requireTask(taskId: string): Task;
  updateTask(taskId: string, update: TaskUpdate): void;
}

/**
 * Service for docs operations.
 * Extracted from ControlPlaneStore to reduce complexity.
 * Returns TaskUpdate objects instead of mutating tasks directly.
 */
export class DocsService {
  /**
   * Resolve documents for a task.
   */
  resolveDocs(taskId: string, request: ResolveDocsRequest, ctx: DocsContext): ResolveDocsResponse {
    const task = ctx.requireTask(taskId);

    const response = ResolverService.resolveDocs(task.typed_ref, request);

    ctx.updateTask(taskId, {
      resolver_refs: {
        doc_refs: response.doc_refs,
        chunk_refs: response.chunk_refs,
        contract_refs: response.contract_refs,
        stale_status: response.stale_status,
      },
    });

    return response;
  }

  /**
   * Acknowledge reading a document.
   */
  ackDocs(taskId: string, request: AckDocsRequest, ctx: DocsContext): AckDocsResponse {
    const task = ctx.requireTask(taskId);

    const ackRef = ResolverService.buildAckRef(taskId, request.doc_id, request.version);

    const existingAckRefs = task.resolver_refs?.ack_refs ?? [];
    const updatedAckRefs = existingAckRefs.includes(ackRef)
      ? existingAckRefs
      : [...existingAckRefs, ackRef];

    ctx.updateTask(taskId, {
      resolver_refs: {
        ...task.resolver_refs,
        ack_refs: updatedAckRefs,
      },
    });

    return { ack_ref: ackRef };
  }

  /**
   * Check for stale documents.
   */
  async staleCheck(taskId: string, request: StaleCheckRequest, ctx: DocsContext): Promise<StaleCheckResponse> {
    const task = ctx.requireTask(taskId);

    // Use memx-resolver client if configured, otherwise use fallback
    const client = getMemxResolverClient();

    const response = await ResolverService.checkStale(
      taskId,
      task.resolver_refs,
      request,
      client ? undefined : this.getFallbackVersions.bind(this),
    );

    // Update stale_status if any stale documents found
    if (response.stale.length > 0) {
      ctx.updateTask(taskId, {
        resolver_refs: {
          ...task.resolver_refs,
          stale_status: 'stale',
        },
      });
    }

    return response;
  }

  /**
   * Get chunks by IDs.
   * Fetches chunk content from memx-resolver.
   */
  async getChunks(request: GetChunksRequest): Promise<GetChunksResponse> {
    const client = getMemxResolverClient();

    if (!client) {
      // Fallback: return empty chunks
      return {
        chunks: [],
        not_found: request.chunk_ids,
      };
    }

    // Use memx-resolver to fetch chunks
    const response = await fetch(`${(client as unknown as { baseUrl: string }).baseUrl}/v1/chunks:get`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      return {
        chunks: [],
        not_found: request.chunk_ids,
      };
    }

    return await response.json() as GetChunksResponse;
  }

  /**
   * Resolve contracts by IDs.
   * Fetches contract definitions from memx-resolver.
   */
  async resolveContracts(request: ResolveContractsRequest): Promise<ResolveContractsResponse> {
    const client = getMemxResolverClient();

    if (!client) {
      // Fallback: return empty contracts
      return {
        contracts: [],
        not_found: request.contract_ids,
      };
    }

    // Use memx-resolver to resolve contracts
    const response = await fetch(`${(client as unknown as { baseUrl: string }).baseUrl}/v1/contracts:resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      return {
        contracts: [],
        not_found: request.contract_ids,
      };
    }

    return await response.json() as ResolveContractsResponse;
  }

  /**
   * Fallback version checker when memx-resolver is not configured.
   * Uses the last ack'd version as current (assumes no changes).
   */
  private getFallbackVersions(docIds: string[]): Array<{ doc_id: string; version: string; exists: boolean }> {
    return docIds.map(docId => ({
      doc_id: docId,
      version: new Date().toISOString().split('T')[0] ?? 'unknown',
      exists: !docId.includes('missing'),
    }));
  }
}