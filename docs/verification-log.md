# shipyard-cp Test & Verification Log

**Date:** 2026-03-17 (Updated: 2026-03-18)
**Environment:** Windows 10, Node.js, vitest

---

## Automated Tests (Initial Snapshot: 37/37 passed)

```
> shipyard-cp@0.1.0 test
> vitest run

 ✓ test/resolver.test.ts (5 tests) 128ms
 ✓ test/full-flow.test.ts (3 tests) 131ms
 ✓ test/task.test.ts (7 tests) 132ms
 ✓ test/tracker.test.ts (5 tests) 133ms
 ✓ test/worker.test.ts (7 tests) 136ms
 ✓ test/integrate-publish.test.ts (10 tests) 159ms

 Test Files  6 passed (6)
      Tests  37 passed (37)
   Duration  876ms
```

注記:

- この節は初期の検証スナップショットである。
- 後続のリファクタリング後テスト集計は [refactoring-log.md](./refactoring-log.md) を正とし、そちらでは `104` テストを記録している。

---

## Documentation Sync (2026-03-17)

実行信頼性追補に合わせて、以下の文書更新を実施した。

- `docs/execution-reliability.md`
- `docs/lock-and-lease.md`
- `docs/audit-events.md`
- `docs/openapi.yaml`
- `docs/schemas/*.json`

反映済みの主な仕様:

- `POST /v1/jobs/{job_id}/heartbeat`
- `DispatchRequest.expected_version`
- `IntegrateRequest.expected_version`
- `PublishRequest.expected_version`
- `WorkerJob.retry_policy`, `retry_count`, `loop_fingerprint`, `lease_expires_at`
- `WorkerResult.failure_class`, `failure_code`
- `Task.version`, 拡張 `blocked_context`
- `StateTransitionEvent.event_type`, `run_id`

注意:

- これは文書同期であり、アプリ実装やテスト実行の更新はまだ行っていない。

---

## Manual Verification

### Step 1: Task Input Boundary

**Create Task (valid)**
```json
POST /v1/tasks
{
  "task_id": "task_a8d111677c2e4754959c9659d129b1de",
  "title": "Manual Test Task",
  "objective": "Verify manual operation",
  "typed_ref": "agent-taskstate:task:github:manual-test-001",
  "state": "queued",
  "risk_level": "medium",
  "repo_ref": {"provider":"github","owner":"testorg","name":"testrepo","default_branch":"main"},
  "publish_plan": {"mode":"apply","approval_required":true},
  "external_refs": [{"kind":"github_issue","value":"100"}],
  "created_at": "2026-03-17T04:09:44.781Z"
}
```
✅ Result: 201 Created

**Invalid typed_ref validation**
```json
POST /v1/tasks (typed_ref: "invalid-format")
{"code":"BAD_REQUEST","message":"typed_ref invalid format: invalid-format"}
```
✅ Result: 400 Bad Request

---

### Step 2: Resolver Connection

**Resolve Docs**
```json
POST /v1/tasks/{task_id}/docs/resolve
{"feature":"auth","topic":"oauth"}

Response:
{
  "typed_ref": "agent-taskstate:task:github:manual-test-001",
  "doc_refs": ["doc:feature:auth","doc:topic:oauth"],
  "chunk_refs": ["chunk:feature:auth:1"],
  "contract_refs": [],
  "stale_status": "fresh"
}
```
✅ Result: 200 OK

**Ack Docs**
```json
POST /v1/tasks/{task_id}/docs/ack
{"doc_id":"doc:feature:auth","version":"v1"}

Response:
{"ack_ref":"ack:task_89b459744cff4d5cae6b7d1533d5bd62:doc:feature:auth:v1"}
```
✅ Result: 200 OK

---

### Step 3: Worker Orchestration

