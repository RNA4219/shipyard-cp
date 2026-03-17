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
 * The actual status names in a project may vary, so mapStateToStatus
 * uses fuzzy matching to find appropriate options.
 */
export const TASK_STATE_TO_STATUS: Record<TaskState, string> = {
  'queued': 'Todo',
  'planning': 'Planning',
  'planned': 'Ready',
  'developing': 'In Progress',
  'dev_completed': 'Review',
  'accepting': 'Testing',
  'accepted': 'Done',
  'rework_required': 'Rework',
  'integrating': 'Integrating',
  'integrated': 'Ready to Deploy',
  'publish_pending_approval': 'Pending Approval',
  'publishing': 'Deploying',
  'published': 'Done',
  'cancelled': 'Cancelled',
  'failed': 'Failed',
  'blocked': 'Blocked',
};

/**
 * Status categories for fallback mapping
 * Used when exact status name is not found in the project
 */
const STATUS_FALLBACK: Record<string, string[]> = {
  'todo': ['queued', 'planning', 'planned', 'blocked'],
  'in progress': ['developing', 'dev_completed', 'accepting', 'integrating', 'publishing', 'rework_required'],
  'done': ['accepted', 'published', 'cancelled', 'failed'],
};

/**
 * GitHub Projects v2 GraphQL Client
 *
 * Handles all GraphQL operations for GitHub Projects v2 API
 */
export class GitHubProjectsClient {
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly headers: Headers;
  private rateLimitInfo?: RateLimitInfo;

  constructor(config: GitHubProjectsClientConfig) {
    this.baseUrl = config.baseUrl || 'https://api.github.com/graphql';
    this.timeout = config.timeout || 30000;
    this.headers = new Headers({
      'Authorization': `Bearer ${config.auth.token}`,
      'Content-Type': 'application/json',
    });
  }

