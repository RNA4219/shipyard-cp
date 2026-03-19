import type { ExternalRef, LinkRole, Task, TrackerLinkRequest, TrackerLinkResponse } from '../../types.js';

/**
 * Context for tracker operations
 */
export interface TrackerContext {
  requireTask(taskId: string): Task;
  touchTask(task: Task): void;
}

export class TrackerService {
  static parseEntityRef(entityRef: string, connectionRef?: string, linkRole?: LinkRole, metadataJson?: string): ExternalRef {
    const parts = entityRef.split(':');
    if (parts.length >= 2) {
      const kind = parts[0];
      const value = parts.slice(1).join(':');

      // Map entity_ref kind to ExternalRef kind
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

    // Fallback: treat as entity_link
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
   * Extracted from ControlPlaneStore to reduce complexity.
   */
  static linkTracker(taskId: string, request: TrackerLinkRequest, ctx: TrackerContext): TrackerLinkResponse {
    const task = ctx.requireTask(taskId);

    // Validate typed_ref matches
    if (request.typed_ref !== task.typed_ref) {
      throw new Error(`typed_ref mismatch: expected ${task.typed_ref}, got ${request.typed_ref}`);
    }

    // Generate sync_event_ref
    const syncEventRef = this.generateSyncEventRef(taskId);

    // Create external refs from the entity_ref
    const entityRef = this.parseEntityRef(
      request.entity_ref,
      request.connection_ref,
      request.link_role,
      request.metadata_json
    );
    const syncEventExtRef = this.buildSyncEventRef(syncEventRef, request.connection_ref);
    const externalRefs = [entityRef, syncEventExtRef];

    // Merge with existing external_refs (avoid duplicates)
    task.external_refs = this.mergeExternalRefs(task.external_refs, externalRefs);
    ctx.touchTask(task);

    return {
      typed_ref: task.typed_ref,
      external_refs: externalRefs,
      sync_event_ref: syncEventRef,
    };
  }
}