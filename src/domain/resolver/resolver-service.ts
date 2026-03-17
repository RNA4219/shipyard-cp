import type { ResolveDocsRequest, ResolveDocsResponse } from '../../types.js';

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
}