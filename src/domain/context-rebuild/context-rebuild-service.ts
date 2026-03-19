import type { TrackerContext } from '../context-bundle/context-bundle.js';
import type { Purpose, DecisionDigest, OpenQuestionDigest } from '../context-bundle/context-bundle.js';
import { getLogger } from '../../monitoring/index.js';

const logger = getLogger();

/**
 * Link role types for entity relationships
 */
export type LinkRole = 'primary' | 'related' | 'duplicate' | 'blocks' | 'caused_by';

/**
 * Tracker bridge configuration
 */
export interface TrackerBridgeConfig {
  /** Base URL for tracker-bridge-materials API */
  baseUrl?: string;
  /** Connection reference for GitHub */
  connectionRef?: string;
  /** Request timeout in ms */
  timeout?: number;
}

/**
 * External reference types
 */
export interface ExternalRef {
  kind: 'github_issue' | 'github_pr' | 'github_project_item' | 'jira_issue' | 'linear_issue' | 'sync_event' | 'entity_link' | string;
  value: string;
  connection_ref?: string;
  url?: string;
  link_role?: LinkRole;
  metadata_json?: string;
}

/**
 * Issue cache entry
 */
export interface IssueCacheEntry {
  issue_id: string;
  provider: 'github' | 'jira' | 'linear' | 'other';
  owner?: string;
  repo?: string;
  title: string;
  body?: string;
  state: string;
  labels?: string[];
  assignees?: string[];
  milestone?: string;
  created_at: string;
  updated_at: string;
  cached_at: string;
  etag?: string;
  /** Raw JSON response from API - for debugging and full context */
  raw_json?: string;
}

/**
 * PR cache entry
 */
export interface PRCacheEntry {
  pr_id: string;
  provider: 'github' | 'gitlab';
  owner: string;
  repo: string;
  title: string;
  body?: string;
  state: 'open' | 'closed' | 'merged';
  author: string;
  base_branch: string;
  head_branch: string;
  mergeable?: boolean;
  draft: boolean;
  files_changed: number;
  additions: number;
  deletions: number;
  commits: number;
  created_at: string;
  updated_at: string;
  cached_at: string;
}

/**
 * Comment data
 */
export interface CommentData {
  comment_id: string;
  author: string;
  body: string;
  created_at: string;
  updated_at?: string;
  reaction_summary?: Record<string, number>;
}

/**
 * Sync event
 */
export interface SyncEvent {
  sync_id: string;
  source: string;
  entity_type: 'issue' | 'pr' | 'project_item' | 'comment' | string;
  entity_id: string;
  operation: 'create' | 'update' | 'delete' | 'link' | 'unlink';
  occurred_at: string;
  /** SHA256 fingerprint for idempotency */
  fingerprint?: string;
  /** Sync direction: inbound (from tracker) or outbound (to tracker) */
  direction?: 'inbound' | 'outbound';
  /** Processing status */
  status?: 'pending' | 'applied' | 'failed' | 'skipped';
  /** When the event was processed */
  processed_at?: string;
  /** Hash of the payload for verification */
  payload_hash?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Entity link request
 */
export interface EntityLinkRequest {
  typed_ref: string;
  entity_ref: string;
  connection_ref?: string;
  link_role?: LinkRole;
  metadata_json?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Entity link result
 */
export interface EntityLinkResult {
  success: boolean;
  sync_event_ref: string;
  external_refs: ExternalRef[];
  linked_at: string;
}

/**
 * Context rebuild request
 */
export interface ContextRebuildRequest {
  task_id: string;
  typed_ref: string;
  tracker_refs: ExternalRef[];
  include_comments?: boolean;
  include_linked_prs?: boolean;
  include_commits?: boolean;
  include_project_items?: boolean;
  max_comment_count?: number;
  stale_after_ms?: number;
  /** Purpose of context rebuild - aligns with agent-taskstate */
  purpose?: Purpose;
  /** Decision digest from previous context */
  decision_digest?: DecisionDigest[];
  /** Open question digest from previous context */
  open_question_digest?: OpenQuestionDigest[];
}

/**
 * Rebuilt context result
 */
export interface RebuiltContext {
  task_id: string;
  typed_ref: string;
  rebuilt_at: string;

  /** Purpose of context rebuild - aligns with agent-taskstate */
  purpose?: Purpose;

  /** Decision digest - carries forward from request */
  decision_digest?: DecisionDigest[];

