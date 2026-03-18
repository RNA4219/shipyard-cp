import type { Task, TaskState, ExternalRef } from '../../types.js';
import {
  GitHubProjectsClient,
  type ProjectV2,
  type ProjectV2SingleSelectField,
  type GitHubProjectsClientConfig,
  GitHubProjectsError,
} from '../github-projects/index.js';

/**
 * Configuration for the GitHub Projects integration service
 */
export interface GitHubProjectsServiceConfig {
  /** GitHub Projects client configuration */
  clientConfig: GitHubProjectsClientConfig;
  /** Default project to use when creating tasks */
  defaultProject?: {
    owner: string;
    projectNumber: number;
  };
  /** Status field name in the project (default: "Status") */
  statusFieldName?: string;
}

/**
 * Task project item mapping
 */
export interface TaskProjectItem {
  taskId: string;
  projectId: string;
  projectItemId: string;
  projectNumber: number;
  owner: string;
}

/**
 * Result of syncing task state to project
 */
export interface SyncTaskStateResult {
  success: boolean;
  projectId?: string;
  projectItemId?: string;
  previousStatus?: string;
  newStatus?: string;
  error?: string;
}

/**
 * GitHub Projects Integration Service
 *
 * Manages the relationship between Control Plane tasks and GitHub Projects v2 items
 */
export class GitHubProjectsService {
  private client: GitHubProjectsClient;
  private defaultProject?: { owner: string; projectNumber: number };
  private statusFieldName: string;
  private projectCache: Map<string, ProjectV2> = new Map();
  private statusFieldCache: Map<string, ProjectV2SingleSelectField> = new Map();

  constructor(config: GitHubProjectsServiceConfig) {
    this.client = new GitHubProjectsClient(config.clientConfig);
    this.defaultProject = config.defaultProject;
    this.statusFieldName = config.statusFieldName || 'Status';
  }

  /**
   * Get cached project or fetch from API
   */
  private async getProject(owner: string, projectNumber: number): Promise<ProjectV2> {
    const cacheKey = `${owner}/${projectNumber}`;

    if (this.projectCache.has(cacheKey)) {
      return this.projectCache.get(cacheKey) as ProjectV2;
    }

    const project = await this.client.getProject({ owner, projectNumber });
    this.projectCache.set(cacheKey, project);
    return project;
  }

  /**
   * Get the status field from a project
   */
  private async getStatusField(project: ProjectV2): Promise<ProjectV2SingleSelectField | null> {
    const cacheKey = project.id;

    if (this.statusFieldCache.has(cacheKey)) {
      return this.statusFieldCache.get(cacheKey) as ProjectV2SingleSelectField;
    }

    const field = GitHubProjectsClient.findFieldByName(project, this.statusFieldName);
    if (field && field.dataType === 'SINGLE_SELECT') {
      this.statusFieldCache.set(cacheKey, field as ProjectV2SingleSelectField);
      return field as ProjectV2SingleSelectField;
    }

    return null;
  }

  /**
   * Get project item ID from task's external_refs
   */
  getProjectItemFromTask(task: Task): TaskProjectItem | null {
    const projectItemRef = task.external_refs?.find((ref) => ref.kind === 'github_project_item');
    if (!projectItemRef) {
      return null;
    }

    // Parse project item ID format: "PVT_123:PVTI_456:owner/projectNumber"
    // or just the raw project item ID
    const parts = projectItemRef.value.split(':');
    if (parts.length >= 2) {
      return {
        taskId: task.task_id,
        projectId: parts[0],
        projectItemId: parts[1],
        projectNumber: parseInt(parts[3] || '0'),
        owner: parts[2] || '',
      };
    }

    // Simple format: just the item ID
    return {
      taskId: task.task_id,
      projectId: '',
      projectItemId: projectItemRef.value,
      projectNumber: 0,
      owner: '',
    };
  }

