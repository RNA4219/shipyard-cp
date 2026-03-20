import type {
  Task,
  StateTransition,
  Decision,
  OpenQuestion,
  Run,
  ContextBundle,
  BundleSource,
} from '../types.js';
import type { TaskStateBackend, TaskFilter } from './store-backend.js';

type Database = any;
type Statement = any;

export interface SQLiteBackendConfig {
  filename?: string;
  database?: Database;
}

/**
 * SQLite backend for local development
 * Uses better-sqlite3 for synchronous API
 */
export class SQLiteBackend implements TaskStateBackend {
  private config: SQLiteBackendConfig;
  private db: Database | null = null;

  // Prepared statements
  private stmtGetTask: Statement | null = null;
  private stmtCreateTask: Statement | null = null;
  private stmtUpdateTask: Statement | null = null;
  private stmtDeleteTask: Statement | null = null;
  private stmtListTasks: Statement | null = null;

  constructor(config: SQLiteBackendConfig = {}) {
    this.config = config;
  }

  private async getDatabase(): Promise<Database> {
    if (this.db) {
      return this.db;
    }

    if (this.config.database) {
      this.db = this.config.database;
      return this.db;
    }

    // Dynamic import for better-sqlite3
    const betterSqlite3 = await import('better-sqlite3');
    const Database = (betterSqlite3 as any).default || betterSqlite3;
    this.db = new Database(this.config.filename ?? ':memory:');
    this.initializeSchema();
    this.prepareStatements();
    return this.db;
  }

  private initializeSchema(): void {
    if (!this.db) return;

    this.db.exec(`
      -- Tasks table
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        goal TEXT NOT NULL,
        status TEXT NOT NULL,
        priority TEXT NOT NULL,
        owner_type TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      );

      -- State transitions table
      CREATE TABLE IF NOT EXISTS state_transitions (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        from_status TEXT,
        to_status TEXT NOT NULL,
        reason TEXT NOT NULL,
        actor_type TEXT NOT NULL,
        actor_id TEXT,
        run_id TEXT,
        changed_at TEXT NOT NULL,
        FOREIGN KEY (task_id) REFERENCES tasks(id)
      );

      -- Decisions table
      CREATE TABLE IF NOT EXISTS decisions (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        question TEXT NOT NULL,
        options TEXT NOT NULL,
        chosen TEXT,
        rationale TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (task_id) REFERENCES tasks(id)
      );

      -- Open questions table
      CREATE TABLE IF NOT EXISTS open_questions (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        question TEXT NOT NULL,
        answer TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (task_id) REFERENCES tasks(id)
      );

      -- Runs table
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        status TEXT NOT NULL,
        error_message TEXT,
        FOREIGN KEY (task_id) REFERENCES tasks(id)
      );

      -- Context bundles table
      CREATE TABLE IF NOT EXISTS context_bundles (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        purpose TEXT NOT NULL,
        rebuild_level TEXT NOT NULL,
        summary TEXT,
        state_snapshot TEXT NOT NULL,
        decision_digest TEXT,
        question_digest TEXT,
        diagnostics TEXT,
        raw_included INTEGER NOT NULL DEFAULT 0,
        generator_version TEXT NOT NULL,
        generated_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (task_id) REFERENCES tasks(id)
      );

      -- Bundle sources table
      CREATE TABLE IF NOT EXISTS bundle_sources (
        id TEXT PRIMARY KEY,
        context_bundle_id TEXT NOT NULL,
        typed_ref TEXT NOT NULL,
        source_kind TEXT NOT NULL,
        selected_raw INTEGER NOT NULL DEFAULT 0,
        metadata TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (context_bundle_id) REFERENCES context_bundles(id)
      );

      -- Indexes
      CREATE INDEX IF NOT EXISTS idx_transitions_task_id ON state_transitions(task_id);
      CREATE INDEX IF NOT EXISTS idx_decisions_task_id ON decisions(task_id);
      CREATE INDEX IF NOT EXISTS idx_questions_task_id ON open_questions(task_id);
      CREATE INDEX IF NOT EXISTS idx_runs_task_id ON runs(task_id);
      CREATE INDEX IF NOT EXISTS idx_bundles_task_id ON context_bundles(task_id);
      CREATE INDEX IF NOT EXISTS idx_bundle_sources_bundle_id ON bundle_sources(context_bundle_id);
    `);
  }

