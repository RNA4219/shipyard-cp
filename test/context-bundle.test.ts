import { describe, it, expect, beforeEach } from 'vitest';
import {
  ContextBundleBuilder,
  ContextBundleService,
  type ContextBundle,
  type TaskCore,
  type RepositoryContext,
  type WorkspaceContext,
  type DocumentContext,
  type TrackerContext,
  type DiagnosticContext,
  type HistoryContext,
  type Purpose,
  type DecisionDigest,
  type OpenQuestionDigest,
  type StateSnapshot,
} from '../src/domain/context-bundle/index.js';

describe('ContextBundle', () => {
  describe('ContextBundleBuilder', () => {
    let builder: ContextBundleBuilder;
    const taskId = 'task-123';

    const taskCore: TaskCore = {
      task_id: taskId,
      typed_ref: 'agent-taskstate:task:github:issue-456',
      title: 'Test Task',
      objective: 'Implement feature X',
      state: 'created',
      stage: 'plan',
      risk_level: 'low',
    };

    const repo: RepositoryContext = {
      provider: 'github',
      owner: 'test-org',
      name: 'test-repo',
      default_branch: 'main',
    };

    const workspace: WorkspaceContext = {
      workspace_id: 'ws-123',
      kind: 'container',
      reusable: true,
      working_directory: '/workspace',
    };

    beforeEach(() => {
      builder = new ContextBundleBuilder(taskId);
    });

    it('should build minimal valid bundle', () => {
      const bundle = builder
        .setTaskCore(taskCore)
        .setRepository(repo)
        .setWorkspace(workspace)
        .build();

      expect(bundle.version).toBe('1.0.0');
      expect(bundle.task_id).toBe(taskId);
      expect(bundle.task).toEqual(taskCore);
      expect(bundle.repository).toEqual(repo);
      expect(bundle.workspace).toEqual(workspace);
      expect(bundle.bundle_id).toMatch(/^ctx-/);
      expect(bundle.created_at).toBeDefined();
      expect(bundle.generator.component).toBe('control_plane');
    });

    it('should throw when task core is missing', () => {
      expect(() => builder.build()).toThrow('Task core is required');
    });

    it('should throw when repository is missing', () => {
      builder.setTaskCore(taskCore);
      expect(() => builder.build()).toThrow('Repository context is required');
    });

    it('should throw when workspace is missing', () => {
      builder.setTaskCore(taskCore).setRepository(repo);
      expect(() => builder.build()).toThrow('Workspace context is required');
    });

    it('should set documents context', () => {
      const docs: DocumentContext = {
        doc_refs: [{ ref: 'doc-1', title: 'API Spec' }],
        chunks: [{ chunk_id: 'c1', doc_ref: 'doc-1', content: 'content' }],
        contracts: [{ contract_ref: 'ctr-1', type: 'api' }],
        ack_refs: ['ack-1'],
        stale_status: 'fresh',
      };

      const bundle = builder
        .setTaskCore(taskCore)
        .setRepository(repo)
        .setWorkspace(workspace)
        .setDocuments(docs)
        .build();

      expect(bundle.documents).toEqual(docs);
    });

    it('should set trackers context', () => {
      const trackers: TrackerContext = {
        issues: [{ provider: 'github', issue_id: '1', title: 'Bug', state: 'open' }],
        project_items: [{ project_name: 'Backlog', item_id: 'item-1' }],
        external_refs: [{ kind: 'jira', value: 'JIRA-123' }],
        sync_events: [{ sync_id: 's1', source: 'github', timestamp: new Date().toISOString() }],
      };

      const bundle = builder
        .setTaskCore(taskCore)
        .setRepository(repo)
        .setWorkspace(workspace)
        .setTrackers(trackers)
        .build();

      expect(bundle.trackers).toEqual(trackers);
    });

    it('should set diagnostics context', () => {
      const diagnostics: DiagnosticContext = {
        code_analysis: {
          issues: [{ severity: 'error', message: 'Unused variable', file: 'test.ts', line: 10 }],
          metrics: { complexity: 5, coverage: 80, lines_of_code: 1000 },
        },
        dependencies: {
          direct: [{ name: 'vitest', version: '1.0.0', type: 'development' }],
          vulnerabilities: [],
        },
        tests: {
          test_files: ['test.ts'],
          framework: 'vitest',
          coverage_percent: 80,
        },
        security: {
          secrets_detected: false,
        },
      };

      const bundle = builder
        .setTaskCore(taskCore)
        .setRepository(repo)
        .setWorkspace(workspace)
        .setDiagnostics(diagnostics)
        .build();

      expect(bundle.diagnostics).toEqual(diagnostics);
    });

    it('should set history context', () => {
      const history: HistoryContext = {
        attempts: [{
          attempt_number: 1,
          stage: 'plan',
          status: 'failed',
          started_at: '2024-01-01T00:00:00Z',
          finished_at: '2024-01-01T00:05:00Z',
          duration_ms: 300000,
          error: 'Timeout',
        }],
        lessons: [{ category: 'failure', message: 'Need more context', stage: 'plan' }],
        modified_files: [{ path: 'src/test.ts', action: 'modified', attempt: 1 }],
      };

      const bundle = builder
        .setTaskCore(taskCore)
        .setRepository(repo)
        .setWorkspace(workspace)
        .setHistory(history)
        .build();

      expect(bundle.history).toEqual(history);
    });

    it('should set metadata', () => {
      const bundle = builder
        .setTaskCore(taskCore)
        .setRepository(repo)
        .setWorkspace(workspace)
        .setMetadata({
          estimated_size_bytes: 1024,
          tags: ['important', 'test'],
          annotations: { key: 'value' },
        })
        .build();

      expect(bundle.metadata.estimated_size_bytes).toBe(1024);
      expect(bundle.metadata.tags).toContain('important');
      expect(bundle.metadata.annotations?.key).toBe('value');
    });

    it('should set purpose', () => {
      const bundle = builder
        .setTaskCore(taskCore)
        .setRepository(repo)
        .setWorkspace(workspace)
        .setPurpose('high_risk')
        .build();

      expect(bundle.purpose).toBe('high_risk');
    });

    it('should set all purpose types', () => {
      const purposes: Purpose[] = ['normal', 'ambiguity', 'review', 'high_risk', 'recovery'];

      for (const purpose of purposes) {
        const testBuilder = new ContextBundleBuilder(taskId);
        const bundle = testBuilder
          .setTaskCore(taskCore)
          .setRepository(repo)
          .setWorkspace(workspace)
          .setPurpose(purpose)
          .build();

        expect(bundle.purpose).toBe(purpose);
      }
    });

    it('should set task_ref', () => {
      const bundle = builder
        .setTaskCore(taskCore)
        .setRepository(repo)
        .setWorkspace(workspace)
        .setTaskRef('agent-taskstate:task:local:task-123')
        .build();

      expect(bundle.task_ref).toBe('agent-taskstate:task:local:task-123');
    });

    it('should set state_snapshot', () => {
      const snapshot: StateSnapshot = {
        current_state: 'in_progress',
        last_reason: 'working on migration draft',
      };

      const bundle = builder
        .setTaskCore(taskCore)
        .setRepository(repo)
        .setWorkspace(workspace)
        .setStateSnapshot(snapshot)
        .build();

      expect(bundle.state_snapshot).toEqual(snapshot);
    });

    it('should set decision_digest', () => {
      const decisions: DecisionDigest[] = [
        { ref: 'decision-001', summary: 'Use PostgreSQL for primary database' },
        { ref: 'decision-002', summary: 'Implement REST API instead of GraphQL' },
      ];

      const bundle = builder
        .setTaskCore(taskCore)
        .setRepository(repo)
        .setWorkspace(workspace)
        .setDecisionDigest(decisions)
        .build();

      expect(bundle.decision_digest).toEqual(decisions);
      expect(bundle.decision_digest).toHaveLength(2);
    });

    it('should set open_question_digest', () => {
      const questions: OpenQuestionDigest[] = [
        { ref: 'q-001', summary: 'Should we use microservices architecture?' },
        { ref: 'q-002', summary: 'What caching strategy should be used?' },
      ];

      const bundle = builder
        .setTaskCore(taskCore)
        .setRepository(repo)
        .setWorkspace(workspace)
        .setOpenQuestionDigest(questions)
        .build();

      expect(bundle.open_question_digest).toEqual(questions);
      expect(bundle.open_question_digest).toHaveLength(2);
    });

    it('should set all new agent-taskstate fields together', () => {
      const snapshot: StateSnapshot = {
        current_state: 'in_progress',
        last_reason: 'working on feature',
      };
      const decisions: DecisionDigest[] = [
        { ref: 'decision-001', summary: 'Major architecture decision' },
      ];
      const questions: OpenQuestionDigest[] = [
        { ref: 'q-001', summary: 'Open question about implementation' },
      ];

      const bundle = builder
        .setTaskCore(taskCore)
        .setRepository(repo)
        .setWorkspace(workspace)
        .setPurpose('recovery')
        .setTaskRef('agent-taskstate:task:github:issue-123')
        .setStateSnapshot(snapshot)
        .setDecisionDigest(decisions)
        .setOpenQuestionDigest(questions)
        .build();

      expect(bundle.purpose).toBe('recovery');
      expect(bundle.task_ref).toBe('agent-taskstate:task:github:issue-123');
      expect(bundle.state_snapshot).toEqual(snapshot);
      expect(bundle.decision_digest).toEqual(decisions);
      expect(bundle.open_question_digest).toEqual(questions);
    });
  });

  describe('ContextBundleService', () => {
    let service: ContextBundleService;
    let bundle: ContextBundle;

    const taskCore: TaskCore = {
      task_id: 'task-456',
      typed_ref: 'agent-taskstate:task:github:pr-789',
      title: 'Another Task',
      objective: 'Fix bug Y',
      state: 'accepted',
      stage: 'dev',
      risk_level: 'medium',
    };

    const repo: RepositoryContext = {
      provider: 'github',
      owner: 'org',
      name: 'repo',
      default_branch: 'main',
    };

    const workspace: WorkspaceContext = {
      workspace_id: 'ws-456',
      kind: 'volume',
      reusable: false,
      working_directory: '/work',
    };

    beforeEach(() => {
      service = new ContextBundleService();
      bundle = new ContextBundleBuilder('task-456')
        .setTaskCore(taskCore)
        .setRepository(repo)
        .setWorkspace(workspace)
        .build();
    });

    describe('serialize/deserialize', () => {
      it('should serialize and deserialize bundle', () => {
        const serialized = service.serialize(bundle);
        const deserialized = service.deserialize(serialized);

        expect(deserialized.task_id).toBe(bundle.task_id);
        expect(deserialized.task).toEqual(bundle.task);
        expect(deserialized.repository).toEqual(bundle.repository);
      });

      it('should throw for invalid bundle (missing version)', () => {
        const invalidJson = JSON.stringify({ task_id: 'test' });
        expect(() => service.deserialize(invalidJson)).toThrow('missing version');
      });
    });

    describe('calculateChecksum', () => {
      it('should produce consistent checksum', () => {
        const checksum1 = service.calculateChecksum(bundle);
        const checksum2 = service.calculateChecksum(bundle);

        expect(checksum1).toBe(checksum2);
        expect(checksum1).toMatch(/^sha256:/);
      });

      it('should produce different checksums for different bundles', () => {
        const bundle2 = new ContextBundleBuilder('task-789')
          .setTaskCore({ ...taskCore, task_id: 'task-789' })
          .setRepository(repo)
          .setWorkspace(workspace)
          .build();

        const checksum1 = service.calculateChecksum(bundle);
        const checksum2 = service.calculateChecksum(bundle2);

        expect(checksum1).not.toBe(checksum2);
      });
    });

    describe('verifyIntegrity', () => {
      it('should verify valid checksum', () => {
        const checksum = service.calculateChecksum(bundle);
        expect(service.verifyIntegrity(bundle, checksum)).toBe(true);
      });

      it('should reject invalid checksum', () => {
        expect(service.verifyIntegrity(bundle, 'sha256:invalid')).toBe(false);
      });
    });

    describe('mergeBundles', () => {
      it('should merge multiple bundles', () => {
        const docs1: DocumentContext = {
          doc_refs: [{ ref: 'doc-1' }],
          chunks: [],
          contracts: [],
        };

        const docs2: DocumentContext = {
          doc_refs: [{ ref: 'doc-2' }],
          chunks: [],
          contracts: [],
        };

        const bundle1 = new ContextBundleBuilder('task-shared')
          .setTaskCore(taskCore)
          .setRepository(repo)
          .setWorkspace(workspace)
          .setDocuments(docs1)
          .build();

        const bundle2 = new ContextBundleBuilder('task-shared')
          .setTaskCore(taskCore)
          .setRepository(repo)
          .setWorkspace(workspace)
          .setDocuments(docs2)
          .build();

        const merged = service.mergeBundles([bundle1, bundle2]);

        expect(merged.documents?.doc_refs).toHaveLength(2);
        expect(merged.documents?.doc_refs.map(d => d.ref)).toContain('doc-1');
        expect(merged.documents?.doc_refs.map(d => d.ref)).toContain('doc-2');
      });

      it('should merge trackers', () => {
        const trackers1: TrackerContext = {
          issues: [{ provider: 'github', issue_id: '1', title: 'Issue 1', state: 'open' }],
          project_items: [],
          external_refs: [],
          sync_events: [],
        };

        const trackers2: TrackerContext = {
          issues: [{ provider: 'jira', issue_id: 'JIRA-2', title: 'Issue 2', state: 'open' }],
          project_items: [],
          external_refs: [],
          sync_events: [],
        };

        const bundle1 = new ContextBundleBuilder('task-shared')
          .setTaskCore(taskCore)
          .setRepository(repo)
          .setWorkspace(workspace)
          .setTrackers(trackers1)
          .build();

        const bundle2 = new ContextBundleBuilder('task-shared')
          .setTaskCore(taskCore)
          .setRepository(repo)
          .setWorkspace(workspace)
          .setTrackers(trackers2)
          .build();

        const merged = service.mergeBundles([bundle1, bundle2]);

        expect(merged.trackers?.issues).toHaveLength(2);
      });

      it('should return single bundle unchanged', () => {
        const merged = service.mergeBundles([bundle]);
        expect(merged.task_id).toBe(bundle.task_id);
      });

      it('should throw for empty array', () => {
        expect(() => service.mergeBundles([])).toThrow('No bundles to merge');
      });
    });

    describe('generateBundle', () => {
      it('should throw when not enough data (stub implementation)', async () => {
        // Note: This is a stub implementation that throws without required fields
        // In production, this would fetch task from store, resolve documents, etc.
        await expect(service.generateBundle('task-test')).rejects.toThrow('Task core is required');
      });
    });
  });
});