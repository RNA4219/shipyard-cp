import { describe, it, expect, beforeEach } from 'vitest';
import {
  WorkspaceManager,
  DEFAULT_WORKSPACE_CONFIGS,
  type WorkspaceState,
} from '../src/domain/workspace/index.js';

describe('WorkspaceManager', () => {
  let manager: WorkspaceManager;

  beforeEach(() => {
    manager = new WorkspaceManager();
  });

  describe('createWorkspace', () => {
    it('should create container workspace', async () => {
      const state = await manager.createWorkspace({
        task_id: 'task-1',
        kind: 'container',
        container_image: 'node:20',
        working_directory: '/app',
      });

      expect(state.workspace_id).toBeDefined();
      expect(state.task_id).toBe('task-1');
      expect(state.kind).toBe('container');
      expect(state.status).toBe('ready');
      expect(state.container_id).toBeDefined();
    });

    it('should create volume workspace', async () => {
      const state = await manager.createWorkspace({
        task_id: 'task-2',
        kind: 'volume',
        reusable: true,
      });

      expect(state.kind).toBe('volume');
      expect(state.config.reusable).toBe(true);
    });

    it('should create workspace with isolation settings', async () => {
      const state = await manager.createWorkspace({
        task_id: 'task-3',
        kind: 'container',
        isolation: {
          user_namespace: true,
          network_mode: 'none',
          no_new_privileges: true,
          read_only_root: true,
        },
      });

      expect(state.config.isolation?.user_namespace).toBe(true);
      expect(state.config.isolation?.network_mode).toBe('none');
    });

    it('should create workspace with resource limits', async () => {
      const state = await manager.createWorkspace({
        task_id: 'task-4',
        kind: 'container',
        resource_limits: {
          cpu_limit: 2,
          memory_limit: 4 * 1024 * 1024 * 1024,
          execution_timeout_ms: 3600000,
        },
      });

      expect(state.config.resource_limits?.cpu_limit).toBe(2);
      expect(state.config.resource_limits?.memory_limit).toBe(4 * 1024 * 1024 * 1024);
    });

    it('should create workspace with environment variables', async () => {
      const state = await manager.createWorkspace({
        task_id: 'task-5',
        kind: 'container',
        environment: {
          NODE_ENV: 'test',
          DEBUG: 'true',
        },
        secrets: ['API_KEY', 'DB_PASSWORD'],
      });

      expect(state.config.environment?.NODE_ENV).toBe('test');
      expect(state.config.secrets).toContain('API_KEY');
    });
  });

  describe('getWorkspace', () => {
    it('should return workspace by ID', async () => {
      const created = await manager.createWorkspace({
        task_id: 'task-1',
        kind: 'container',
      });

      const found = manager.getWorkspace(created.workspace_id);
      expect(found).toBeDefined();
      expect(found?.workspace_id).toBe(created.workspace_id);
    });

    it('should return undefined for unknown ID', () => {
      const found = manager.getWorkspace('unknown-id');
      expect(found).toBeUndefined();
    });
  });

  describe('getWorkspaceForTask', () => {
    it('should return workspace for task', async () => {
      await manager.createWorkspace({
        task_id: 'task-1',
        kind: 'container',
      });

      const found = manager.getWorkspaceForTask('task-1');
      expect(found).toBeDefined();
      expect(found?.task_id).toBe('task-1');
    });

    it('should return undefined for task without workspace', () => {
      const found = manager.getWorkspaceForTask('unknown-task');
      expect(found).toBeUndefined();
    });
  });

  describe('acquireLease', () => {
    it('should acquire lease on ready workspace', async () => {
      const state = await manager.createWorkspace({
        task_id: 'task-1',
        kind: 'container',
      });

      const result = await manager.acquireLease(
        state.workspace_id,
        'run-1',
        'worker-1',
        60000
      );

      expect(result.success).toBe(true);
      expect(result.expires_at).toBeDefined();

      const updated = manager.getWorkspace(state.workspace_id);
      expect(updated?.status).toBe('in_use');
      expect(updated?.lease_owner).toBe('worker-1');
    });

    it('should fail to acquire lease on non-ready workspace', async () => {
      const state = await manager.createWorkspace({
        task_id: 'task-1',
        kind: 'container',
      });

      // Manually set status to creating
      const ws = manager.getWorkspace(state.workspace_id);
      if (ws) ws.status = 'creating';

      const result = await manager.acquireLease(
        state.workspace_id,
        'run-1',
        'worker-1',
        60000
      );

      expect(result.success).toBe(false);
    });

    it('should fail to acquire lease when already leased', async () => {
      const state = await manager.createWorkspace({
        task_id: 'task-1',
        kind: 'container',
      });

      await manager.acquireLease(state.workspace_id, 'run-1', 'worker-1', 60000);

      const result = await manager.acquireLease(
        state.workspace_id,
        'run-2',
        'worker-2',
        60000
      );

      expect(result.success).toBe(false);
    });

    it('should throw for unknown workspace', async () => {
      await expect(
        manager.acquireLease('unknown-id', 'run-1', 'worker-1', 60000)
      ).rejects.toThrow('not found');
    });
  });

  describe('releaseLease', () => {
    it('should release lease', async () => {
      const state = await manager.createWorkspace({
        task_id: 'task-1',
        kind: 'container',
      });

      await manager.acquireLease(state.workspace_id, 'run-1', 'worker-1', 60000);
      await manager.releaseLease(state.workspace_id);

      const updated = manager.getWorkspace(state.workspace_id);
      expect(updated?.status).toBe('ready');
      expect(updated?.lease_owner).toBeUndefined();
    });
  });

  describe('resetWorkspace', () => {
    it('should reset workspace for high risk', async () => {
      const state = await manager.createWorkspace({
        task_id: 'task-1',
        kind: 'container',
      });

      const result = await manager.resetWorkspace({
        workspace_id: state.workspace_id,
        reason: 'high_risk_detected',
        risk_level: 'high',
      });

      expect(result.workspace_id).toBe(state.workspace_id);
      expect(result.reason).toBe('high_risk_detected');
      expect(result.new_container_id).toBeDefined();

      const updated = manager.getWorkspace(state.workspace_id);
      expect(updated?.reset_count).toBe(1);
      expect(updated?.last_reset_reason).toBe('high_risk_detected');
    });

    it('should preserve artifacts during reset', async () => {
      const state = await manager.createWorkspace({
        task_id: 'task-1',
        kind: 'container',
      });

      const result = await manager.resetWorkspace({
        workspace_id: state.workspace_id,
        reason: 'contamination',
        risk_level: 'high',
        preserve_artifacts: true,
        artifact_paths: ['/workspace/logs', '/workspace/output.json'],
      });

      expect(result.preserved_artifacts).toHaveLength(2);
      expect(result.preserved_artifacts?.map(a => a.path)).toContain('/workspace/logs');
    });

    it('should throw for high-risk reset on non-high task', async () => {
      const state = await manager.createWorkspace({
        task_id: 'task-1',
        kind: 'container',
      });

      await expect(
        manager.resetWorkspace({
          workspace_id: state.workspace_id,
          reason: 'high_risk_detected',
          risk_level: 'low',
        })
      ).rejects.toThrow('only allowed for high risk level');
    });

    it('should throw for unknown workspace', async () => {
      await expect(
        manager.resetWorkspace({
          workspace_id: 'unknown-id',
          reason: 'user_request',
          risk_level: 'medium',
        })
      ).rejects.toThrow('not found');
    });
  });

  describe('destroyWorkspace', () => {
    it('should destroy workspace', async () => {
      const state = await manager.createWorkspace({
        task_id: 'task-1',
        kind: 'container',
      });

      await manager.destroyWorkspace(state.workspace_id);

      const updated = manager.getWorkspace(state.workspace_id);
      expect(updated?.status).toBe('destroyed');
      expect(updated?.destroyed_at).toBeDefined();

      // Should no longer be mapped to task
      expect(manager.getWorkspaceForTask('task-1')).toBeUndefined();
    });
  });

  describe('cleanupOrphaned', () => {
    it('should clean up orphaned workspaces', async () => {
      const state = await manager.createWorkspace({
        task_id: 'task-1',
        kind: 'container',
      });

      await manager.acquireLease(state.workspace_id, 'run-1', 'worker-1', -1000); // Already expired

      const orphaned = await manager.cleanupOrphaned(0);

      expect(orphaned).toContain(state.workspace_id);
    });
  });

  describe('listWorkspaces', () => {
    it('should list all workspaces', async () => {
      await manager.createWorkspace({ task_id: 'task-1', kind: 'container' });
      await manager.createWorkspace({ task_id: 'task-2', kind: 'container' });

      const all = manager.listWorkspaces();
      expect(all).toHaveLength(2);
    });

    it('should list workspaces by status', async () => {
      await manager.createWorkspace({ task_id: 'task-1', kind: 'container' });

      const state2 = await manager.createWorkspace({ task_id: 'task-2', kind: 'container' });
      await manager.destroyWorkspace(state2.workspace_id);

      const ready = manager.listWorkspaces('ready');
      const destroyed = manager.listWorkspaces('destroyed');

      expect(ready).toHaveLength(1);
      expect(destroyed).toHaveLength(1);
    });
  });

  describe('shouldResetForRisk', () => {
    it('should return true for contamination', () => {
      expect(
        WorkspaceManager.shouldResetForRisk('low', undefined, true)
      ).toBe(true);
    });

    it('should return true for risk escalation to high', () => {
      expect(
        WorkspaceManager.shouldResetForRisk('high', 'medium', false)
      ).toBe(true);
    });

    it('should return false for same risk level', () => {
      expect(
        WorkspaceManager.shouldResetForRisk('medium', 'medium', false)
      ).toBe(false);
    });

    it('should return false for risk downgrade', () => {
      expect(
        WorkspaceManager.shouldResetForRisk('low', 'high', false)
      ).toBe(false);
    });
  });

  describe('DEFAULT_WORKSPACE_CONFIGS', () => {
    it('should have configs for all risk levels', () => {
      expect(DEFAULT_WORKSPACE_CONFIGS.low).toBeDefined();
      expect(DEFAULT_WORKSPACE_CONFIGS.medium).toBeDefined();
      expect(DEFAULT_WORKSPACE_CONFIGS.high).toBeDefined();
    });

    it('should have increasing isolation for higher risk', () => {
      const lowIsolation = DEFAULT_WORKSPACE_CONFIGS.low.isolation;
      const highIsolation = DEFAULT_WORKSPACE_CONFIGS.high.isolation;

      expect(highIsolation?.network_mode).toBe('none');
      expect(highIsolation?.user_namespace).toBe(true);
      expect(highIsolation?.read_only_root).toBe(true);

      // Low risk should be less restrictive
      expect(lowIsolation?.network_mode).toBe('bridge');
    });

    it('should have resource limits for high risk', () => {
      const highConfig = DEFAULT_WORKSPACE_CONFIGS.high;
      expect(highConfig.resource_limits?.cpu_limit).toBeDefined();
      expect(highConfig.resource_limits?.memory_limit).toBeDefined();
      expect(highConfig.resource_limits?.execution_timeout_ms).toBeDefined();
    });

    it('should mark high risk as non-reusable', () => {
      expect(DEFAULT_WORKSPACE_CONFIGS.low.reusable).toBe(true);
      expect(DEFAULT_WORKSPACE_CONFIGS.medium.reusable).toBe(false);
      expect(DEFAULT_WORKSPACE_CONFIGS.high.reusable).toBe(false);
    });
  });
});