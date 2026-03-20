/**
 * tracker-bridge-js
 * Tracker bridge library with Redis and in-memory backends
 */

// Types
export * from './types.js';

// TypedRef
export {
  TypedRef,
  KNOWN_DOMAINS,
  LOCAL_PROVIDER,
  TRACKER_DOMAIN,
  TRACKER_DEFAULT_ENTITY_TYPE,
  LOCAL_DOMAINS,
  makeRef,
  makeTrackerIssueRef,
  makeAgentTaskstateTaskRef,
  makeMemxEvidenceRef,
  makeMemxKnowledgeRef,
  makeMemxArtifactRef,
  validateTypedRef,
  canonicalize,
  isMemxRef,
  isAgentTaskstateRef,
  isTrackerRef,
} from './refs/typed-ref.js';

// Store backends
export type { StoreBackend } from './store/store-backend.js';
export { InMemoryBackend } from './store/memory-backend.js';
export { RedisBackend, type RedisBackendConfig } from './store/redis-backend.js';

// Services
export { CacheService, type CacheServiceConfig } from './services/cache-service.js';
export { LinkService, type LinkServiceConfig } from './services/link-service.js';
export { SyncService, type SyncServiceConfig } from './services/sync-service.js';

/**
 * Main TrackerBridge class combining all services
 */
import type { StoreBackend } from './store/store-backend.js';
import { CacheService } from './services/cache-service.js';
import { LinkService } from './services/link-service.js';
import { SyncService } from './services/sync-service.js';

export interface TrackerBridgeConfig {
  backend: StoreBackend;
}

/**
 * Main TrackerBridge class
 * Provides a unified interface to all tracker bridge services
 */
export class TrackerBridge {
  public readonly cache: CacheService;
  public readonly link: LinkService;
  public readonly sync: SyncService;
  public readonly backend: StoreBackend;

  constructor(config: TrackerBridgeConfig) {
    this.backend = config.backend;
    this.cache = new CacheService({ backend: this.backend });
    this.link = new LinkService({ backend: this.backend });
    this.sync = new SyncService({ backend: this.backend });
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