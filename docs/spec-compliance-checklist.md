# shipyard-cp 仕様整合性チェックリスト

生成日: 2026-03-18

本書は、`Agent_tools` 配下のOSS仕様と`shipyard-cp`実装の整合性を検証するチェックリストである。

---

## 1. agent-taskstate 連携

### 1.1 タスク状態 (Task States)

**agent-taskstate 仕様 (MVP):**
| 状態 | 説明 |
|------|------|
| `proposed` | 未着手、要確認 |
| `ready` | 開始可能 |
| `in_progress` | 作業中 |
| `blocked` | ブロック中 |
| `review` | レビュー中 |
| `done` | 完了 |
| `cancelled` | キャンセル |

**shipyard-cp 実装状態:**
| 仕様状態 | 実装状態 | マッピング | 整合性 |
|----------|----------|------------|--------|
| `proposed` | `queued` | - | ⚠️ 名称不一致 |
| `ready` | `planning` | - | ⚠️ 名称不一致 |
| `in_progress` | `developing` | - | ⚠️ 名称不一致 |
| `blocked` | `blocked` | ✓ | ✅ 整合 |
| `review` | `accepting` | - | ⚠️ 名称不一致 |
| `done` | `published` | - | ⚠️ 名称不一致 |
| `cancelled` | `cancelled` | ✓ | ✅ 整合 |

**追加状態 (shipyard-cp固有):**
- `planned`, `dev_completed`, `accepted`, `integrating`, `integrated`, `publishing`, `publish_pending_approval`, `rework_required`, `failed`

**判定:** ⚠️ **要検討**
- shipyard-cpは工程分割（Plan/Dev/Acceptance/Integrate/Publish）のため状態が多い
- agent-taskstateの7状態にマッピング可能か確認が必要
- REQUIREMENTS.mdでは「internal task state 正本は agent-taskstate と整合」とある

**推奨:**
1. 状態マッピングテーブルを明文化
2. context bundle で agent-taskstate 状態に変換して渡す

### 1.2 状態遷移 (State Transitions)

**agent-taskstate 許可遷移:**
```
proposed -> ready
ready -> in_progress
in_progress -> blocked
blocked -> in_progress
in_progress -> review
review -> in_progress
review -> done
* -> cancelled
```

**shipyard-cp ALLOWED_TRANSITIONS:** 52遷移定義済み

**判定:** ⚠️ **要検討**
- 遷移数が大きく異なる
- agent-taskstateの「review必須」原則とshipyard-cpの工程分離の整合性

### 1.3 typed_ref 形式

**agent-taskstate 仕様:**
```
<domain>:<entity_type>:<provider>:<entity_id>
```

**例:**
- `agent-taskstate:task:local:task_01JABCDEF`
- `memx:evidence:local:ev_01JABCDEF`
- `tracker:issue:github:RNA4219/agent-taskstate#12`

**shipyard-cp 実装:**
- pattern: `^[a-z0-9_-]+:[a-z0-9_-]+:[a-z0-9_-]+:.+$`
- 例: `agent-taskstate:task:github:test123`

**判定:** ⚠️ **要調整**
- domain が `shipyard` vs `agent-taskstate`
- entity_type が `task` で一致
- provider 実装確認必要

**推奨:**
1. domain を `agent-taskstate` に統一するか、明示的なマッピング定義
2. `shipyard` domain は内部使用、外部連携時に変換

### 1.4 Context Bundle 構造

**agent-taskstate 必須フィールド:**
```json
{
  "bundle_id": "cb_01J...",
  "task_ref": "agent-taskstate:task:local:...",
  "purpose": "continue_work",
  "state_snapshot": {...},
  "decision_digest": [...],
  "open_question_digest": [...],
  "evidence_refs": [...],
  "artifact_refs": [...],
  "tracker_refs": [...],
  "raw_included": false,
  "source_refs": [...]
}
```

**shipyard-cp ContextBundle:**
```json
{
  "version": "1.0.0",
  "bundle_id": "ctx-...",
  "task_id": "...",
  "task": {...},
  "repository": {...},
  "workspace": {...},
  "documents": {...},
  "trackers": {...},
  "diagnostics": {...},
  "history": {...}
}
```

**判定:** ⚠️ **構造不一致**
- agent-taskstate: 目的志向（purpose, decision_digest, open_question_digest）
- shipyard-cp: データ志向（repository, workspace, diagnostics）

**推奨:**
1. `purpose` フィールド追加
2. `decision_digest`, `open_question_digest` 追加
3. `state_snapshot` 形式統一
4. `task_ref` を `typed_ref` 形式に統一

---

## 2. memx-resolver 連携

### 2.1 API エンドポイント

