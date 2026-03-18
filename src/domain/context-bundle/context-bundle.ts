import type { RiskLevel } from '../../types.js';

/**
 * Purpose type - reason for building this context bundle
 */
export type Purpose = 'normal' | 'ambiguity' | 'review' | 'high_risk' | 'recovery';

/**
 * Decision digest - summary of a decision made
 */
export interface DecisionDigest {
  /** Reference to the full decision record */
  ref: string;
  /** Brief summary of the decision */
  summary: string;
}

/**
 * Open question digest - summary of an open question
 */
export interface OpenQuestionDigest {
  /** Reference to the full question record */
  ref: string;
  /** Brief summary of the question */
  summary: string;
}

/**
 * State snapshot - current state information
 */
export interface StateSnapshot {
  /** Current state of the task */
  current_state: string;
  /** Reason for being in current state */
  last_reason?: string;
}

/**
 * Context Bundle - Complete task context for workers
 *
 * Contains all information needed for a worker to execute a task,
 * including diagnostics, source references, and generator metadata.
 */
export interface ContextBundle {
  /** Bundle version for compatibility checking */
  version: string;
  /** Unique bundle identifier */
  bundle_id: string;
  /** Task this bundle is for */
  task_id: string;
  /** Task reference in typed_ref format (alias for task_id) */
  task_ref?: string;
  /** When this bundle was created */
  created_at: string;
  /** Source of this bundle generation */
  generator: ContextGenerator;

  /** Purpose/reason for building this bundle */
  purpose?: Purpose;
  /** Current state snapshot */
  state_snapshot?: StateSnapshot;
  /** Digest of decisions made */
  decision_digest?: DecisionDigest[];
  /** Digest of open questions */
  open_question_digest?: OpenQuestionDigest[];

  /** Core task information */
  task: TaskCore;
  /** Repository context */
  repository: RepositoryContext;
  /** Workspace context */
  workspace: WorkspaceContext;

  /** Resolved documents */
  documents?: DocumentContext;
  /** Tracker references */
  trackers?: TrackerContext;
  /** Diagnostics and analysis */
  diagnostics?: DiagnosticContext;
  /** Historical context from previous runs */
  history?: HistoryContext;

  /** Metadata for auditing and debugging */
  metadata: ContextBundleMetadata;
}

/**
 * Generator information
 */
export interface ContextGenerator {
  /** Component that generated this bundle */
  component: 'control_plane' | 'worker' | 'external';
  /** Version of the generator */
  version: string;
  /** Configuration used during generation */
  config?: Record<string, unknown>;
  /** Timestamp of generation */
  generated_at: string;
}

/**
 * Core task information
 */
export interface TaskCore {
  task_id: string;
  typed_ref: string;
  title: string;
  objective: string;
  description?: string;
  state: string;
  stage: string;
  risk_level: RiskLevel;

  /** Acceptance criteria */
  acceptance_criteria?: string[];
  /** Constraints and limitations */
  constraints?: string[];

  /** Labels for categorization */
  labels?: string[];
  /** Priority (if set) */
  priority?: 'low' | 'medium' | 'high' | 'critical';
}

/**
 * Repository context
 */
export interface RepositoryContext {
  provider: 'github' | 'gitlab' | 'bitbucket';
  owner: string;
  name: string;
  default_branch: string;

  /** Current base SHA */
  base_sha?: string;
  /** HEAD SHA when task was created */
  head_sha?: string;

  /** Repository URL */
  clone_url?: string;
  /** Web URL */
  html_url?: string;

  /** Language detection */
  primary_language?: string;
  /** Framework detection */
  frameworks?: string[];

  /** CI configuration files */
  ci_config?: {
    type: 'github_actions' | 'circleci' | 'jenkins' | 'other';
    path: string;
    exists: boolean;
  };
}

/**
 * Workspace context
 */
export interface WorkspaceContext {
  workspace_id: string;
  kind: 'container' | 'volume' | 'host_path';
  reusable: boolean;

  /** Container image (if applicable) */
  container_image?: string;
  /** Working directory inside workspace */
  working_directory: string;

  /** Environment variables to set */
  environment?: Record<string, string>;
  /** Secrets to inject (names only, not values) */
  secrets?: string[];

  /** Mounted volumes */
  mounts?: Array<{
    source: string;
    target: string;
    type: 'bind' | 'volume';
  }>;
}

/**
 * Document context from resolver
 */
export interface DocumentContext {
  /** Resolved document references */
  doc_refs: Array<{
    ref: string;
    title?: string;
    relevance_score?: number;
    last_updated?: string;
  }>;

