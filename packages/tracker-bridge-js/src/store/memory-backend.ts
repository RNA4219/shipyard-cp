/**
 * In-memory store backend for development and testing
 */

import type { StoreBackend } from './store-backend.js';
import type {
  TrackerConnection,
  IssueCache,
  PRCache,
  ProjectItemCache,
  EntityLink,
  SyncEvent,
  CommentCache,
} from '../types.js';

/**
 * In-memory backend implementation
 */
export class InMemoryBackend implements StoreBackend {
  private connections = new Map<string, TrackerConnection>();
  private issues = new Map<string, IssueCache>();
  private issuesByKey = new Map<string, IssueCache>();
  private prs = new Map<string, PRCache>();
  private prsByKey = new Map<string, PRCache>();
  private projectItems = new Map<string, ProjectItemCache>();
  private entityLinks = new Map<string, EntityLink>();
  private entityLinksByLocalRef = new Map<string, EntityLink[]>();
  private entityLinksByRemoteRef = new Map<string, EntityLink[]>();
  private syncEvents = new Map<string, SyncEvent>();
  private comments = new Map<string, CommentCache[]>();

  // Connection operations
  async getConnection(id: string): Promise<TrackerConnection | null> {
    return this.connections.get(id) ?? null;
  }

  async setConnection(connection: TrackerConnection): Promise<void> {
    this.connections.set(connection.id, connection);
  }

  async listConnections(): Promise<TrackerConnection[]> {
    return Array.from(this.connections.values());
  }

  // Issue cache operations
  async getIssue(id: string): Promise<IssueCache | null> {
    return this.issues.get(id) ?? null;
  }

  async getIssueByKey(key: string): Promise<IssueCache | null> {
    return this.issuesByKey.get(key) ?? null;
  }

  async setIssue(issue: IssueCache): Promise<void> {
    this.issues.set(issue.id, issue);
    this.issuesByKey.set(issue.remote_issue_key, issue);
  }

  async deleteIssue(id: string): Promise<boolean> {
    const issue = this.issues.get(id);
    if (issue) {
      this.issuesByKey.delete(issue.remote_issue_key);
    }
    return this.issues.delete(id);
  }

  // PR cache operations
  async getPR(id: string): Promise<PRCache | null> {
    return this.prs.get(id) ?? null;
  }

  async getPRByKey(key: string): Promise<PRCache | null> {
    return this.prsByKey.get(key) ?? null;
  }

  async setPR(pr: PRCache): Promise<void> {
    this.prs.set(pr.id, pr);
    this.prsByKey.set(pr.remote_pr_key, pr);
  }

  async deletePR(id: string): Promise<boolean> {
    const pr = this.prs.get(id);
    if (pr) {
      this.prsByKey.delete(pr.remote_pr_key);
    }
    return this.prs.delete(id);
  }

  // Project item cache operations
  async getProjectItem(id: string): Promise<ProjectItemCache | null> {
    return this.projectItems.get(id) ?? null;
  }

  async setProjectItem(item: ProjectItemCache): Promise<void> {
    this.projectItems.set(item.id, item);
  }

  async deleteProjectItem(id: string): Promise<boolean> {
    return this.projectItems.delete(id);
  }

  // Entity link operations
  async getEntityLink(id: string): Promise<EntityLink | null> {
    return this.entityLinks.get(id) ?? null;
  }

  async getEntityLinksByLocalRef(localRef: string): Promise<EntityLink[]> {
    return this.entityLinksByLocalRef.get(localRef) ?? [];
  }

  async getEntityLinksByRemoteRef(remoteRef: string): Promise<EntityLink[]> {
    return this.entityLinksByRemoteRef.get(remoteRef) ?? [];
  }

  async setEntityLink(link: EntityLink): Promise<void> {
    this.entityLinks.set(link.id, link);

    // Index by local_ref
    const byLocal = this.entityLinksByLocalRef.get(link.local_ref) ?? [];
    const existingIndex = byLocal.findIndex(l => l.id === link.id);
    if (existingIndex >= 0) {
      byLocal[existingIndex] = link;
    } else {
      byLocal.push(link);
    }
    this.entityLinksByLocalRef.set(link.local_ref, byLocal);

    // Index by remote_ref
    const byRemote = this.entityLinksByRemoteRef.get(link.remote_ref) ?? [];
    const remoteIndex = byRemote.findIndex(l => l.id === link.id);
    if (remoteIndex >= 0) {
      byRemote[remoteIndex] = link;
    } else {
      byRemote.push(link);
    }
    this.entityLinksByRemoteRef.set(link.remote_ref, byRemote);
  }

  async deleteEntityLink(id: string): Promise<boolean> {
    const link = this.entityLinks.get(id);
    if (link) {
      // Remove from indexes
      const byLocal = this.entityLinksByLocalRef.get(link.local_ref);
      if (byLocal) {
        const index = byLocal.findIndex(l => l.id === id);
        if (index >= 0) byLocal.splice(index, 1);
      }

      const byRemote = this.entityLinksByRemoteRef.get(link.remote_ref);
      if (byRemote) {
        const index = byRemote.findIndex(l => l.id === id);
        if (index >= 0) byRemote.splice(index, 1);
      }
    }
    return this.entityLinks.delete(id);
  }

  // Sync event operations
  async getSyncEvent(id: string): Promise<SyncEvent | null> {
    return this.syncEvents.get(id) ?? null;
  }

  async getSyncEventsByEntity(entityType: string, entityId: string, limit: number = 10): Promise<SyncEvent[]> {
    const results: SyncEvent[] = [];

    for (const event of this.syncEvents.values()) {
      if (event.local_ref?.includes(entityId) || event.remote_ref.includes(entityId)) {
        results.push(event);
      }
    }

    // Sort by occurred_at descending
    results.sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));

    return results.slice(0, limit);
  }

  async setSyncEvent(event: SyncEvent): Promise<void> {
    this.syncEvents.set(event.id, event);
  }

  // Comment operations
  async getComments(entityType: string, entityId: string): Promise<CommentCache[]> {
    const key = `${entityType}:${entityId}`;
    return this.comments.get(key) ?? [];
  }

  async setComment(comment: CommentCache): Promise<void> {
    const key = `${comment.entity_type}:${comment.entity_id}`;
    const existing = this.comments.get(key) ?? [];
    const index = existing.findIndex(c => c.id === comment.id);
    if (index >= 0) {
      existing[index] = comment;
    } else {
      existing.push(comment);
    }
    this.comments.set(key, existing);
  }
}