| API | 仕様 | 実装 | 整合性 |
|-----|------|------|--------|
| `POST /v1/docs:resolve` | ✓ | `/v1/tasks/{task_id}/docs/resolve` | ✅ |
| `POST /v1/chunks:get` | ✓ | - | ⚠️ 未実装 |
| `POST /v1/reads:ack` | ✓ | `/v1/tasks/{task_id}/docs/ack` | ✅ |
| `POST /v1/docs:stale-check` | ✓ | - | ⚠️ 未実装 |
| `POST /v1/contracts:resolve` | ✓ | - | ⚠️ 未実装 |
| `POST /v1/docs:ingest` | ✓ | - | ❌ 不要（Control Plane管轄外）|
| `POST /v1/docs:search` | ✓ | - | ⚠️ 未実装 |

### 2.2 ResolverRefs 構造

**memx-resolver 応答:**
```json
{
  "required": [{"doc_id": "...", "title": "...", "importance": "required"}],
  "recommended": [{"doc_id": "...", "importance": "recommended"}]
}
```

**shipyard-cp ResolverRefs:**
```typescript
interface ResolverRefs {
  doc_refs?: string[];
  chunk_refs?: string[];
  ack_refs?: string[];
  contract_refs?: string[];
  stale_status?: 'fresh' | 'stale' | 'unknown';
}
```

**判定:** ⚠️ **構造不一致**
- memx-resolver: importance階層構造
- shipyard-cp: フラットなref配列

**推奨:**
1. `importance` 分類を保持
2. `reason` フィールド追加
3. `top_chunks` 保持

### 2.3 Stale Check

**memx-resolver 仕様:**
- `POST /v1/docs:stale-check`
- 応答: `{stale: [{doc_id, previous_version, current_version, reason}]}`

**shipyard-cp 実装:**
- `stale_status` フィールドのみ保持
- stale check API未実装

**判定:** ⚠️ **未実装**
- stale判定→blocked/rework判断が未実装

### 2.4 Contract Resolve

**memx-resolver 仕様:**
```json
{
  "acceptance_criteria": [...],
  "forbidden_patterns": [...],
  "definition_of_done": [...],
  "dependencies": [...]
}
```

**shipyard-cp 実装:**
- `contract_refs` のみ保持

**判定:** ⚠️ **未実装**
- acceptance_criteria, forbidden_patterns 等の展開未実装

---

## 3. tracker-bridge-materials 連携

### 3.1 Entity Link

**仕様:**
```python
EntityLink:
  id: str
  local_ref: str      # agent-taskstate:task:local:...
  remote_ref: str     # tracker:issue:jira:PROJ-123
  link_role: str      # primary / related / duplicate / blocks / caused_by
  created_at: str
  updated_at: str
  metadata_json: str | None
```

**shipyard-cp 実装:**
- `POST /v1/tasks/{task_id}/tracker/link`
- `external_refs` で保持

**判定:** ✅ **概ね整合**
- `link_role` が未実装（要追加）
- `metadata_json` が未実装

### 3.2 Sync Event

**仕様:**
```python
SyncEvent:
  id: str
  tracker_connection_id: str
  direction: str           # inbound / outbound
  remote_ref: str
  local_ref: str | None
  event_type: str          # issue_created / issue_updated / ...
  fingerprint: str | None  # SHA256 for idempotency
  payload_json: str
  status: str              # pending / applied / failed / skipped
  occurred_at: str
  processed_at: str | None
```

**shipyard-cp 実装:**
```typescript
interface TrackerContext {
  sync_events: Array<{
    sync_id: string;
    source: string;
    timestamp: string;
  }>;
}
```

**判定:** ⚠️ **構造簡略化**
- `fingerprint`, `payload_json`, `status` 未保持
- `direction` 未保持

### 3.3 Issue Cache

**仕様:**
```python
IssueCache:
  id: str
  tracker_connection_id: str
  remote_issue_id: str
  remote_issue_key: str
  title: str
  status: str | None
  assignee: str | None
  labels_json: str | None
  raw_json: str           # Full original API response
  last_seen_at: str
```

**shipyard-cp 実装 (ContextRebuildService):**
```typescript
interface IssueCacheEntry {
  issue_id: string;
  provider: string;
  title: string;
  state: string;
  labels?: string[];
  cached_at: string;
  etag?: string;
}
```

**判定:** ✅ **概ね整合**
- `raw_json` 未保持（要検討）
- `last_seen_at` vs `cached_at` 名称相違

### 3.4 Context Rebuild

**仕様:**
```python
rebuild_context(
    purpose: str,          # resume / handoff / checkpoint / audit
    source_refs: Sequence[str],
    include_raw: bool,
    raw_triggers: list[str] | None,
    decision_digest: str | None,
    open_question_digest: str | None,
) -> tuple[bundle_id, ResolveReport, ResolverDiagnostics]
```

**shipyard-cp 実装:**
```typescript
rebuildContext(request: ContextRebuildRequest): Promise<RebuiltContext>
```

