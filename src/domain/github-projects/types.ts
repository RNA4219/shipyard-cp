import type { TaskState } from '../../types.js';

/**
 * GitHub Projects v2 Field Types
 */
export interface ProjectV2Field {
  id: string;
  name: string;
  dataType: 'TEXT' | 'NUMBER' | 'DATE' | 'SINGLE_SELECT' | 'ITERATION';
}

export interface ProjectV2SingleSelectField extends ProjectV2Field {
  dataType: 'SINGLE_SELECT';
  options: ProjectV2SingleSelectOption[];
}

export interface ProjectV2SingleSelectOption {
  id: string;
  name: string;
  color?: string;
}

/**
 * Project V2 structure
 */
export interface ProjectV2 {
  id: string;
  number: number;
  title: string;
  shortDescription?: string;
  public?: boolean;
  closed?: boolean;
  fields: ProjectV2Field[];
  owner: {
    login: string;
    type: 'Organization' | 'User';
  };
}

/**
 * Project V2 Item
 */
export interface ProjectV2Item {
  id: string;
  content?: {
    type: 'Issue' | 'PullRequest' | 'DraftIssue';
    number?: number;
    title: string;
    state?: string;
    body?: string;
    url?: string;
  };
  fieldValues: ProjectV2ItemFieldValue[];
  createdAt: string;
  updatedAt: string;
}

export interface ProjectV2ItemFieldValue {
  field: { id: string; name: string };
  value: string | number | null;
}

/**
 * Field value input types
 */
export type ProjectV2FieldValueInput =
  | { text: string }
  | { number: number }
  | { date: string }
  | { singleSelectOptionId: string }
  | { iterationId: string };

/**
 * Authentication options
 */
export interface GitHubProjectsAuth {
  /** Personal Access Token or GitHub App installation token */
  token: string;
  /** Token type for logging/debugging */
  tokenType: 'pat' | 'github_app' | 'oauth';
}

/**
 * Client configuration
 */
export interface GitHubProjectsClientConfig {
  auth: GitHubProjectsAuth;
  /** GraphQL API endpoint (default: https://api.github.com/graphql) */
  baseUrl?: string;
  /** Request timeout in ms (default: 30000) */
  timeout?: number;
}

/**
 * Get project input
 */
export interface GetProjectInput {
  owner: string;
  projectNumber: number;
}

/**
 * Add item input
 */
export interface AddProjectItemInput {
  projectId: string;
  /** Repository content ID (Issue or PR node ID), or draft issue content */
  contentId?: string;
  /** For draft issues */
  draftIssue?: {
    title: string;
    body?: string;
  };
}

/**
 * Update item field input
 */
export interface UpdateItemFieldInput {
  projectId: string;
  itemId: string;
  fieldId: string;
  value: ProjectV2FieldValueInput;
}

/**
 * Delete item input
 */
export interface DeleteProjectItemInput {
  projectId: string;
  itemId: string;
}

/**
 * API response wrapper
 */
export interface GitHubGraphQLResponse<T> {
  data?: T;
  errors?: Array<{
    message: string;
    type: string;
    path: string[];
    locations: Array<{ line: number; column: number }>;
  }>;
}

/**
 * Rate limit info from response headers
 */
export interface RateLimitInfo {
  limit: number;
  remaining: number;
  resetAt: Date;
}

/**
 * API error
 */
export class GitHubProjectsError extends Error {
  constructor(
    message: string,
    public readonly type: 'graphql_error' | 'auth_error' | 'rate_limit' | 'network_error' | 'validation_error',
    public readonly errors?: Array<{ message: string; type: string }>
  ) {
    super(message);
    this.name = 'GitHubProjectsError';
  }
}

/**
 * Task state to project status mapping
 *
 * Maps internal task states to GitHub Project status field values.
 * The GitHub Project has 3 status options: "Todo", "In Progress", "Done"
 */
export const TASK_STATE_TO_STATUS: Record<TaskState, string> = {
  'queued': 'Todo',
  'planning': 'Todo',
  'planned': 'Todo',
  'developing': 'In Progress',
  'dev_completed': 'In Progress',
  'accepting': 'In Progress',
  'accepted': 'Done',
  'rework_required': 'In Progress',
  'integrating': 'In Progress',
  'integrated': 'Todo',
  'publish_pending_approval': 'Todo',
  'publishing': 'In Progress',
  'published': 'Done',
  'cancelled': 'Done',
  'failed': 'Done',
  'blocked': 'Todo',
};

/**
 * Status categories for fallback mapping
 * Used when exact status name is not found in the project
 */
export const STATUS_FALLBACK: Record<string, string[]> = {
  'todo': ['queued', 'planning', 'planned', 'blocked', 'integrated', 'publish_pending_approval'],
  'in progress': ['developing', 'dev_completed', 'accepting', 'integrating', 'publishing', 'rework_required'],
  'done': ['accepted', 'published', 'cancelled', 'failed'],
};