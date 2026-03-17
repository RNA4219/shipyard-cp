import type { RiskLevel } from '../../types.js';

/**
 * Workspace kinds
 */
export type WorkspaceKind = 'container' | 'volume' | 'host_path';

/**
 * Workspace status
 */
export type WorkspaceStatus =
  | 'pending'      // Created but not started
  | 'creating'     // Being created
  | 'ready'        // Ready for use
  | 'in_use'       // Currently being used
  | 'error'        // Error state
  | 'resetting'    // Being reset (high-risk)
  | 'destroying'   // Being destroyed
  | 'destroyed';   // Destroyed

/**
 * Workspace configuration
 */
export interface WorkspaceConfig {
  /** Unique workspace ID */
  workspace_id: string;
  /** Task ID this workspace is for */
  task_id: string;
  /** Kind of workspace */
  kind: WorkspaceKind;
  /** Whether workspace can be reused between runs */
  reusable: boolean;

  /** Container image (if kind is container) */
  container_image?: string;
  /** Working directory inside workspace */
  working_directory: string;

  /** Environment variables */
  environment?: Record<string, string>;
  /** Secrets to inject (names only) */
  secrets?: string[];

  /** Mounted volumes */
  mounts?: Array<{
    source: string;
    target: string;
    type: 'bind' | 'volume';
  }>;

  /** Isolation settings */
  isolation?: WorkspaceIsolation;

  /** Resource limits */
  resource_limits?: ResourceLimits;
}

/**
 * Workspace isolation settings
 */
export interface WorkspaceIsolation {
  /** Use user namespace for rootless containers */
  user_namespace?: boolean;
  /** Network isolation mode */
  network_mode?: 'none' | 'bridge' | 'host' | 'custom';
  /** Custom network name (if network_mode is custom) */
  custom_network?: string;
  /** Disable inter-container communication */
  no_new_privileges?: boolean;
  /** Read-only root filesystem */
  read_only_root?: boolean;
  /** Security options */
  security_opts?: string[];
  /** Capabilities to drop */
  cap_drop?: string[];
  /** Capabilities to add */
  cap_add?: string[];
}

/**
 * Resource limits for workspace
 */
export interface ResourceLimits {
  /** CPU limit (cores) */
  cpu_limit?: number;
  /** Memory limit (bytes) */
  memory_limit?: number;
  /** Disk limit (bytes) */
  disk_limit?: number;
  /** Maximum execution time (ms) */
  execution_timeout_ms?: number;
}

/**
 * Workspace state
 */
export interface WorkspaceState {
  workspace_id: string;
  task_id: string;
  status: WorkspaceStatus;
  kind: WorkspaceKind;

  /** Container ID (if applicable) */
  container_id?: string;

  /** Creation timestamp */
  created_at: string;
  /** Last update timestamp */
  updated_at: string;
  /** Ready timestamp */
  ready_at?: string;
  /** Destroyed timestamp */
  destroyed_at?: string;

  /** Current run ID (if in_use) */
  current_run_id?: string;
  /** Current lease owner */
  lease_owner?: string;
  /** Lease expiration */
  lease_expires_at?: string;

  /** Error message (if status is error) */
  error_message?: string;
  /** Reset count */
  reset_count: number;
  /** Last reset reason */
  last_reset_reason?: string;

  /** Configuration */
  config: WorkspaceConfig;
}

/**
 * Workspace creation request
 */
export interface CreateWorkspaceRequest {
  task_id: string;
  kind: WorkspaceKind;
  reusable?: boolean;

  container_image?: string;
  working_directory?: string;

  environment?: Record<string, string>;
  secrets?: string[];
  mounts?: WorkspaceConfig['mounts'];

  isolation?: WorkspaceIsolation;
  resource_limits?: ResourceLimits;
}

/**
 * Workspace reset request
 */
export interface ResetWorkspaceRequest {
  workspace_id: string;
  reason: 'high_risk_detected' | 'contamination' | 'user_request' | 'error_recovery';
  risk_level: RiskLevel;
  preserve_artifacts?: boolean;
  artifact_paths?: string[];
}

/**
 * Workspace reset result
 */
export interface ResetWorkspaceResult {
  workspace_id: string;
  old_container_id?: string;
  new_container_id?: string;
  reset_at: string;
  reason: string;
  preserved_artifacts?: Array<{
    path: string;
    artifact_id: string;
  }>;
}