**判定:** ⚠️ **引数不一致**
- `purpose` 未実装
- `decision_digest`, `open_question_digest` 未実装
- 戻り値構造が異なる

---

## 4. チェックリスト

### 4.1 agent-taskstate 整合性

- [x] 状態マッピングテーブル作成 ✅ (2026-03-18) - `src/domain/state-machine/state-mapping.ts`
- [x] typed_ref domain 統一方針決定 ✅ (2026-03-18) - `agent-taskstate` に統一
- [x] ContextBundle に `purpose` 追加 ✅ (2026-03-18)
- [x] ContextBundle に `decision_digest` 追加 ✅ (2026-03-18)
- [x] ContextBundle に `open_question_digest` 追加 ✅ (2026-03-18)
- [x] ContextBundle に `state_snapshot` 追加 ✅ (2026-03-18)
- [x] `task_ref` を `typed_ref` 形式に統一 ✅ (2026-03-18)
- [ ] 遷移理由 (`reason`) の必須化確認

### 4.2 memx-resolver 整合性

- [x] `POST /v1/chunks:get` 相当実装 ✅ (2026-03-18) - ResolverService.getChunks()
- [x] `POST /v1/docs:stale-check` 実装 ✅ (2026-03-18)
- [x] `POST /v1/contracts:resolve` 実装 ✅ (2026-03-18) - ResolverService.resolveContracts()
- [x] ResolverRefs に `importance` 追加 ✅ (2026-03-18)
- [x] ResolverRefs に `reason` 追加 ✅ (2026-03-18)
- [x] stale check → blocked/rework 判定ロジック ✅ (2026-03-18) - determineStaleAction()
- [x] acceptance_criteria / forbidden_patterns 展開 ✅ (2026-03-18) - expandContractCriteria()

### 4.3 tracker-bridge-materials 整合性

- [x] EntityLink に `link_role` 追加 ✅ (2026-03-18)
- [x] EntityLink に `metadata_json` 追加 ✅ (2026-03-18)
- [x] SyncEvent に `fingerprint` 追加 ✅ (2026-03-18)
- [x] SyncEvent に `direction` 追加 ✅ (2026-03-18)
- [x] SyncEvent に `status` 追加 ✅ (2026-03-18)
- [x] IssueCache に `raw_json` 保持 ✅ (2026-03-18)
- [x] ContextRebuild に `purpose` 追加 ✅ (2026-03-18)
- [x] ContextRebuild に `decision_digest` / `open_question_digest` 追加 ✅ (2026-03-18)

### 4.4 その他

- [x] typed_ref の domain 命名規則統一 ✅ (2026-03-18)
- [x] 4セグメント形式の検証強化 ✅ (2026-03-18) - typed-ref-utils.ts
- [x] canonical form 変換ユーティリティ ✅ (2026-03-18) - normalizeTypedRef()

---

## 5. 優先順位付き修正項目

### P0: 必須（仕様契約に関わる） ✅ 完了

1. [x] **typed_ref domain 統一** - `agent-taskstate` と整合
2. [x] **ContextBundle purpose フィールド追加** - agent-taskstate と整合

### P1: 推奨（運用効率に関わる） ✅ 完了

1. [x] **stale check API実装** ✅ - memx-resolver 連携
2. [x] **EntityLink link_role 追加** ✅ - 関係性分類
3. [x] **状態マッピングテーブル作成** ✅ (2026-03-18) - 17状態↔7状態マッピング実装

### P2: 機能強化 ✅ 完了

1. [x] chunks:get API ✅ (2026-03-18)
2. [x] contracts:resolve API ✅ (2026-03-18)
3. [x] decision_digest / open_question_digest ✅ (2026-03-18) - ContextBundle
4. [x] SyncEvent fingerprint/direction/status ✅ (2026-03-18)
5. [x] ResolverRefs importance/reason ✅ (2026-03-18)
6. [x] typed_ref validation utilities ✅ (2026-03-18)

---

## 6. 検証方法

### 6.1 自動テスト

```bash
# typed_ref 形式検証
npm test -- --run test/task-validator.test.ts

# ContextBundle 構造検証
npm test -- --run test/context-bundle.test.ts

# 外部連携検証
npm test -- --run test/memx-resolver-integration.test.ts
npm test -- --run test/tracker-bridge-integration.test.ts
```

### 6.2 手動検証

1. agent-taskstate との実際の接続確認
2. context bundle の相互運用性確認
3. typed_ref の解決確認

---

## 更新履歴

| 日付 | 内容 |
|------|------|
| 2026-03-18 | 初版作成 |
| 2026-03-18 | P0/P1項目完了: typed_ref統一, purpose追加, stale check, link_role, 状態マッピング |
| 2026-03-18 | P2項目完了: chunks:get, contracts:resolve, SyncEvent拡張, typed_ref utilities |
| 2026-03-18 | 全チェックリスト項目完了: determineStaleAction, expandContractCriteria, IssueCache raw_json |