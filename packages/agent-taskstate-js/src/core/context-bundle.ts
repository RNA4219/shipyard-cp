import type {
  Task,
  ContextBundle,
  BundleSource,
  BundlePurpose,
  RebuildLevel,
  SourceKind,
  Decision,
  OpenQuestion,
  Run,
} from '../types.js';
import type { TaskStateBackend } from '../store/store-backend.js';

/**
 * Generate a unique ID
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Context bundle service
 * Generates context bundles for task continuation
 */
export class ContextBundleService {
  private backend: TaskStateBackend;
  private generatorVersion: string;

  constructor(backend: TaskStateBackend, generatorVersion: string = '1.0.0') {
    this.backend = backend;
    this.generatorVersion = generatorVersion;
  }

  /**
   * Create a context bundle for a task
   */
  async createBundle(
    taskId: string,
    purpose: BundlePurpose,
    rebuildLevel: RebuildLevel = 'L2',
    options?: {
      summary?: string;
      rawIncluded?: boolean;
    },
  ): Promise<ContextBundle> {
    const task = await this.backend.getTask(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const now = new Date().toISOString();

    // Gather task state
    const transitions = await this.backend.getTransitions(taskId);
    const decisions = await this.backend.getDecisions(taskId);
    const questions = await this.backend.getQuestions(taskId);
    const runs = await this.backend.getRuns(taskId);

    // Build state snapshot
    const stateSnapshot = this.buildStateSnapshot(task, transitions, runs);

    // Build decision digest
    const decisionDigest = this.buildDecisionDigest(decisions);

    // Build question digest
    const questionDigest = this.buildQuestionDigest(questions);

    // Build sources
    const sources = this.buildSources(taskId, decisions, questions, runs);

    const bundle: ContextBundle = {
      id: generateId(),
      task_id: taskId,
      purpose,
      rebuild_level: rebuildLevel,
      summary: options?.summary,
      state_snapshot: stateSnapshot,
      decision_digest: decisionDigest,
      question_digest: questionDigest,
      raw_included: options?.rawIncluded ?? false,
      generator_version: this.generatorVersion,
      generated_at: now,
      created_at: now,
      sources,
    };

    await this.backend.createBundle(bundle);
    return bundle;
  }

  /**
   * Get the latest bundle for a task
   */
  async getLatestBundle(taskId: string): Promise<ContextBundle | null> {
    const bundles = await this.backend.getBundles(taskId);
    if (bundles.length === 0) return null;
    return bundles[0]; // Already sorted by created_at DESC
  }

  /**
   * Get bundle by ID
   */
  async getBundle(bundleId: string): Promise<ContextBundle | null> {
    return this.backend.getBundle(bundleId);
  }

  /**
   * Add a source to an existing bundle
   */
  async addSource(
    bundleId: string,
    typedRef: string,
    sourceKind: SourceKind,
    options?: {
      selectedRaw?: boolean;
      metadata?: Record<string, unknown>;
    },
  ): Promise<BundleSource> {
    const bundle = await this.backend.getBundle(bundleId);
    if (!bundle) {
      throw new Error(`Bundle not found: ${bundleId}`);
    }

    const now = new Date().toISOString();
    const source: BundleSource = {
      id: generateId(),
      context_bundle_id: bundleId,
      typed_ref: typedRef,
      source_kind: sourceKind,
      selected_raw: options?.selectedRaw ?? false,
      metadata: options?.metadata,
      created_at: now,
    };

    await this.backend.addBundleSource(source);
    return source;
  }

  /**
   * Build state snapshot from task data
   */
  private buildStateSnapshot(
    task: Task,
    transitions: StateTransitionData[],
    runs: Run[],
  ): Record<string, unknown> {
    const latestRun = runs.length > 0 ? runs[0] : null;
    const transitionCount = transitions.length;

    return {
      task: {
        id: task.id,
        kind: task.kind,
        title: task.title,
        goal: task.goal,
        status: task.status,
        priority: task.priority,
        owner: {
          type: task.owner_type,
          id: task.owner_id,
        },
        revision: task.revision,
        created_at: task.created_at,
        updated_at: task.updated_at,
        completed_at: task.completed_at,
      },
      state_history: {
        transition_count: transitionCount,
        current_state: task.status,
        last_transition: transitions.length > 0 ? {
          from: transitions[transitions.length - 1].from_status,
          to: transitions[transitions.length - 1].to_status,
          at: transitions[transitions.length - 1].changed_at,
          reason: transitions[transitions.length - 1].reason,
        } : null,
      },
      execution: {
        run_count: runs.length,
        latest_run: latestRun ? {
          id: latestRun.id,
          started_at: latestRun.started_at,
          finished_at: latestRun.finished_at,
          status: latestRun.status,
          error: latestRun.error_message,
        } : null,
      },
    };
  }

  /**
   * Build decision digest
   */
  private buildDecisionDigest(decisions: Decision[]): Record<string, unknown> | undefined {
    if (decisions.length === 0) return undefined;

    const pending = decisions.filter(d => d.status === 'pending');
    const accepted = decisions.filter(d => d.status === 'accepted');

    return {
      total: decisions.length,
      pending_count: pending.length,
      accepted_count: accepted.length,
      decisions: decisions.map(d => ({
        id: d.id,
        question: d.question,
        options: d.options,
        chosen: d.chosen,
        rationale: d.rationale,
        status: d.status,
      })),
    };
  }

  /**
   * Build question digest
   */
  private buildQuestionDigest(questions: OpenQuestion[]): Record<string, unknown> | undefined {
    if (questions.length === 0) return undefined;

    const open = questions.filter(q => q.status === 'open');
    const answered = questions.filter(q => q.status === 'answered');

    return {
      total: questions.length,
      open_count: open.length,
      answered_count: answered.length,
      questions: questions.map(q => ({
        id: q.id,
        question: q.question,
        answer: q.answer,
        status: q.status,
      })),
    };
  }

  /**
   * Build sources array
   */
  private buildSources(
    taskId: string,
    decisions: Decision[],
    questions: OpenQuestion[],
    runs: Run[],
  ): BundleSource[] {
    const now = new Date().toISOString();
    const sources: BundleSource[] = [];

    // Add task as source
    sources.push({
      id: generateId(),
      context_bundle_id: '', // Will be set when bundle is created
      typed_ref: `task:${taskId}`,
      source_kind: 'task',
      selected_raw: false,
      created_at: now,
    });

    // Add decisions as sources
    for (const decision of decisions) {
      sources.push({
        id: generateId(),
        context_bundle_id: '',
        typed_ref: `decision:${decision.id}`,
        source_kind: 'decision',
        selected_raw: false,
        created_at: now,
      });
    }

    // Add open questions as sources
    for (const question of questions) {
      sources.push({
        id: generateId(),
        context_bundle_id: '',
        typed_ref: `open_question:${question.id}`,
        source_kind: 'open_question',
        selected_raw: false,
        created_at: now,
      });
    }

    // Add runs as sources
    for (const run of runs) {
      sources.push({
        id: generateId(),
        context_bundle_id: '',
        typed_ref: `run:${run.id}`,
        source_kind: 'run',
        selected_raw: false,
        created_at: now,
      });
    }

    return sources;
  }
}

interface StateTransitionData {
  from_status: string | null;
  to_status: string;
  changed_at: string;
  reason: string;
}