// Types
export type {
  TaskState,
  ActorType,
  Task,
  StateTransition,
  Decision,
  OpenQuestion,
  Run,
  BundlePurpose,
  RebuildLevel,
  SourceKind,
  BundleSource,
  ContextBundle,
  CreateTaskRequest,
  TransitionRequest,
  CreateBundleRequest,
  AddSourceRequest,
} from './types.js';

// Store backends
export type { TaskStateBackend, TaskFilter } from './store/store-backend.js';
export { InMemoryBackend } from './store/memory-backend.js';
export { RedisBackend, type RedisBackendConfig } from './store/redis-backend.js';
export { SQLiteBackend, type SQLiteBackendConfig } from './store/sqlite-backend.js';

// Core services
export {
  isValidTransition,
  getValidTargetStates,
  StateTransitionService,
} from './core/state-transition.js';
export { ContextBundleService } from './core/context-bundle.js';
export { TaskService } from './core/task-service.js';

import type { TaskStateBackend } from './store/store-backend.js';
import { InMemoryBackend } from './store/memory-backend.js';
import { RedisBackend, type RedisBackendConfig } from './store/redis-backend.js';
import { SQLiteBackend, type SQLiteBackendConfig } from './store/sqlite-backend.js';
import { TaskService } from './core/task-service.js';
import { StateTransitionService } from './core/state-transition.js';
import { ContextBundleService } from './core/context-bundle.js';

/**
 * Configuration for AgentTaskState
 */
export interface AgentTaskStateConfig {
  backend?: TaskStateBackend;
  redis?: RedisBackendConfig;
  sqlite?: SQLiteBackendConfig;
  generatorVersion?: string;
}

/**
 * Main class for agent-taskstate
 */
export class AgentTaskState {
  private backend: TaskStateBackend;
  private taskService: TaskService;
  private transitionService: StateTransitionService;
  private bundleService: ContextBundleService;

  constructor(config: AgentTaskStateConfig = {}) {
    // Initialize backend
    if (config.backend) {
      this.backend = config.backend;
    } else if (config.redis) {
      this.backend = new RedisBackend(config.redis);
    } else if (config.sqlite) {
      this.backend = new SQLiteBackend(config.sqlite);
    } else {
      this.backend = new InMemoryBackend();
    }

    // Initialize services
    this.taskService = new TaskService(this.backend);
    this.transitionService = new StateTransitionService(this.backend);
    this.bundleService = new ContextBundleService(this.backend, config.generatorVersion);
  }

  // Expose services as properties
  get tasks(): TaskService {
    return this.taskService;
  }

  get transitions(): StateTransitionService {
    return this.transitionService;
  }

  get bundles(): ContextBundleService {
    return this.bundleService;
  }

  // Direct backend access for advanced use cases
  get store(): TaskStateBackend {
    return this.backend;
  }

  /**
   * Close connections and cleanup
   */
  async close(): Promise<void> {
    await this.backend.close();
  }
}

/**
 * Create a new AgentTaskState instance
 */
export function createAgentTaskState(config?: AgentTaskStateConfig): AgentTaskState {
  return new AgentTaskState(config);
}