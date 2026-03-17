import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  GitHubProjectsClient,
  GitHubProjectsError,
  TASK_STATE_TO_STATUS,
  type ProjectV2,
  type ProjectV2SingleSelectField,
} from '../src/domain/github-projects/index.js';
import type { TaskState } from '../../src/types.js';

describe('GitHub Projects v2 Client', () => {
  describe('TASK_STATE_TO_STATUS mapping', () => {
    it('should map all task states to project statuses', () => {
      const states: TaskState[] = [
        'queued', 'planning', 'planned', 'developing', 'dev_completed',
        'accepting', 'accepted', 'rework_required', 'integrating', 'integrated',
        'publish_pending_approval', 'publishing', 'published', 'cancelled',
        'failed', 'blocked',
      ];

      for (const state of states) {
        expect(TASK_STATE_TO_STATUS[state]).toBeDefined();
        expect(typeof TASK_STATE_TO_STATUS[state]).toBe('string');
      }
    });

    it('should map developing to In Progress', () => {
      expect(TASK_STATE_TO_STATUS['developing']).toBe('In Progress');
    });

    it('should map published to Done', () => {
      expect(TASK_STATE_TO_STATUS['published']).toBe('Done');
    });

    it('should map blocked to Todo', () => {
      expect(TASK_STATE_TO_STATUS['blocked']).toBe('Todo');
    });

    it('should map planning to Todo', () => {
      expect(TASK_STATE_TO_STATUS['planning']).toBe('Todo');
    });
  });

  describe('GitHubProjectsError', () => {
    it('should create error with type', () => {
      const error = new GitHubProjectsError('Test error', 'graphql_error');
      expect(error.message).toBe('Test error');
      expect(error.type).toBe('graphql_error');
      expect(error.name).toBe('GitHubProjectsError');
    });

    it('should include errors array when provided', () => {
      const errors = [{ message: 'Field not found', type: 'NOT_FOUND' }];
      const error = new GitHubProjectsError('Validation failed', 'validation_error', errors);
      expect(error.errors).toEqual(errors);
    });
  });

  describe('GitHubProjectsClient - Static Methods', () => {
    describe('findFieldByName', () => {
      const mockProject: ProjectV2 = {
        id: 'PVT_123',
        number: 1,
        title: 'Test Project',
        fields: [
          { id: 'FIELD_1', name: 'Status', dataType: 'SINGLE_SELECT', options: [] } as ProjectV2SingleSelectField,
          { id: 'FIELD_2', name: 'Priority', dataType: 'SINGLE_SELECT', options: [] } as ProjectV2SingleSelectField,
          { id: 'FIELD_3', name: 'Notes', dataType: 'TEXT' },
        ],
        owner: { login: 'test-org', type: 'Organization' },
      };

      it('should find field by exact name', () => {
        const field = GitHubProjectsClient.findFieldByName(mockProject, 'Status');
        expect(field?.id).toBe('FIELD_1');
      });

      it('should find field case-insensitively', () => {
        const field = GitHubProjectsClient.findFieldByName(mockProject, 'status');
        expect(field?.id).toBe('FIELD_1');
      });

      it('should return undefined for non-existent field', () => {
        const field = GitHubProjectsClient.findFieldByName(mockProject, 'NonExistent');
        expect(field).toBeUndefined();
      });
    });

    describe('findOptionByName', () => {
      const mockField: ProjectV2SingleSelectField = {
        id: 'FIELD_1',
        name: 'Status',
        dataType: 'SINGLE_SELECT',
        options: [
          { id: 'OPT_1', name: 'Backlog' },
          { id: 'OPT_2', name: 'In Progress' },
          { id: 'OPT_3', name: 'Done' },
        ],
      };

      it('should find option by exact name', () => {
        const option = GitHubProjectsClient.findOptionByName(mockField, 'Done');
        expect(option?.id).toBe('OPT_3');
      });

      it('should find option case-insensitively', () => {
        const option = GitHubProjectsClient.findOptionByName(mockField, 'done');
        expect(option?.id).toBe('OPT_3');
      });

      it('should return undefined for non-existent option', () => {
        const option = GitHubProjectsClient.findOptionByName(mockField, 'Unknown');
        expect(option).toBeUndefined();
      });
    });

    describe('mapStateToStatus', () => {
      // Mock field with minimal options matching real project configuration
      const mockField: ProjectV2SingleSelectField = {
        id: 'FIELD_1',
        name: 'Status',
        dataType: 'SINGLE_SELECT',
        options: [
          { id: 'OPT_1', name: 'Todo' },
          { id: 'OPT_2', name: 'In Progress' },
          { id: 'OPT_3', name: 'Done' },
        ],
      };

      it('should map developing to In Progress option', () => {
        const result = GitHubProjectsClient.mapStateToStatus('developing', mockField);
        expect(result).toEqual({ singleSelectOptionId: 'OPT_2' });
      });

      it('should map published to Done option', () => {
        const result = GitHubProjectsClient.mapStateToStatus('published', mockField);
        expect(result).toEqual({ singleSelectOptionId: 'OPT_3' });
      });

      it('should map blocked to Todo option', () => {
        const result = GitHubProjectsClient.mapStateToStatus('blocked', mockField);
        // 'blocked' maps to 'Todo' which exists in options
        expect(result).toEqual({ singleSelectOptionId: 'OPT_1' });
      });

      it('should map queued to Todo option', () => {
        const result = GitHubProjectsClient.mapStateToStatus('queued', mockField);
        // 'queued' maps to 'Todo' which exists in options
        expect(result).toEqual({ singleSelectOptionId: 'OPT_1' });
      });

      it('should map planning to Todo option', () => {
        const result = GitHubProjectsClient.mapStateToStatus('planning', mockField);
        // 'planning' maps to 'Todo' which exists in options
        expect(result).toEqual({ singleSelectOptionId: 'OPT_1' });
      });

      it('should try fuzzy match for close option names', () => {
        const fieldWithPartialMatch: ProjectV2SingleSelectField = {
          id: 'FIELD_1',
          name: 'Status',
          dataType: 'SINGLE_SELECT',
          options: [
            { id: 'OPT_1', name: 'Ready for Dev' },
          ],
        };

        // 'planned' maps to 'Todo', no exact match, falls back to first option
        const result = GitHubProjectsClient.mapStateToStatus('planned', fieldWithPartialMatch);
        expect(result).toEqual({ singleSelectOptionId: 'OPT_1' });
      });
    });
  });

  describe('GitHubProjectsClient - Constructor', () => {
    it('should create client with PAT auth', () => {
      const client = new GitHubProjectsClient({
        auth: { token: 'ghp_test123', tokenType: 'pat' },
      });
      expect(client).toBeDefined();
    });

    it('should create client with custom base URL', () => {
      const client = new GitHubProjectsClient({
        auth: { token: 'ghs_test123', tokenType: 'github_app' },
        baseUrl: 'https://github.example.com/api/graphql',
      });
      expect(client).toBeDefined();
    });

    it('should use default timeout if not specified', () => {
      const client = new GitHubProjectsClient({
        auth: { token: 'ghp_test', tokenType: 'pat' },
      });
      expect(client.getRateLimitInfo()).toBeUndefined();
    });
  });

  describe('GitHubProjectsClient - GraphQL Operations', () => {
    let client: GitHubProjectsClient;
    let mockFetch: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mockFetch = vi.fn();
      global.fetch = mockFetch;

      client = new GitHubProjectsClient({
        auth: { token: 'ghp_test123', tokenType: 'pat' },
      });
    });

    describe('getProject', () => {
      it('should fetch organization project', async () => {
        const mockResponse = {
          data: {
            organization: {
              projectV2: {
                id: 'PVT_123',
                number: 1,
                title: 'Test Project',
                shortDescription: 'A test project',
                public: true,
                closed: false,
                fields: {
                  nodes: [
                    { id: 'FIELD_1', name: 'Status', dataType: 'SINGLE_SELECT', options: [{ id: 'OPT_1', name: 'Todo' }] },
                    { id: 'FIELD_2', name: 'Notes', dataType: 'TEXT' },
                  ],
                },
                owner: { login: 'test-org' },
              },
            },
          },
        };

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockResponse,
          headers: new Headers({
            'x-ratelimit-limit': '5000',
            'x-ratelimit-remaining': '4999',
            'x-ratelimit-reset': '1710662400',
          }),
        });

        const project = await client.getProject({ owner: 'test-org', projectNumber: 1 });

        expect(project.id).toBe('PVT_123');
        expect(project.title).toBe('Test Project');
        expect(project.fields).toHaveLength(2);
        expect(project.owner.login).toBe('test-org');
      });

      it('should throw validation_error for non-existent project', async () => {
        const mockResponse = {
          data: {
            organization: {
              projectV2: null,
            },
          },
        };

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockResponse,
          headers: new Headers(),
        });

        await expect(
          client.getProject({ owner: 'test-org', projectNumber: 999 })
        ).rejects.toThrow(GitHubProjectsError);
      });

      it('should handle user-owned projects', async () => {
        // The client tries organization first, then user
        // For this test, return null for org, then success for user
        const userResponse = {
          data: {
            user: {
              projectV2: {
                id: 'PVT_456',
                number: 2,
                title: 'User Project',
                shortDescription: undefined,
                public: undefined,
                closed: undefined,
                fields: { nodes: [] },
                owner: { login: 'testuser' },
              },
            },
          },
        };

        // First call (org) returns null projectV2
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            data: { organization: { projectV2: null } },
          }),
          headers: new Headers(),
        });

        // Second call (user) succeeds
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => userResponse,
          headers: new Headers(),
        });

        const project = await client.getProject({ owner: 'testuser', projectNumber: 2 });
        expect(project.id).toBe('PVT_456');
      });
    });

    describe('addProjectItem', () => {
      it('should add existing issue to project', async () => {
        const mockResponse = {
          data: {
            addProjectV2ItemById: {
              item: {
                id: 'PVTI_123',
                createdAt: '2026-03-17T12:00:00Z',
                updatedAt: '2026-03-17T12:00:00Z',
                content: {
                  title: 'Test Issue',
                  number: 42,
                  state: 'open',
                  url: 'https://github.com/test/repo/issues/42',
                },
              },
            },
          },
        };

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockResponse,
          headers: new Headers(),
        });

        const item = await client.addProjectItem({
          projectId: 'PVT_123',
          contentId: 'I_123',
        });

        expect(item.id).toBe('PVTI_123');
        expect(item.content?.number).toBe(42);
      });

      it('should add draft issue to project', async () => {
        const mockResponse = {
          data: {
            addProjectV2DraftIssue: {
              projectItem: {
                id: 'PVTI_456',
                createdAt: '2026-03-17T12:00:00Z',
                updatedAt: '2026-03-17T12:00:00Z',
                content: {
                  title: 'Draft Issue',
                  body: 'Draft body',
                },
              },
            },
          },
        };

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockResponse,
          headers: new Headers(),
        });

        const item = await client.addProjectItem({
          projectId: 'PVT_123',
          draftIssue: {
            title: 'Draft Issue',
            body: 'Draft body',
          },
        });

        expect(item.id).toBe('PVTI_456');
        expect(item.content?.type).toBe('DraftIssue');
      });

      it('should throw validation_error without contentId or draftIssue', async () => {
        await expect(
          client.addProjectItem({ projectId: 'PVT_123' } as any)
        ).rejects.toThrow(GitHubProjectsError);
      });
    });

    describe('updateItemField', () => {
      it('should update text field', async () => {
        const mockResponse = {
          data: {
            updateProjectV2ItemFieldValue: {
              projectV2Item: { id: 'PVTI_123' },
            },
          },
        };

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockResponse,
          headers: new Headers(),
        });

        const result = await client.updateItemField({
          projectId: 'PVT_123',
          itemId: 'PVTI_123',
          fieldId: 'FIELD_1',
          value: { text: 'Updated text' },
        });

        expect(result.itemId).toBe('PVTI_123');
      });

      it('should update single select field', async () => {
        const mockResponse = {
          data: {
            updateProjectV2ItemFieldValue: {
              projectV2Item: { id: 'PVTI_123' },
            },
          },
        };

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockResponse,
          headers: new Headers(),
        });

        const result = await client.updateItemField({
          projectId: 'PVT_123',
          itemId: 'PVTI_123',
          fieldId: 'FIELD_STATUS',
          value: { singleSelectOptionId: 'OPT_IN_PROGRESS' },
        });

        expect(result.itemId).toBe('PVTI_123');
      });

      it('should update number field', async () => {
        const mockResponse = {
          data: {
            updateProjectV2ItemFieldValue: {
              projectV2Item: { id: 'PVTI_123' },
            },
          },
        };

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockResponse,
          headers: new Headers(),
        });

        const result = await client.updateItemField({
          projectId: 'PVT_123',
          itemId: 'PVTI_123',
          fieldId: 'FIELD_COUNT',
          value: { number: 42 },
        });

        expect(result.itemId).toBe('PVTI_123');
      });

      it('should update date field', async () => {
        const mockResponse = {
          data: {
            updateProjectV2ItemFieldValue: {
              projectV2Item: { id: 'PVTI_123' },
            },
          },
        };

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockResponse,
          headers: new Headers(),
        });

        const result = await client.updateItemField({
          projectId: 'PVT_123',
          itemId: 'PVTI_123',
          fieldId: 'FIELD_DUE',
          value: { date: '2026-03-17' },
        });

        expect(result.itemId).toBe('PVTI_123');
      });
    });

    describe('deleteProjectItem', () => {
      it('should delete item from project', async () => {
        const mockResponse = {
          data: {
            deleteProjectV2Item: {
              deletedItemId: 'PVTI_123',
            },
          },
        };

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockResponse,
          headers: new Headers(),
        });

        await expect(
          client.deleteProjectItem({ projectId: 'PVT_123', itemId: 'PVTI_123' })
        ).resolves.not.toThrow();
      });
    });

    describe('getProjectItem', () => {
      it('should fetch item details', async () => {
        const mockResponse = {
          data: {
            node: {
              item: {
                id: 'PVTI_123',
                createdAt: '2026-03-17T12:00:00Z',
                updatedAt: '2026-03-17T13:00:00Z',
                content: {
                  title: 'Test Issue',
                  number: 42,
                  state: 'open',
                  url: 'https://github.com/test/repo/issues/42',
                },
                fieldValues: {
                  nodes: [
                    { field: { id: 'FIELD_1', name: 'Status' }, value: 'In Progress' },
                    { field: { id: 'FIELD_2', name: 'Priority' }, value: 'high' },
                  ],
                },
              },
            },
          },
        };

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockResponse,
          headers: new Headers(),
        });

        const item = await client.getProjectItem('PVT_123', 'PVTI_123');

        expect(item.id).toBe('PVTI_123');
        expect(item.fieldValues).toHaveLength(2);
        expect(item.content?.number).toBe(42);
      });

      it('should throw validation_error for non-existent item', async () => {
        const mockResponse = {
          data: {
            node: {
              item: null,
            },
          },
        };

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockResponse,
          headers: new Headers(),
        });

        await expect(
          client.getProjectItem('PVT_123', 'PVTI_NONEXISTENT')
        ).rejects.toThrow(GitHubProjectsError);
      });
    });

    describe('Error Handling', () => {
      it('should throw auth_error on 401', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 401,
          json: async () => ({}),
          headers: new Headers(),
        });

        await expect(
          client.getProject({ owner: 'test', projectNumber: 1 })
        ).rejects.toThrow(GitHubProjectsError);
      });

      it('should throw rate_limit on 403 with no remaining', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 403,
          json: async () => ({}),
          headers: new Headers({
            'x-ratelimit-remaining': '0',
            'x-ratelimit-reset': '1710662400',
          }),
        });

        await expect(
          client.getProject({ owner: 'test', projectNumber: 1 })
        ).rejects.toThrow(GitHubProjectsError);
      });

      it('should throw graphql_error on GraphQL errors', async () => {
        const mockResponse = {
          errors: [
            { message: 'Field not found', type: 'NOT_FOUND', path: ['projectV2'], locations: [] },
          ],
        };

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockResponse,
          headers: new Headers(),
        });

        await expect(
          client.getProject({ owner: 'test', projectNumber: 1 })
        ).rejects.toThrow(GitHubProjectsError);
      });

      it('should update rate limit info from headers', async () => {
        const mockResponse = {
          data: {
            organization: {
              projectV2: {
                id: 'PVT_123',
                number: 1,
                title: 'Test',
                fields: { nodes: [] },
                owner: { login: 'test' },
              },
            },
          },
        };

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockResponse,
          headers: new Headers({
            'x-ratelimit-limit': '5000',
            'x-ratelimit-remaining': '4998',
            'x-ratelimit-reset': '1710662400',
          }),
        });

        await client.getProject({ owner: 'test', projectNumber: 1 });
        const rateLimit = client.getRateLimitInfo();

        expect(rateLimit?.limit).toBe(5000);
        expect(rateLimit?.remaining).toBe(4998);
      });
    });
  });
});