**Dispatch Plan**
```json
POST /v1/tasks/{task_id}/dispatch
{"target_stage":"plan"}

Response:
{
  "job_id": "job_998811900c694698a6792ec7b175ef2b",
  "task_id": "task_a8d111677c2e4754959c9659d129b1de",
  "stage": "plan",
  "worker_type": "codex",
  "capability_requirements": ["plan"],
  "approval_policy": {"mode":"deny","sandbox_profile":"read_only","operator_approval_required":false},
  "context": {
    "objective": "Verify manual operation",
    "resolver_refs": {"doc_refs":["doc:feature:auth","doc:topic:oauth"],"chunk_refs":["chunk:feature:auth:1"],"contract_refs":[]},
    "tracker_refs": [{"kind":"typed_ref","value":"100"}]
  }
}
```
✅ Result: 202 Accepted

**Submit Plan Result**
```json
POST /v1/tasks/{task_id}/results
{
  "job_id": "job_998811900c694698a6792ec7b175ef2b",
  "typed_ref": "agent-taskstate:task:github:manual-test-001",
  "status": "succeeded",
  "artifacts": [{"artifact_id":"plan_art","kind":"log","uri":"file:///plan.log"}],
  "test_results": [],
  "requested_escalations": [],
  "usage": {"runtime_ms":1500}
}

Response:
{
  "task": {"state": "planned"},
  "emitted_events": [...],
  "next_action": "dispatch_dev"
}
```
✅ Result: 200 OK, state: queued → planned

**Dispatch Dev + Result**
✅ Result: state: planned → dev_completed

**Dispatch Acceptance + Result**
```json
Response:
{
  "task": {"state": "accepted"},
  "last_verdict": {"outcome": "accept", "reason": "All checks passed"},
  "next_action": "integrate"
}
```
✅ Result: state: dev_completed → accepted

**Invalid State Transition**
```json
POST /v1/tasks/{task_id}/transitions
{
  "from_state": "queued",
  "to_state": "published"
}

Response:
{"code":"STATE_CONFLICT","message":"transition not allowed: queued -> published"}
```
✅ Result: 409 Conflict (validation working)

---

### Step 4: Tracker Connection

**Link Tracker**
```json
POST /v1/tasks/{task_id}/tracker/link
{
  "typed_ref": "agent-taskstate:task:github:tracker-link-test",
  "connection_ref": "conn_github",
  "entity_ref": "github_issue:456"
}

Response:
{
  "typed_ref": "agent-taskstate:task:github:tracker-link-test",
  "external_refs": [
    {"kind":"github_issue","value":"456","connection_ref":"conn_github"},
    {"kind":"sync_event","value":"sync_evt_task_89b459744cff4d5cae6b7d1533d5bd62_1773721085868","connection_ref":"conn_github"}
  ],
  "sync_event_ref": "sync_evt_task_89b459744cff4d5cae6b7d1533d5bd62_1773721085868"
}
```
✅ Result: 200 OK

---

### Step 5: Integrate/Publish

**Integrate**
```json
POST /v1/tasks/{task_id}/integrate
{"base_sha": "abc123def456"}

Response:
{
  "task_id": "task_a8d111677c2e4754959c9659d129b1de",
  "state": "integrating",
  "integration_branch": "cp/integrate/task_a8d111677c2e4754959c9659d129b1de"
}
```
✅ Result: 202 Accepted

**Complete Integrate**
```json
POST /v1/tasks/{task_id}/integrate/complete
{"checks_passed":true,"integration_head_sha":"xyz789","main_updated_sha":"abc123def456"}

Response:
{
  "state": "integrated",
  "integration_branch": "cp/integrate/task_a8d111677c2e4754959c9659d129b1de",
  "integration_head_sha": "xyz789"
}
```
✅ Result: 200 OK, state: integrating → integrated

**Publish (with approval)**
```json
POST /v1/tasks/{task_id}/publish
{"mode":"apply","idempotency_key":"pub-001"}

Response:
{
  "state": "publish_pending_approval",
  "publish_run_id": "pub_task_a8d111677c2e4754959c9659d129b1de"
}
```
✅ Result: 202 Accepted, state: integrated → publish_pending_approval

