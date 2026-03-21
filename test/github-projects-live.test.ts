import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import {
  GitHubProjectsClient,
  GitHubProjectsService,
  type ProjectV2SingleSelectField,
} from '../src/domain/github-projects/index.js';
import type { Task } from '../src/types.js';
import type { ControlPlaneStore } from '../src/store/control-plane-store.js';

/**
 * GitHub Projects v2 Live Tests
 *
 * Run with:
 *   export GITHUB_TOKEN=ghp_xxx
 *   export GITHUB_OWNER=your-org
 *   export GITHUB_PROJECT_NUMBER=1
 *   npm test -- --run test/github-projects-live.test.ts
 */
describe('GitHub Projects v2 Live Tests', () => {
  const githubToken = process.env.GITHUB_TOKEN;
  const githubOwner = process.env.GITHUB_OWNER;
  const projectNumber = parseInt(process.env.GITHUB_PROJECT_NUMBER || '1');

  // Skip all tests if no token
  const maybeDescribe = githubToken && githubOwner ? describe : describe.skip;

  let client: GitHubProjectsClient;
  let service: GitHubProjectsService;
  let app: FastifyInstance & { store: ControlPlaneStore };
  let testTask: Task;
  let projectItemId: string | null = null;

  beforeAll(async () => {
    if (!githubToken || !githubOwner) {
      return;
    }

    client = new GitHubProjectsClient({
      auth: { token: githubToken, tokenType: 'pat' },
    });

    service = new GitHubProjectsService({
      clientConfig: { auth: { token: githubToken, tokenType: 'pat' } },
      defaultProject: { owner: githubOwner, projectNumber },
    });

    app = await buildApp({ logger: false, auth: { enabled: false } });
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  maybeDescribe('Client Operations', () => {
    it('should fetch project details', async () => {
      console.log(`Fetching project: ${githubOwner}/${projectNumber}`);

      const project = await client.getProject({
        owner: githubOwner!,
        projectNumber,
      });

      console.log('Project:', JSON.stringify(project, null, 2));

      expect(project.id).toBeDefined();
      expect(project.title).toBeDefined();
      expect(project.fields.length).toBeGreaterThan(0);

      // Find Status field
      const statusField = GitHubProjectsClient.findFieldByName(project, 'Status');
      console.log('Status field:', statusField);
    }, 30000);

    it('should check rate limit', () => {
      const rateLimit = client.getRateLimitInfo();
      console.log('Rate limit:', rateLimit);

      if (rateLimit) {
        expect(rateLimit.limit).toBeGreaterThan(0);
        console.log(`Remaining: ${rateLimit.remaining}/${rateLimit.limit}`);
      }
    });
  });

  maybeDescribe('Service Integration', () => {
    it('should create a task and add to project', async () => {
      // Create test task
      const response = await app.inject({
        method: 'POST',
        url: '/v1/tasks',
        payload: {
          title: `[TEST] GitHub Projects Integration ${Date.now()}`,
          objective: 'Test GitHub Projects v2 integration',
          typed_ref: `agent-taskstate:task:github:test-gh-projects-${Date.now()}`,
          repo_ref: {
            provider: 'github',
            owner: githubOwner!,
            name: 'test-repo',
            default_branch: 'main',
          },
          risk_level: 'low',
        },
      });

      expect(response.statusCode).toBe(201);
      testTask = response.json();
      console.log('Created task:', testTask.task_id);

      // Add to project
      const result = await service.addTaskToProject(testTask);
      console.log('Added to project:', result);

      expect(result.projectItem.projectItemId).toBeDefined();
      expect(result.externalRef.kind).toBe('github_project_item');

      projectItemId = result.projectItem.projectItemId;

      // Add external_ref to task for subsequent tests
      testTask.external_refs = [result.externalRef];
    }, 30000);

    it('should sync task state to project', async () => {
      if (!projectItemId) {
        console.log('Skipping - no project item created');
        return;
      }

      const result = await service.syncTaskState(testTask, 'developing');
      console.log('Sync result:', result);

      expect(result.success).toBe(true);
      expect(result.newStatus).toBeDefined();
    }, 30000);

    it('should remove task from project', async () => {
      if (!projectItemId) {
        console.log('Skipping - no project item created');
        return;
      }

      const removed = await service.removeTaskFromProject(testTask);
      console.log('Removed from project:', removed);

      expect(removed).toBe(true);
    }, 30000);
  });

  maybeDescribe('State Mapping', () => {
    it('should map all task states to project statuses', async () => {
      const project = await client.getProject({
        owner: githubOwner!,
        projectNumber,
      });

      const statusField = GitHubProjectsClient.findFieldByName(project, 'Status');
      if (!statusField || statusField.dataType !== 'SINGLE_SELECT') {
        console.log('No Status field found, skipping');
        return;
      }

      const states = [
        'queued', 'planning', 'planned', 'developing', 'dev_completed',
        'accepting', 'accepted', 'integrating', 'integrated',
        'publishing', 'published', 'blocked', 'failed',
      ] as const;

      console.log('\nState to Status mapping:');
      for (const state of states) {
        const value = GitHubProjectsClient.mapStateToStatus(state, statusField as ProjectV2SingleSelectField);
        const statusName = value
          ? statusField.options.find(o => o.id === (value as { singleSelectOptionId: string }).singleSelectOptionId)?.name
          : 'NO MATCH';
        console.log(`  ${state} -> ${statusName}`);
      }
    }, 30000);
  });
});