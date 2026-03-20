import type { ExternalRef, LinkRole, Task, TrackerLinkRequest, TrackerLinkResponse } from '../../types.js';
import type { TaskUpdate } from '../task/index.js';
import {
  TrackerBridge,
  InMemoryBackend,
  RedisBackend,
  type StoreBackend,
  type IssueCache,
  type PRCache,
  type ProjectItemCache,
  type CommentCache,
  type ConnectionStatus,
} from 'tracker-bridge-js';

/**
 * Context for tracker operations
 */
export interface TrackerContext {
  requireTask(taskId: string): Task;
  updateTask(taskId: string, update: TaskUpdate): void;
}

/** Tracker bridge configuration */
export interface TrackerBridgeConfig {
  backend?: StoreBackend;
  redisUrl?: string;
  redisKeyPrefix?: string;
}

/** Global tracker bridge instance */
let bridge: TrackerBridge | null = null;

/**
 * Initialize the tracker bridge with configuration
 */
export function initTrackerBridge(config: TrackerBridgeConfig = {}): TrackerBridge {
  if (bridge) {
    return bridge;
  }

  let backend: StoreBackend;

  if (config.backend) {
    backend = config.backend;
  } else if (config.redisUrl) {
    backend = new RedisBackend({
      url: config.redisUrl,
      keyPrefix: config.redisKeyPrefix ?? 'tracker-bridge:',
    });
  } else {
    backend = new InMemoryBackend();
  }

  bridge = new TrackerBridge({ backend });
  return bridge;
}

/**
 * Get the tracker bridge instance
 */
export function getTrackerBridge(): TrackerBridge {
  if (!bridge) {
    return initTrackerBridge();
  }
  return bridge;
}

export class TrackerService {
  static parseEntityRef(entityRef: string, connectionRef?: string, linkRole?: LinkRole, metadataJson?: string): ExternalRef {
    const parts = entityRef.split(':');
    if (parts.length >= 2) {
      const kind = parts[0];
      const value = parts.slice(1).join(':');

      let externalKind: ExternalRef['kind'];
      switch (kind) {
        case 'github_issue':
          externalKind = 'github_issue';
          break;
        case 'github_project_item':
          externalKind = 'github_project_item';
          break;
        case 'tracker_issue':
          externalKind = 'tracker_issue';
          break;
        default:
          externalKind = 'entity_link';
      }

      const ref: ExternalRef = {
        kind: externalKind,
        value: value,
      };

      if (connectionRef) {
        ref.connection_ref = connectionRef;
      }

      if (linkRole) {
        ref.link_role = linkRole;
      }

      if (metadataJson) {
        ref.metadata_json = metadataJson;
      }

      return ref;
    }

    const ref: ExternalRef = {
      kind: 'entity_link',
      value: entityRef,
    };
    if (connectionRef) {
      ref.connection_ref = connectionRef;
    }
    if (linkRole) {
      ref.link_role = linkRole;
    }
    if (metadataJson) {
      ref.metadata_json = metadataJson;
    }
    return ref;
  }

  static generateSyncEventRef(taskId: string): string {
    return `sync_evt_${taskId}_${Date.now()}`;
  }

  static buildSyncEventRef(syncEventValue: string, connectionRef?: string): ExternalRef {
    const ref: ExternalRef = {
      kind: 'sync_event',
      value: syncEventValue,
    };
    if (connectionRef) {
      ref.connection_ref = connectionRef;
    }
    return ref;
  }

  static mergeExternalRefs(existing: ExternalRef[] | undefined, newRefs: ExternalRef[]): ExternalRef[] {
    const existingValues = new Set(existing?.map(e => `${e.kind}:${e.value}`) ?? []);
    const uniqueNewRefs = newRefs.filter(e => !existingValues.has(`${e.kind}:${e.value}`));
    return [...(existing ?? []), ...uniqueNewRefs];
  }

  /**
   * Link a tracker entity to a task.
   * Uses tracker-bridge-js package for the link operation.
   */
  static async linkTracker(taskId: string, request: TrackerLinkRequest, ctx: TrackerContext): Promise<TrackerLinkResponse> {
    const task = ctx.requireTask(taskId);

    // Validate typed_ref matches
    if (request.typed_ref !== task.typed_ref) {
      throw new Error(`typed_ref mismatch: expected ${task.typed_ref}, got ${request.typed_ref}`);
    }

    // Use tracker-bridge-js to create the link
    const b = getTrackerBridge();
    await b.link.link({
      typed_ref: request.typed_ref,
      entity_ref: request.entity_ref,
      connection_ref: request.connection_ref,
      link_role: request.link_role,
      metadata_json: request.metadata_json,
    });

    // Create external refs using parseEntityRef for correct kind mapping
    const syncEventRef = this.generateSyncEventRef(taskId);
    const entityRef = this.parseEntityRef(
      request.entity_ref,
      request.connection_ref,
      request.link_role,
      request.metadata_json
    );
    const syncEventExtRef = this.buildSyncEventRef(syncEventRef, request.connection_ref);
    const externalRefs = [entityRef, syncEventExtRef];

    // Merge with existing external_refs
    const mergedExternalRefs = this.mergeExternalRefs(task.external_refs, externalRefs);

    // Apply update immutably
    ctx.updateTask(taskId, { external_refs: mergedExternalRefs });

    return {
      typed_ref: task.typed_ref,
      external_refs: externalRefs,
      sync_event_ref: syncEventRef,
    };
  }

  /**
   * Unlink a tracker entity from a task.
   */
  static async unlinkTracker(taskId: string, request: { typed_ref: string; entity_ref: string }): Promise<{ success: boolean }> {
    const b = getTrackerBridge();
    const result = await b.link.unlink({
      typed_ref: request.typed_ref,
      entity_ref: request.entity_ref,
    });

    return { success: result.success };
  }

  /**
   * Get cached issue by ID
   */
  static async getCachedIssue(issueId: string): Promise<IssueCache | null> {
    const b = getTrackerBridge();
    return b.cache.getIssue(issueId);
  }

  /**
   * Get cached issue by key
   */
  static async getCachedIssueByKey(key: string): Promise<IssueCache | null> {
    const b = getTrackerBridge();
    return b.cache.getIssueByKey(key);
  }

  /**
   * Get cached PR by ID
   */
  static async getCachedPR(prId: string): Promise<PRCache | null> {
    const b = getTrackerBridge();
    return b.cache.getPR(prId);
  }

  /**
   * Get cached project item
   */
  static async getCachedProjectItem(itemId: string): Promise<ProjectItemCache | null> {
    const b = getTrackerBridge();
    return b.cache.getProjectItem(itemId);
  }

  /**
   * Get comments for an entity
   */
  static async getComments(entityType: 'issue' | 'pr' | 'project_item', entityId: string): Promise<CommentCache[]> {
    const b = getTrackerBridge();
    return b.cache.getComments(entityType, entityId);
  }

  /**
   * Get connection status
   */
  static async getConnectionStatus(connectionRef: string): Promise<ConnectionStatus | null> {
    const b = getTrackerBridge();
    return b.sync.getConnectionStatus(connectionRef);
  }
}