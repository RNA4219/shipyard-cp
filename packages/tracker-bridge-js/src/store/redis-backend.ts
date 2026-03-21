/**
 * Redis store backend for production use
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
import { getOrCreateRedisClient, type RedisClientLike } from 'shared-redis-utils';

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
    this.keyPrefix = config.keyPrefix ?? 'tracker-bridge:';
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

  // Connection operations
  async getConnection(id: string): Promise<TrackerConnection | null> {
    const client = await this.getClient();
    const data = await client.get(`connection:${id}`);
    return data ? JSON.parse(data) : null;
  }

  async setConnection(connection: TrackerConnection): Promise<void> {
    const client = await this.getClient();
    await client.set(`connection:${connection.id}`, JSON.stringify(connection));
  }

  async listConnections(): Promise<TrackerConnection[]> {
    const client = await this.getClient();
    const keys = await client.keys('connection:*');
    const results: TrackerConnection[] = [];

    for (const key of keys) {
      const data = await client.get(key);
      if (data) {
        results.push(JSON.parse(data));
      }
    }

    return results;
  }

  // Issue cache operations
  async getIssue(id: string): Promise<IssueCache | null> {
    const client = await this.getClient();
    const data = await client.get(`issue:${id}`);
    return data ? JSON.parse(data) : null;
  }

  async getIssueByKey(key: string): Promise<IssueCache | null> {
    const client = await this.getClient();
    const data = await client.get(`issue-key:${key}`);
    return data ? JSON.parse(data) : null;
  }

  async setIssue(issue: IssueCache): Promise<void> {
    const client = await this.getClient();
    await client.set(`issue:${issue.id}`, JSON.stringify(issue));
    await client.set(`issue-key:${issue.remote_issue_key}`, JSON.stringify(issue));
  }

  async deleteIssue(id: string): Promise<boolean> {
    const client = await this.getClient();
    const issue = await this.getIssue(id);
    if (issue) {
      await client.del(`issue-key:${issue.remote_issue_key}`);
    }
    const result = await client.del(`issue:${id}`);
    return result > 0;
  }

  // PR cache operations
  async getPR(id: string): Promise<PRCache | null> {
    const client = await this.getClient();
    const data = await client.get(`pr:${id}`);
    return data ? JSON.parse(data) : null;
  }

  async getPRByKey(key: string): Promise<PRCache | null> {
    const client = await this.getClient();
    const data = await client.get(`pr-key:${key}`);
    return data ? JSON.parse(data) : null;
  }

  async setPR(pr: PRCache): Promise<void> {
    const client = await this.getClient();
    await client.set(`pr:${pr.id}`, JSON.stringify(pr));
    await client.set(`pr-key:${pr.remote_pr_key}`, JSON.stringify(pr));
  }

  async deletePR(id: string): Promise<boolean> {
    const client = await this.getClient();
    const pr = await this.getPR(id);
    if (pr) {
      await client.del(`pr-key:${pr.remote_pr_key}`);
    }
    const result = await client.del(`pr:${id}`);
    return result > 0;
  }

  // Project item cache operations
  async getProjectItem(id: string): Promise<ProjectItemCache | null> {
    const client = await this.getClient();
    const data = await client.get(`project-item:${id}`);
    return data ? JSON.parse(data) : null;
  }

  async setProjectItem(item: ProjectItemCache): Promise<void> {
    const client = await this.getClient();
    await client.set(`project-item:${item.id}`, JSON.stringify(item));
  }

  async deleteProjectItem(id: string): Promise<boolean> {
    const client = await this.getClient();
    const result = await client.del(`project-item:${id}`);
    return result > 0;
  }

  // Entity link operations
  async getEntityLink(id: string): Promise<EntityLink | null> {
    const client = await this.getClient();
    const data = await client.get(`link:${id}`);
    return data ? JSON.parse(data) : null;
  }

  async getEntityLinksByLocalRef(localRef: string): Promise<EntityLink[]> {
    const client = await this.getClient();
    const data = await client.get(`links-by-local:${localRef}`);
    return data ? JSON.parse(data) : [];
  }

  async getEntityLinksByRemoteRef(remoteRef: string): Promise<EntityLink[]> {
    const client = await this.getClient();
    const data = await client.get(`links-by-remote:${remoteRef}`);
    return data ? JSON.parse(data) : [];
  }

  async setEntityLink(link: EntityLink): Promise<void> {
    const client = await this.getClient();
    await client.set(`link:${link.id}`, JSON.stringify(link));

    // Update indexes
    const byLocal = await this.getEntityLinksByLocalRef(link.local_ref);
    const localIndex = byLocal.findIndex(l => l.id === link.id);
    if (localIndex >= 0) {
      byLocal[localIndex] = link;
    } else {
      byLocal.push(link);
    }
    await client.set(`links-by-local:${link.local_ref}`, JSON.stringify(byLocal));

    const byRemote = await this.getEntityLinksByRemoteRef(link.remote_ref);
    const remoteIndex = byRemote.findIndex(l => l.id === link.id);
    if (remoteIndex >= 0) {
      byRemote[remoteIndex] = link;
    } else {
      byRemote.push(link);
    }
    await client.set(`links-by-remote:${link.remote_ref}`, JSON.stringify(byRemote));
  }

  async deleteEntityLink(id: string): Promise<boolean> {
    const client = await this.getClient();
    const link = await this.getEntityLink(id);
    if (link) {
      const byLocal = await this.getEntityLinksByLocalRef(link.local_ref);
      const filtered = byLocal.filter(l => l.id !== id);
      await client.set(`links-by-local:${link.local_ref}`, JSON.stringify(filtered));

      const byRemote = await this.getEntityLinksByRemoteRef(link.remote_ref);
      const filteredRemote = byRemote.filter(l => l.id !== id);
      await client.set(`links-by-remote:${link.remote_ref}`, JSON.stringify(filteredRemote));
    }
    const result = await client.del(`link:${id}`);
    return result > 0;
  }

  // Sync event operations
  async getSyncEvent(id: string): Promise<SyncEvent | null> {
    const client = await this.getClient();
    const data = await client.get(`sync:${id}`);
    return data ? JSON.parse(data) : null;
  }

  async getSyncEventsByEntity(entityType: string, entityId: string, limit: number = 10): Promise<SyncEvent[]> {
    const client = await this.getClient();
    const data = await client.get(`sync-by-entity:${entityType}:${entityId}`);
    const events: SyncEvent[] = data ? JSON.parse(data) : [];
    return events.slice(0, limit);
  }

  async setSyncEvent(event: SyncEvent): Promise<void> {
    const client = await this.getClient();
    await client.set(`sync:${event.id}`, JSON.stringify(event));

    if (event.local_ref) {
      const key = `sync-by-entity:task:${event.local_ref.split(':')[3] ?? 'unknown'}`;
      const data = await client.get(key);
      const events: SyncEvent[] = data ? JSON.parse(data) : [];
      events.unshift(event);
      await client.set(key, JSON.stringify(events.slice(0, 100)));
    }
  }

  // Comment operations
  async getComments(entityType: string, entityId: string): Promise<CommentCache[]> {
    const client = await this.getClient();
    const data = await client.get(`comments:${entityType}:${entityId}`);
    return data ? JSON.parse(data) : [];
  }

  async setComment(comment: CommentCache): Promise<void> {
    const client = await this.getClient();
    const key = `comments:${comment.entity_type}:${comment.entity_id}`;
    const data = await client.get(key);
    const comments: CommentCache[] = data ? JSON.parse(data) : [];
    const index = comments.findIndex(c => c.id === comment.id);
    if (index >= 0) {
      comments[index] = comment;
    } else {
      comments.push(comment);
    }
    await client.set(key, JSON.stringify(comments));
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.client = null;
    }
  }
}