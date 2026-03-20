/**
 * memx-resolver-js
 * Document resolver library with Redis and in-memory backends
 */

// Types
export * from './types.js';

// Store backends
export type { StoreBackend } from './store/store-backend.js';
export { InMemoryBackend } from './store/memory-backend.js';
export { RedisBackend, type RedisBackendConfig } from './store/redis-backend.js';

// Services
export { DocsService, type DocsServiceConfig, generateDocId } from './services/docs-service.js';
export { ChunksService, type ChunksServiceConfig } from './services/chunks-service.js';
export { ReadsService, type ReadsServiceConfig } from './services/reads-service.js';
export { ContractsService, type ContractsServiceConfig } from './services/contracts-service.js';

// Chunking
export {
  chunkMarkdown,
  chunkByHeadings,
  generateChunkId,
  estimateTokens,
  type ChunkingOptions,
} from './chunking/markdown-chunker.js';

/**
 * Main resolver class combining all services
 */
import type { StoreBackend } from './store/store-backend.js';
import { DocsService, type DocsServiceConfig } from './services/docs-service.js';
import { ChunksService, type ChunksServiceConfig } from './services/chunks-service.js';
import { ReadsService, type ReadsServiceConfig } from './services/reads-service.js';
import { ContractsService, type ContractsServiceConfig } from './services/contracts-service.js';

export interface MemxResolverConfig {
  backend: StoreBackend;
}

/**
 * Main MemxResolver class
 * Provides a unified interface to all resolver services
 */
export class MemxResolver {
  public readonly docs: DocsService;
  public readonly chunks: ChunksService;
  public readonly reads: ReadsService;
  public readonly contracts: ContractsService;
  public readonly backend: StoreBackend;

  constructor(config: MemxResolverConfig) {
    this.backend = config.backend;
    this.docs = new DocsService({ backend: this.backend });
    this.chunks = new ChunksService({ backend: this.backend });
    this.reads = new ReadsService({ backend: this.backend });
    this.contracts = new ContractsService({ backend: this.backend });
  }

  /**
   * Close the backend connection if applicable
   */
  async close(): Promise<void> {
    if (this.backend.close) {
      await this.backend.close();
    }
  }
}