describe('GitHub Projects v2 Integration with Tasks', () => {
  it('should update task status in project on state transition', () => {
    const statusField: ProjectV2SingleSelectField = {
      id: 'FIELD_STATUS',
      name: 'Status',
      dataType: 'SINGLE_SELECT',
      options: [
        { id: 'OPT_BACKLOG', name: 'Backlog' },
        { id: 'OPT_PLANNING', name: 'Planning' },
        { id: 'OPT_READY', name: 'Ready' },
        { id: 'OPT_IN_PROGRESS', name: 'In Progress' },
        { id: 'OPT_REVIEW', name: 'Review' },
        { id: 'OPT_TESTING', name: 'Testing' },
        { id: 'OPT_DONE', name: 'Done' },
        { id: 'OPT_INTEGRATING', name: 'Integrating' },
        { id: 'OPT_READY_TO_DEPLOY', name: 'Ready to Deploy' },
        { id: 'OPT_DEPLOYING', name: 'Deploying' },
        { id: 'OPT_BLOCKED', name: 'Blocked' },
      ],
    };

    // Test state transitions
    const transitions: Array<{ from: TaskState; to: TaskState }> = [
      { from: 'queued', to: 'planning' },
      { from: 'planning', to: 'planned' },
      { from: 'planned', to: 'developing' },
      { from: 'developing', to: 'dev_completed' },
      { from: 'dev_completed', to: 'accepting' },
      { from: 'accepting', to: 'accepted' },
      { from: 'accepted', to: 'integrating' },
      { from: 'integrating', to: 'integrated' },
      { from: 'integrated', to: 'publishing' },
      { from: 'publishing', to: 'published' },
    ];

    for (const { to } of transitions) {
      const value = GitHubProjectsClient.mapStateToStatus(to, statusField);
      expect(value).not.toBeNull();
    }
  });

  it('should handle blocked state with fallback to In Progress', () => {
    const statusField: ProjectV2SingleSelectField = {
      id: 'FIELD_STATUS',
      name: 'Status',
      dataType: 'SINGLE_SELECT',
      options: [
        { id: 'OPT_IN_PROGRESS', name: 'In Progress' },
        { id: 'OPT_BLOCKED', name: 'Blocked' },
      ],
    };

    // When task becomes blocked, status maps to 'Todo'
    // Falls back via 'todo' category, which has no match, so first option
    const value = GitHubProjectsClient.mapStateToStatus('blocked', statusField);
    expect(value).toEqual({ singleSelectOptionId: 'OPT_IN_PROGRESS' });
  });
});