  /** Open question digest - carries forward from request */
  open_question_digest?: OpenQuestionDigest[];

  /** Issue summaries */
  issues: Array<{
    issue_id: string;
    provider: string;
    title: string;
    state: string;
    labels: string[];
    summary?: string;
    url?: string;
  }>;

  /** Related PRs */
  related_prs: Array<{
    pr_id: string;
    provider: string;
    title: string;
    state: string;
    author: string;
    url?: string;
  }>;

  /** Project items */
  project_items: Array<{
    item_id: string;
    project_name: string;
    status: string;
    custom_fields?: Record<string, string | number>;
  }>;

  /** Comments summary */
  comments_summary?: {
    total_count: number;
    last_activity?: string;
    participants: string[];
    sentiment?: 'positive' | 'neutral' | 'negative' | 'mixed';
  };

  /** Commit activity */
  commit_activity?: {
    total_commits: number;
    authors: string[];
    last_commit?: string;
  };

  /** Sync events */
  sync_events: Array<{
    sync_id: string;
    source: string;
    occurred_at: string;
    operation: string;
  }>;

  /** Activity timeline */
  activity_timeline: Array<{
    timestamp: string;
    event_type: string;
    actor?: string;
    summary: string;
  }>;

  /** Staleness info */
  staleness: {
    is_stale: boolean;
    stale_refs: string[];
    oldest_cache?: string;
  };

  /** Tracker context for ContextBundle */
  tracker_context?: TrackerContext;
}

/**
 * Connection status
 */
export interface ConnectionStatus {
  connection_ref: string;
  provider: string;
  status: 'active' | 'inactive' | 'error';
  last_sync?: string;
  rate_limit_remaining?: number;
  error_message?: string;
}

/**
 * Context Rebuild Service
 *
 * Integrates with tracker-bridge-materials to rebuild task context
 * from issue, PR, and project data.
 */
export class ContextRebuildService {
  private baseUrl: string;
  private connectionRef: string;
  private timeout: number;

  constructor(config: TrackerBridgeConfig = {}) {
    this.baseUrl = config.baseUrl || 'http://localhost:8081';
    this.connectionRef = config.connectionRef || 'github-main';
    this.timeout = config.timeout || 30000;
  }

