export {
  TaskStateIntegration,
  getTaskStateIntegration,
  initTaskStateIntegration,
  createAgentTaskFromCPTask,
} from './taskstate-integration.js';

// Re-export state mapping function for external use
export { toAgentTaskState } from '../state-machine/state-mapping.js';