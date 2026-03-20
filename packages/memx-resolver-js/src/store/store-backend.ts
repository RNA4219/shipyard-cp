/**
 * Store backend interface for memx-resolver
 */

import type {
  Document,
  DocumentChunk,
  ReadReceipt,
  StaleReason,
  Contract,
} from '../types.js';

/**
 * Store backend interface
 * Implementations: InMemoryBackend, RedisBackend
 */
export interface StoreBackend {
  // Document operations
  getDocument(docId: string): Promise<Document | null>;
  setDocument(doc: Document): Promise<void>;
  deleteDocument(docId: string): Promise<boolean>;
  findDocumentsByFeature(feature: string): Promise<Document[]>;
  findDocumentsByTags(tags: string[]): Promise<Document[]>;
  searchDocuments(query: string, limit: number): Promise<Document[]>;

  // Chunk operations
  getChunk(chunkId: string): Promise<DocumentChunk | null>;
  getChunksByDocId(docId: string): Promise<DocumentChunk[]>;
  setChunks(docId: string, chunks: DocumentChunk[]): Promise<void>;
  deleteChunks(docId: string): Promise<void>;

  // Read receipt operations
  getReadReceipt(taskId: string, docId: string): Promise<ReadReceipt | null>;
  getReadReceiptsByTask(taskId: string): Promise<ReadReceipt[]>;
  setReadReceipt(receipt: ReadReceipt): Promise<void>;

  // Stale reasons
  addStaleReason(reason: StaleReason): Promise<void>;
  getStaleReasons(taskId: string): Promise<StaleReason[]>;

  // Contract operations
  getContract(contractId: string): Promise<Contract | null>;
  setContract(contract: Contract): Promise<void>;
  findContractsByFeature(feature: string): Promise<Contract[]>;

  // Utility
  close?(): Promise<void>;
}