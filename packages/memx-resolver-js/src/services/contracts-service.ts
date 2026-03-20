/**
 * Contracts service for contract resolution
 */

import type { StoreBackend } from '../store/store-backend.js';
import type {
  Contract,
  ResolveContractsRequest,
  ResolveContractsResponse,
} from '../types.js';

/**
 * Contracts service configuration
 */
export interface ContractsServiceConfig {
  backend: StoreBackend;
}

/**
 * Contracts service for acceptance criteria
 */
export class ContractsService {
  private backend: StoreBackend;

  constructor(config: ContractsServiceConfig) {
    this.backend = config.backend;
  }

  /**
   * Resolve contracts for feature/task
   */
  async resolve(request: ResolveContractsRequest): Promise<ResolveContractsResponse> {
    // For MVP, return default contract based on feature
    if (request.feature) {
      return this.getDefaultContract(request.feature);
    }

    return {
      feature: request.feature,
      required_docs: [],
      acceptance_criteria: [],
      forbidden_patterns: [],
      definition_of_done: [],
    };
  }

  /**
   * Get default contract for a feature
   */
  private async getDefaultContract(feature: string): Promise<ResolveContractsResponse> {
    // Try to find stored contracts
    const contracts = await this.backend.findContractsByFeature(feature);

    if (contracts.length > 0) {
      // Merge all contracts
      const acceptance_criteria: string[] = [];
      const forbidden_patterns: string[] = [];
      const definition_of_done: string[] = [];
      const required_docs: string[] = [];

      for (const contract of contracts) {
        if (contract.acceptance_criteria) {
          acceptance_criteria.push(...contract.acceptance_criteria);
        }
        if (contract.forbidden_patterns) {
          forbidden_patterns.push(...contract.forbidden_patterns);
        }
        if (contract.definition_of_done) {
          definition_of_done.push(...contract.definition_of_done);
        }
        if (contract.dependencies) {
          required_docs.push(...contract.dependencies);
        }
      }

      return {
        feature,
        required_docs: [...new Set(required_docs)],
        acceptance_criteria: [...new Set(acceptance_criteria)],
        forbidden_patterns: [...new Set(forbidden_patterns)],
        definition_of_done: [...new Set(definition_of_done)],
      };
    }

    // Return default template
    return {
      feature,
      required_docs: [`doc:spec:${feature}`],
      acceptance_criteria: [
        `${feature} functionality works as expected`,
        `Tests pass for ${feature}`,
        `Documentation is updated for ${feature}`,
      ],
      forbidden_patterns: [
        'No hardcoded credentials',
        'No synchronous operations in hot paths',
      ],
      definition_of_done: [
        `Feature ${feature} is implemented`,
        'Code review is approved',
        'Tests are passing',
        'Documentation is updated',
      ],
    };
  }

  /**
   * Store a contract
   */
  async setContract(contract: Contract): Promise<void> {
    await this.backend.setContract(contract);
  }

  /**
   * Get a contract by ID
   */
  async getContract(contractId: string): Promise<Contract | null> {
    return this.backend.getContract(contractId);
  }
}