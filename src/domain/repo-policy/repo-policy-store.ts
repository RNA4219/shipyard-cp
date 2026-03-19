import type { RepoPolicy, RepoRef } from '../../types.js';

/**
 * Store for repository-specific policies.
 * Manages RepoPolicy per repository (owner/name).
 */
export class RepoPolicyStore {
  private readonly policies = new Map<string, RepoPolicy>();

  /**
   * Get the key for a repository.
   */
  private getKey(owner: string, name: string): string {
    return `${owner}/${name}`;
  }

  /**
   * Get policy for a repository.
   * Returns default policy if not set.
   */
  getPolicy(repoRef: RepoRef): RepoPolicy {
    const key = this.getKey(repoRef.owner, repoRef.name);
    const policy = this.policies.get(key);
    if (policy) {
      return policy;
    }
    // Return default policy
    return this.getDefaultPolicy();
  }

  /**
   * Get policy by owner/name.
   */
  getPolicyByName(owner: string, name: string): RepoPolicy | undefined {
    const key = this.getKey(owner, name);
    return this.policies.get(key);
  }

  /**
   * Set policy for a repository.
   */
  setPolicy(owner: string, name: string, policy: RepoPolicy): void {
    const key = this.getKey(owner, name);
    this.policies.set(key, policy);
  }

  /**
   * Update policy for a repository (partial update).
   */
  updatePolicy(owner: string, name: string, updates: Partial<RepoPolicy>): RepoPolicy {
    const existing = this.getPolicyByName(owner, name) ?? this.getDefaultPolicy();
    const updated: RepoPolicy = {
      ...existing,
      ...updates,
    };
    this.setPolicy(owner, name, updated);
    return updated;
  }

  /**
   * Delete policy for a repository.
   */
  deletePolicy(owner: string, name: string): boolean {
    const key = this.getKey(owner, name);
    return this.policies.delete(key);
  }

  /**
   * List all policies.
   */
  listPolicies(): Array<{ owner: string; name: string; policy: RepoPolicy }> {
    const result: Array<{ owner: string; name: string; policy: RepoPolicy }> = [];
    this.policies.forEach((policy, key) => {
      const [owner, name] = key.split('/');
      result.push({ owner, name, policy });
    });
    return result;
  }

  /**
   * Get the default policy.
   */
  getDefaultPolicy(): RepoPolicy {
    return {
      update_strategy: 'pull_request',
      main_push_actor: 'bot',
      require_ci_pass: true,
      protected_branches: ['main', 'master'],
      allowed_merge_methods: ['merge', 'squash', 'rebase'],
    };
  }
}