  /**
   * Add a task to a GitHub Project
   */
  async addTaskToProject(
    task: Task,
    projectOwner?: string,
    projectNumber?: number
  ): Promise<{ projectItem: TaskProjectItem; externalRef: ExternalRef }> {
    const owner = projectOwner || this.defaultProject?.owner;
    const number = projectNumber || this.defaultProject?.projectNumber;

    if (!owner || !number) {
      throw new GitHubProjectsError(
        'No project specified and no default project configured',
        'validation_error'
      );
    }

    const project = await this.getProject(owner, number);

    // Create a draft issue with task details
    const item = await this.client.addProjectItem({
      projectId: project.id,
      draftIssue: {
        title: task.title,
        body: `**Objective:** ${task.objective}\n\n**Task ID:** ${task.task_id}\n**State:** ${task.state}\n**Risk Level:** ${task.risk_level}`,
      },
    });

    // Create external ref in format "projectId:itemId:owner/projectNumber"
    const projectItem: TaskProjectItem = {
      taskId: task.task_id,
      projectId: project.id,
      projectItemId: item.id,
      projectNumber: number,
      owner: owner,
    };

    const externalRef: ExternalRef = {
      kind: 'github_project_item',
      value: `${project.id}:${item.id}:${owner}:${number}`,
    };

    // Set initial status
    const statusField = await this.getStatusField(project);
    if (statusField) {
      const statusValue = GitHubProjectsClient.mapStateToStatus(task.state, statusField);
      if (statusValue) {
        await this.client.updateItemField({
          projectId: project.id,
          itemId: item.id,
          fieldId: statusField.id,
          value: statusValue,
        });
      }
    }

    return { projectItem, externalRef };
  }

  /**
   * Sync task state to project status
   */
  async syncTaskState(
    task: Task,
    newState: TaskState,
    projectItem?: TaskProjectItem
  ): Promise<SyncTaskStateResult> {
    const item = projectItem || this.getProjectItemFromTask(task);
    if (!item) {
      return {
        success: false,
        error: 'No project item found for task',
      };
    }

    try {
      const project = await this.getProject(item.owner, item.projectNumber);
      const statusField = await this.getStatusField(project);

      if (!statusField) {
        return {
          success: false,
          projectId: item.projectId,
          projectItemId: item.projectItemId,
          error: `Status field "${this.statusFieldName}" not found in project`,
        };
      }

      const statusValue = GitHubProjectsClient.mapStateToStatus(newState, statusField);
      if (!statusValue) {
        return {
          success: false,
          projectId: item.projectId,
          projectItemId: item.projectItemId,
          error: `No matching status option for state: ${newState}`,
        };
      }

      // Get current item to find previous status
      let previousStatus: string | undefined;
      try {
        const currentItem = await this.client.getProjectItem(item.projectId, item.projectItemId);
        const statusFieldValue = currentItem.fieldValues.find(
          (fv) => fv.field.name.toLowerCase() === this.statusFieldName.toLowerCase()
        );
        previousStatus = statusFieldValue?.value?.toString();
      } catch {
        // Ignore errors when fetching current item
      }

      await this.client.updateItemField({
        projectId: item.projectId,
        itemId: item.projectItemId,
        fieldId: statusField.id,
        value: statusValue,
      });

      // Find the new status name
      const newOption = GitHubProjectsClient.findOptionByName(
        statusField,
        'singleSelectOptionId' in statusValue
          ? statusField.options.find((o: { id: string }) => o.id === statusValue.singleSelectOptionId)?.name || ''
          : ''
      );

      return {
        success: true,
        projectId: item.projectId,
        projectItemId: item.projectItemId,
        previousStatus,
        newStatus: newOption?.name,
      };
    } catch (error: unknown) {
      return {
        success: false,
        error: error instanceof GitHubProjectsError
          ? error.message
          : 'Unknown error syncing task state',
      };
    }
  }

  /**
   * Remove task from project
   */
  async removeTaskFromProject(task: Task): Promise<boolean> {
    const item = this.getProjectItemFromTask(task);
    if (!item || !item.projectId) {
      return false;
    }

    try {
      await this.client.deleteProjectItem({
        projectId: item.projectId,
        itemId: item.projectItemId,
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get rate limit info
   */
  getRateLimitInfo() {
    return this.client.getRateLimitInfo();
  }

  /**
   * Clear caches
   */
  clearCaches(): void {
    this.projectCache.clear();
    this.statusFieldCache.clear();
  }
}