/**
 * In-memory store backend for development and testing
 */

import type { StoreBackend } from './store-backend.js';
import type {
  Document,
  DocumentChunk,
  ReadReceipt,
  StaleReason,
  Contract,
} from '../types.js';

/**
 * In-memory backend implementation
 * Stores all data in memory, useful for development and testing
 */
export class InMemoryBackend implements StoreBackend {
  private documents = new Map<string, Document>();
  private chunks = new Map<string, DocumentChunk[]>();
  private readReceipts = new Map<string, ReadReceipt>();
  private staleReasons = new Map<string, StaleReason[]>();
  private contracts = new Map<string, Contract>();

  // Document operations
  async getDocument(docId: string): Promise<Document | null> {
    return this.documents.get(docId) ?? null;
  }

  async setDocument(doc: Document): Promise<void> {
    this.documents.set(doc.doc_id, doc);
  }

  async deleteDocument(docId: string): Promise<boolean> {
    return this.documents.delete(docId);
  }

  async findDocumentsByFeature(feature: string): Promise<Document[]> {
    const results: Document[] = [];
    for (const doc of this.documents.values()) {
      if (doc.feature_keys?.includes(feature)) {
        results.push(doc);
      }
    }
    return results;
  }

  async findDocumentsByTags(tags: string[]): Promise<Document[]> {
    const results: Document[] = [];
    for (const doc of this.documents.values()) {
      if (doc.tags?.some(t => tags.includes(t))) {
        results.push(doc);
      }
    }
    return results;
  }

  async searchDocuments(query: string, limit: number): Promise<Document[]> {
    const lowerQuery = query.toLowerCase();
    const results: Document[] = [];

    for (const doc of this.documents.values()) {
      const titleMatch = doc.title.toLowerCase().includes(lowerQuery);
      const summaryMatch = doc.summary?.toLowerCase().includes(lowerQuery);
      const tagsMatch = doc.tags?.some(t => t.toLowerCase().includes(lowerQuery));

      if (titleMatch || summaryMatch || tagsMatch) {
        results.push(doc);
      }
    }

    return results.slice(0, limit);
  }

  // Chunk operations
  async getChunk(chunkId: string): Promise<DocumentChunk | null> {
    for (const chunks of this.chunks.values()) {
      const chunk = chunks.find(c => c.chunk_id === chunkId);
      if (chunk) return chunk;
    }
    return null;
  }

  async getChunksByDocId(docId: string): Promise<DocumentChunk[]> {
    return this.chunks.get(docId) ?? [];
  }

  async setChunks(docId: string, chunks: DocumentChunk[]): Promise<void> {
    this.chunks.set(docId, chunks);
  }

  async deleteChunks(docId: string): Promise<void> {
    this.chunks.delete(docId);
  }

  // Read receipt operations
  async getReadReceipt(taskId: string, docId: string): Promise<ReadReceipt | null> {
    const key = `${taskId}:${docId}`;
    return this.readReceipts.get(key) ?? null;
  }

  async getReadReceiptsByTask(taskId: string): Promise<ReadReceipt[]> {
    const results: ReadReceipt[] = [];
    for (const receipt of this.readReceipts.values()) {
      if (receipt.task_id === taskId) {
        results.push(receipt);
      }
    }
    return results;
  }

  async setReadReceipt(receipt: ReadReceipt): Promise<void> {
    const key = `${receipt.task_id}:${receipt.doc_id}`;
    this.readReceipts.set(key, receipt);
  }

  // Stale reasons
  async addStaleReason(reason: StaleReason): Promise<void> {
    const existing = this.staleReasons.get(reason.task_id) ?? [];
    existing.push(reason);
    this.staleReasons.set(reason.task_id, existing);
  }

  async getStaleReasons(taskId: string): Promise<StaleReason[]> {
    return this.staleReasons.get(taskId) ?? [];
  }

  // Contract operations
  async getContract(contractId: string): Promise<Contract | null> {
    return this.contracts.get(contractId) ?? null;
  }

  async setContract(contract: Contract): Promise<void> {
    this.contracts.set(contract.contract_id, contract);
  }

  async findContractsByFeature(feature: string): Promise<Contract[]> {
    const results: Contract[] = [];
    for (const contract of this.contracts.values()) {
      if (contract.contract_id.includes(feature)) {
        results.push(contract);
      }
    }
    return results;
  }
}