import type { ResolveDocsRequest, ResolveDocsResponse, StaleCheckRequest, StaleCheckResponse, StaleDocItem, ResolverRefs } from '../../types.js';
import {
  MemxResolver,
  InMemoryBackend,
  RedisBackend,
  type StoreBackend,
  type GetChunksRequest,
  type GetChunksResponse,
  type ResolveContractsRequest,
  type ResolveContractsResponse,
  type DocumentChunk,
  type Contract,
} from 'memx-resolver-js';

// Re-export types for backwards compatibility
export type { GetChunksRequest, GetChunksResponse, ResolveContractsRequest, ResolveContractsResponse };

export interface DocVersionInfo {
  doc_id: string;
  version: string;
  exists: boolean;
}

/** memx-resolver configuration */
export interface MemxResolverConfig {
  backend?: StoreBackend;
  redisUrl?: string;
  redisKeyPrefix?: string;
}

/** Global resolver instance */
let resolver: MemxResolver | null = null;

/**
 * Initialize the resolver with configuration
 */
export function initResolver(config: MemxResolverConfig = {}): MemxResolver {
  if (resolver) {
    return resolver;
  }

  let backend: StoreBackend;

  if (config.backend) {
    backend = config.backend;
  } else if (config.redisUrl) {
    backend = new RedisBackend({
      url: config.redisUrl,
      keyPrefix: config.redisKeyPrefix ?? 'memx-resolver:',
    });
  } else {
    backend = new InMemoryBackend();
  }

  resolver = new MemxResolver({ backend });
  return resolver;
}

/**
 * Get the resolver instance
 */
export function getResolver(): MemxResolver {
  if (!resolver) {
    return initResolver();
  }
  return resolver;
}

/**
 * Configure the resolver (for backwards compatibility)
 */
export function configureMemxResolver(_config: { baseUrl: string; timeoutMs?: number }): void {
  // Initialize with in-memory backend for backwards compatibility
  initResolver();
}

/**
 * Get the memx-resolver client (for backwards compatibility)
 */
export function getMemxResolverClient(): { getDocVersions: (docIds: string[]) => Promise<DocVersionInfo[]> } | null {
  const r = getResolver();
  return {
    getDocVersions: async (docIds: string[]) => {
      return r.docs.getVersions(docIds);
    },
  };
}

export class ResolverService {
  static resolveDocs(typedRef: string, request: ResolveDocsRequest): ResolveDocsResponse {
    const docRefs: string[] = [];
    const chunkRefs: string[] = [];
    const contractRefs: string[] = [];

    if (request.feature) {
      docRefs.push(`doc:feature:${request.feature}`);
      chunkRefs.push(`chunk:feature:${request.feature}:1`);
    }
    if (request.topic) {
      docRefs.push(`doc:topic:${request.topic}`);
    }
    if (request.task_seed) {
      docRefs.push(`doc:task:${request.task_seed}`);
    }

    // Default docs if no specific request
    if (docRefs.length === 0) {
      docRefs.push('doc:workflow-cookbook:blueprint');
    }

    return {
      typed_ref: typedRef,
      doc_refs: docRefs,
      chunk_refs: chunkRefs,
      contract_refs: contractRefs,
      stale_status: 'fresh',
    };
  }

  static buildAckRef(taskId: string, docId: string, version: string): string {
    return `ack:${taskId}:${docId}:${version}`;
  }