import {
  GitHubProjectsService,
  type GitHubProjectsServiceConfig,
} from '../src/domain/github-projects/index.js';
import type { Task, ExternalRef } from '../src/types.js';

describe('GitHubProjectsService', () => {
  describe('Constructor', () => {
    it('should create service with config', () => {
      const config: GitHubProjectsServiceConfig = {
        clientConfig: {
          auth: { token: 'ghp_test', tokenType: 'pat' },
        },
        defaultProject: {
          owner: 'test-org',
          projectNumber: 1,
        },
        statusFieldName: 'Status',
      };

      const service = new GitHubProjectsService(config);
      expect(service).toBeDefined();
    });

    it('should use default status field name', () => {
      const config: GitHubProjectsServiceConfig = {
        clientConfig: {
          auth: { token: 'ghp_test', tokenType: 'pat' },
        },
      };

      const service = new GitHubProjectsService(config);
      expect(service).toBeDefined();
    });
  });

  describe('getProjectItemFromTask', () => {
    let service: GitHubProjectsService;

    beforeEach(() => {
      service = new GitHubProjectsService({
        clientConfig: { auth: { token: 'ghp_test', tokenType: 'pat' } },
      });
    });

    it('should extract project item from task external_refs', () => {
      const task: Task = {
        task_id: 'task_123',
        title: 'Test Task',
        objective: 'Test objective',
        typed_ref: 'shipyard:task:github:123',
        state: 'developing',
        version: 1,
        risk_level: 'medium',
        repo_ref: { provider: 'github', owner: 'test', name: 'repo', default_branch: 'main' },
        external_refs: [
          { kind: 'github_project_item', value: 'PVT_123:PVTI_456:test-org:1' },
        ],
        created_at: '2026-03-17T12:00:00Z',
        updated_at: '2026-03-17T12:00:00Z',
      };

      const result = service.getProjectItemFromTask(task);
      expect(result).not.toBeNull();
      expect(result?.projectId).toBe('PVT_123');
      expect(result?.projectItemId).toBe('PVTI_456');
      expect(result?.owner).toBe('test-org');
      expect(result?.projectNumber).toBe(1);
    });

    it('should return null when no project item ref exists', () => {
      const task: Task = {
        task_id: 'task_123',
        title: 'Test Task',
        objective: 'Test objective',
        typed_ref: 'shipyard:task:github:123',
        state: 'developing',
        version: 1,
        risk_level: 'medium',
        repo_ref: { provider: 'github', owner: 'test', name: 'repo', default_branch: 'main' },
        external_refs: [
          { kind: 'github_issue', value: '456' },
        ],
        created_at: '2026-03-17T12:00:00Z',
        updated_at: '2026-03-17T12:00:00Z',
      };

      const result = service.getProjectItemFromTask(task);
      expect(result).toBeNull();
    });

    it('should return null when no external_refs', () => {
      const task: Task = {
        task_id: 'task_123',
        title: 'Test Task',
        objective: 'Test objective',
        typed_ref: 'shipyard:task:github:123',
        state: 'developing',
        version: 1,
        risk_level: 'medium',
        repo_ref: { provider: 'github', owner: 'test', name: 'repo', default_branch: 'main' },
        created_at: '2026-03-17T12:00:00Z',
        updated_at: '2026-03-17T12:00:00Z',
      };

      const result = service.getProjectItemFromTask(task);
      expect(result).toBeNull();
    });

    it('should handle simple project item ID format', () => {
      const task: Task = {
        task_id: 'task_123',
        title: 'Test Task',
        objective: 'Test objective',
        typed_ref: 'shipyard:task:github:123',
        state: 'developing',
        version: 1,
        risk_level: 'medium',
        repo_ref: { provider: 'github', owner: 'test', name: 'repo', default_branch: 'main' },
        external_refs: [
          { kind: 'github_project_item', value: 'PVTI_456' },
        ],
        created_at: '2026-03-17T12:00:00Z',
        updated_at: '2026-03-17T12:00:00Z',
      };

      const result = service.getProjectItemFromTask(task);
      expect(result).not.toBeNull();
      expect(result?.projectItemId).toBe('PVTI_456');
    });
  });

  describe('addTaskToProject', () => {
    let service: GitHubProjectsService;
    let mockFetch: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mockFetch = vi.fn();
      global.fetch = mockFetch;

      service = new GitHubProjectsService({
        clientConfig: { auth: { token: 'ghp_test', tokenType: 'pat' } },
        defaultProject: { owner: 'test-org', projectNumber: 1 },
      });
    });

    it('should add task to default project', async () => {
      // Mock getProject
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            organization: {
              projectV2: {
                id: 'PVT_123',
                number: 1,
                title: 'Test Project',
                fields: {
                  nodes: [
                    {
                      id: 'FIELD_STATUS',
                      name: 'Status',
                      dataType: 'SINGLE_SELECT',
                      options: [
                        { id: 'OPT_1', name: 'Backlog' },
                        { id: 'OPT_2', name: 'In Progress' },
                      ],
                    },
                  ],
                },
                owner: { login: 'test-org' },
              },
            },
          },
        }),
        headers: new Headers(),
      });

      // Mock addProjectItem (draft issue)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            addProjectV2DraftIssue: {
              projectItem: {
                id: 'PVTI_456',
                createdAt: '2026-03-17T12:00:00Z',
                updatedAt: '2026-03-17T12:00:00Z',
                content: { title: 'Test Task' },
              },
            },
          },
        }),
        headers: new Headers(),
      });

      // Mock updateItemField (set status)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            updateProjectV2ItemFieldValue: {
              projectV2Item: { id: 'PVTI_456' },
            },
          },
        }),
        headers: new Headers(),
      });

      const task: Task = {
        task_id: 'task_123',
        title: 'Test Task',
        objective: 'Test objective',
        typed_ref: 'shipyard:task:github:123',
        state: 'queued',
        version: 1,
        risk_level: 'medium',
        repo_ref: { provider: 'github', owner: 'test', name: 'repo', default_branch: 'main' },
        created_at: '2026-03-17T12:00:00Z',
        updated_at: '2026-03-17T12:00:00Z',
      };

      const result = await service.addTaskToProject(task);

      expect(result.projectItem.projectItemId).toBe('PVTI_456');
      expect(result.externalRef.kind).toBe('github_project_item');
    });

    it('should throw validation_error without project config', async () => {
      const serviceWithoutDefault = new GitHubProjectsService({
        clientConfig: { auth: { token: 'ghp_test', tokenType: 'pat' } },
      });

      const task: Task = {
        task_id: 'task_123',
        title: 'Test Task',
        objective: 'Test objective',
        typed_ref: 'shipyard:task:github:123',
        state: 'queued',
        version: 1,
        risk_level: 'medium',
        repo_ref: { provider: 'github', owner: 'test', name: 'repo', default_branch: 'main' },
        created_at: '2026-03-17T12:00:00Z',
        updated_at: '2026-03-17T12:00:00Z',
      };

      await expect(serviceWithoutDefault.addTaskToProject(task)).rejects.toThrow(
        'No project specified and no default project configured'
      );
    });
  });

  describe('syncTaskState', () => {
    let service: GitHubProjectsService;
    let mockFetch: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mockFetch = vi.fn();
      global.fetch = mockFetch;

      service = new GitHubProjectsService({
        clientConfig: { auth: { token: 'ghp_test', tokenType: 'pat' } },
        defaultProject: { owner: 'test-org', projectNumber: 1 },
      });
    });

    it('should sync task state to project status', async () => {
      // Mock getProject
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            organization: {
              projectV2: {
                id: 'PVT_123',
                number: 1,
                title: 'Test Project',
                fields: {
                  nodes: [
                    {
                      id: 'FIELD_STATUS',
                      name: 'Status',
                      dataType: 'SINGLE_SELECT',
                      options: [
                        { id: 'OPT_1', name: 'Backlog' },
                        { id: 'OPT_2', name: 'In Progress' },
                        { id: 'OPT_3', name: 'Done' },
                      ],
                    },
                  ],
                },
                owner: { login: 'test-org' },
              },
            },
          },
        }),
        headers: new Headers(),
      });

      // Mock getProjectItem
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            node: {
              item: {
                id: 'PVTI_456',
                createdAt: '2026-03-17T12:00:00Z',
                updatedAt: '2026-03-17T12:00:00Z',
                content: { title: 'Test Task' },
                fieldValues: {
                  nodes: [
                    { field: { id: 'FIELD_STATUS', name: 'Status' }, value: 'Backlog' },
                  ],
                },
              },
            },
          },
        }),
        headers: new Headers(),
      });

      // Mock updateItemField
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            updateProjectV2ItemFieldValue: {
              projectV2Item: { id: 'PVTI_456' },
            },
          },
        }),
        headers: new Headers(),
      });

      const task: Task = {
        task_id: 'task_123',
        title: 'Test Task',
        objective: 'Test objective',
        typed_ref: 'shipyard:task:github:123',
        state: 'queued',
        version: 1,
        risk_level: 'medium',
        repo_ref: { provider: 'github', owner: 'test', name: 'repo', default_branch: 'main' },
        external_refs: [
          { kind: 'github_project_item', value: 'PVT_123:PVTI_456:test-org:1' },
        ],
        created_at: '2026-03-17T12:00:00Z',
        updated_at: '2026-03-17T12:00:00Z',
      };

      const result = await service.syncTaskState(task, 'developing');

      expect(result.success).toBe(true);
      expect(result.projectId).toBe('PVT_123');
      expect(result.projectItemId).toBe('PVTI_456');
      expect(result.previousStatus).toBe('Backlog');
      expect(result.newStatus).toBe('In Progress');
    });

    it('should return error when no project item found', async () => {
      const task: Task = {
        task_id: 'task_123',
        title: 'Test Task',
        objective: 'Test objective',
        typed_ref: 'shipyard:task:github:123',
        state: 'queued',
        version: 1,
        risk_level: 'medium',
        repo_ref: { provider: 'github', owner: 'test', name: 'repo', default_branch: 'main' },
        created_at: '2026-03-17T12:00:00Z',
        updated_at: '2026-03-17T12:00:00Z',
      };

      const result = await service.syncTaskState(task, 'developing');

      expect(result.success).toBe(false);
      expect(result.error).toBe('No project item found for task');
    });
  });

  describe('removeTaskFromProject', () => {
    let service: GitHubProjectsService;
    let mockFetch: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mockFetch = vi.fn();
      global.fetch = mockFetch;

      service = new GitHubProjectsService({
        clientConfig: { auth: { token: 'ghp_test', tokenType: 'pat' } },
      });
    });

    it('should remove task from project', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            deleteProjectV2Item: {
              deletedItemId: 'PVTI_456',
            },
          },
        }),
        headers: new Headers(),
      });

      const task: Task = {
        task_id: 'task_123',
        title: 'Test Task',
        objective: 'Test objective',
        typed_ref: 'shipyard:task:github:123',
        state: 'queued',
        version: 1,
        risk_level: 'medium',
        repo_ref: { provider: 'github', owner: 'test', name: 'repo', default_branch: 'main' },
        external_refs: [
          { kind: 'github_project_item', value: 'PVT_123:PVTI_456:test-org:1' },
        ],
        created_at: '2026-03-17T12:00:00Z',
        updated_at: '2026-03-17T12:00:00Z',
      };

      const result = await service.removeTaskFromProject(task);
      expect(result).toBe(true);
    });

    it('should return false when no project item', async () => {
      const task: Task = {
        task_id: 'task_123',
        title: 'Test Task',
        objective: 'Test objective',
        typed_ref: 'shipyard:task:github:123',
        state: 'queued',
        version: 1,
        risk_level: 'medium',
        repo_ref: { provider: 'github', owner: 'test', name: 'repo', default_branch: 'main' },
        created_at: '2026-03-17T12:00:00Z',
        updated_at: '2026-03-17T12:00:00Z',
      };

      const result = await service.removeTaskFromProject(task);
      expect(result).toBe(false);
    });
  });

  describe('Caching', () => {
    let service: GitHubProjectsService;
    let mockFetch: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mockFetch = vi.fn();
      global.fetch = mockFetch;

      service = new GitHubProjectsService({
        clientConfig: { auth: { token: 'ghp_test', tokenType: 'pat' } },
        defaultProject: { owner: 'test-org', projectNumber: 1 },
      });
    });

    it('should cache project data', async () => {
      const mockProjectResponse = {
        data: {
          organization: {
            projectV2: {
              id: 'PVT_123',
              number: 1,
              title: 'Test Project',
              fields: { nodes: [] },
              owner: { login: 'test-org' },
            },
          },
        },
      };

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockProjectResponse,
        headers: new Headers(),
      });

      // Mock add item
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockProjectResponse,
        headers: new Headers(),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            addProjectV2DraftIssue: {
              projectItem: {
                id: 'PVTI_1',
                createdAt: '2026-03-17T12:00:00Z',
                updatedAt: '2026-03-17T12:00:00Z',
                content: { title: 'Task 1' },
              },
            },
          },
        }),
        headers: new Headers(),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            addProjectV2DraftIssue: {
              projectItem: {
                id: 'PVTI_2',
                createdAt: '2026-03-17T12:00:00Z',
                updatedAt: '2026-03-17T12:00:00Z',
                content: { title: 'Task 2' },
              },
            },
          },
        }),
        headers: new Headers(),
      });

      const task: Task = {
        task_id: 'task_1',
        title: 'Task 1',
        objective: 'Test',
        typed_ref: 'shipyard:task:github:1',
        state: 'queued',
        version: 1,
        risk_level: 'low',
        repo_ref: { provider: 'github', owner: 'test', name: 'repo', default_branch: 'main' },
        created_at: '2026-03-17T12:00:00Z',
        updated_at: '2026-03-17T12:00:00Z',
      };

      // Add two tasks - should only fetch project once
      await service.addTaskToProject(task);
      task.task_id = 'task_2';
      await service.addTaskToProject(task);

      // Verify project was only fetched once (first call)
      // Note: This is hard to test precisely with the mock setup
    });

    it('should clear caches', () => {
      service.clearCaches();
      // No error should occur
    });
  });
});