  /** Document chunks for context */
  chunks: Array<{
    chunk_id: string;
    doc_ref: string;
    content: string;
    start_line?: number;
    end_line?: number;
  }>;

  /** Contract references */
  contracts: Array<{
    contract_ref: string;
    type: 'feature' | 'api' | 'interface';
    version?: string;
  }>;

  /** Acknowledgment references */
  ack_refs?: string[];

  /** Stale status */
  stale_status?: 'fresh' | 'stale' | 'unknown';
  stale_details?: Array<{
    doc_ref: string;
    is_stale: boolean;
    reason?: string;
  }>;
}

/**
 * Tracker context
 */
export interface TrackerContext {
  /** Linked issues */
  issues: Array<{
    provider: 'github' | 'jira' | 'linear' | 'other';
    issue_id: string;
    title: string;
    state: string;
    labels?: string[];
    url?: string;
  }>;

  /** Project items */
  project_items: Array<{
    project_name: string;
    item_id: string;
    status?: string;
    custom_fields?: Record<string, string | number>;
  }>;

  /** External references */
  external_refs: Array<{
    kind: string;
    value: string;
    url?: string;
  }>;

  /** Sync events */
  sync_events: Array<{
    sync_id: string;
    source: string;
    timestamp: string;
  }>;
}

/**
 * Diagnostic context
 */
export interface DiagnosticContext {
  /** Code analysis results */
  code_analysis?: {
    /** Detected issues */
    issues: Array<{
      severity: 'error' | 'warning' | 'info';
      message: string;
      file?: string;
      line?: number;
      rule_id?: string;
    }>;
    /** Metrics */
    metrics?: {
      complexity?: number;
      coverage?: number;
      lines_of_code?: number;
    };
  };

  /** Dependency analysis */
  dependencies?: {
    /** Direct dependencies */
    direct: Array<{
      name: string;
      version: string;
      type: 'production' | 'development';
    }>;
    /** Vulnerability findings */
    vulnerabilities: Array<{
      id: string;
      severity: 'critical' | 'high' | 'medium' | 'low';
      package: string;
      description: string;
    }>;
  };

  /** Test analysis */
  tests?: {
    /** Test files found */
    test_files: string[];
    /** Framework used */
    framework?: string;
    /** Coverage percentage */
    coverage_percent?: number;
  };

  /** Security analysis */
  security?: {
    secrets_detected: boolean;
    secrets_locations?: string[];
    sensitive_patterns_found?: string[];
  };
}

/**
 * Historical context from previous runs
 */
export interface HistoryContext {
  /** Previous attempts */
  attempts: Array<{
    attempt_number: number;
    stage: string;
    status: 'succeeded' | 'failed' | 'cancelled';
    started_at: string;
    finished_at?: string;
    duration_ms?: number;
    summary?: string;
    error?: string;
  }>;

  /** Lessons learned */
  lessons?: Array<{
    category: 'success' | 'failure' | 'warning';
    message: string;
    stage: string;
  }>;

  /** Files modified in previous attempts */
  modified_files?: Array<{
    path: string;
    action: 'created' | 'modified' | 'deleted';
    attempt: number;
  }>;
}

/**
 * Context bundle metadata
 */
export interface ContextBundleMetadata {
  /** Total size estimate in bytes */
  estimated_size_bytes?: number;
  /** Checksum for integrity verification */
  checksum?: string;
  /** Expiration time for cache */
  expires_at?: string;

  /** Tags for filtering */
  tags?: string[];
  /** Custom annotations */
  annotations?: Record<string, string>;
}

/**
 * Context bundle builder
 */
export class ContextBundleBuilder {
  private bundle: Partial<ContextBundle>;

  constructor(taskId: string) {
    this.bundle = {
      version: '1.0.0',
      bundle_id: `ctx-${taskId}-${Date.now()}`,
      task_id: taskId,
      created_at: new Date().toISOString(),
      generator: {
        component: 'control_plane',
        version: '1.0.0',
        generated_at: new Date().toISOString(),
      },
      metadata: {},
    };
  }

  setTaskCore(task: TaskCore): this {
    this.bundle.task = task;
    return this;
  }

  setRepository(repo: RepositoryContext): this {
    this.bundle.repository = repo;
    return this;
  }

  setWorkspace(workspace: WorkspaceContext): this {
    this.bundle.workspace = workspace;
    return this;
  }

  setDocuments(docs: DocumentContext): this {
    this.bundle.documents = docs;
    return this;
  }

  setTrackers(trackers: TrackerContext): this {
    this.bundle.trackers = trackers;
    return this;
  }

