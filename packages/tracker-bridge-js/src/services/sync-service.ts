/**
 * Sync service for synchronization event tracking
 */

import type { StoreBackend } from '../store/store-backend.js';
import type {
  TrackerConnection,
  SyncEvent,
  ConnectionStatus,
} from '../types.js';
import { randomUUID } from 'crypto';

/**
 * Sync service configuration
 */
export interface SyncServiceConfig {
  backend: StoreBackend;
}

/**
 * Sync service for tracking synchronization
 */
export class SyncService {
  private backend: StoreBackend;

  constructor(config: SyncServiceConfig) {
    this.backend = config.backend;
  }

  /**
   * Get sync event by ID
   */
  async getSyncEvent(id: string): Promise<SyncEvent | null> {
    return this.backend.getSyncEvent(id);
  }

  /**
   * Get sync events for an entity
   */
  async getSyncEvents(entityType: string, entityId: string, limit: number = 10): Promise<SyncEvent[]> {
    return this.backend.getSyncEventsByEntity(entityType, entityId, limit);
  }

  /**
   * Record a sync event
   */
  async recordSyncEvent(data: {
    trackerConnectionId: string;
    direction: 'inbound' | 'outbound';
    remoteRef: string;
    localRef?: string;
    eventType: string;
    fingerprint?: string;
    payload: Record<string, unknown>;
    status: 'pending' | 'applied' | 'failed' | 'skipped';
    errorMessage?: string;
  }): Promise<SyncEvent> {
    const now = new Date().toISOString();

    const event: SyncEvent = {
      id: randomUUID(),
      tracker_connection_id: data.trackerConnectionId,
      direction: data.direction,
      remote_ref: data.remoteRef,
      local_ref: data.localRef,
      event_type: data.eventType,
      fingerprint: data.fingerprint,
      payload_json: JSON.stringify(data.payload),
      status: data.status,
      error_message: data.errorMessage,
      occurred_at: now,
      processed_at: data.status !== 'pending' ? now : undefined,
      created_at: now,
    };

    await this.backend.setSyncEvent(event);
    return event;
  }

  // Connection operations

  /**
   * Get connection by ID
   */
  async getConnection(id: string): Promise<TrackerConnection | null> {
    return this.backend.getConnection(id);
  }

  /**
   * List all connections
   */
  async listConnections(): Promise<TrackerConnection[]> {
    return this.backend.listConnections();
  }

  /**
   * Get connection status
   */
  async getConnectionStatus(connectionRef: string): Promise<ConnectionStatus> {
    const connection = await this.backend.getConnection(connectionRef);

    if (!connection) {
      return {
        connection_ref: connectionRef,
        provider: 'unknown',
        status: 'inactive',
      };
    }

    return {
      connection_ref: connectionRef,
      provider: connection.tracker_type,
      status: connection.is_enabled ? 'active' : 'inactive',
      last_sync: connection.updated_at,
    };
  }

  /**
   * Register a connection
   */
  async registerConnection(data: {
    id: string;
    trackerType: string;
    name: string;
    baseUrl: string;
    workspaceKey?: string;
    projectKey?: string;
    secretRef?: string;
    metadata?: Record<string, unknown>;
  }): Promise<TrackerConnection> {
    const now = new Date().toISOString();

    const connection: TrackerConnection = {
      id: data.id,
      tracker_type: data.trackerType,
      name: data.name,
      base_url: data.baseUrl,
      workspace_key: data.workspaceKey,
      project_key: data.projectKey,
      secret_ref: data.secretRef,
      is_enabled: true,
      created_at: now,
      updated_at: now,
      metadata_json: data.metadata ? JSON.stringify(data.metadata) : undefined,
    };

    await this.backend.setConnection(connection);
    return connection;
  }
}