/**
 * Workspace manager service
 */
export class WorkspaceManager {
  private workspaces: Map<string, WorkspaceState> = new Map();
  private taskWorkspaces: Map<string, string> = new Map(); // task_id -> workspace_id

  /**
   * Create a new workspace for a task
   */
  async createWorkspace(request: CreateWorkspaceRequest): Promise<WorkspaceState> {
    const workspaceId = `ws-${request.task_id}-${Date.now()}`;

    const config: WorkspaceConfig = {
      workspace_id: workspaceId,
      task_id: request.task_id,
      kind: request.kind,
      reusable: request.reusable ?? false,
      container_image: request.container_image,
      working_directory: request.working_directory ?? '/workspace',
      environment: request.environment,
      secrets: request.secrets,
      mounts: request.mounts,
      isolation: request.isolation,
      resource_limits: request.resource_limits,
    };

    const state: WorkspaceState = {
      workspace_id: workspaceId,
      task_id: request.task_id,
      status: 'creating',
      kind: request.kind,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      reset_count: 0,
      config,
    };

    this.workspaces.set(workspaceId, state);
    this.taskWorkspaces.set(request.task_id, workspaceId);

    // Simulate async creation
    // In production, this would call container runtime API
    await this.performCreation(state);

    return state;
  }

  /**
   * Get workspace state
   */
  getWorkspace(workspaceId: string): WorkspaceState | undefined {
    return this.workspaces.get(workspaceId);
  }

  /**
   * Get workspace for a task
   */
  getWorkspaceForTask(taskId: string): WorkspaceState | undefined {
    const workspaceId = this.taskWorkspaces.get(taskId);
    if (!workspaceId) return undefined;
    return this.workspaces.get(workspaceId);
  }

  /**
   * Acquire workspace lease
   */
  async acquireLease(
    workspaceId: string,
    runId: string,
    owner: string,
    durationMs: number
  ): Promise<{ success: boolean; expires_at?: string }> {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) {
      throw new Error(`Workspace ${workspaceId} not found`);
    }

    if (workspace.status !== 'ready') {
      return { success: false };
    }

    if (workspace.lease_owner && new Date(workspace.lease_expires_at!) > new Date()) {
      return { success: false };
    }

    const expiresAt = new Date(Date.now() + durationMs).toISOString();
    workspace.status = 'in_use';
    workspace.current_run_id = runId;
    workspace.lease_owner = owner;
    workspace.lease_expires_at = expiresAt;
    workspace.updated_at = new Date().toISOString();

