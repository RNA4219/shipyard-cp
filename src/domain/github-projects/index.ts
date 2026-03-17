export {
  GitHubProjectsClient,
  GitHubProjectsError,
  TASK_STATE_TO_STATUS,
  type ProjectV2,
  type ProjectV2Field,
  type ProjectV2SingleSelectField,
  type ProjectV2SingleSelectOption,
  type ProjectV2Item,
  type ProjectV2ItemFieldValue,
  type ProjectV2FieldValueInput,
  type GitHubProjectsAuth,
  type GitHubProjectsClientConfig,
  type GetProjectInput,
  type AddProjectItemInput,
  type UpdateItemFieldInput,
  type DeleteProjectItemInput,
  type RateLimitInfo,
  type GitHubGraphQLResponse,
} from './github-projects-client.js';

export {
  GitHubProjectsService,
  type GitHubProjectsServiceConfig,
  type TaskProjectItem,
  type SyncTaskStateResult,
} from './github-projects-service.js';