  /**
   * Check for stale documents by comparing acknowledged versions with current versions.
   */
  static async checkStale(
    taskId: string,
    resolverRefs: ResolverRefs | undefined,
    request: StaleCheckRequest,
    getCurrentVersions?: (docIds: string[]) => DocVersionInfo[] | Promise<DocVersionInfo[]>,
  ): Promise<StaleCheckResponse> {
    const staleItems: StaleDocItem[] = [];

    // If no resolver refs, nothing to check
    if (!resolverRefs?.ack_refs?.length) {
      return { task_id: taskId, stale: [] };
    }

    // Parse ack_refs to get previous versions
    const ackedDocs = this.parseAckRefs(resolverRefs.ack_refs);

    // Determine which docs to check
    const docIdsToCheck = request.doc_ids ?? Object.keys(ackedDocs);

    // Get current versions
    let currentVersions: DocVersionInfo[];

    if (getCurrentVersions) {
      currentVersions = await getCurrentVersions(docIdsToCheck);
    } else {
      const r = getResolver();
      currentVersions = await r.docs.getVersions(docIdsToCheck);
    }

    const currentVersionMap = new Map(currentVersions.map(v => [v.doc_id, v]));

    const detectedAt = new Date().toISOString();

    for (const docId of docIdsToCheck) {
      const current = currentVersionMap.get(docId);
      const previous = ackedDocs[docId];

      if (!current || !current.exists) {
        staleItems.push({
          task_id: taskId,
          doc_id: docId,
          previous_version: previous?.version ?? 'unknown',
          current_version: 'missing',
          reason: 'document_missing',
          detected_at: detectedAt,
        });
        continue;
      }

      if (previous && current.version !== previous.version) {
        staleItems.push({
          task_id: taskId,
          doc_id: docId,
          previous_version: previous.version,
          current_version: current.version,
          reason: 'version_mismatch',
          detected_at: detectedAt,
        });
      }
    }

    return { task_id: taskId, stale: staleItems };
  }

  private static parseAckRefs(ackRefs: string[]): Record<string, { version: string }> {
    const result: Record<string, { version: string }> = {};

    for (const ackRef of ackRefs) {
      const parsed = this.parseAckRef(ackRef);
      if (parsed) {
        result[parsed.docId] = { version: parsed.version };
      }
    }

    return result;
  }

  private static parseAckRef(ackRef: string): { taskId: string; docId: string; version: string } | null {
    const prefix = 'ack:';
    if (!ackRef.startsWith(prefix)) {
      return null;
    }

    const rest = ackRef.slice(prefix.length);
    const firstColon = rest.indexOf(':');
    if (firstColon === -1) {
      return null;
    }

    const taskId = rest.slice(0, firstColon);
    const afterTaskId = rest.slice(firstColon + 1);

    const lastColon = afterTaskId.lastIndexOf(':');
    if (lastColon === -1) {
      return null;
    }

    const docId = afterTaskId.slice(0, lastColon);
    const version = afterTaskId.slice(lastColon + 1);

    return { taskId, docId, version };
  }

  /**
   * Get chunks by IDs from memx-resolver.
   */
  static async getChunks(
    request: { chunk_ids: string[]; include_metadata?: boolean },
    fetchChunks?: (chunkIds: string[]) => Promise<DocumentChunk[]>,
  ): Promise<{ chunks: DocumentChunk[]; not_found?: string[] }> {
    if (fetchChunks) {
      const chunks = await fetchChunks(request.chunk_ids);
      const foundIds = new Set(chunks.map(c => c.chunk_id));
      const notFound = request.chunk_ids.filter(id => !foundIds.has(id));
      return { chunks, not_found: notFound.length > 0 ? notFound : undefined };
    }

    const r = getResolver();
    return r.chunks.get({ chunk_ids: request.chunk_ids });
  }

  /**
   * Resolve contracts by IDs from memx-resolver.
   */
  static async resolveContracts(
    request: { contract_ids: string[]; expand_criteria?: boolean },
    fetchContracts?: (contractIds: string[]) => Promise<Contract[]>,
  ): Promise<{ contracts: Contract[]; not_found?: string[] }> {
    if (fetchContracts) {
      const contracts = await fetchContracts(request.contract_ids);
      const foundIds = new Set(contracts.map(c => c.contract_id));
      const notFound = request.contract_ids.filter(id => !foundIds.has(id));
      return { contracts, not_found: notFound.length > 0 ? notFound : undefined };
    }

    // For now, return empty contracts
    return { contracts: [] };
  }

