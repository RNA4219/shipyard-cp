import type { ResolveDocsRequest, ResolveDocsResponse, StaleCheckRequest, StaleCheckResponse, StaleDocItem, ResolverRefs } from '../../types.js';

export interface DocVersionInfo {
  doc_id: string;
  version: string;
  exists: boolean;
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
}