  setDiagnostics(diagnostics: DiagnosticContext): this {
    this.bundle.diagnostics = diagnostics;
    return this;
  }

  setHistory(history: HistoryContext): this {
    this.bundle.history = history;
    return this;
  }

  setPurpose(purpose: Purpose): this {
    this.bundle.purpose = purpose;
    return this;
  }

  setTaskRef(taskRef: string): this {
    this.bundle.task_ref = taskRef;
    return this;
  }

  setStateSnapshot(snapshot: StateSnapshot): this {
    this.bundle.state_snapshot = snapshot;
    return this;
  }

  setDecisionDigest(decisions: DecisionDigest[]): this {
    this.bundle.decision_digest = decisions;
    return this;
  }

  setOpenQuestionDigest(questions: OpenQuestionDigest[]): this {
    this.bundle.open_question_digest = questions;
    return this;
  }

  setMetadata(metadata: Partial<ContextBundleMetadata>): this {
    this.bundle.metadata = { ...this.bundle.metadata, ...metadata };
    return this;
  }

  build(): ContextBundle {
    if (!this.bundle.task) {
      throw new Error('Task core is required');
    }
    if (!this.bundle.repository) {
      throw new Error('Repository context is required');
    }
    if (!this.bundle.workspace) {
      throw new Error('Workspace context is required');
    }

    return this.bundle as ContextBundle;
  }
}

/**
 * Context bundle service
 */
export class ContextBundleService {
  /**
   * Generate a context bundle for a task
   */
  async generateBundle(
    taskId: string,
    _options?: {
      includeDiagnostics?: boolean;
      includeHistory?: boolean;
    }
  ): Promise<ContextBundle> {
    const builder = new ContextBundleBuilder(taskId);

    // In a real implementation, this would:
    // 1. Fetch task from store
    // 2. Resolve documents from memx-resolver
    // 3. Fetch tracker context from tracker-bridge
    // 4. Run diagnostics if requested
    // 5. Build complete bundle

    return builder.build();
  }

  /**
   * Serialize bundle for storage/transmission
   */
  serialize(bundle: ContextBundle): string {
    return JSON.stringify(bundle);
  }

  /**
   * Deserialize bundle
   */
  deserialize(data: string): ContextBundle {
    const bundle = JSON.parse(data) as ContextBundle;

    // Validate version
    if (!bundle.version) {
      throw new Error('Invalid context bundle: missing version');
    }

    return bundle;
  }

  /**
   * Calculate checksum for integrity
   */
  calculateChecksum(bundle: ContextBundle): string {
    // Simple hash implementation
    const content = JSON.stringify(bundle, Object.keys(bundle).sort());
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return `sha256:${Math.abs(hash).toString(16).padStart(64, '0').slice(0, 64)}`;
  }

  /**
   * Verify bundle integrity
   */
  verifyIntegrity(bundle: ContextBundle, expectedChecksum: string): boolean {
    const actualChecksum = this.calculateChecksum(bundle);
    return actualChecksum === expectedChecksum;
  }

  /**
   * Merge multiple context bundles
   */
  mergeBundles(bundles: ContextBundle[]): ContextBundle {
    if (bundles.length === 0) {
      throw new Error('No bundles to merge');
    }

    if (bundles.length === 1) {
      return bundles[0];
    }

    // Use the first bundle as base
    const base = bundles[0];
    const builder = new ContextBundleBuilder(base.task_id);

    builder.setTaskCore(base.task);
    builder.setRepository(base.repository);
    builder.setWorkspace(base.workspace);

    // Merge documents
    const allDocs: DocumentContext = {
      doc_refs: [],
      chunks: [],
      contracts: [],
    };
    for (const bundle of bundles) {
      if (bundle.documents) {
        allDocs.doc_refs.push(...bundle.documents.doc_refs);
        allDocs.chunks.push(...bundle.documents.chunks);
        allDocs.contracts.push(...bundle.documents.contracts);
      }
    }
    if (allDocs.doc_refs.length > 0) {
      builder.setDocuments(allDocs);
    }

    // Merge trackers
    const allTrackers: TrackerContext = {
      issues: [],
      project_items: [],
      external_refs: [],
      sync_events: [],
    };
    for (const bundle of bundles) {
      if (bundle.trackers) {
        allTrackers.issues.push(...bundle.trackers.issues);
        allTrackers.project_items.push(...bundle.trackers.project_items);
        allTrackers.external_refs.push(...bundle.trackers.external_refs);
        allTrackers.sync_events.push(...bundle.trackers.sync_events);
      }
    }
    if (allTrackers.issues.length > 0) {
      builder.setTrackers(allTrackers);
    }

    return builder.build();
  }
}