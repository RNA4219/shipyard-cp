import type {
  Task,
  PublishRequest,
  CompletePublishRequest,
  StateTransitionEvent,
} from '../../types.js';
import { nowIso, createId, generateApprovalToken, APPROVAL_TOKEN_TTL_MS, DEFAULT_REPO_POLICY, mergeExternalRefs } from '../../store/utils.js';
import type { RepoPolicyService } from '../repo-policy/index.js';

/**
 * Context for publish operations
 */
export interface PublishContext {
  transitionTask(
    task: Task,
    toState: Task['state'],
    input: { actor_type: StateTransitionEvent['actor_type']; actor_id: string; reason: string },
  ): { event: StateTransitionEvent; task: Task };
}

/**
 * Dependencies for PublishOrchestrator
 */
export interface PublishDeps {
  repoPolicyService: RepoPolicyService;
}

/**
 * Orchestrates publish workflow for tasks.
 * Extracted from ControlPlaneStore to reduce complexity.
 */
export class PublishOrchestrator {
  constructor(private readonly deps: PublishDeps) {}

  /**
   * Start publish for a task.
   * Returns updated task with publish metadata.
   */
  startPublish(task: Task, request: PublishRequest, ctx: PublishContext): Task {
    // Get repo policy
    const policy = task.repo_policy ?? DEFAULT_REPO_POLICY;

    // Only apply policy restrictions for 'apply' mode
    // dry_run and no_op modes are always allowed
    if (request.mode === 'apply') {
      // Determine if we can fast-forward
      const canFastForward = task.integration?.main_updated_sha === undefined ||
        task.integration.main_updated_sha === task.repo_ref.base_sha;

      // Validate publish policy
      const policyResult = this.deps.repoPolicyService.validatePublishPolicy({
        policy,
        actor: 'bot', // Control Plane acts as bot
        target_branch: task.repo_ref.default_branch ?? 'main',
        checks_passed: task.integration?.checks_passed ?? false,
        is_fast_forward: canFastForward,
      });

      // If policy denies publish, block the task
      if (!policyResult.allowed) {
        const blockedTask: Task = {
          ...task,
          blocked_context: {
            resume_state: 'integrated',
            reason: policyResult.reason ?? 'publish policy denied',
            waiting_on: 'environment',
          },
        };
        const result = ctx.transitionTask(blockedTask, 'blocked', {
          actor_type: 'control_plane',
          actor_id: 'shipyard-cp',
          reason: policyResult.reason ?? 'publish policy denied',
        });
        return result.task;
      }

      // Store policy warnings if any
      if (policyResult.warnings && policyResult.warnings.length > 0) {
        task = {
          ...task,
          publish_plan: {
            ...(task.publish_plan ?? {}),
            policy_warnings: policyResult.warnings,
          },
        };
      }
    }

    task = {
      ...task,
      publish_plan: {
        ...(task.publish_plan ?? {}),
        mode: request.mode,
        idempotency_key: request.idempotency_key,
      },
    };

    const needsApproval = request.mode === 'apply' && task.publish_plan?.approval_required && !request.approval_token;

    if (needsApproval) {
      // Generate secure approval token with expiration
      task = {
        ...task,
        pending_approval_token: generateApprovalToken(),
        pending_approval_expires_at: new Date(Date.now() + APPROVAL_TOKEN_TTL_MS).toISOString(),
      };
    } else {
      // Create publish run metadata for progress monitoring (only when actually starting)
      const now = nowIso();
      const publishTimeoutMs = 15 * 60 * 1000; // 15 minutes default timeout
      task = {
        ...task,
        publish_run: {
          run_id: createId('pub-run'),
          started_at: now,
          status: 'running',
          progress: 0,
          timeout_at: new Date(Date.now() + publishTimeoutMs).toISOString(),
        },
      };
    }

    const result = ctx.transitionTask(task, needsApproval ? 'publish_pending_approval' : 'publishing', {
      actor_type: 'control_plane',
      actor_id: 'shipyard-cp',
      reason: needsApproval ? 'publish approval required' : 'publish started',
    });
    return result.task;
  }

  /**
   * Approve a pending publish.
   * Returns updated task with publish run started.
   */
  approvePublish(task: Task, approvalToken: string, ctx: PublishContext): Task {
    // Validate approval token
    const validationError = this.validateApprovalToken(task, approvalToken);
    if (validationError) {
      throw new Error(validationError);
    }

    // Create publish run metadata for progress monitoring
    const now = nowIso();
    const publishTimeoutMs = 15 * 60 * 1000; // 15 minutes default timeout
    const updatedTask: Task = {
      ...task,
      pending_approval_token: undefined,
      pending_approval_expires_at: undefined,
      publish_run: {
        run_id: createId('pub-run'),
        started_at: now,
        status: 'running',
        progress: 0,
        timeout_at: new Date(Date.now() + publishTimeoutMs).toISOString(),
      },
    };

    const result = ctx.transitionTask(updatedTask, 'publishing', {
      actor_type: 'human',
      actor_id: 'operator',
      reason: 'publish approved',
    });

    return result.task;
  }

  /**
   * Complete a publish.
   * Returns updated task.
   */
  completePublish(task: Task, request: CompletePublishRequest, ctx: PublishContext): Task {
    const now = nowIso();
    let updatedTask: Task = { ...task };

    // Update external_refs from result
    if (request.external_refs) {
      updatedTask = {
        ...updatedTask,
        external_refs: mergeExternalRefs(updatedTask.external_refs, request.external_refs),
      };
    }

    // Store rollback_notes for high-risk tasks
    if (request.rollback_notes) {
      updatedTask = {
        ...updatedTask,
        rollback_notes: request.rollback_notes,
      };
    }

    // Update publish run metadata
    if (updatedTask.publish_run) {
      updatedTask = {
        ...updatedTask,
        publish_run: {
          ...updatedTask.publish_run,
          completed_at: now,
          status: 'succeeded',
          progress: 100,
          external_refs: request.external_refs ? mergeExternalRefs(updatedTask.publish_run.external_refs, request.external_refs) : updatedTask.publish_run.external_refs,
        },
      };
    }

    const result = ctx.transitionTask(updatedTask, 'published', {
      actor_type: 'control_plane',
      actor_id: 'shipyard-cp',
      reason: 'publish completed',
    });

    // Add completed_at to the transitioned task
    return { ...result.task, completed_at: now };
  }

  /**
   * Validate approval token with expiration check.
   * Returns error message if invalid, undefined if valid.
   */
  private validateApprovalToken(task: Task, providedToken: string): string | undefined {
    // Check if token was provided
    if (!providedToken) {
      return 'approval_token is required';
    }

    // Check if task has a pending approval token
    if (!task.pending_approval_token) {
      return 'no approval token expected for this task';
    }

    // Check expiration
    if (task.pending_approval_expires_at) {
      const expiresAt = new Date(task.pending_approval_expires_at);
      if (expiresAt < new Date()) {
        return 'approval token has expired';
      }
    }

    // Constant-time comparison to prevent timing attacks
    const expected = task.pending_approval_token;
    if (expected.length !== providedToken.length) {
      return 'invalid approval token';
    }

    let result = 0;
    for (let i = 0; i < expected.length; i++) {
      result |= expected.charCodeAt(i) ^ providedToken.charCodeAt(i);
    }

    if (result !== 0) {
      return 'invalid approval token';
    }

    return undefined;
  }

  /**
   * Update publish run progress.
   */
  updateProgress(task: Task, progress: number): void {
    if (task.publish_run) {
      task.publish_run.progress = Math.min(100, Math.max(0, progress));
    }
  }
}