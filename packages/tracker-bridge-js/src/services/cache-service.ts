/**
 * Cache service for issue/PR/project item operations
 */

import type { StoreBackend } from '../store/store-backend.js';
import type {
  IssueCache,
  PRCache,
  ProjectItemCache,
  CommentCache,
  NormalizedIssue,
  NormalizedPR,
} from '../types.js';
import { randomUUID } from 'crypto';

/**
 * Cache service configuration
 */
export interface CacheServiceConfig {
  backend: StoreBackend;
}

/**
 * Cache service for tracker entities
 */
export class CacheService {
  private backend: StoreBackend;

  constructor(config: CacheServiceConfig) {
    this.backend = config.backend;
  }

  // Issue operations

  /**
   * Get cached issue by ID
   */
  async getIssue(id: string): Promise<IssueCache | null> {
    return this.backend.getIssue(id);
  }

  /**
   * Get cached issue by key (e.g., PROJ-123)
   */
  async getIssueByKey(key: string): Promise<IssueCache | null> {
    return this.backend.getIssueByKey(key);
  }

  /**
   * Cache an issue
   */
  async cacheIssue(trackerConnectionId: string, normalized: NormalizedIssue): Promise<IssueCache> {
    const now = new Date().toISOString();

    const issue: IssueCache = {
      id: randomUUID(),
      tracker_connection_id: trackerConnectionId,
      remote_issue_id: normalized.remote_issue_id,
      remote_issue_key: normalized.remote_issue_key,
      title: normalized.title,
      status: normalized.status,
      assignee: normalized.assignee,
      reporter: normalized.reporter,
      labels_json: JSON.stringify(normalized.labels),
      issue_type: normalized.issue_type,
      priority: normalized.priority,
      raw_json: JSON.stringify(normalized.raw),
      last_seen_at: now,
      created_at: now,
      updated_at: now,
    };

    await this.backend.setIssue(issue);
    return issue;
  }

  /**
   * Invalidate issue cache
   */
  async invalidateIssue(id: string): Promise<boolean> {
    return this.backend.deleteIssue(id);
  }

  // PR operations

  /**
   * Get cached PR by ID
   */
  async getPR(id: string): Promise<PRCache | null> {
    return this.backend.getPR(id);
  }

  /**
   * Get cached PR by key
   */
  async getPRByKey(key: string): Promise<PRCache | null> {
    return this.backend.getPRByKey(key);
  }

  /**
   * Cache a PR
   */
  async cachePR(trackerConnectionId: string, normalized: NormalizedPR): Promise<PRCache> {
    const now = new Date().toISOString();

    const pr: PRCache = {
      id: randomUUID(),
      tracker_connection_id: trackerConnectionId,
      remote_pr_id: normalized.remote_pr_id,
      remote_pr_key: normalized.remote_pr_key,
      title: normalized.title,
      status: normalized.status,
      author: normalized.author,
      base_branch: normalized.base_branch,
      head_branch: normalized.head_branch,
      mergeable: normalized.mergeable,
      draft: normalized.draft,
      files_changed: normalized.files_changed,
      additions: normalized.additions,
      deletions: normalized.deletions,
      commits: normalized.commits,
      raw_json: JSON.stringify(normalized.raw),
      last_seen_at: now,
      created_at: now,
      updated_at: now,
    };

    await this.backend.setPR(pr);
    return pr;
  }

  /**
   * Invalidate PR cache
   */
  async invalidatePR(id: string): Promise<boolean> {
    return this.backend.deletePR(id);
  }

  // Project item operations

  /**
   * Get cached project item by ID
   */
  async getProjectItem(id: string): Promise<ProjectItemCache | null> {
    return this.backend.getProjectItem(id);
  }

  /**
   * Cache a project item
   */
  async cacheProjectItem(
    trackerConnectionId: string,
    remoteItemId: string,
    data: {
      projectName?: string;
      status?: string;
      customFields?: Record<string, unknown>;
      raw?: Record<string, unknown>;
    }
  ): Promise<ProjectItemCache> {
    const now = new Date().toISOString();

    const item: ProjectItemCache = {
      id: randomUUID(),
      tracker_connection_id: trackerConnectionId,
      remote_item_id: remoteItemId,
      project_name: data.projectName,
      status: data.status,
      custom_fields_json: data.customFields ? JSON.stringify(data.customFields) : undefined,
      raw_json: data.raw ? JSON.stringify(data.raw) : '{}',
      last_seen_at: now,
      created_at: now,
      updated_at: now,
    };

    await this.backend.setProjectItem(item);
    return item;
  }

  /**
   * Invalidate project item cache
   */
  async invalidateProjectItem(id: string): Promise<boolean> {
    return this.backend.deleteProjectItem(id);
  }

  // Comment operations

  /**
   * Get comments for an entity
   */
  async getComments(entityType: 'issue' | 'pr' | 'project_item', entityId: string): Promise<CommentCache[]> {
    return this.backend.getComments(entityType, entityId);
  }

  /**
   * Add a comment
   */
  async addComment(
    entityType: 'issue' | 'pr' | 'project_item',
    entityId: string,
    data: {
      remoteCommentId: string;
      author: string;
      body: string;
      reactionSummary?: Record<string, number>;
    }
  ): Promise<CommentCache> {
    const now = new Date().toISOString();

    const comment: CommentCache = {
      id: randomUUID(),
      entity_type: entityType,
      entity_id: entityId,
      remote_comment_id: data.remoteCommentId,
      author: data.author,
      body: data.body,
      created_at: now,
      reaction_summary: data.reactionSummary,
    };

    await this.backend.setComment(comment);
    return comment;
  }

  /**
   * Get linked PRs for an issue
   * Returns PRs that reference the issue in their body
   */
  async getLinkedPRs(_issueId: string): Promise<PRCache[]> {
    // This would typically query the actual tracker API
    // For now, return empty array
    return [];
  }
}