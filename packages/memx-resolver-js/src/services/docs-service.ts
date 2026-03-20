/**
 * Docs service for document operations
 */

import type { StoreBackend } from '../store/store-backend.js';
import type {
  Document,
  IngestRequest,
  IngestResponse,
  ResolveRequest,
  ResolveResponse,
  ResolveEntry,
  SearchRequest,
  SearchResponse,
  SearchResult,
} from '../types.js';
import { chunkMarkdown } from '../chunking/markdown-chunker.js';

/**
 * Docs service configuration
 */
export interface DocsServiceConfig {
  backend: StoreBackend;
}

/**
 * Generate document ID from type and title
 */
export function generateDocId(docType: string, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `doc:${docType}:${slug}`;
}

/**
 * Docs service for document management
 */
export class DocsService {
  private backend: StoreBackend;

  constructor(config: DocsServiceConfig) {
    this.backend = config.backend;
  }

  /**
   * Ingest a document
   */
  async ingest(request: IngestRequest): Promise<IngestResponse> {
    const docId = generateDocId(request.doc_type, request.title);
    const now = new Date().toISOString();

    const doc: Document = {
      doc_id: docId,
      doc_type: request.doc_type,
      title: request.title,
      source_path: request.source_path,
      version: request.version,
      updated_at: request.updated_at ?? now,
      summary: request.summary,
      tags: request.tags,
      feature_keys: request.feature_keys,
    };

    // Check for existing document
    const existing = await this.backend.getDocument(docId);
    const status = existing ? 'updated' : 'ingested';

    // Save document
    await this.backend.setDocument(doc);

    // Chunk the document body
    const chunks = chunkMarkdown(docId, request.body, request.chunking);
    await this.backend.setChunks(docId, chunks);

    return {
      doc_id: docId,
      version: request.version,
      chunk_count: chunks.length,
      status,
    };
  }

  /**
   * Resolve documents for feature/topic/task
   */
  async resolve(request: ResolveRequest): Promise<ResolveResponse> {
    const required: ResolveEntry[] = [];
    const recommended: ResolveEntry[] = [];
    const reference: ResolveEntry[] = [];

    // Resolve by feature
    if (request.feature) {
      const docs = await this.backend.findDocumentsByFeature(request.feature);
      for (const doc of docs) {
        const entry = await this.createResolveEntry(doc);
        if (doc.doc_type === 'spec' || doc.doc_type === 'blueprint') {
          required.push(entry);
        } else if (doc.doc_type === 'cookbook' || doc.doc_type === 'guide') {
          recommended.push(entry);
        } else {
          reference.push(entry);
        }
      }
    }

    // Resolve by topic (search)
    if (request.topic) {
      const docs = await this.backend.searchDocuments(request.topic, request.limit ?? 10);
      for (const doc of docs) {
        // Avoid duplicates
        const existingIds = new Set([...required, ...recommended, ...reference].map(e => e.doc_id));
        if (!existingIds.has(doc.doc_id)) {
          const entry = await this.createResolveEntry(doc);
          recommended.push(entry);
        }
      }
    }

    // Apply limit
    const limit = request.limit ?? 10;
    return {
      required: required.slice(0, limit),
      recommended: recommended.slice(0, limit),
      reference: reference.length > 0 ? reference.slice(0, limit) : undefined,
    };
  }

  /**
   * Create a resolve entry from document
   */
  private async createResolveEntry(doc: Document): Promise<ResolveEntry> {
    const chunks = await this.backend.getChunksByDocId(doc.doc_id);
    const topChunks = chunks
      .filter(c => c.importance === 'required')
      .slice(0, 2)
      .map(c => c.chunk_id);

    return {
      doc_id: doc.doc_id,
      title: doc.title,
      version: doc.version,
      importance: this.mapDocTypeToImportance(doc.doc_type),
      reason: `${doc.doc_type} for ${doc.feature_keys?.join(', ') ?? 'general use'}`,
      top_chunks: topChunks.length > 0 ? topChunks : undefined,
    };
  }

  /**
   * Map document type to importance
   */
  private mapDocTypeToImportance(docType: string): 'required' | 'recommended' | 'reference' {
    switch (docType) {
      case 'spec':
      case 'blueprint':
      case 'contract':
        return 'required';
      case 'cookbook':
      case 'guide':
      case 'tutorial':
        return 'recommended';
      default:
        return 'reference';
    }
  }

  /**
   * Search documents
   */
  async search(request: SearchRequest): Promise<SearchResponse> {
    const results: SearchResult[] = [];
    const docs = await this.backend.searchDocuments(request.query, request.limit ?? 10);

    // Filter by doc_types, tags, feature_keys if specified
    const filtered = docs.filter(doc => {
      if (request.doc_types && !request.doc_types.includes(doc.doc_type)) {
        return false;
      }
      if (request.tags && !doc.tags?.some(t => request.tags!.includes(t))) {
        return false;
      }
      if (request.feature_keys && !doc.feature_keys?.some(f => request.feature_keys!.includes(f))) {
        return false;
      }
      return true;
    });

    for (const doc of filtered) {
      results.push({
        doc_id: doc.doc_id,
        title: doc.title,
        version: doc.version,
        score: this.calculateScore(request.query, doc),
        summary: doc.summary,
      });
    }

    // Sort by score
    results.sort((a, b) => b.score - a.score);

    return { results };
  }

  /**
   * Calculate search score
   */
  private calculateScore(query: string, doc: Document): number {
    const lowerQuery = query.toLowerCase();
    let score = 0;

    // Title match
    if (doc.title.toLowerCase().includes(lowerQuery)) {
      score += 0.5;
    }

    // Summary match
    if (doc.summary?.toLowerCase().includes(lowerQuery)) {
      score += 0.3;
    }

    // Tags match
    if (doc.tags?.some(t => t.toLowerCase().includes(lowerQuery))) {
      score += 0.2;
    }

    return Math.min(score, 1.0);
  }

  /**
   * Get document by ID
   */
  async getDocument(docId: string): Promise<Document | null> {
    return this.backend.getDocument(docId);
  }

  /**
   * Get document versions
   */
  async getVersions(docIds: string[]): Promise<Array<{ doc_id: string; version: string; exists: boolean }>> {
    const results = [];

    for (const docId of docIds) {
      const doc = await this.backend.getDocument(docId);
      results.push({
        doc_id: docId,
        version: doc?.version ?? 'unknown',
        exists: !!doc,
      });
    }

    return results;
  }
}