  /**
   * Rebuild context from tracker references
   */
  async rebuildContext(request: ContextRebuildRequest): Promise<RebuiltContext> {
    const {
      task_id,
      typed_ref,
      tracker_refs,
      include_comments = true,
      include_linked_prs = true,
      max_comment_count = 50,
      stale_after_ms = 24 * 60 * 60 * 1000, // 24 hours
    } = request;

    const now = new Date().toISOString();
    const issues: RebuiltContext['issues'] = [];
    const related_prs: RebuiltContext['related_prs'] = [];
    const project_items: RebuiltContext['project_items'] = [];
    const sync_events: RebuiltContext['sync_events'] = [];
    const activity_timeline: RebuiltContext['activity_timeline'] = [];
    const staleRefs: string[] = [];
    let oldestCache: string | undefined;

    // Process each tracker reference
    for (const ref of tracker_refs) {
      switch (ref.kind) {
        case 'github_issue': {
          const issue = await this.fetchIssue(ref.value, ref.connection_ref);
          if (issue) {
            issues.push({
              issue_id: issue.issue_id,
              provider: issue.provider,
              title: issue.title,
              state: issue.state,
              labels: issue.labels || [],
              url: ref.url,
            });

            // Check staleness
            const cachedAtTime = new Date(issue.cached_at).getTime();
            const nowTime = Date.now();
            const cacheAgeMs = nowTime - cachedAtTime;
            if (cacheAgeMs > stale_after_ms) {
              staleRefs.push(`github_issue:${issue.issue_id}`);
              if (!oldestCache || issue.cached_at < oldestCache) {
                oldestCache = issue.cached_at;
              }
            }

            // Add to timeline
            activity_timeline.push({
              timestamp: issue.updated_at,
              event_type: 'issue_update',
              summary: `Issue #${issue.issue_id} ${issue.state}: ${issue.title}`,
            });

            // Fetch comments if requested
            if (include_comments) {
              const comments = await this.fetchComments('issue', ref.value);
              for (const comment of comments.slice(0, max_comment_count)) {
                activity_timeline.push({
                  timestamp: comment.created_at,
                  event_type: 'comment',
                  actor: comment.author,
                  summary: `Comment on #${issue.issue_id}`,
                });
              }
            }

            // Fetch linked PRs if requested
            if (include_linked_prs) {
              const linkedPRs = await this.fetchLinkedPRs(ref.value);
              for (const pr of linkedPRs) {
                related_prs.push({
                  pr_id: pr.pr_id,
                  provider: pr.provider,
                  title: pr.title,
                  state: pr.state,
                  author: pr.author,
                  url: `https://github.com/${pr.owner}/${pr.repo}/pull/${pr.pr_id}`,
                });
              }
            }
          }
          break;
        }

        case 'github_pr': {
          const pr = await this.fetchPR(ref.value, ref.connection_ref);
          if (pr) {
            related_prs.push({
              pr_id: pr.pr_id,
              provider: pr.provider,
              title: pr.title,
              state: pr.state,
              author: pr.author,
              url: ref.url,
            });
          }
          break;
        }

        case 'github_project_item': {
          const item = await this.fetchProjectItem(ref.value);
          if (item) {
            project_items.push(item);
          }
          break;
        }

        case 'sync_event': {
          const syncEvent = await this.fetchSyncEvent(ref.value);
          if (syncEvent) {
            sync_events.push({
              sync_id: syncEvent.sync_id,
              source: syncEvent.source,
              occurred_at: syncEvent.occurred_at,
              operation: syncEvent.operation,
            });
          }
          break;
        }
      }
    }

    // Sort activity timeline by timestamp
    activity_timeline.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    // Build comments summary
    const comments_summary: RebuiltContext['comments_summary'] = {
      total_count: activity_timeline.filter(e => e.event_type === 'comment').length,
      last_activity: activity_timeline[activity_timeline.length - 1]?.timestamp,
      participants: [...new Set(activity_timeline.map(e => e.actor).filter(Boolean) as string[])],
    };

    // Build tracker context for ContextBundle
    const tracker_context: TrackerContext = {
      issues: issues.map(i => ({
        provider: i.provider as 'github' | 'jira' | 'linear' | 'other',
        issue_id: i.issue_id,
        title: i.title,
        state: i.state,
        labels: i.labels,
        url: i.url,
      })),
      project_items: project_items.map(p => ({
        project_name: p.project_name,
        item_id: p.item_id,
        status: p.status,
        custom_fields: p.custom_fields,
      })),
      external_refs: tracker_refs,
      sync_events: sync_events.map(s => ({
        sync_id: s.sync_id,
        source: s.source,
        timestamp: s.occurred_at,
      })),
    };

    return {
      task_id,
      typed_ref,
      rebuilt_at: now,
      purpose: request.purpose,
      decision_digest: request.decision_digest,
      open_question_digest: request.open_question_digest,
      issues,
      related_prs,
      project_items,
      comments_summary,
      sync_events,
      activity_timeline,
      staleness: {
        is_stale: staleRefs.length > 0,
        stale_refs: staleRefs,
        oldest_cache: oldestCache,
      },
      tracker_context,
    };
  }

