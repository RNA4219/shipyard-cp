/**
 * Redis store backend for production use
 */

import type { StoreBackend } from './store-backend.js';
import type {
  Document,
  DocumentChunk,
  ReadReceipt,
  StaleReason,
  Contract,
} from '../types.js';
import { getOrCreateRedisClient, type RedisClientLike } from './redis-utils.js';

/**
 * Redis backend configuration
 */
export interface RedisBackendConfig {
  url?: string;
  keyPrefix?: string;
  client?: RedisClientLike;
}

/**
 * Redis backend implementation using ioredis
 */
export class RedisBackend implements StoreBackend {
  private keyPrefix: string;
  private client: RedisClientLike | null = null;
  private config: RedisBackendConfig;

  constructor(config: RedisBackendConfig = {}) {
    this.keyPrefix = config.keyPrefix ?? 'memx-resolver:';
    this.config = config;
  }

  private async getClient(): Promise<RedisClientLike> {
    if (!this.client) {
      this.client = await getOrCreateRedisClient(this.client, {
        url: this.config.url,
        client: this.config.client,
      });
    }
    return this.client;
  }

  // Document operations
  async getDocument(docId: string): Promise<Document | null> {
    const client = await this.getClient();
    const data = await client.get(`doc:${docId}`);
    return data ? JSON.parse(data) : null;
  }

  async setDocument(doc: Document): Promise<void> {
    const client = await this.getClient();
    await client.set(`doc:${doc.doc_id}`, JSON.stringify(doc));
  }

  async deleteDocument(docId: string): Promise<boolean> {
    const client = await this.getClient();
    const result = await client.del(`doc:${docId}`);
    return result > 0;
  }

  async findDocumentsByFeature(feature: string): Promise<Document[]> {
    const client = await this.getClient();
    const keys = await client.keys('doc:*');
    const results: Document[] = [];

    for (const key of keys) {
      const data = await client.get(key);
      if (data) {
        const doc = JSON.parse(data) as Document;
        if (doc.feature_keys?.includes(feature)) {
          results.push(doc);
        }
      }
    }

    return results;
  }

  async findDocumentsByTags(tags: string[]): Promise<Document[]> {
    const client = await this.getClient();
    const keys = await client.keys('doc:*');
    const results: Document[] = [];

    for (const key of keys) {
      const data = await client.get(key);
      if (data) {
        const doc = JSON.parse(data) as Document;
        if (doc.tags?.some(t => tags.includes(t))) {
          results.push(doc);
        }
      }
    }

    return results;
  }

  async searchDocuments(query: string, limit: number): Promise<Document[]> {
    const client = await this.getClient();
    const keys = await client.keys('doc:*');
    const lowerQuery = query.toLowerCase();
    const results: Document[] = [];

    for (const key of keys) {
      const data = await client.get(key);
      if (data) {
        const doc = JSON.parse(data) as Document;
        const titleMatch = doc.title.toLowerCase().includes(lowerQuery);
        const summaryMatch = doc.summary?.toLowerCase().includes(lowerQuery);
        const tagsMatch = doc.tags?.some(t => t.toLowerCase().includes(lowerQuery));

        if (titleMatch || summaryMatch || tagsMatch) {
          results.push(doc);
        }
      }
    }

    return results.slice(0, limit);
  }

  // Chunk operations
  async getChunk(chunkId: string): Promise<DocumentChunk | null> {
    const client = await this.getClient();
    const data = await client.get(`chunk:${chunkId}`);
    return data ? JSON.parse(data) : null;
  }

  async getChunksByDocId(docId: string): Promise<DocumentChunk[]> {
    const client = await this.getClient();
    const data = await client.get(`chunks:${docId}`);
    return data ? JSON.parse(data) : [];
  }

  async setChunks(docId: string, chunks: DocumentChunk[]): Promise<void> {
    const client = await this.getClient();
    await client.set(`chunks:${docId}`, JSON.stringify(chunks));
  }

  async deleteChunks(docId: string): Promise<void> {
    const client = await this.getClient();
    await client.del(`chunks:${docId}`);
  }

  // Read receipt operations
  async getReadReceipt(taskId: string, docId: string): Promise<ReadReceipt | null> {
    const client = await this.getClient();
    const data = await client.get(`read:${taskId}:${docId}`);
    return data ? JSON.parse(data) : null;
  }

  async getReadReceiptsByTask(taskId: string): Promise<ReadReceipt[]> {
    const client = await this.getClient();
    const keys = await client.keys(`read:${taskId}:*`);
    const results: ReadReceipt[] = [];

    for (const key of keys) {
      const data = await client.get(key);
      if (data) {
        results.push(JSON.parse(data));
      }
    }

    return results;
  }

  async setReadReceipt(receipt: ReadReceipt): Promise<void> {
    const client = await this.getClient();
    await client.set(
      `read:${receipt.task_id}:${receipt.doc_id}`,
      JSON.stringify(receipt)
    );
  }

  // Stale reasons
  async addStaleReason(reason: StaleReason): Promise<void> {
    const client = await this.getClient();
    const existing = await this.getStaleReasons(reason.task_id);
    existing.push(reason);
    await client.set(`stale:${reason.task_id}`, JSON.stringify(existing));
  }

  async getStaleReasons(taskId: string): Promise<StaleReason[]> {
    const client = await this.getClient();
    const data = await client.get(`stale:${taskId}`);
    return data ? JSON.parse(data) : [];
  }

  // Contract operations
  async getContract(contractId: string): Promise<Contract | null> {
    const client = await this.getClient();
    const data = await client.get(`contract:${contractId}`);
    return data ? JSON.parse(data) : null;
  }

  async setContract(contract: Contract): Promise<void> {
    const client = await this.getClient();
    await client.set(`contract:${contract.contract_id}`, JSON.stringify(contract));
  }

  async findContractsByFeature(feature: string): Promise<Contract[]> {
    const client = await this.getClient();
    const keys = await client.keys('contract:*');
    const results: Contract[] = [];

    for (const key of keys) {
      const data = await client.get(key);
      if (data) {
        const contract = JSON.parse(data) as Contract;
        if (contract.contract_id.includes(feature)) {
          results.push(contract);
        }
      }
    }

    return results;
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.client = null;
    }
  }
}