/**
 * Shipyard Control Plane Configuration Loader
 *
 * Loads operational limits from config.json and provides typed access.
 * Falls back to defaults if file is not present or invalid.
 */

import { readFileSync, existsSync, copyFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { getLogger } from '../monitoring/index.js';
import {
  LEASE_DURATION_MS,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_GRACE_MULTIPLIER,
  MAX_CONCURRENT_AGENTS,
  MAX_SPAWNS_PER_WINDOW,
  SPAWN_RATE_WINDOW_SECONDS,
} from '../constants/index.js';

const logger = getLogger().child({ component: 'Config' });

// =============================================================================
// Configuration Types
// =============================================================================

export interface RateLimitTier {
  maxRequestsPerMinute: number;
  maxRequestsTotal: number;
}

export interface ApiRateLimitsConfig {
  public: RateLimitTier;
  standard: RateLimitTier;
  trans: RateLimitTier;
}

export interface StageRetryConfig {
  max_retries: number;
  default_action: string;
}

export interface BackoffConfig {
  base_seconds: number;
  max_seconds: number;
  jitter_enabled: boolean;
  multiplier: number;
}

export interface FailureClassConfig {
  description: string;
  auto_retry: boolean;
}

export interface RetryConfig {
  stages: Record<string, StageRetryConfig>;
  backoff: BackoffConfig;
  failure_classes: Record<string, FailureClassConfig>;
}

export interface DoomLoopConfig {
  enabled: boolean;
  window_size: number;
  warn_threshold: number;
  block_threshold: number;
  fingerprint_components: string[];
}

export interface OrphanRecoveryConfig {
  default_action: 'retry' | 'block' | 'fail';
  publish_action: 'retry' | 'block' | 'fail';
  scan_interval_seconds: number;
}

export interface LeaseConfig {
  duration_seconds: number;
  heartbeat_interval_seconds: number;
  heartbeat_grace_multiplier: number;
  orphan_recovery: OrphanRecoveryConfig;
}

export interface ResourceLockConfig {
  enabled: boolean;
  max_concurrent_per_resource: number;
}

export interface ConcurrencyConfig {
  enabled: boolean;
  lock_duration_seconds: number;
  optimistic_lock_enabled: boolean;
  resource_locks: Record<string, ResourceLockConfig>;
}

export interface SpawnRateLimitConfig {
  window_seconds: number;
  max_spawns_per_window: number;
  burst: number;
  algorithm: 'token_bucket' | 'sliding_window';
}

export interface OverflowPolicyConfig {
  on_concurrent_limit_exceeded: 'queue' | 'reject';
  on_rate_limit_exceeded: 'queue' | 'reject';
  max_queue_wait_seconds: number;
}

export interface AgentSpawnConfig {
  enabled: boolean;
  scope: 'job' | 'worker' | 'global';
  max_concurrent_agents: number;
  spawn_rate_limit: SpawnRateLimitConfig;
  overflow_policy: OverflowPolicyConfig;
  count_descendants: boolean;
  include_root_agent: boolean;
}

export interface CapabilityConfig {
  stage_requirements: Record<string, string[]>;
  conditional_capabilities: Record<string, string>;
}

export interface ShipyardConfig {
  api_rate_limits: ApiRateLimitsConfig;
  retry: RetryConfig;
  doom_loop: DoomLoopConfig;
  lease: LeaseConfig;
  concurrency: ConcurrencyConfig;
  agent_spawn: AgentSpawnConfig;
  capability: CapabilityConfig;
}

// =============================================================================
// Default Configuration
// =============================================================================

const DEFAULT_CONFIG: ShipyardConfig = {
  api_rate_limits: {
    public: { maxRequestsPerMinute: 3, maxRequestsTotal: 30 },
    standard: { maxRequestsPerMinute: 10, maxRequestsTotal: 100 },
    trans: { maxRequestsPerMinute: 150, maxRequestsTotal: 300 },
  },
  retry: {
    stages: {
      plan: { max_retries: 2, default_action: 'blocked' },
      dev: { max_retries: 3, default_action: 'retry_transient_only' },
      acceptance: { max_retries: 1, default_action: 'rework_required' },
      integrate: { max_retries: 2, default_action: 'blocked' },
      publish: { max_retries: 1, default_action: 'blocked' },
    },
    backoff: {
      base_seconds: 1,
      max_seconds: 60,
      jitter_enabled: true,
      multiplier: 2,
    },
    failure_classes: {
      retryable_transient: { description: 'Temporary failures', auto_retry: true },
      retryable_capacity: { description: 'Rate limits, congestion', auto_retry: true },
      non_retryable_policy: { description: 'Permission denied', auto_retry: false },
      non_retryable_logic: { description: 'Invalid input', auto_retry: false },
    },
  },
  doom_loop: {
    enabled: true,
    window_size: 20,
    warn_threshold: 3,
    block_threshold: 4,
    fingerprint_components: ['stage', 'worker_type', 'normalized_prompt_hash', 'repo_ref', 'typed_ref'],
  },
  lease: {
    duration_seconds: LEASE_DURATION_MS / 1000,
    heartbeat_interval_seconds: HEARTBEAT_INTERVAL_MS / 1000,
    heartbeat_grace_multiplier: HEARTBEAT_GRACE_MULTIPLIER,
    orphan_recovery: {
      default_action: 'retry',
      publish_action: 'block',
      scan_interval_seconds: 30,
    },
  },
  concurrency: {
    enabled: true,
    lock_duration_seconds: 300,
    optimistic_lock_enabled: true,
    resource_locks: {
      task: { enabled: true, max_concurrent_per_resource: 1 },
      repo_branch: { enabled: true, max_concurrent_per_resource: 1 },
      environment: { enabled: true, max_concurrent_per_resource: 1 },
      publish_target: { enabled: true, max_concurrent_per_resource: 1 },
    },
  },
  agent_spawn: {
    enabled: true,
    scope: 'global',
    max_concurrent_agents: MAX_CONCURRENT_AGENTS,
    spawn_rate_limit: {
      window_seconds: SPAWN_RATE_WINDOW_SECONDS,
      max_spawns_per_window: MAX_SPAWNS_PER_WINDOW,
      burst: MAX_SPAWNS_PER_WINDOW,
      algorithm: 'token_bucket',
    },
    overflow_policy: {
      on_concurrent_limit_exceeded: 'queue',
      on_rate_limit_exceeded: 'queue',
      max_queue_wait_seconds: 60,
    },
    count_descendants: true,
    include_root_agent: false,
  },
  capability: {
    stage_requirements: {
      plan: ['plan'],
      dev: ['edit_repo', 'run_tests'],
      acceptance: ['produces_verdict'],
    },
    conditional_capabilities: {
      networked: 'Required when job needs network access',
      needs_approval: 'Required when job operates under approval flow',
      produces_patch: 'Required when job produces patch artifacts',
    },
  },
};

// =============================================================================
// Configuration Loader
// =============================================================================

let _config: ShipyardConfig | null = null;

/**
 * Load configuration from config.json in the project root.
 * If config.json does not exist, copies from config.example.json.
 * Falls back to defaults if both files are missing or invalid.
 */
export function loadShipyardConfig(): ShipyardConfig {
  if (_config) {
    return _config;
  }

  // Try to find config.json
  const configPath = join(process.cwd(), 'config.json');
  const examplePath = join(process.cwd(), 'config.example.json');

  // If config.json doesn't exist, try to copy from example
  if (!existsSync(configPath)) {
    if (existsSync(examplePath)) {
      try {
        copyFileSync(examplePath, configPath);
        logger.info('Created config.json from config.example.json');
      } catch (error) {
        logger.warn({ err: error }, 'Failed to copy config.example.json');
      }
    } else {
      // No example either, create from defaults atomically
      // Use exclusive flag 'wx' directly without existsSync check to avoid TOCTOU race
      try {
        writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2), { flag: 'wx' });
        logger.info('Created config.json from defaults');
      } catch (error) {
        // EEXIST error means file was created by another process - expected race outcome
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          logger.info('config.json already exists, another process created it');
        } else {
          logger.warn({ err: error }, 'Failed to create config.json');
        }
      }
    }
  }

  // Now try to load config.json
  if (existsSync(configPath)) {
    try {
      const content = readFileSync(configPath, 'utf-8');
      const parsed = JSON.parse(content);

      // Validate that parsed config is a valid object
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('Configuration file must contain a JSON object');
      }

      // Deep merge with defaults
      _config = deepMerge(DEFAULT_CONFIG, parsed as Partial<ShipyardConfig>);
      logger.info({ configPath }, 'Loaded configuration from config.json');
      return _config;
    } catch (error) {
      logger.warn({ err: error, configPath }, 'Failed to load config.json, using defaults');
    }
  }

  // Fall back to defaults
  logger.info('Using built-in defaults');
  _config = DEFAULT_CONFIG;
  return _config;
}