  private prepareStatements(): void {
    if (!this.db) return;

    this.stmtGetTask = this.db.prepare('SELECT * FROM tasks WHERE id = ?');
    this.stmtCreateTask = this.db.prepare(`
      INSERT INTO tasks (id, kind, title, goal, status, priority, owner_type, owner_id, revision, created_at, updated_at, completed_at)
      VALUES (@id, @kind, @title, @goal, @status, @priority, @owner_type, @owner_id, @revision, @created_at, @updated_at, @completed_at)
    `);
    this.stmtUpdateTask = this.db.prepare(`
      UPDATE tasks SET kind = @kind, title = @title, goal = @goal, status = @status, priority = @priority,
        owner_type = @owner_type, owner_id = @owner_id, revision = @revision, updated_at = @updated_at, completed_at = @completed_at
      WHERE id = @id
    `);
    this.stmtDeleteTask = this.db.prepare('DELETE FROM tasks WHERE id = ?');
    this.stmtListTasks = this.db.prepare('SELECT * FROM tasks');
  }

  // Task operations
  async getTask(taskId: string): Promise<Task | null> {
    await this.getDatabase();
    const row = this.stmtGetTask!.get(taskId);
    return row ?? null;
  }

  async createTask(task: Task): Promise<Task> {
    await this.getDatabase();
    this.stmtCreateTask!.run(task);
    return task;
  }

  async updateTask(task: Task): Promise<Task> {
    await this.getDatabase();
    this.stmtUpdateTask!.run(task);
    return task;
  }

  async deleteTask(taskId: string): Promise<void> {
    await this.getDatabase();

    // Delete in transaction for atomicity
    const deleteAll = this.db!.transaction(() => {
      // Delete related entities first
      this.db!.prepare('DELETE FROM bundle_sources WHERE context_bundle_id IN (SELECT id FROM context_bundles WHERE task_id = ?)').run(taskId);
      this.db!.prepare('DELETE FROM context_bundles WHERE task_id = ?').run(taskId);
      this.db!.prepare('DELETE FROM runs WHERE task_id = ?').run(taskId);
      this.db!.prepare('DELETE FROM open_questions WHERE task_id = ?').run(taskId);
      this.db!.prepare('DELETE FROM decisions WHERE task_id = ?').run(taskId);
      this.db!.prepare('DELETE FROM state_transitions WHERE task_id = ?').run(taskId);
      this.db!.prepare('DELETE FROM tasks WHERE id = ?').run(taskId);
    });

    deleteAll();
  }

  async listTasks(filter?: TaskFilter): Promise<Task[]> {
    await this.getDatabase();
    let rows = this.stmtListTasks!.all() as Task[];

    if (filter) {
      if (filter.status) {
        const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
        rows = rows.filter(t => statuses.includes(t.status));
      }
      if (filter.owner_id) {
        rows = rows.filter(t => t.owner_id === filter.owner_id);
      }
      if (filter.owner_type) {
        rows = rows.filter(t => t.owner_type === filter.owner_type);
      }
      if (filter.kind) {
        const kinds = Array.isArray(filter.kind) ? filter.kind : [filter.kind];
        rows = rows.filter(t => kinds.includes(t.kind));
      }
      if (filter.priority) {
        const priorities = Array.isArray(filter.priority) ? filter.priority : [filter.priority];
        rows = rows.filter(t => priorities.includes(t.priority));
      }
      if (filter.offset !== undefined) {
        rows = rows.slice(filter.offset);
      }
      if (filter.limit !== undefined) {
        rows = rows.slice(0, filter.limit);
      }
    }

    return rows;
  }

  // State transition operations
  async addTransition(transition: StateTransition): Promise<StateTransition> {
    await this.getDatabase();
    const stmt = this.db!.prepare(`
      INSERT INTO state_transitions (id, task_id, from_status, to_status, reason, actor_type, actor_id, run_id, changed_at)
      VALUES (@id, @task_id, @from_status, @to_status, @reason, @actor_type, @actor_id, @run_id, @changed_at)
    `);
    stmt.run(transition);
    return transition;
  }

