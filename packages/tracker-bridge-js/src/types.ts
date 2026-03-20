/**
 * tracker-bridge-js type definitions
 * Based on tracker-bridge-materials Python models
 */

/**
 * Tracker connection configuration
 */
export interface TrackerConnection {
  id: string;
  tracker_type: string;
  name: string;
  base_url: string;
  workspace_key?: string;
  project_key?: string;
  secret_ref?: string;
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
  metadata_json?: string;
}

/**
 * Issue cache entry
 */
export interface IssueCache {
  id: string;
  tracker_connection_id: string;
  remote_issue_id: string;
  remote_issue_key: string;
  title: string;
  status?: string;
  assignee?: string;
  reporter?: string;
  labels_json?: string;
  issue_type?: string;
  priority?: string;
  raw_json: string;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
}

/**
 * Pull request cache entry
 */
export interface PRCache {
  id: string;
  tracker_connection_id: string;
  remote_pr_id: string;
  remote_pr_key: string;
  title: string;
  status?: string;
  author?: string;
  base_branch?: string;
  head_branch?: string;
  mergeable?: boolean;
  draft?: boolean;
  files_changed?: number;
  additions?: number;
  deletions?: number;
  commits?: number;
  raw_json: string;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
}

/**
 * Project item cache entry
 */
export interface ProjectItemCache {
  id: string;
  tracker_connection_id: string;
  remote_item_id: string;
  project_name?: string;
  status?: string;
  custom_fields_json?: string;
  raw_json: string;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
}

/**
 * Entity link between local and remote entities
 */
export interface EntityLink {
  id: string;
  local_ref: string;
  remote_ref: string;
  link_role: string;
  created_at: string;
  updated_at: string;
  metadata_json?: string;
}

/**
 * Sync event for tracking synchronization operations
 */
export interface SyncEvent {
  id: string;
  tracker_connection_id: string;
  direction: 'inbound' | 'outbound';
  remote_ref: string;
  local_ref?: string;
  event_type: string;
  fingerprint?: string;
  payload_json: string;
  status: 'pending' | 'applied' | 'failed' | 'skipped';
  error_message?: string;
  occurred_at: string;
  processed_at?: string;
  created_at: string;
}

/**
 * Normalized issue for cross-tracker compatibility
 */
export interface NormalizedIssue {
  remote_issue_id: string;
  remote_issue_key: string;
  title: string;
  status?: string;
  assignee?: string;
  reporter?: string;
  labels: string[];
  issue_type?: string;
  priority?: string;
  raw: Record<string, unknown>;
}

/**
 * Normalized PR for cross-tracker compatibility
 */
export interface NormalizedPR {
  remote_pr_id: string;
  remote_pr_key: string;
  title: string;
  status?: string;
  author?: string;
  base_branch?: string;
  head_branch?: string;
  mergeable?: boolean;
  draft?: boolean;
  files_changed?: number;
  additions?: number;
  deletions?: number;
  commits?: number;
  raw: Record<string, unknown>;
}

/**
 * Comment cache entry
 */
export interface CommentCache {
  id: string;
  entity_type: 'issue' | 'pr' | 'project_item';
  entity_id: string;
  remote_comment_id: string;
  author: string;
  body: string;
  created_at: string;
  updated_at?: string;
  reaction_summary?: Record<string, number>;
}

/**
 * Link entity request
 */
export interface LinkEntityRequest {
  typed_ref: string;
  entity_ref: string;
  connection_ref?: string;
  link_role?: string;
  metadata_json?: string;
}

/**
 * Link entity response
 */
export interface LinkEntityResponse {
  success: boolean;
  sync_event_ref: string;
  external_refs: Array<{
    kind: string;
    value: string;
    connection_ref?: string;
  }>;
  linked_at: string;
}

/**
 * Unlink entity request
 */
export interface UnlinkEntityRequest {
  typed_ref: string;
  entity_ref: string;
}

/**
 * Unlink entity response
 */
export interface UnlinkEntityResponse {
  success: boolean;
  sync_event_ref: string;
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