  /**
   * Link entity to task
   */
  async linkEntity(request: EntityLinkRequest): Promise<EntityLinkResult> {
    const response = await this.fetchApi('/api/v1/entity/link', {
      method: 'POST',
      body: JSON.stringify({
        typed_ref: request.typed_ref,
        entity_ref: request.entity_ref,
        connection_ref: request.connection_ref || this.connectionRef,
        link_role: request.link_role,
        metadata_json: request.metadata_json,
        metadata: request.metadata,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to link entity: ${response.status}`);
    }

    return response.json() as Promise<EntityLinkResult>;
  }

  /**
   * Unlink entity from task
   */
  async unlinkEntity(typedRef: string, entityRef: string): Promise<void> {
    const response = await this.fetchApi('/api/v1/entity/unlink', {
      method: 'POST',
      body: JSON.stringify({
        typed_ref: typedRef,
        entity_ref: entityRef,
      }),
    });

    if (!response.ok && response.status !== 404) {
      throw new Error(`Failed to unlink entity: ${response.status}`);
    }
  }

  /**
   * Get connection status
   */
  async getConnectionStatus(connectionRef?: string): Promise<ConnectionStatus> {
    const ref = connectionRef || this.connectionRef;

    const response = await this.fetchApi(`/api/v1/connections/${ref}/status`);

    if (!response.ok) {
      return {
        connection_ref: ref,
        provider: 'unknown',
        status: 'error',
        error_message: `Connection not found: ${response.status}`,
      };
    }

    return response.json() as Promise<ConnectionStatus>;
  }

  /**
   * List available connections
   */
  async listConnections(): Promise<ConnectionStatus[]> {
    const response = await this.fetchApi('/api/v1/connections');

    if (!response.ok) {
      return [];
    }

    const data = await response.json() as { connections?: ConnectionStatus[] };
    return data.connections || [];
  }

  /**
   * Invalidate cache for entity
   */
  async invalidateCache(entityType: string, entityId: string): Promise<void> {
    await this.fetchApi(`/api/v1/cache/${entityType}/${entityId}`, {
      method: 'DELETE',
    });
  }

  /**
   * Get sync events for entity
   */
  async getSyncEvents(
    entityType: string,
    entityId: string,
    options?: { limit?: number; since?: string }
  ): Promise<SyncEvent[]> {
    const params = new URLSearchParams();
    if (options?.limit) params.set('limit', String(options.limit));
    if (options?.since) params.set('since', options.since);

    const response = await this.fetchApi(
      `/api/v1/sync-events/${entityType}/${entityId}?${params}`
    );

    if (!response.ok) {
      return [];
    }

    const data = await response.json() as { events?: SyncEvent[] };
    return data.events || [];
  }

  // Private methods

  private async fetchApi(path: string, options?: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...options?.headers,
        },
        signal: controller.signal,
      });
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async fetchIssue(issueId: string, connectionRef?: string): Promise<IssueCacheEntry | null> {
    try {
      const response = await this.fetchApi(
        `/api/v1/cache/issue/${issueId}?connection=${connectionRef || this.connectionRef}`
      );

      if (!response.ok) return null;

      return response.json() as Promise<IssueCacheEntry>;
    } catch (error) {
      logger.debug('Failed to fetch issue from cache', { issueId, error: String(error) });
      return null;
    }
  }

  private async fetchPR(prId: string, connectionRef?: string): Promise<PRCacheEntry | null> {
    try {
      const response = await this.fetchApi(
        `/api/v1/cache/pr/${prId}?connection=${connectionRef || this.connectionRef}`
      );

      if (!response.ok) return null;

      return response.json() as Promise<PRCacheEntry>;
    } catch (error) {
      logger.debug('Failed to fetch PR from cache', { prId, error: String(error) });
      return null;
    }
  }

  private async fetchComments(entityType: string, entityId: string): Promise<CommentData[]> {
    try {
      const response = await this.fetchApi(
        `/api/v1/cache/${entityType}/${entityId}/comments`
      );

      if (!response.ok) return [];

      const data = await response.json() as { comments?: CommentData[] };
      return data.comments || [];
    } catch (error) {
      logger.debug('Failed to fetch comments', { entityType, entityId, error: String(error) });
      return [];
    }
  }

  private async fetchLinkedPRs(issueId: string): Promise<PRCacheEntry[]> {
    try {
      const response = await this.fetchApi(
        `/api/v1/cache/issue/${issueId}/linked-prs`
      );

      if (!response.ok) return [];

      const data = await response.json() as { prs?: PRCacheEntry[] };
      return data.prs || [];
    } catch (error) {
      logger.debug('Failed to fetch linked PRs', { issueId, error: String(error) });
      return [];
    }
  }

  private async fetchProjectItem(itemId: string): Promise<RebuiltContext['project_items'][0] | null> {
    try {
      const response = await this.fetchApi(`/api/v1/cache/project-item/${itemId}`);

      if (!response.ok) return null;

      const data = await response.json() as {
        item_id: string;
        project_name: string;
        status: string;
        custom_fields?: Record<string, string | number>;
      };
      return {
        item_id: data.item_id,
        project_name: data.project_name,
        status: data.status,
        custom_fields: data.custom_fields,
      };
    } catch (error) {
      logger.debug('Failed to fetch project item', { itemId, error: String(error) });
      return null;
    }
  }

  private async fetchSyncEvent(syncId: string): Promise<SyncEvent | null> {
    try {
      const response = await this.fetchApi(`/api/v1/sync-events/${syncId}`);

      if (!response.ok) return null;

      return response.json() as Promise<SyncEvent>;
    } catch (error) {
      logger.debug('Failed to fetch sync event', { syncId, error: String(error) });
      return null;
    }
  }
}

/**
 * Default context rebuild service instance
 */
export const defaultContextRebuildService = new ContextRebuildService();