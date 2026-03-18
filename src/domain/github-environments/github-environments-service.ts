import type { RiskLevel } from '../../types.js';

/**
 * GitHub Environments API configuration
 */
export interface GitHubEnvironmentsConfig {
  /** GitHub API base URL */
  baseUrl?: string;
  /** GitHub token (PAT or GitHub App) */
  token: string;
  /** Token type */
  tokenType?: 'pat' | 'github_app';
}

/**
 * GitHub Environment
 */
export interface GitHubEnvironment {
  name: string;
  id: number;
  node_id: string;
  url: string;
  html_url: string;
  created_at: string;
  updated_at: string;
  can_admins_bypass?: boolean;
  protection_rules?: EnvironmentProtectionRule[];
  deployment_branch_policy?: DeploymentBranchPolicy | null;
}

/**
 * Environment protection rule
 */
export interface EnvironmentProtectionRule {
  id: number;
  node_id: string;
  type: 'required_reviewers' | 'branch_policy' | 'required_secrets';
  enabled: boolean;
  reviewers?: Array<{
    type: 'User' | 'Team';
    reviewer: { id: number; login: string } | { id: number; name: string; slug: string };
  }>;
}

/**
 * Deployment branch policy
 */
export interface DeploymentBranchPolicy {
  protected_branches: boolean;
  custom_branch_policies: boolean;
}

/**
 * Create environment request
 */
export interface CreateEnvironmentRequest {
  name: string;
  wait_timer?: number;
  reviewers?: Array<{
    type: 'User' | 'Team';
    id: number;
  }>;
  deployment_branch_policy?: {
    protected_branches?: boolean;
    custom_branch_policies?: boolean;
  };
  can_admins_bypass?: boolean;
}

/**
 * Update environment request
 */
export interface UpdateEnvironmentRequest {
  wait_timer?: number;
  reviewers?: Array<{
    type: 'User' | 'Team';
    id: number;
  }>;
  deployment_branch_policy?: {
    protected_branches?: boolean;
    custom_branch_policies?: boolean;
  } | null;
  can_admins_bypass?: boolean;
}

/**
 * Environment secret
 */
export interface EnvironmentSecret {
  name: string;
  created_at: string;
  updated_at: string;
}

/**
 * Create secret request
 */
export interface CreateSecretRequest {
  name: string;
  encrypted_value: string;
  key_id: string;
}

/**
 * Deployment status
 */
export interface DeploymentStatus {
  id: number;
  state: 'pending' | 'queued' | 'in_progress' | 'success' | 'failure' | 'inactive' | 'error' | 'waiting';
  environment: string;
  deployment_id: number;
  created_at: string;
  updated_at: string;
  log_url?: string;
  description?: string;
}

/**
 * Approval request for deployment
 */
export interface DeploymentApprovalRequest {
  environment: string;
  task_id: string;
  risk_level: RiskLevel;
  requested_by: string;
  callback_url: string;
  metadata?: Record<string, string | number | boolean>;
}

/**
 * Approval result
 */
export interface DeploymentApprovalResult {
  approved: boolean;
  environment: string;
  approved_by?: string;
  approved_at?: string;
  rejected_reason?: string;
  expires_at?: string;
}

/**
 * Environment protection check result
 */
export interface ProtectionCheckResult {
  environment: string;
  can_deploy: boolean;
  protection_rules: Array<{
    type: string;
    satisfied: boolean;
    reason?: string;
  }>;
  required_reviewers?: string[];
  branch_policy_satisfied?: boolean;
}

/**
 * GitHub Environments Service
 *
 * Manages GitHub Environments for deployment protection and secrets
 */
export class GitHubEnvironmentsService {
  private baseUrl: string;
  private headers: Record<string, string>;