  async getTransitions(taskId: string): Promise<StateTransition[]> {
    await this.getDatabase();
    const stmt = this.db!.prepare('SELECT * FROM state_transitions WHERE task_id = ? ORDER BY changed_at');
    return stmt.all(taskId);
  }

  // Decision operations
  async createDecision(decision: Decision): Promise<Decision> {
    await this.getDatabase();
    const stmt = this.db!.prepare(`
      INSERT INTO decisions (id, task_id, question, options, chosen, rationale, status, created_at, updated_at)
      VALUES (@id, @task_id, @question, @options, @chosen, @rationale, @status, @created_at, @updated_at)
    `);
    stmt.run({
      ...decision,
      options: JSON.stringify(decision.options),
    });
    return decision;
  }

  async getDecision(decisionId: string): Promise<Decision | null> {
    await this.getDatabase();
    const stmt = this.db!.prepare('SELECT * FROM decisions WHERE id = ?');
    const row = stmt.get(decisionId);
    if (!row) return null;
    return {
      ...row,
      options: JSON.parse(row.options),
    };
  }

  async getDecisions(taskId: string): Promise<Decision[]> {
    await this.getDatabase();
    const stmt = this.db!.prepare('SELECT * FROM decisions WHERE task_id = ?');
    const rows = stmt.all(taskId) as any[];
    return rows.map((row: any) => ({
      ...row,
      options: JSON.parse(row.options),
    }));
  }

  async updateDecision(decision: Decision): Promise<Decision> {
    await this.getDatabase();
    const stmt = this.db!.prepare(`
      UPDATE decisions SET question = @question, options = @options, chosen = @chosen, rationale = @rationale, status = @status, updated_at = @updated_at
      WHERE id = @id
    `);
    stmt.run({
      ...decision,
      options: JSON.stringify(decision.options),
    });
    return decision;
  }

  // Open question operations
  async createQuestion(question: OpenQuestion): Promise<OpenQuestion> {
    await this.getDatabase();
    const stmt = this.db!.prepare(`
      INSERT INTO open_questions (id, task_id, question, answer, status, created_at, updated_at)
      VALUES (@id, @task_id, @question, @answer, @status, @created_at, @updated_at)
    `);
    stmt.run(question);
    return question;
  }

  async getQuestion(questionId: string): Promise<OpenQuestion | null> {
    await this.getDatabase();
    const stmt = this.db!.prepare('SELECT * FROM open_questions WHERE id = ?');
    const row = stmt.get(questionId);
    return row ?? null;
  }

  async getQuestions(taskId: string): Promise<OpenQuestion[]> {
    await this.getDatabase();
    const stmt = this.db!.prepare('SELECT * FROM open_questions WHERE task_id = ?');
    return stmt.all(taskId);
  }

  async updateQuestion(question: OpenQuestion): Promise<OpenQuestion> {
    await this.getDatabase();
    const stmt = this.db!.prepare(`
      UPDATE open_questions SET question = @question, answer = @answer, status = @status, updated_at = @updated_at
      WHERE id = @id
    `);
    stmt.run(question);
    return question;
  }

  // Run operations
  async createRun(run: Run): Promise<Run> {
    await this.getDatabase();
    const stmt = this.db!.prepare(`
      INSERT INTO runs (id, task_id, started_at, finished_at, status, error_message)
      VALUES (@id, @task_id, @started_at, @finished_at, @status, @error_message)
    `);
    stmt.run(run);
    return run;
  }

  async getRun(runId: string): Promise<Run | null> {
    await this.getDatabase();
    const stmt = this.db!.prepare('SELECT * FROM runs WHERE id = ?');
    const row = stmt.get(runId);
    return row ?? null;
  }

  async getRuns(taskId: string): Promise<Run[]> {
    await this.getDatabase();
    const stmt = this.db!.prepare('SELECT * FROM runs WHERE task_id = ? ORDER BY started_at DESC');
    return stmt.all(taskId);
  }

