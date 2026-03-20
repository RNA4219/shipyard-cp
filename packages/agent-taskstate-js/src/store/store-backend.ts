import type {
  Task,
  StateTransition,
  Decision,
  OpenQuestion,
  Run,
  ContextBundle,
  BundleSource,
} from '../types.js';

/**
 * Store backend interface for agent-taskstate
 */
export interface TaskStateBackend {
  // Task operations
  getTask(taskId: string): Promise<Task | null>;
  createTask(task: Task): Promise<Task>;
  updateTask(task: Task): Promise<Task>;
  deleteTask(taskId: string): Promise<void>;
  listTasks(filter?: TaskFilter): Promise<Task[]>;

  // State transition operations
  addTransition(transition: StateTransition): Promise<StateTransition>;
  getTransitions(taskId: string): Promise<StateTransition[]>;

  // Decision operations
  createDecision(decision: Decision): Promise<Decision>;
  getDecision(decisionId: string): Promise<Decision | null>;
  getDecisions(taskId: string): Promise<Decision[]>;
  updateDecision(decision: Decision): Promise<Decision>;

  // Open question operations
  createQuestion(question: OpenQuestion): Promise<OpenQuestion>;
  getQuestion(questionId: string): Promise<OpenQuestion | null>;
  getQuestions(taskId: string): Promise<OpenQuestion[]>;
  updateQuestion(question: OpenQuestion): Promise<OpenQuestion>;

  // Run operations
  createRun(run: Run): Promise<Run>;
  getRun(runId: string): Promise<Run | null>;
  getRuns(taskId: string): Promise<Run[]>;
  updateRun(run: Run): Promise<Run>;

  // Context bundle operations
  createBundle(bundle: ContextBundle): Promise<ContextBundle>;
  getBundle(bundleId: string): Promise<ContextBundle | null>;
  getBundles(taskId: string): Promise<ContextBundle[]>;
  addBundleSource(source: BundleSource): Promise<BundleSource>;

  // Utility
  close(): Promise<void>;
}

export interface TaskFilter {
  status?: string | string[];
  owner_id?: string;
  owner_type?: string;
  kind?: string | string[];
  priority?: string | string[];
  limit?: number;
  offset?: number;
}