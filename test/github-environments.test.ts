import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  GitHubEnvironmentsService,
  type GitHubEnvironmentsConfig,
} from '../src/domain/github-environments/index.js';

describe('GitHubEnvironmentsService', () => {
  let service: GitHubEnvironmentsService;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch;

    const config: GitHubEnvironmentsConfig = {
      token: 'ghp_test_token',
      tokenType: 'pat',
    };

    service = new GitHubEnvironmentsService(config);
  });

  describe('constructor', () => {
    it('should create service with default base URL', () => {
      const config: GitHubEnvironmentsConfig = {
        token: 'test-token',
      };
      const service = new GitHubEnvironmentsService(config);
      expect(service).toBeDefined();
    });

    it('should create service with custom base URL', () => {
      const config: GitHubEnvironmentsConfig = {
        token: 'test-token',
        baseUrl: 'https://github.example.com/api/v3',
      };
      const service = new GitHubEnvironmentsService(config);
      expect(service).toBeDefined();
    });
  });

  describe('listEnvironments', () => {
    it('should list environments for repository', async () => {
      const mockResponse = {
        total_count: 2,
        environments: [
          { name: 'production', id: 1, node_id: 'env1', url: '', html_url: '', created_at: '', updated_at: '' },
          { name: 'staging', id: 2, node_id: 'env2', url: '', html_url: '', created_at: '', updated_at: '' },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await service.listEnvironments('test-owner', 'test-repo');

      expect(result.total_count).toBe(2);
      expect(result.environments).toHaveLength(2);
      expect(result.environments[0].name).toBe('production');
    });

    it('should return empty list on 404', async () => {
      mockFetch.mockResolvedValueOnce({
        status: 404,
        ok: false,
      });

      const result = await service.listEnvironments('test-owner', 'test-repo');

      expect(result.total_count).toBe(0);
      expect(result.environments).toHaveLength(0);
    });
  });

  describe('getEnvironment', () => {
    it('should get specific environment', async () => {
      const mockResponse = {
        name: 'production',
        id: 1,
        node_id: 'env1',
        url: 'https://api.github.com/repos/test/test/environments/production',
        html_url: 'https://github.com/test/test/settings/environments/1',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        protection_rules: [
          { id: 1, node_id: 'rule1', type: 'required_reviewers', enabled: true },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await service.getEnvironment('test-owner', 'test-repo', 'production');

      expect(result).not.toBeNull();
      expect(result?.name).toBe('production');
      expect(result?.protection_rules).toHaveLength(1);
    });

    it('should return null for non-existent environment', async () => {
      mockFetch.mockResolvedValueOnce({
        status: 404,
        ok: false,
      });

      const result = await service.getEnvironment('test-owner', 'test-repo', 'nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('createOrUpdateEnvironment', () => {
    it('should create environment', async () => {
      const mockResponse = {
        name: 'staging',
        id: 3,
        node_id: 'env3',
        url: '',
        html_url: '',
        created_at: '',
        updated_at: '',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await service.createOrUpdateEnvironment('test-owner', 'test-repo', {
        name: 'staging',
        wait_timer: 5,
      });

      expect(result.name).toBe('staging');
    });

    it('should throw on failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({ message: 'Forbidden' }),
      });

      await expect(
        service.createOrUpdateEnvironment('test-owner', 'test-repo', { name: 'test' })
      ).rejects.toThrow();
    });
  });

  describe('deleteEnvironment', () => {
    it('should delete environment', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
      });

      await expect(
        service.deleteEnvironment('test-owner', 'test-repo', 'test-env')
      ).resolves.not.toThrow();
    });

    it('should not throw on 404', async () => {
      mockFetch.mockResolvedValueOnce({
        status: 404,
        ok: false,
      });

      await expect(
        service.deleteEnvironment('test-owner', 'test-repo', 'nonexistent')
      ).resolves.not.toThrow();
    });
  });

  describe('checkProtectionRules', () => {
    it('should return failure for non-existent environment', async () => {
      mockFetch.mockResolvedValueOnce({
        status: 404,
        ok: false,
      });

      const result = await service.checkProtectionRules('test-owner', 'test-repo', 'nonexistent', 'main');

      expect(result.can_deploy).toBe(false);
      expect(result.protection_rules[0].type).toBe('environment_not_found');
    });

    it('should check branch policy', async () => {
      const mockEnv = {
        name: 'production',
        id: 1,
        node_id: 'env1',
        url: '',
        html_url: '',
        created_at: '',
        updated_at: '',
        deployment_branch_policy: {
          protected_branches: true,
          custom_branch_policies: false,
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockEnv,
      });

      // Mock branch protection check
      mockFetch.mockResolvedValueOnce({
        ok: true,
      });

      const result = await service.checkProtectionRules('test-owner', 'test-repo', 'production', 'main');

      expect(result.protection_rules.some(r => r.type === 'branch_policy')).toBe(true);
    });

    it('should detect required reviewers', async () => {
      const mockEnv = {
        name: 'production',
        id: 1,
        node_id: 'env1',
        url: '',
        html_url: '',
        created_at: '',
        updated_at: '',
        protection_rules: [
          {
            id: 1,
            node_id: 'rule1',
            type: 'required_reviewers',
            enabled: true,
            reviewers: [
              { type: 'User', reviewer: { id: 1, login: 'reviewer1' } },
            ],
          },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockEnv,
      });

      const result = await service.checkProtectionRules('test-owner', 'test-repo', 'production', 'main');

      expect(result.can_deploy).toBe(false);
      expect(result.required_reviewers).toContain('reviewer1');
    });
  });

  describe('requestDeploymentApproval', () => {
    it('should auto-approve if no reviewers required', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          name: 'development',
          id: 1,
          node_id: 'env1',
          url: '',
          html_url: '',
          created_at: '',
          updated_at: '',
          protection_rules: [],
        }),
      });

      const result = await service.requestDeploymentApproval('test-owner', 'test-repo', {
        environment: 'development',
        task_id: 'task_123',
        risk_level: 'low',
        requested_by: 'user1',
        callback_url: 'https://example.com/callback',
      });

      expect(result.status).toBe('approved');
    });

    it('should return pending if reviewers required', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          name: 'production',
          id: 1,
          node_id: 'env1',
          url: '',
          html_url: '',
          created_at: '',
          updated_at: '',
          protection_rules: [
            { id: 1, node_id: 'rule1', type: 'required_reviewers', enabled: true },
          ],
        }),
      });

      const result = await service.requestDeploymentApproval('test-owner', 'test-repo', {
        environment: 'production',
        task_id: 'task_123',
        risk_level: 'high',
        requested_by: 'user1',
        callback_url: 'https://example.com/callback',
      });

      expect(result.status).toBe('pending');
    });
  });

  describe('getApprovalRequirements', () => {
    it('should return approval requirements', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          name: 'production',
          id: 1,
          node_id: 'env1',
          url: '',
          html_url: '',
          created_at: '',
          updated_at: '',
          protection_rules: [
            {
              id: 1,
              node_id: 'rule1',
              type: 'required_reviewers',
              enabled: true,
              reviewers: [
                { type: 'User', reviewer: { id: 1, login: 'approver1' } },
                { type: 'Team', reviewer: { id: 2, slug: 'deploy-team' } },
              ],
            },
          ],
        }),
      });

      const result = await service.getApprovalRequirements('test-owner', 'test-repo', 'production');

      expect(result.requires_approval).toBe(true);
      expect(result.required_reviewers).toHaveLength(2);
      expect(result.required_reviewers[0].login).toBe('approver1');
      expect(result.required_reviewers[1].login).toBe('deploy-team');
    });

    it('should return no approval for non-existent environment', async () => {
      mockFetch.mockResolvedValueOnce({
        status: 404,
        ok: false,
      });

      const result = await service.getApprovalRequirements('test-owner', 'test-repo', 'nonexistent');

      expect(result.requires_approval).toBe(false);
    });
  });

  describe('secrets', () => {
    it('should get repo public key', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ key: 'public-key-base64', key_id: 'key123' }),
      });

      const result = await service.getRepoPublicKey('test-owner', 'test-repo');

      expect(result.key).toBe('public-key-base64');
      expect(result.key_id).toBe('key123');
    });

    it('should list environment secrets', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          total_count: 2,
          secrets: [
            { name: 'API_KEY', created_at: '', updated_at: '' },
            { name: 'DB_PASSWORD', created_at: '', updated_at: '' },
          ],
        }),
      });

      const result = await service.listEnvironmentSecrets('test-owner', 'test-repo', 'production');

      expect(result.total_count).toBe(2);
      expect(result.secrets[0].name).toBe('API_KEY');
    });

    it('should set environment secret', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
      });

      await expect(
        service.setEnvironmentSecret('test-owner', 'test-repo', 'production', {
          name: 'SECRET_KEY',
          encrypted_value: 'encrypted-value',
          key_id: 'key123',
        })
      ).resolves.not.toThrow();
    });

    it('should delete environment secret', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
      });

      await expect(
        service.deleteEnvironmentSecret('test-owner', 'test-repo', 'production', 'SECRET_KEY')
      ).resolves.not.toThrow();
    });
  });

  describe('getEnvironmentForRiskLevel', () => {
    it('should map high risk to production', () => {
      expect(GitHubEnvironmentsService.getEnvironmentForRiskLevel('high')).toBe('production');
    });

    it('should map medium risk to staging', () => {
      expect(GitHubEnvironmentsService.getEnvironmentForRiskLevel('medium')).toBe('staging');
    });

    it('should map low risk to development', () => {
      expect(GitHubEnvironmentsService.getEnvironmentForRiskLevel('low')).toBe('development');
    });
  });
});