  async updateRun(run: Run): Promise<Run> {
    await this.getDatabase();
    const stmt = this.db!.prepare(`
      UPDATE runs SET started_at = @started_at, finished_at = @finished_at, status = @status, error_message = @error_message
      WHERE id = @id
    `);
    stmt.run(run);
    return run;
  }

  // Context bundle operations
  async createBundle(bundle: ContextBundle): Promise<ContextBundle> {
    await this.getDatabase();
    const { sources, ...bundleData } = bundle;

    const stmt = this.db!.prepare(`
      INSERT INTO context_bundles (id, task_id, purpose, rebuild_level, summary, state_snapshot, decision_digest, question_digest, diagnostics, raw_included, generator_version, generated_at, created_at)
      VALUES (@id, @task_id, @purpose, @rebuild_level, @summary, @state_snapshot, @decision_digest, @question_digest, @diagnostics, @raw_included, @generator_version, @generated_at, @created_at)
    `);
    stmt.run({
      ...bundleData,
      state_snapshot: JSON.stringify(bundleData.state_snapshot),
      decision_digest: bundleData.decision_digest ? JSON.stringify(bundleData.decision_digest) : null,
      question_digest: bundleData.question_digest ? JSON.stringify(bundleData.question_digest) : null,
      diagnostics: bundleData.diagnostics ? JSON.stringify(bundleData.diagnostics) : null,
      raw_included: bundleData.raw_included ? 1 : 0,
    });

    // Store sources
    if (sources && sources.length > 0) {
      const sourceStmt = this.db!.prepare(`
        INSERT INTO bundle_sources (id, context_bundle_id, typed_ref, source_kind, selected_raw, metadata, created_at)
        VALUES (@id, @context_bundle_id, @typed_ref, @source_kind, @selected_raw, @metadata, @created_at)
      `);
      for (const source of sources) {
        sourceStmt.run({
          ...source,
          metadata: source.metadata ? JSON.stringify(source.metadata) : null,
          selected_raw: source.selected_raw ? 1 : 0,
        });
      }
    }

    return bundle;
  }

  async getBundle(bundleId: string): Promise<ContextBundle | null> {
    await this.getDatabase();
    const stmt = this.db!.prepare('SELECT * FROM context_bundles WHERE id = ?');
    const row = stmt.get(bundleId);
    if (!row) return null;

    // Get sources
    const sourcesStmt = this.db!.prepare('SELECT * FROM bundle_sources WHERE context_bundle_id = ?');
    const sourceRows = sourcesStmt.all(bundleId);

    return {
      ...row,
      state_snapshot: JSON.parse(row.state_snapshot),
      decision_digest: row.decision_digest ? JSON.parse(row.decision_digest) : undefined,
      question_digest: row.question_digest ? JSON.parse(row.question_digest) : undefined,
      diagnostics: row.diagnostics ? JSON.parse(row.diagnostics) : undefined,
      raw_included: row.raw_included === 1,
      sources: sourceRows.map((s: any) => ({
        ...s,
        metadata: s.metadata ? JSON.parse(s.metadata) : undefined,
        selected_raw: s.selected_raw === 1,
      })),
    };
  }

  async getBundles(taskId: string): Promise<ContextBundle[]> {
    await this.getDatabase();
    const stmt = this.db!.prepare('SELECT * FROM context_bundles WHERE task_id = ? ORDER BY created_at DESC');
    const rows = stmt.all(taskId);

    const bundles: ContextBundle[] = [];
    for (const row of rows) {
      const bundle = await this.getBundle(row.id);
      if (bundle) bundles.push(bundle);
    }

    return bundles;
  }

  async addBundleSource(source: BundleSource): Promise<BundleSource> {
    await this.getDatabase();
    const stmt = this.db!.prepare(`
      INSERT INTO bundle_sources (id, context_bundle_id, typed_ref, source_kind, selected_raw, metadata, created_at)
      VALUES (@id, @context_bundle_id, @typed_ref, @source_kind, @selected_raw, @metadata, @created_at)
    `);
    stmt.run({
      ...source,
      metadata: source.metadata ? JSON.stringify(source.metadata) : null,
      selected_raw: source.selected_raw ? 1 : 0,
    });
    return source;
  }

  // Utility
  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}