  constructor(config: GitHubEnvironmentsConfig) {
    this.baseUrl = config.baseUrl || 'https://api.github.com';
    this.headers = {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${config.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  /**
   * List environments for a repository
   */
  async listEnvironments(
    owner: string,
    repo: string
  ): Promise<{ total_count: number; environments: GitHubEnvironment[] }> {
    const response = await fetch(
      `${this.baseUrl}/repos/${owner}/${repo}/environments`,
      {
        method: 'GET',
        headers: this.headers,
      }
    );

    if (response.status === 404) {
      return { total_count: 0, environments: [] };
    }

    if (!response.ok) {
      throw new Error(`Failed to list environments: ${response.status}`);
    }

    return response.json() as Promise<{ total_count: number; environments: GitHubEnvironment[] }>;
  }

  /**
   * Get a specific environment
   */
  async getEnvironment(
    owner: string,
    repo: string,
    environmentName: string
  ): Promise<GitHubEnvironment | null> {
    const response = await fetch(
      `${this.baseUrl}/repos/${owner}/${repo}/environments/${encodeURIComponent(environmentName)}`,
      {
        method: 'GET',
        headers: this.headers,
      }
    );

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new Error(`Failed to get environment: ${response.status}`);
    }

    return response.json() as Promise<GitHubEnvironment>;
  }

  /**
   * Create or update an environment
   */
  async createOrUpdateEnvironment(
    owner: string,
    repo: string,
    environmentName: string,
    request: CreateEnvironmentRequest | UpdateEnvironmentRequest
  ): Promise<GitHubEnvironment> {
    const response = await fetch(
      `${this.baseUrl}/repos/${owner}/${repo}/environments/${encodeURIComponent(environmentName)}`,
      {
        method: 'PUT',
        headers: {
          ...this.headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      }
    );

    if (!response.ok) {
      const error = await response.json() as { message?: string };
      throw new Error(`Failed to create/update environment: ${error.message || response.status}`);
    }

    return response.json() as Promise<GitHubEnvironment>;
  }

  /**
   * Delete an environment
   */
  async deleteEnvironment(
    owner: string,
    repo: string,
    environmentName: string
  ): Promise<void> {
    const response = await fetch(
      `${this.baseUrl}/repos/${owner}/${repo}/environments/${encodeURIComponent(environmentName)}`,
      {
        method: 'DELETE',
        headers: this.headers,
      }
    );

    if (!response.ok && response.status !== 404) {
      throw new Error(`Failed to delete environment: ${response.status}`);
    }
  }

  /**
   * Check protection rules for deployment
   */
  async checkProtectionRules(
    owner: string,
    repo: string,
    environmentName: string,
    branch: string
  ): Promise<ProtectionCheckResult> {
    const environment = await this.getEnvironment(owner, repo, environmentName);

    if (!environment) {
      return {
        environment: environmentName,
        can_deploy: false,
        protection_rules: [
          { type: 'environment_not_found', satisfied: false, reason: 'Environment does not exist' },
        ],
      };
    }

    const rules: ProtectionCheckResult['protection_rules'] = [];
    let canDeploy = true;

    // Check branch policy
    if (environment.deployment_branch_policy) {
      const branchPolicy = environment.deployment_branch_policy;
      let branchSatisfied = false;

      if (branchPolicy.protected_branches) {
        // Check if branch is protected
        const isProtected = await this.isBranchProtected(owner, repo, branch);
        branchSatisfied = isProtected;
      }

      if (branchPolicy.custom_branch_policies) {
        // Assume custom policy allows if branch matches pattern
        branchSatisfied = true; // Simplified - would need to check actual patterns
      }

      rules.push({
        type: 'branch_policy',
        satisfied: branchSatisfied,
        reason: branchSatisfied ? undefined : `Branch ${branch} does not satisfy policy`,
      });

      if (!branchSatisfied) {
        canDeploy = false;
      }
    }

    // Check required reviewers
    if (environment.protection_rules) {
      const reviewerRule = environment.protection_rules.find(
        (r) => r.type === 'required_reviewers' && r.enabled
      );

      if (reviewerRule) {
        rules.push({
          type: 'required_reviewers',
          satisfied: false,
          reason: 'Deployment requires approval',
        });
        canDeploy = false;
      }
    }

    return {
      environment: environmentName,
      can_deploy: canDeploy,
      protection_rules: rules,
      required_reviewers: environment.protection_rules
        ?.filter((r) => r.type === 'required_reviewers' && r.reviewers)
        .flatMap((r) => r.reviewers?.map((rv) =>
          rv.type === 'User' ? (rv.reviewer as { login: string }).login : (rv.reviewer as { slug: string }).slug
        ) || []),
      branch_policy_satisfied: rules.find((r) => r.type === 'branch_policy')?.satisfied,
    };
  }

  /**
   * Request deployment approval
   */
  async requestDeploymentApproval(
    owner: string,
    repo: string,
    request: DeploymentApprovalRequest
  ): Promise<{ review_id: string; status: 'pending' | 'approved' | 'rejected' }> {
    const environment = await this.getEnvironment(owner, repo, request.environment);

    if (!environment) {
      throw new Error(`Environment ${request.environment} not found`);
    }

    // Check if approval is needed
    const reviewerRule = environment.protection_rules?.find(
      (r) => r.type === 'required_reviewers' && r.enabled
    );

    if (!reviewerRule) {
      // No approval required
      return {
        review_id: `auto-${Date.now()}`,
        status: 'approved',
      };
    }

    // For now, return pending - in production, this would:
    // 1. Create a deployment
    // 2. Set status to 'waiting'
    // 3. Notify reviewers via GitHub
    // 4. Wait for approval via webhook

    return {
      review_id: `review-${request.task_id}-${Date.now()}`,
      status: 'pending',
    };
  }

  /**
   * Check if branch is protected
   */
  private async isBranchProtected(
    owner: string,
    repo: string,
    branch: string
  ): Promise<boolean> {
    try {
      const response = await fetch(
        `${this.baseUrl}/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}/protection`,
        {
          method: 'GET',
          headers: this.headers,
        }
      );

      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Get repository public key for secret encryption
   */
  async getRepoPublicKey(
    owner: string,
    repo: string
  ): Promise<{ key: string; key_id: string }> {
    const response = await fetch(
      `${this.baseUrl}/repos/${owner}/${repo}/actions/secrets/public-key`,
      {
        method: 'GET',
        headers: this.headers,
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to get public key: ${response.status}`);
    }

    return response.json() as Promise<{ key: string; key_id: string }>;
  }

  /**
   * Create or update environment secret
   */
  async setEnvironmentSecret(
    owner: string,
    repo: string,
    environmentName: string,
    request: CreateSecretRequest
  ): Promise<void> {
    const response = await fetch(
      `${this.baseUrl}/repos/${owner}/${repo}/environments/${encodeURIComponent(environmentName)}/secrets/${request.name}`,
      {
        method: 'PUT',
        headers: {
          ...this.headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          encrypted_value: request.encrypted_value,
          key_id: request.key_id,
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to set environment secret: ${response.status}`);
    }
  }

  /**
   * List environment secrets
   */
  async listEnvironmentSecrets(
    owner: string,
    repo: string,
    environmentName: string
  ): Promise<{ total_count: number; secrets: EnvironmentSecret[] }> {
    const response = await fetch(
      `${this.baseUrl}/repos/${owner}/${repo}/environments/${encodeURIComponent(environmentName)}/secrets`,
      {
        method: 'GET',
        headers: this.headers,
      }
    );

    if (response.status === 404) {
      return { total_count: 0, secrets: [] };
    }

    if (!response.ok) {
      throw new Error(`Failed to list environment secrets: ${response.status}`);
    }

    return response.json() as Promise<{ total_count: number; secrets: EnvironmentSecret[] }>;
  }

  /**
   * Delete environment secret
   */
  async deleteEnvironmentSecret(
    owner: string,
    repo: string,
    environmentName: string,
    secretName: string
  ): Promise<void> {
    const response = await fetch(
      `${this.baseUrl}/repos/${owner}/${repo}/environments/${encodeURIComponent(environmentName)}/secrets/${secretName}`,
      {
        method: 'DELETE',
        headers: this.headers,
      }
    );

    if (!response.ok && response.status !== 404) {
      throw new Error(`Failed to delete environment secret: ${response.status}`);
    }
  }

  /**
   * Determine required environment based on risk level
   */
  static getEnvironmentForRiskLevel(riskLevel: RiskLevel): string {
    switch (riskLevel) {
      case 'high':
        return 'production';
      case 'medium':
        return 'staging';
      case 'low':
        return 'development';
    }
  }

  /**
   * Get approval requirements for environment
   */
  async getApprovalRequirements(
    owner: string,
    repo: string,
    environmentName: string
  ): Promise<{
    requires_approval: boolean;
    required_reviewers: Array<{ type: 'User' | 'Team'; id: number; login?: string }>;
    wait_timer_minutes: number;
  }> {
    const environment = await this.getEnvironment(owner, repo, environmentName);

    if (!environment) {
      return {
        requires_approval: false,
        required_reviewers: [],
        wait_timer_minutes: 0,
      };
    }

    const reviewerRule = environment.protection_rules?.find(
      (r) => r.type === 'required_reviewers' && r.enabled
    );

    const requiredReviewers: Array<{ type: 'User' | 'Team'; id: number; login?: string }> = [];

    if (reviewerRule?.reviewers) {
      for (const reviewer of reviewerRule.reviewers) {
        if (reviewer.type === 'User') {
          const user = reviewer.reviewer as { id: number; login: string };
          requiredReviewers.push({ type: 'User', id: user.id, login: user.login });
        } else {
          const team = reviewer.reviewer as { id: number; slug: string };
          requiredReviewers.push({ type: 'Team', id: team.id, login: team.slug });
        }
      }
    }

    // Get wait timer from environment
    const waitTimer = 0;
    // Note: wait_timer is not directly in protection_rules, it's a separate field
    // For now, default to 0

    return {
      requires_approval: requiredReviewers.length > 0,
      required_reviewers: requiredReviewers,
      wait_timer_minutes: waitTimer,
    };
  }
}