/**
 * Get the current configuration (loads if not already loaded).
 */
export function getShipyardConfig(): ShipyardConfig {
  if (!_config) {
    return loadShipyardConfig();
  }
  return _config;
}

/**
 * Reset configuration (useful for testing).
 */
export function resetShipyardConfig(): void {
  _config = null;
}

/**
 * Deep merge two objects, with source overriding target.
 */
function deepMerge<T>(target: T, source: Partial<T>): T {
  const result = { ...target } as T;

  for (const key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      const sourceValue = source[key];
      const targetValue = (target as Record<string, unknown>)[key];

      if (
        sourceValue &&
        typeof sourceValue === 'object' &&
        !Array.isArray(sourceValue) &&
        targetValue &&
        typeof targetValue === 'object' &&
        !Array.isArray(targetValue)
      ) {
        (result as Record<string, unknown>)[key] = deepMerge(
          targetValue,
          sourceValue as Record<string, unknown>
        );
      } else {
        (result as Record<string, unknown>)[key] = sourceValue;
      }
    }
  }

  return result;
}

// =============================================================================
// Convenience Accessors
// =============================================================================

export function getApiRateLimitsConfig(): ApiRateLimitsConfig {
  return getShipyardConfig().api_rate_limits;
}

export function getRetryConfig(): RetryConfig {
  return getShipyardConfig().retry;
}

export function getDoomLoopConfig(): DoomLoopConfig {
  return getShipyardConfig().doom_loop;
}

export function getLeaseConfig(): LeaseConfig {
  return getShipyardConfig().lease;
}

export function getConcurrencyConfig(): ConcurrencyConfig {
  return getShipyardConfig().concurrency;
}

export function getAgentSpawnConfig(): AgentSpawnConfig {
  return getShipyardConfig().agent_spawn;
}

export function getCapabilityConfig(): CapabilityConfig {
  return getShipyardConfig().capability;
}