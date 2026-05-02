---
intent_id: DOC-LEGACY
owner: infrastructure
status: active
last_reviewed_at: 2026-05-02
next_review_due: 2026-06-02
---

# Technical Debt Register

code-to-gate 分析で検出された技術的債務の記録と対応計画。

## 検出日: 2026-05-02

## 1. LARGE_MODULE - モジュール肥大化

### 1.1 src/domain/worker/opencode-session-registry.ts → session-registry/ package (分割済み: 2026-05-03)

**分割後**:
| Module | 行数 | 内容 |
|---|---|---|
| session-registry/reuse.ts | 145 | Reuse eligibility and ranking helpers |
| session-registry/warm-pool.ts | 124 | Warm pool utilities |
| session-registry/health.ts | 95 | Health score utilities |
| session-registry/cleanup.ts | 110 | Orphan detection and cleanup utilities |
| session-registry/registry.ts | 780 | Main OpenCodeSessionRegistry class |
| session-registry/index.ts | 49 | Package exports |

**判定**: 完了 - registry.ts at 780 lines (acceptable for core class)

### 1.2 src/domain/worker/opencode-event-ingestor.ts (899 lines)

**現状**: Event ingestor handling 15 event types for OpenCode integration.

**分割計画**:
| 新モジュール | 内容 | 行数見積 |
|---|---|---|
| `event-ingestor/types.ts` | Event type definitions, validation | ~150 |
| `event-ingestor/handlers.ts` | Event handler implementations per type | ~400 |
| `event-ingestor/transform.ts` | Event transformation, normalization | ~200 |
| `event-ingestor/index.ts` | Ingestor class, public API | ~100 |

**優先度**: Low (Q3)

### 1.3 src/domain/worker/opencode-session-executor.ts (820 lines)

**現状**: Session executor with 10 lifecycle operations for OpenCode execution.

**分割計画**:
| 新モジュール | 内容 | 行数見積 |
|---|---|---|
| `session-executor/execute.ts` | Session execution, polling, cancellation | ~300 |
| `session-executor/output.ts` | Output fetching, transcript handling | ~200 |
| `session-executor/artifacts.ts` | Artifact saving, cleanup | ~200 |
| `session-executor/index.ts` | Executor class, public API | ~100 |

**優先度**: Medium (Q2)

### 1.4 src/store/control-plane-store.ts (878 lines)

**現状**: Control plane store with 20 state operations for task/job/run management.

**分割計画**:
| 新モジュール | 内容 | 行数見積 |
|---|---|---|
| `store/tasks.ts` | Task CRUD, state transitions | ~250 |
| `store/jobs.ts` | Job management, retry logic | ~250 |
| `store/runs.ts` | Run tracking, result storage | ~200 |
| `store/events.ts` | Event recording, query | ~150 |
| `store/index.ts` | Store class, public API | ~50 |

**優先度**: Low (Q3)

### 1.5 関数数過多モジュール

| Module | Functions | 対応 |
|---|---|---|
| `src/domain/resolver/resolver-service.ts` | 35 | Resolve operations in submodule |
| `src/domain/task/task-update.ts` | 24 | Update operations per type |
| `src/domain/github-projects/graphql-queries.ts` | 24 | Query library acceptable |

## 2. TRY_CATCH_SWALLOW - 解消済み

### 2.1 src/infrastructure/opencode-session-executor.ts

**修正**: debug logging added in catch block (2026-05-02)

### 2.2 web/src/contexts/ThemeContext.tsx

**修正**: console.warn added in catch block (2026-05-02)

## 3. UNTESTED_CRITICAL_PATH - 解消済み

### 3.1 src/auth/auth-plugin.ts

**修正**: Test file moved to `test/auth/auth-plugin.test.ts` to match naming pattern (2026-05-02)

## 4. UNSAFE_DELETE - 妥当性確認済み

### 4.1 In-memory Map/Set.clear()

**判定**: False Positive
- All Map/Set.clear() operations are in-memory state reset for test/dev
- No database deletion involved

**対応**: 抑制設定 `.ctg/suppressions.yaml` で false positive 記録

## 5. ENV_DIRECT_ACCESS - 妥当性確認済み

### 5.1 VITEST environment variable

**判定**: Acceptable
- Test mode detection, not user input
- Safe usage for conditional test behavior

### 5.2 CORS_ORIGIN environment variable

**判定**: Acceptable
- Server configuration validated at startup
- No user input handling

## 6. 定期再評価

次回 code-to-gate 実行: 2026-06-02 (月次)

```bash
code-to-gate scan . --out .qh
code-to-gate analyze . --from .qh --out .qh --policy .ctg/policy.yaml
```