  /**
   * Build a resolver refs object with importance and reason metadata.
   */
  static buildResolverRefs(
    docRefs: Array<{ ref: string; importance?: 'required' | 'recommended' | 'optional'; reason?: string }>,
    chunkRefs: string[] = [],
    ackRefs: string[] = [],
    contractRefs: string[] = [],
    staleStatus: 'fresh' | 'stale' | 'unknown' = 'fresh',
  ): ResolverRefs {
    const importance: Record<string, 'required' | 'recommended' | 'optional'> = {};
    const reason: Record<string, string> = {};

    for (const doc of docRefs) {
      if (doc.importance) {
        importance[doc.ref] = doc.importance;
      }
      if (doc.reason) {
        reason[doc.ref] = doc.reason;
      }
    }

    return {
      doc_refs: docRefs.map(d => d.ref),
      chunk_refs: chunkRefs,
      ack_refs: ackRefs,
      contract_refs: contractRefs,
      stale_status: staleStatus,
      importance: Object.keys(importance).length > 0 ? importance : undefined,
      reason: Object.keys(reason).length > 0 ? reason : undefined,
    };
  }

  /**
   * Determine action based on stale check results.
   */
  static determineStaleAction(
    staleResponse: StaleCheckResponse,
    currentTaskState: string,
  ): {
    recommended_action: 'block' | 'rework' | 'continue' | 'notify';
    reason: string;
    blocked_on?: string[];
    rework_scope?: string[];
  } {
    const staleItems = staleResponse.stale;

    if (staleItems.length === 0) {
      return { recommended_action: 'continue', reason: 'No stale documents detected' };
    }

    const missingDocs = staleItems.filter(item => item.reason === 'document_missing');

    if (missingDocs.length > 0) {
      return {
        recommended_action: 'block',
        reason: `${missingDocs.length} document(s) are missing`,
        blocked_on: missingDocs.map(d => d.doc_id),
      };
    }

    const versionMismatches = staleItems.filter(item => item.reason === 'version_mismatch');

    if (currentTaskState === 'developing' || currentTaskState === 'planning') {
      return {
        recommended_action: 'rework',
        reason: `${versionMismatches.length} document(s) have been updated`,
        rework_scope: versionMismatches.map(d => d.doc_id),
      };
    }

    if (currentTaskState === 'accepting' || currentTaskState === 'integrating') {
      return {
        recommended_action: 'block',
        reason: `Documents changed during ${currentTaskState} phase`,
        blocked_on: versionMismatches.map(d => d.doc_id),
      };
    }

    return {
      recommended_action: 'notify',
      reason: `${versionMismatches.length} document(s) have newer versions`,
    };
  }

  /**
   * Expand contracts to extract acceptance criteria and forbidden patterns.
   */
  static expandContractCriteria(
    contracts: Contract[],
  ): {
    acceptance_criteria: string[];
    forbidden_patterns: string[];
    definition_of_done: string[];
    dependencies: string[];
  } {
    const acceptance_criteria: string[] = [];
    const forbidden_patterns: string[] = [];
    const definition_of_done: string[] = [];
    const dependencies: string[] = [];

    for (const contract of contracts) {
      if (contract.acceptance_criteria) {
        acceptance_criteria.push(...contract.acceptance_criteria);
      }
      if (contract.forbidden_patterns) {
        forbidden_patterns.push(...contract.forbidden_patterns);
      }
      if (contract.definition_of_done) {
        definition_of_done.push(...contract.definition_of_done);
      }
      if (contract.dependencies) {
        dependencies.push(...contract.dependencies);
      }
    }

    return {
      acceptance_criteria: [...new Set(acceptance_criteria)],
      forbidden_patterns: [...new Set(forbidden_patterns)],
      definition_of_done: [...new Set(definition_of_done)],
      dependencies: [...new Set(dependencies)],
    };
  }
}