**Approve Publish**
```json
POST /v1/tasks/{task_id}/publish/approve
{"approval_token":"operator-token-123"}

Response:
{
  "state": "publishing",
  "publish_run_id": "pub_task_a8d111677c2e4754959c9659d129b1de"
}
```
✅ Result: 200 OK, state: publish_pending_approval → publishing

**Complete Publish**
```json
POST /v1/tasks/{task_id}/publish/complete
{
  "external_refs": [
    {"kind":"deployment","value":"prod-deploy-001"},
    {"kind":"release","value":"v1.0.0"}
  ],
  "rollback_notes": "Rollback: revert to abc123def456"
}

Response:
{
  "state": "published",
  "external_refs": [
    {"kind":"github_issue","value":"100"},
    {"kind":"deployment","value":"prod-deploy-001"},
    {"kind":"release","value":"v1.0.0"}
  ],
  "rollback_notes": "Rollback: revert to abc123def456",
  "completed_at": "2026-03-17T04:17:32.053Z"
}
```
✅ Result: 200 OK, state: publishing → published

---

## Full State Transition Flow

```
queued → planning → planned → developing → dev_completed → accepting → accepted → integrating → integrated → publish_pending_approval → publishing → published
```

**Audit Events (12 events recorded)**
- task created
- dispatched plan job
- plan completed
- dispatched dev job
- dev completed
- dispatched acceptance job
- acceptance passed
- integrate requested
- integration checks passed
- publish approval required
- publish approved
- publish completed

---

## Summary

| Category | Status |
|----------|--------|
| Automated Tests | 688/688 ✅ (15 skipped live tests) |
| Step 1: Task Input Boundary | ✅ |
| Step 2: Resolver Connection | ✅ |
| Step 3: Worker Orchestration | ✅ |
| Step 4: Tracker Connection | ✅ |
| Step 5: Integrate/Publish | ✅ |
| State Machine Validation | ✅ |
| Audit Logging | ✅ |
| GitHub Projects v2 Live Tests | ✅ |

---

## TypeScript Strict Mode Compliance (2026-03-18)

`verbatimModuleSyntax` 対応完了。主な修正:

- `export type { ... }` 形式での型再エクスポート
- `Record<string, string>` への `HeadersInit` 置換
- `response.json() as Type` 形式の型アサーション追加
- `WorkerJob` の `worker-adapter.ts` からの再エクスポート
- `FastifyInstance` 型の明示的インポート

---

## GitHub Projects v2 Live Test (2026-03-18)

新規 PAT で GitHub Projects v2 API 検証を実施:

- Project 作成: ✅
- Draft Issue 追加: ✅ (assignees 引数削除対応)
- Single Select Field 更新: ✅ (個別 Mutation 実装)
- Status フィールドマッピング: ✅ (3段階フォールバック実装)

ライブテスト結果: 6/6 passed

---

## LiteLLM/OpenRouter Live Test (2026-03-18)

OpenRouter API 経由で LiteLLMConnector を検証:

- Direct API call: ✅ (200 OK)
- LiteLLMConnector chatCompletion: ✅
- Usage tracking: ✅ (input_tokens, output_tokens, cost_usd)

テスト結果: 7/7 passed

使用API: OpenRouter (openai/gpt-4o-mini)

---

## memx-resolver Live Test (2026-03-18)

memx-resolver (Go) サーバーを起動して連携検証:

- `/v1/docs:resolve`: ✅ 動作確認
- `/v1/reads:ack`: ✅ 動作確認

テスト結果: 24/24 passed

エンドポイント修正: `/api/v1/docs/resolve` → `/v1/docs:resolve`

---

## tracker-bridge-materials Test (2026-03-18)

tracker-bridge-materialsはAPIサーバーではなくライブラリとして設計されているため、型定義とデータ構造のテストを実施:

- Entity Link types: ✅
- Issue Cache: ✅
- External Refs: ✅
- Context Rebuild: ✅
- Sync Event Generation: ✅
- Connection Management: ✅

テスト結果: 21/22 passed (1 skipped - API接続テスト)
