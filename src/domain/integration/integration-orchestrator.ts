import type {
  Task,
  IntegrateResponse,
  CompleteIntegrateRequest,
  StateTransitionEvent,
} from '../../types.js';
import { nowIso, createId } from '../../store/utils.js';
import type { RepoPolicyService } from '../repo-policy/index.js';
import type { RiskIntegrationService } from '../risk/index.js';
import type { ManualChecklistService } from '../checklist/index.js';
import { DEFAULT_REPO_POLICY } from '../../store/utils.js';

/**
 * Context for integration operations
 */
export interface IntegrationContext {
  transitionTask(
    task: Task,
    toState: Task['state'],
    input: { actor_type: StateTransitionEvent['actor_type']; actor_id: string; reason: string },
  ): void;
}

/**
 * Dependencies for IntegrationOrchestrator
 */
export interface IntegrationDeps {
  repoPolicyService: RepoPolicyService;
  riskIntegrationService: RiskIntegrationService;
  checklistService: ManualChecklistService;
}

/**
 * Orchestrates integration workflow for tasks.
 * Extracted from ControlPlaneStore to reduce complexity.
 */
export class IntegrationOrchestrator {
  constructor(private readonly deps: IntegrationDeps) {}

  /**
   * Start integration for a task.
   * Returns updated task with integration metadata.
   */
  startIntegration(task: Task, baseSha: string, ctx: IntegrationContext): Task {
    // Get repo policy (from task or use default)
    const policy = task.repo_policy ?? DEFAULT_REPO_POLICY;

    // Validate integration policy
    const policyResult = this.deps.repoPolicyService.validateIntegrationPolicy({
      policy,
      task_id: task.task_id,
      base_sha: baseSha,
      checks_passed: false, // Will be checked in completeIntegrate
    });

    // Store policy result for later use
    task.repo_policy = policy;
    task.repo_ref.base_sha = baseSha;

    const integrationBranch = this.deps.repoPolicyService.getDefaultIntegrationBranch(policy, task.task_id);
    task.integration = {
      integration_branch: integrationBranch,
      integration_head_sha: baseSha,
      checks_passed: false,
    };

    // Generate manual checklist based on risk level
    const riskAssessment = this.deps.riskIntegrationService.assessFromFactors([], task.risk_level);
    task.manual_checklist = this.deps.checklistService.generateChecklist(task, riskAssessment);

    // Create integration run metadata for progress monitoring
    const now = nowIso();
    const integrationTimeoutMs = 10 * 60 * 1000; // 10 minutes default timeout
    task.integration_run = {
      run_id: createId('int-run'),
      started_at: now,
      status: 'running',
      progress: 0,
      timeout_at: new Date(Date.now() + integrationTimeoutMs).toISOString(),
    };

    ctx.transitionTask(task, 'integrating', {
      actor_type: 'control_plane',
      actor_id: 'shipyard-cp',
      reason: policyResult.requires_pr
        ? 'integrate requested (PR required)'
        : 'integrate requested',
    });
    return task;
  }

  /**
   * Complete integration for a task.
   * Returns integration response with policy results.
   */
  completeIntegration(task: Task, request: CompleteIntegrateRequest, ctx: IntegrationContext): IntegrateResponse {
    // Get repo policy
    const policy = task.repo_policy ?? DEFAULT_REPO_POLICY;

    // Validate integration policy with actual check results
    const policyResult = this.deps.repoPolicyService.validateIntegrationPolicy({
      policy,
      task_id: task.task_id,
      base_sha: task.repo_ref.base_sha ?? '',
      integration_head_sha: request.integration_head_sha,
      main_sha: request.main_updated_sha,
      checks_passed: request.checks_passed,
    });

    // If policy denies integration, block the task
    if (!policyResult.allowed) {
      ctx.transitionTask(task, 'blocked', {
        actor_type: 'control_plane',
        actor_id: 'shipyard-cp',
        reason: policyResult.reason ?? 'integration policy denied',
      });
      task.blocked_context = {
        resume_state: 'integrating',
        reason: policyResult.reason ?? 'integration policy denied',
        waiting_on: 'github',
      };
      return {
        task_id: task.task_id,
        state: task.state,
        integration_branch: task.integration!.integration_branch ?? '',
        integration_head_sha: request.integration_head_sha,
        requires_pr: policyResult.requires_pr,
        can_fast_forward: policyResult.can_fast_forward,
        policy_warnings: policyResult.reason ? [policyResult.reason] : undefined,
      };
    }

    task.integration!.checks_passed = request.checks_passed;
    if (request.integration_head_sha) {
      task.integration!.integration_head_sha = request.integration_head_sha;
    }
    if (request.main_updated_sha) {
      task.integration!.main_updated_sha = request.main_updated_sha;
    }

    // Update integration run metadata
    if (task.integration_run) {
      const now = nowIso();
      task.integration_run.completed_at = now;
      task.integration_run.progress = 100;
    }

    if (request.checks_passed) {
      ctx.transitionTask(task, 'integrated', {
        actor_type: 'control_plane',
        actor_id: 'shipyard-cp',
        reason: 'integration checks passed',
      });
      // Mark run as succeeded
      if (task.integration_run) {
        task.integration_run.status = 'succeeded';
      }
    } else {
      ctx.transitionTask(task, 'blocked', {
        actor_type: 'control_plane',
        actor_id: 'shipyard-cp',
        reason: 'integration checks failed',
      });
      task.blocked_context = {
        resume_state: 'integrating',
        reason: 'CI checks failed',
        waiting_on: 'github',
      };
      // Mark run as failed
      if (task.integration_run) {
        task.integration_run.status = 'failed';
        task.integration_run.error = 'CI checks failed';
      }
    }

    return {
      task_id: task.task_id,
      state: task.state,
      integration_branch: task.integration?.integration_branch ?? '',
      integration_head_sha: task.integration?.integration_head_sha,
      requires_pr: policyResult.requires_pr,
      can_fast_forward: policyResult.can_fast_forward,
    };
  }

  /**
   * Update integration run progress.
   */
  updateProgress(task: Task, progress: number): void {
    if (task.integration_run) {
      task.integration_run.progress = Math.min(100, Math.max(0, progress));
    }
  }
}