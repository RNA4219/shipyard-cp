import type { ResolveDocsRequest, ResolveDocsResponse, StaleCheckRequest, StaleCheckResponse, StaleDocItem, ResolverRefs } from '../../types.js';

export interface DocVersionInfo {
  doc_id: string;
  version: string;
  exists: boolean;
}

/**
 * Chunk data from memx-resolver
 */
export interface ChunkData {
  chunk_id: string;
  doc_id: string;
  content: string;
  metadata?: {
    start_line?: number;
    end_line?: number;
    importance?: 'required' | 'recommended' | 'optional';
    reason?: string;
  };
}

/**
 * Get chunks request
 */
export interface GetChunksRequest {
  chunk_ids: string[];
  include_metadata?: boolean;
}

/**
 * Get chunks response
 */
export interface GetChunksResponse {
  chunks: ChunkData[];
  not_found?: string[];
}

/**
 * Contract data from memx-resolver
 */
export interface ContractData {
  contract_id: string;
  type: 'api' | 'schema' | 'behavior' | 'constraint' | 'definition';
  content: string;
  acceptance_criteria?: string[];
  forbidden_patterns?: string[];
  definition_of_done?: string[];
  dependencies?: string[];
}

/**
 * Resolve contracts request
 */
export interface ResolveContractsRequest {
  contract_ids: string[];
  expand_criteria?: boolean;
}

/**
 * Resolve contracts response
 */
export interface ResolveContractsResponse {
  contracts: ContractData[];
  not_found?: string[];
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
   * This integrates with memx-resolver's stale-check API.
   */
  static checkStale(
    taskId: string,
    resolverRefs: ResolverRefs | undefined,
    request: StaleCheckRequest,
    getCurrentVersions: (docIds: string[]) => DocVersionInfo[],
  ): StaleCheckResponse {
    const staleItems: StaleDocItem[] = [];

    // If no resolver refs, nothing to check
    if (!resolverRefs?.ack_refs?.length) {
      return { task_id: taskId, stale: [] };
    }

    // Parse ack_refs to get previous versions
    const ackedDocs = this.parseAckRefs(resolverRefs.ack_refs);

    // Determine which docs to check
    const docIdsToCheck = request.doc_ids ?? Object.keys(ackedDocs);

    // Get current versions from resolver
    const currentVersions = getCurrentVersions(docIdsToCheck);
    const currentVersionMap = new Map(currentVersions.map(v => [v.doc_id, v]));

    const detectedAt = new Date().toISOString();

    for (const docId of docIdsToCheck) {
      const current = currentVersionMap.get(docId);
      const previous = ackedDocs[docId];

      if (!current || !current.exists) {
        // Document is missing
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
        // Version mismatch
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

  /**
   * Parse ack_refs into a map of doc_id -> { version }
   * Format: ack:{task_id}:{doc_id}:{version}
   */
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

  /**
   * Parse a single ack_ref into its components.
   * Format: ack:{task_id}:{doc_id}:{version}
   * Note: doc_id may contain colons (e.g., "doc:feature:auth")
   */
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

    // Find the last colon to separate doc_id from version
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
   * Corresponds to POST /v1/chunks:get
   */
  static async getChunks(
    request: GetChunksRequest,
    fetchChunks: (chunkIds: string[]) => Promise<ChunkData[]>,
  ): Promise<GetChunksResponse> {
    const chunks = await fetchChunks(request.chunk_ids);

    const foundIds = new Set(chunks.map(c => c.chunk_id));
    const notFound = request.chunk_ids.filter(id => !foundIds.has(id));

    return {
      chunks,
      not_found: notFound.length > 0 ? notFound : undefined,
    };
  }

  /**
   * Resolve contracts by IDs from memx-resolver.
   * Corresponds to POST /v1/contracts:resolve
   */
  static async resolveContracts(
    request: ResolveContractsRequest,
    fetchContracts: (contractIds: string[]) => Promise<ContractData[]>,
  ): Promise<ResolveContractsResponse> {
    const contracts = await fetchContracts(request.contract_ids);

    const foundIds = new Set(contracts.map(c => c.contract_id));
    const notFound = request.contract_ids.filter(id => !foundIds.has(id));

    return {
      contracts,
      not_found: notFound.length > 0 ? notFound : undefined,
    };
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
   * Returns recommended state transition and action.
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

    // Check for missing documents (critical)
    const missingDocs = staleItems.filter(item => item.reason === 'document_missing');

    if (missingDocs.length > 0) {
      return {
        recommended_action: 'block',
        reason: `${missingDocs.length} document(s) are missing`,
        blocked_on: missingDocs.map(d => d.doc_id),
      };
    }

    // Check for version mismatches
    const versionMismatches = staleItems.filter(item => item.reason === 'version_mismatch');

    // Determine action based on current state
    if (currentTaskState === 'developing' || currentTaskState === 'planning') {
      // During active work, stale docs may indicate need for rework
      return {
        recommended_action: 'rework',
        reason: `${versionMismatches.length} document(s) have been updated`,
        rework_scope: versionMismatches.map(d => d.doc_id),
      };
    }

    if (currentTaskState === 'accepting' || currentTaskState === 'integrating') {
      // During acceptance/integration, block until docs are re-read
      return {
        recommended_action: 'block',
        reason: `Documents changed during ${currentTaskState} phase`,
        blocked_on: versionMismatches.map(d => d.doc_id),
      };
    }

    // For other states, just notify
    return {
      recommended_action: 'notify',
      reason: `${versionMismatches.length} document(s) have newer versions`,
    };
  }

  /**
   * Expand contracts to extract acceptance criteria and forbidden patterns.
   * Used by workers to understand requirements and constraints.
   */
  static expandContractCriteria(
    contracts: ContractData[],
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

    // Deduplicate
    return {
      acceptance_criteria: [...new Set(acceptance_criteria)],
      forbidden_patterns: [...new Set(forbidden_patterns)],
      definition_of_done: [...new Set(definition_of_done)],
      dependencies: [...new Set(dependencies)],
    };
  }
}