import type {
  GitHubProjectsClientConfig,
  GitHubGraphQLResponse,
  GetProjectInput,
  AddProjectItemInput,
  UpdateItemFieldInput,
  DeleteProjectItemInput,
  ProjectV2,
  ProjectV2Item,
  ProjectV2ItemFieldValue,
  ProjectV2Field,
  ProjectV2SingleSelectField,
  ProjectV2SingleSelectOption,
  ProjectV2FieldValueInput,
  RateLimitInfo,
} from './types.js';
import { GitHubProjectsError, TASK_STATE_TO_STATUS, STATUS_FALLBACK } from './types.js';
import { QUERIES, MUTATIONS } from './graphql-queries.js';

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

      this.updateRateLimitInfo(response);

      this.checkResponseStatus(response);

      const json = await response.json() as GitHubGraphQLResponse<T>;

      this.validateResponse(json);

      return json.data!;
    } catch (error) {
      if (error instanceof GitHubProjectsError) {
        throw error;
      }
      if (error instanceof Error && error.name === 'AbortError') {
        throw new GitHubProjectsError('Request timed out', 'network_error');
      }
      throw new GitHubProjectsError(
        error instanceof Error ? error.message : 'Unknown error',
        'network_error'
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private updateRateLimitInfo(response: Response): void {
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
  }

  private checkResponseStatus(response: Response): void {
    if (response.status === 401) {
      throw new GitHubProjectsError('Authentication failed. Check your token.', 'auth_error');
    }

    if (response.status === 403) {
      const remaining = this.rateLimitInfo?.remaining ?? 0;
      if (remaining === 0) {
        throw new GitHubProjectsError('Rate limit exceeded', 'rate_limit');
      }
      throw new GitHubProjectsError('Forbidden. Check token permissions.', 'auth_error');
    }
  }

  private validateResponse<T>(json: GitHubGraphQLResponse<T>): void {
    if (json.errors && json.errors.length > 0) {
      throw new GitHubProjectsError(json.errors[0].message, 'graphql_error', json.errors);
    }

    if (!json.data) {
      throw new GitHubProjectsError('No data returned from GraphQL query', 'graphql_error');
    }
  }

  /**
   * Get project details including fields
   */
  async getProject(input: GetProjectInput): Promise<ProjectV2> {
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
      data = await this.executeGraphQL<OrgResponse>(QUERIES.getProject, {
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
        const userQuery = QUERIES.getProject.replace('organization', 'user');
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

    return this.buildProjectResponse(projectData, data);
  }

  private buildProjectResponse(
    projectData: {
      id: string;
      number: number;
      title: string;
      shortDescription?: string;
      public?: boolean;
      closed?: boolean;
      fields: { nodes: Array<{ id: string; name: string; dataType: string; options?: Array<{ id: string; name: string; color?: string }> }> };
      owner: { login: string };
    },
    data: { organization?: unknown; user?: unknown } | null
  ): ProjectV2 {
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
        type: data && 'organization' in data ? 'Organization' : 'User',
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
      return this.addDraftIssue(input);
    } else {
      return this.addExistingItem(input);
    }
  }

  private async addDraftIssue(input: AddProjectItemInput): Promise<ProjectV2Item> {
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

    const data = await this.executeGraphQL<Response>(MUTATIONS.addDraftIssue, {
      projectId: input.projectId,
      title: input.draftIssue!.title,
      body: input.draftIssue!.body || '',
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
  }

  private async addExistingItem(input: AddProjectItemInput): Promise<ProjectV2Item> {
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

    const data = await this.executeGraphQL<Response>(MUTATIONS.addProjectItem, {
      projectId: input.projectId,
      contentId: input.contentId!,
    });

    const content = data.addProjectV2ItemById.item.content;
    return {
      id: data.addProjectV2ItemById.item.id,
      content: content
        ? {
            type: 'Issue',
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

  /**
   * Update a field value on a project item
   */
  async updateItemField(input: UpdateItemFieldInput): Promise<{ itemId: string }> {
    const { mutation, variables } = this.getUpdateMutation(input);

    type Response = {
      updateProjectV2ItemFieldValue: {
        projectV2Item: { id: string };
      };
    };

    const data = await this.executeGraphQL<Response>(mutation, variables);
    return { itemId: data.updateProjectV2ItemFieldValue.projectV2Item.id };
  }

  private getUpdateMutation(input: UpdateItemFieldInput): { mutation: string; variables: Record<string, unknown> } {
    const baseVars = {
      projectId: input.projectId,
      itemId: input.itemId,
      fieldId: input.fieldId,
    };

    if ('text' in input.value) {
      return { mutation: MUTATIONS.updateTextField, variables: { ...baseVars, value: input.value.text } };
    }
    if ('number' in input.value) {
      return { mutation: MUTATIONS.updateNumberField, variables: { ...baseVars, value: input.value.number } };
    }
    if ('date' in input.value) {
      return { mutation: MUTATIONS.updateDateField, variables: { ...baseVars, value: input.value.date } };
    }
    if ('singleSelectOptionId' in input.value) {
      return { mutation: MUTATIONS.updateSingleSelectField, variables: { ...baseVars, value: input.value.singleSelectOptionId } };
    }
    if ('iterationId' in input.value) {
      return { mutation: MUTATIONS.updateIterationField, variables: { ...baseVars, value: input.value.iterationId } };
    }

    throw new GitHubProjectsError('Invalid field value type', 'validation_error');
  }

  /**
   * Delete an item from a project
   */
  async deleteProjectItem(input: DeleteProjectItemInput): Promise<void> {
    await this.executeGraphQL(MUTATIONS.deleteItem, {
      projectId: input.projectId,
      itemId: input.itemId,
    });
  }

  /**
   * Get a specific item from a project
   */
  async getProjectItem(projectId: string, itemId: string): Promise<ProjectV2Item> {
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

    const data = await this.executeGraphQL<Response>(QUERIES.getProjectItem, { projectId, itemId });

    const item = data.node?.item;
    if (!item) {
      throw new GitHubProjectsError(
        `Item ${itemId} not found in project ${projectId}`,
        'validation_error'
      );
    }

    return this.buildProjectItem(item);
  }

  private buildProjectItem(item: {
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
  }): ProjectV2Item {
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
   */
  static mapStateToStatus(
    state: string,
    statusField: ProjectV2SingleSelectField
  ): ProjectV2FieldValueInput | null {
    const statusName = TASK_STATE_TO_STATUS[state as keyof typeof TASK_STATE_TO_STATUS];
    if (!statusName) return null;

    // 1. Try exact match
    const option = this.findOptionByName(statusField, statusName);
    if (option) {
      return { singleSelectOptionId: option.id };
    }

    // 2. Try fuzzy match
    const lowerStatus = statusName.toLowerCase();
    for (const opt of statusField.options) {
      if (opt.name.toLowerCase().includes(lowerStatus) ||
          lowerStatus.includes(opt.name.toLowerCase())) {
        return { singleSelectOptionId: opt.id };
      }
    }

    // 3. Fallback to category-based mapping
    for (const [categoryName, states] of Object.entries(STATUS_FALLBACK)) {
      if (states.includes(state)) {
        const categoryOption = this.findOptionByName(statusField, categoryName);
        if (categoryOption) {
          return { singleSelectOptionId: categoryOption.id };
        }
        for (const opt of statusField.options) {
          if (opt.name.toLowerCase().includes(categoryName) ||
              categoryName.includes(opt.name.toLowerCase())) {
            return { singleSelectOptionId: opt.id };
          }
        }
      }
    }

    // 4. Last resort: return first option
    if (statusField.options.length > 0) {
      return { singleSelectOptionId: statusField.options[0].id };
    }

    return null;
  }
}