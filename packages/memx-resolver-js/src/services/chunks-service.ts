/**
 * Chunks service for document chunk operations
 */

import type { StoreBackend } from '../store/store-backend.js';
import type {
  DocumentChunk,
  GetChunksRequest,
  GetChunksResponse,
} from '../types.js';

/**
 * Chunks service configuration
 */
export interface ChunksServiceConfig {
  backend: StoreBackend;
}

/**
 * Chunks service for chunk retrieval
 */
export class ChunksService {
  private backend: StoreBackend;

  constructor(config: ChunksServiceConfig) {
    this.backend = config.backend;
  }

  /**
   * Get chunks by various criteria
   */
  async get(request: GetChunksRequest): Promise<GetChunksResponse> {
    // Direct chunk IDs take priority
    if (request.chunk_ids?.length) {
      return this.getByChunkIds(request.chunk_ids);
    }

    // Get by document ID
    if (request.doc_id) {
      return this.getByDocId(
        request.doc_id,
        request.query,
        request.heading,
        request.limit ?? 10
      );
    }

    return { chunks: [] };
  }

  /**
   * Get chunks by chunk IDs
   */
  private async getByChunkIds(chunkIds: string[]): Promise<GetChunksResponse> {
    const chunks: DocumentChunk[] = [];
    const notFound: string[] = [];

    for (const chunkId of chunkIds) {
      const chunk = await this.backend.getChunk(chunkId);
      if (chunk) {
        chunks.push(chunk);
      } else {
        notFound.push(chunkId);
      }
    }

    return {
      chunks,
      not_found: notFound.length > 0 ? notFound : undefined,
    };
  }

  /**
   * Get chunks by document ID with optional filtering
   */
  private async getByDocId(
    docId: string,
    query?: string,
    heading?: string,
    limit: number = 10
  ): Promise<GetChunksResponse> {
    const allChunks = await this.backend.getChunksByDocId(docId);

    let filtered = allChunks;

    // Filter by heading
    if (heading) {
      const lowerHeading = heading.toLowerCase();
      filtered = filtered.filter(chunk =>
        chunk.heading_path?.some(h => h.toLowerCase().includes(lowerHeading))
      );
    }

    // Filter by query (simple text search)
    if (query) {
      const lowerQuery = query.toLowerCase();
      filtered = filtered.filter(chunk =>
        chunk.body.toLowerCase().includes(lowerQuery)
      );
    }

    // Sort by ordinal
    filtered.sort((a, b) => a.ordinal - b.ordinal);

    // Apply limit
    const chunks = filtered.slice(0, limit);

    return {
      doc_id: docId,
      chunks,
    };
  }

  /**
   * Get all chunks for a document
   */
  async getAllChunks(docId: string): Promise<DocumentChunk[]> {
    return this.backend.getChunksByDocId(docId);
  }
}