  /**
   * Execute a GraphQL query
   */
  private async executeGraphQL<T>(
    query: string,
    variables: Record<string, unknown>
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({ query, variables }),
        signal: controller.signal,
      });

      // Update rate limit info from headers
      const limit = response.headers.get('x-ratelimit-limit');
      const remaining = response.headers.get('x-ratelimit-remaining');
      const reset = response.headers.get('x-ratelimit-reset');

      if (limit && remaining && reset) {
        this.rateLimitInfo = {
          limit: parseInt(limit),
          remaining: parseInt(remaining),
          resetAt: new Date(parseInt(reset) * 1000),
        };
      }

      if (response.status === 401) {
        throw new GitHubProjectsError(
          'Authentication failed. Check your token.',
          'auth_error'
        );
      }

      if (response.status === 403) {
        const remaining = this.rateLimitInfo?.remaining ?? 0;
        if (remaining === 0) {
          throw new GitHubProjectsError(
            'Rate limit exceeded',
            'rate_limit',
            undefined
          );
        }
        throw new GitHubProjectsError(
          'Forbidden. Check token permissions.',
          'auth_error'
        );
      }

      const json: GitHubGraphQLResponse<T> = await response.json();

      if (json.errors && json.errors.length > 0) {
        throw new GitHubProjectsError(
          json.errors[0].message,
          'graphql_error',
          json.errors
        );
      }

      if (!json.data) {
        throw new GitHubProjectsError(
          'No data returned from GraphQL query',
          'graphql_error'
        );
      }

      return json.data;
    } catch (error) {
      if (error instanceof GitHubProjectsError) {
        throw error;
      }
      if (error instanceof Error && error.name === 'AbortError') {
        throw new GitHubProjectsError(
          'Request timed out',
          'network_error'
        );
      }
      throw new GitHubProjectsError(
        error instanceof Error ? error.message : 'Unknown error',
        'network_error'
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Get project details including fields
   */
  async getProject(input: GetProjectInput): Promise<ProjectV2> {
    const query = `
      query($owner: String!, $number: Int!) {
        organization(login: $owner) {
          projectV2(number: $number) {
            id
            number
            title
            shortDescription
            public
            closed
            fields(first: 100) {
              nodes {
                ... on ProjectV2Field {
                  id
                  name
                  dataType
                }
                ... on ProjectV2SingleSelectField {
                  id
                  name
                  dataType
                  options {
                    id
                    name
                    color
                  }
                }
                ... on ProjectV2IterationField {
                  id
                  name
                  dataType
                }
              }
            }
            owner {
              ... on Organization {
                login
              }
              ... on User {
                login
              }
            }
          }
        }
      }
    `;

    type OrgResponse = {
      organization: {
        projectV2: {
          id: string;
          number: number;
          title: string;
          shortDescription?: string;
          public?: boolean;
          closed?: boolean;
          fields: {
            nodes: Array<{
              id: string;
              name: string;
              dataType: string;
              options?: Array<{ id: string; name: string; color?: string }>;
            }>;
          };
          owner: { login: string };
        };
      };
    };

    type UserResponse = {
      user: {
        projectV2: {
          id: string;
          number: number;
          title: string;
          shortDescription?: string;
          public?: boolean;
          closed?: boolean;
          fields: {
            nodes: Array<{
              id: string;
              name: string;
              dataType: string;
              options?: Array<{ id: string; name: string; color?: string }>;
            }>;
          };
          owner: { login: string };
        };
      };
    };

    // Try organization first, then user
    let data: OrgResponse | UserResponse | null = null;
    let projectData: OrgResponse['organization']['projectV2'] | UserResponse['user']['projectV2'] | null = null;

    try {
      data = await this.executeGraphQL<OrgResponse>(query, {
        owner: input.owner,
        number: input.projectNumber,
      });
      projectData = data.organization?.projectV2 ?? null;
    } catch {
      // Ignore errors, will try user-owned project
    }

    // If org project not found, try user-owned project
    if (!projectData) {
      try {
        const userQuery = query.replace('organization', 'user');
        data = await this.executeGraphQL<UserResponse>(userQuery, {
          owner: input.owner,
          number: input.projectNumber,
        });
        projectData = data.user?.projectV2 ?? null;
      } catch {
        // Ignore errors
      }
    }

    if (!projectData) {
      throw new GitHubProjectsError(
        `Project ${input.owner}/${input.projectNumber} not found`,
        'validation_error'
      );
    }

    const fields: ProjectV2Field[] = projectData.fields.nodes.map((f) => {
      if (f.dataType === 'SINGLE_SELECT' && f.options) {
        return {
          id: f.id,
          name: f.name,
          dataType: 'SINGLE_SELECT' as const,
          options: f.options,
        } as ProjectV2SingleSelectField;
      }
      return {
        id: f.id,
        name: f.name,
        dataType: f.dataType as ProjectV2Field['dataType'],
      } as ProjectV2Field;
    });

    return {
      id: projectData.id,
      number: projectData.number,
      title: projectData.title,
      shortDescription: projectData.shortDescription,
      public: projectData.public,
      closed: projectData.closed,
      fields,
      owner: {
        login: projectData.owner.login,
        type: 'organization' in data ? 'Organization' : 'User',
      },
    };
  }

  /**
   * Add an item to a project
   */
  async addProjectItem(input: AddProjectItemInput): Promise<ProjectV2Item> {
    if (!input.contentId && !input.draftIssue) {
      throw new GitHubProjectsError(
        'Either contentId or draftIssue must be provided',
        'validation_error'
      );
    }

    if (input.draftIssue) {
      const mutation = `
        mutation($projectId: ID!, $title: String!, $body: String) {
          addProjectV2DraftIssue(input: {
            projectId: $projectId
            title: $title
            body: $body
          }) {
            projectItem {
              id
              createdAt
              updatedAt
              content {
                ... on DraftIssue {
                  title
                  body
                }
              }
            }
          }
        }
      `;

      type Response = {
        addProjectV2DraftIssue: {
          projectItem: {
            id: string;
            createdAt: string;
            updatedAt: string;
            content?: { title: string; body?: string };
          };
        };
      };

      const data = await this.executeGraphQL<Response>(mutation, {
        projectId: input.projectId,
        title: input.draftIssue.title,
        body: input.draftIssue.body || '',
      });

      return {
        id: data.addProjectV2DraftIssue.projectItem.id,
        content: data.addProjectV2DraftIssue.projectItem.content
          ? {
              type: 'DraftIssue',
              title: data.addProjectV2DraftIssue.projectItem.content.title,
              body: data.addProjectV2DraftIssue.projectItem.content.body,
            }
          : undefined,
        fieldValues: [],
        createdAt: data.addProjectV2DraftIssue.projectItem.createdAt,
        updatedAt: data.addProjectV2DraftIssue.projectItem.updatedAt,
      };
    } else {
      const mutation = `
        mutation($projectId: ID!, $contentId: ID!) {
          addProjectV2ItemById(input: {
            projectId: $projectId
            contentId: $contentId
          }) {
            item {
              id
              createdAt
              updatedAt
              content {
                ... on Issue {
                  title
                  number
                  state
                  body
                  url
                }
                ... on PullRequest {
                  title
                  number
                  state
                  body
                  url
                }
              }
            }
          }
        }
      `;

      type Response = {
        addProjectV2ItemById: {
          item: {
            id: string;
            createdAt: string;
            updatedAt: string;
            content?: {
              title: string;
              number?: number;
              state?: string;
              body?: string;
              url?: string;
            };
          };
        };
      };

      const data = await this.executeGraphQL<Response>(mutation, {
        projectId: input.projectId,
        contentId: input.contentId!,
      });

      const content = data.addProjectV2ItemById.item.content;
      return {
        id: data.addProjectV2ItemById.item.id,
        content: content
          ? {
              type: 'Issue', // Default, could be PR too
              title: content.title,
              number: content.number,
              state: content.state,
              body: content.body,
              url: content.url,
            }
          : undefined,
        fieldValues: [],
        createdAt: data.addProjectV2ItemById.item.createdAt,
        updatedAt: data.addProjectV2ItemById.item.updatedAt,
      };
    }
  }

  /**
   * Update a field value on a project item
   */
  async updateItemField(input: UpdateItemFieldInput): Promise<{ itemId: string }> {
    let mutation: string;
    let variables: Record<string, unknown>;

    if ('text' in input.value) {
      mutation = `
        mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: String!) {
          updateProjectV2ItemFieldValue(input: {
            projectId: $projectId
            itemId: $itemId
            fieldId: $fieldId
            value: { text: $value }
          }) {
            projectV2Item {
              id
            }
          }
        }
      `;
      variables = {
        projectId: input.projectId,
        itemId: input.itemId,
        fieldId: input.fieldId,
        value: input.value.text,
      };
    } else if ('number' in input.value) {
      mutation = `
        mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: Float!) {
          updateProjectV2ItemFieldValue(input: {
            projectId: $projectId
            itemId: $itemId
            fieldId: $fieldId
            value: { number: $value }
          }) {
            projectV2Item {
              id
            }
          }
        }
      `;
      variables = {
        projectId: input.projectId,
        itemId: input.itemId,
        fieldId: input.fieldId,
        value: input.value.number,
      };
    } else if ('date' in input.value) {
      mutation = `
        mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: String!) {
          updateProjectV2ItemFieldValue(input: {
            projectId: $projectId
            itemId: $itemId
            fieldId: $fieldId
            value: { date: $value }
          }) {
            projectV2Item {
              id
            }
          }
        }
      `;
      variables = {
        projectId: input.projectId,
        itemId: input.itemId,
        fieldId: input.fieldId,
        value: input.value.date,
      };
    } else if ('singleSelectOptionId' in input.value) {
      mutation = `
        mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: String!) {
          updateProjectV2ItemFieldValue(input: {
            projectId: $projectId
            itemId: $itemId
            fieldId: $fieldId
            value: { singleSelectOptionId: $value }
          }) {
            projectV2Item {
              id
            }
          }
        }
      `;
      variables = {
        projectId: input.projectId,
        itemId: input.itemId,
        fieldId: input.fieldId,
        value: input.value.singleSelectOptionId,
      };
    } else if ('iterationId' in input.value) {
      mutation = `
        mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: String!) {
          updateProjectV2ItemFieldValue(input: {
            projectId: $projectId
            itemId: $itemId
            fieldId: $fieldId
            value: { iterationId: $value }
          }) {
            projectV2Item {
              id
            }
          }
        }
      `;
      variables = {
        projectId: input.projectId,
        itemId: input.itemId,
        fieldId: input.fieldId,
        value: input.value.iterationId,
      };
    } else {
      throw new GitHubProjectsError(
        'Invalid field value type',
        'validation_error'
      );
    }

    type Response = {
      updateProjectV2ItemFieldValue: {
        projectV2Item: { id: string };
      };
    };

    const data = await this.executeGraphQL<Response>(mutation, variables);

    return { itemId: data.updateProjectV2ItemFieldValue.projectV2Item.id };
  }

  /**
   * Delete an item from a project
   */
  async deleteProjectItem(input: DeleteProjectItemInput): Promise<void> {
    const mutation = `
      mutation($projectId: ID!, $itemId: ID!) {
        deleteProjectV2Item(input: {
          projectId: $projectId
          itemId: $itemId
        }) {
          deletedItemId
        }
      }
    `;

    await this.executeGraphQL(mutation, {
      projectId: input.projectId,
      itemId: input.itemId,
    });
  }

  /**
   * Get a specific item from a project
   */
  async getProjectItem(projectId: string, itemId: string): Promise<ProjectV2Item> {
    const query = `
      query($projectId: ID!, $itemId: ID!) {
        node(id: $projectId) {
          ... on ProjectV2 {
            item(id: $itemId) {
              id
              createdAt
              updatedAt
              content {
                ... on Issue {
                  title
                  number
                  state
                  body
                  url
                }
                ... on PullRequest {
                  title
                  number
                  state
                  body
                  url
                }
                ... on DraftIssue {
                  title
                  body
                }
              }
              fieldValues(first: 50) {
                nodes {
                  ... on ProjectV2ItemFieldTextValue {
                    field { id name }
                    text: value
                  }
                  ... on ProjectV2ItemFieldNumberValue {
                    field { id name }
                    number: value
                  }
                  ... on ProjectV2ItemFieldDateValue {
                    field { id name }
                    date: value
                  }
                  ... on ProjectV2ItemFieldSingleSelectValue {
                    field { id name }
                    value: name
                    optionId
                  }
                }
              }
            }
          }
        }
      }
    `;

    type Response = {
      node: {
        item: {
          id: string;
          createdAt: string;
          updatedAt: string;
          content?: {
            title: string;
            number?: number;
            state?: string;
            body?: string;
            url?: string;
          };
          fieldValues: {
            nodes: Array<{
              field: { id: string; name: string };
              text?: string;
              number?: number;
              date?: string;
              value?: string;
            }>;
          };
        };
      };
    };

    const data = await this.executeGraphQL<Response>(query, {
      projectId,
      itemId,
    });

    const item = data.node?.item;
    if (!item) {
      throw new GitHubProjectsError(
        `Item ${itemId} not found in project ${projectId}`,
        'validation_error'
      );
    }

    const fieldValues: ProjectV2ItemFieldValue[] = item.fieldValues.nodes.map((fv) => ({
      field: fv.field,
      value: fv.text ?? fv.number ?? fv.date ?? fv.value ?? null,
    }));

    let contentType: 'Issue' | 'PullRequest' | 'DraftIssue' = 'Issue';
    if (item.content?.number === undefined && item.content?.title) {
      contentType = 'DraftIssue';
    }

    return {
      id: item.id,
      content: item.content
        ? {
            type: contentType,
            title: item.content.title,
            number: item.content.number,
            state: item.content.state,
            body: item.content.body,
            url: item.content.url,
          }
        : undefined,
      fieldValues,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }

  /**
   * Get current rate limit info
   */
  getRateLimitInfo(): RateLimitInfo | undefined {
    return this.rateLimitInfo;
  }

  /**
   * Find a field by name in a project
   */
  static findFieldByName(
    project: ProjectV2,
    fieldName: string
  ): ProjectV2Field | undefined {
    return project.fields.find((f) => f.name.toLowerCase() === fieldName.toLowerCase());
  }

  /**
   * Find an option by name in a single select field
   */
  static findOptionByName(
    field: ProjectV2SingleSelectField,
    optionName: string
  ): ProjectV2SingleSelectOption | undefined {
    return field.options.find(
      (o) => o.name.toLowerCase() === optionName.toLowerCase()
    );
  }

  /**
   * Map task state to project status field value
   *
   * First tries exact match, then fuzzy match, then fallback to category.
   */
  static mapStateToStatus(
    state: TaskState,
    statusField: ProjectV2SingleSelectField
  ): ProjectV2FieldValueInput | null {
    const statusName = TASK_STATE_TO_STATUS[state];

    // 1. Try exact match
    const option = this.findOptionByName(statusField, statusName);
    if (option) {
      return { singleSelectOptionId: option.id };
    }

    // 2. Try fuzzy match (partial name match)
    const lowerStatus = statusName.toLowerCase();
    for (const opt of statusField.options) {
      if (opt.name.toLowerCase().includes(lowerStatus) ||
          lowerStatus.includes(opt.name.toLowerCase())) {
        return { singleSelectOptionId: opt.id };
      }
    }

    // 3. Fallback to category-based mapping
    // Find which category this state belongs to
    for (const [categoryName, states] of Object.entries(STATUS_FALLBACK)) {
      if (states.includes(state)) {
        // Find an option matching this category
        const categoryOption = this.findOptionByName(statusField, categoryName);
        if (categoryOption) {
          return { singleSelectOptionId: categoryOption.id };
        }
        // Try partial match for category
        for (const opt of statusField.options) {
          if (opt.name.toLowerCase().includes(categoryName) ||
              categoryName.includes(opt.name.toLowerCase())) {
            return { singleSelectOptionId: opt.id };
          }
        }
      }
    }

    // 4. Last resort: return first option (usually "Todo" or similar)
    if (statusField.options.length > 0) {
      return { singleSelectOptionId: statusField.options[0].id };
    }

    return null;
  }
}