    return { success: true, expires_at: expiresAt };
  }

  /**
   * Release workspace lease
   */
  async releaseLease(workspaceId: string): Promise<void> {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) return;

    workspace.status = 'ready';
    workspace.current_run_id = undefined;
    workspace.lease_owner = undefined;
    workspace.lease_expires_at = undefined;
    workspace.updated_at = new Date().toISOString();
  }

  /**
   * Reset workspace (for high-risk scenarios)
   */
  async resetWorkspace(request: ResetWorkspaceRequest): Promise<ResetWorkspaceResult> {
    const workspace = this.workspaces.get(request.workspace_id);
    if (!workspace) {
      throw new Error(`Workspace ${request.workspace_id} not found`);
    }

    // Check if reset is allowed for this risk level
    if (request.risk_level !== 'high' && request.reason === 'high_risk_detected') {
      throw new Error('High-risk reset only allowed for high risk level tasks');
    }

    // Preserve artifacts if requested
    const preservedArtifacts: ResetWorkspaceResult['preserved_artifacts'] = [];
    if (request.preserve_artifacts && request.artifact_paths) {
      for (const path of request.artifact_paths) {
        // In production, would copy artifacts to safe location
        preservedArtifacts.push({
          path,
          artifact_id: `artifact-${Date.now()}-${path.replace(/\//g, '_')}`,
        });
      }
    }

    const oldContainerId = workspace.container_id;

    // Update state to resetting
    workspace.status = 'resetting';
    workspace.updated_at = new Date().toISOString();

    // Perform reset (destroy old container, create new one)
    await this.performDestruction(workspace, false);
    await this.performCreation(workspace);

    // Update state
    workspace.status = 'ready';
    workspace.reset_count += 1;
    workspace.last_reset_reason = request.reason;
    workspace.updated_at = new Date().toISOString();

    return {
      workspace_id: request.workspace_id,
      old_container_id: oldContainerId,
      new_container_id: workspace.container_id,
      reset_at: new Date().toISOString(),
      reason: request.reason,
      preserved_artifacts: preservedArtifacts.length > 0 ? preservedArtifacts : undefined,
    };
  }

  /**
   * Destroy workspace
   */
  async destroyWorkspace(workspaceId: string): Promise<void> {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) return;

    workspace.status = 'destroying';
    workspace.updated_at = new Date().toISOString();

    await this.performDestruction(workspace, true);

    workspace.status = 'destroyed';
    workspace.destroyed_at = new Date().toISOString();
    workspace.updated_at = new Date().toISOString();

    // Remove from task mapping
    this.taskWorkspaces.delete(workspace.task_id);
  }

  /**
   * Clean up orphaned workspaces
   */
  async cleanupOrphaned(maxAgeMs: number): Promise<string[]> {
    const now = Date.now();
    const orphanedIds: string[] = [];

    for (const [id, workspace] of this.workspaces) {
      // Check for workspaces with status 'in_use' but expired lease
      if (
        workspace.status === 'in_use' &&
        workspace.lease_expires_at &&
        new Date(workspace.lease_expires_at).getTime() < now - maxAgeMs
      ) {
        orphanedIds.push(id);
        await this.destroyWorkspace(id);
      }
      // Check for ready workspaces with stale lease info (edge case)
      else if (
        workspace.status === 'ready' &&
        workspace.lease_owner &&
        workspace.lease_expires_at &&
        new Date(workspace.lease_expires_at).getTime() < now - maxAgeMs
      ) {
        orphanedIds.push(id);
        await this.destroyWorkspace(id);
      }
    }

    return orphanedIds;
  }

  /**
   * List workspaces by status
   */
  listWorkspaces(status?: WorkspaceStatus): WorkspaceState[] {
    const all = Array.from(this.workspaces.values());
    if (!status) return all;
    return all.filter(w => w.status === status);
  }

  /**
   * Check if high-risk reset is needed
   */
  static shouldResetForRisk(
    riskLevel: RiskLevel,
    previousRiskLevel: RiskLevel | undefined,
    contaminationDetected: boolean
  ): boolean {
    if (contaminationDetected) return true;
    if (riskLevel === 'high' && previousRiskLevel !== 'high') return true;
    return false;
  }

  // Private methods

  private async performCreation(workspace: WorkspaceState): Promise<void> {
    // Simulate container creation
    // In production, this would call Docker/Podman/Kubernetes API
    await new Promise(resolve => setTimeout(resolve, 100));

    workspace.container_id = `container-${workspace.workspace_id}`;
    workspace.status = 'ready';
    workspace.ready_at = new Date().toISOString();
    workspace.updated_at = new Date().toISOString();
  }

  private async performDestruction(
    workspace: WorkspaceState,
    removeVolumes: boolean
  ): Promise<void> {
    // Simulate container destruction
    // In production, this would call Docker/Podman/Kubernetes API
    await new Promise(resolve => setTimeout(resolve, 50));

    workspace.container_id = undefined;
    if (removeVolumes) {
      // Remove associated volumes
    }
  }
}

/**
 * Default workspace configurations by risk level
 */
export const DEFAULT_WORKSPACE_CONFIGS: Record<RiskLevel, Partial<WorkspaceConfig>> = {
  low: {
    kind: 'container',
    reusable: true,
    isolation: {
      network_mode: 'bridge',
    },
  },
  medium: {
    kind: 'container',
    reusable: false,
    isolation: {
      network_mode: 'bridge',
      no_new_privileges: true,
      cap_drop: ['SYS_ADMIN', 'NET_ADMIN'],
    },
  },
  high: {
    kind: 'container',
    reusable: false,
    isolation: {
      user_namespace: true,
      network_mode: 'none',
      no_new_privileges: true,
      read_only_root: true,
      cap_drop: ['SYS_ADMIN', 'NET_ADMIN', 'SYS_PTRACE', 'MKNOD'],
      security_opts: ['no-new-privileges', 'seccomp=default'],
    },
    resource_limits: {
      cpu_limit: 2,
      memory_limit: 4 * 1024 * 1024 * 1024, // 4GB
      execution_timeout_ms: 3600000, // 1 hour
    },
  },
};