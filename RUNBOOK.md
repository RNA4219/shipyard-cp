# shipyard-cp RUNBOOK

## 目的

本書は、`shipyard-cp` を仕様段階から実装段階へ移す際の標準手順を定義する。実装の順番、確認ポイント、依存 OSS の確認箇所を固定し、着手時の迷いを減らすことを目的とする。

## 適用範囲

- `shipyard-cp` 本体
- `agent-taskstate` との state / typed_ref / context bundle 連携
- `memx-resolver` との docs resolve / ack / stale 連携
- `tracker-bridge-materials` との tracker link / sync event 連携

## 前提

- 要件定義の正本は [REQUIREMENTS.md](./REQUIREMENTS.md)
- 状態遷移の正本は [docs/state-machine.md](./docs/state-machine.md)
- API 契約の正本は [docs/api-contract.md](./docs/api-contract.md)
- 実行信頼性の補助仕様は [docs/execution-reliability.md](./docs/execution-reliability.md)
- lock / lease の補助仕様は [docs/lock-and-lease.md](./docs/lock-and-lease.md)
- 監査イベントの補助仕様は [docs/audit-events.md](./docs/audit-events.md)
- JSON Schema の正本は [docs/schemas](./docs/schemas)
- OpenAPI の正本は [docs/openapi.yaml](./docs/openapi.yaml)
- `published` を終端状態とする

## 追補仕様の参照先

実行信頼性追補を実装するときは、以下の補助仕様も正本群とセットで参照する。

- [docs/execution-reliability.md](./docs/execution-reliability.md)
  - retry / escalation policy
  - doom-loop detection
  - capability gate
  - concurrency control
- [docs/lock-and-lease.md](./docs/lock-and-lease.md)
  - task lock / resource lock
  - lease / heartbeat
  - orphan recovery
- [docs/audit-events.md](./docs/audit-events.md)
  - 監査イベント種別
  - retry / heartbeat / lock conflict の必須項目

使い分け:

- 状態遷移そのものは `docs/state-machine.md`
- API 入出力は `docs/api-contract.md`
- retry / lock / lease の運用ルールは上記 3 文書

## 実装前の確認手順

1. [docs/implementation-prep.md](./docs/implementation-prep.md) を読む
2. `docs/execution-reliability.md` / `docs/lock-and-lease.md` / `docs/audit-events.md` を読む
3. `agent-taskstate` の `typed_ref` と context bundle の前提を確認する
4. `memx-resolver` の resolve / ack / stale 入出力を確認する
5. `tracker-bridge-materials` の tracker link / sync event モデルを確認する
6. `openapi.yaml` と schema の差分がないか確認する
7. 実装対象マイルストーンを 1 つに絞る

## 実装順序

### Step 1. Task 入力境界 ✅ 完了 (2026-03-17)

対象:

- `POST /v1/tasks`
- `Task` schema
- `typed_ref` validation

確認事項:

- ✅ `objective` 必須
- ✅ `typed_ref` 必須 (4-segment canonical form: `^[a-z0-9_-]+:[a-z0-9_-]+:[a-z0-9_-]+:.+$`)
- ✅ `publish_plan` を保持できる
- ✅ `external_refs` を保持できる

### Step 2. resolver 接続 ✅ 完了 (2026-03-17)

対象:

- `POST /v1/tasks/{task_id}/docs/resolve`
- `POST /v1/tasks/{task_id}/docs/ack`
- `resolver_refs`

確認事項:

- ✅ `doc_refs` / `chunk_refs` / `contract_refs` を保持できる
- ✅ `ack_ref` を記録できる
- ⚠️ stale docs が acceptance gate に渡る (未実装: stale_status は保持のみ)

### Step 3. worker orchestration ✅ 完了 (2026-03-17)

対象:

- `POST /v1/tasks/{task_id}/dispatch`
- `POST /v1/tasks/{task_id}/results`
- `StateTransitionEvent`

確認事項:

- ✅ `WorkerJob` に resolver / tracker 文脈が流れる (`context` field)
- ✅ `WorkerResult` が `typed_ref` と `context_bundle_ref` を返せる
- ✅ 許可遷移外は拒否される (`ALLOWED_TRANSITIONS` map)

### Step 4. tracker 接続 ✅ 完了 (2026-03-17)

対象:

- `POST /v1/tasks/{task_id}/tracker/link`
- `external_refs`
- `sync_event_ref`

確認事項:

- ✅ tracker は正本でない (external_refs として参照を保持)
- ✅ `typed_ref` をキーに internal task と接続する
- ✅ `github_project_item` と tracker entity を併存できる

### Step 5. Integrate / Publish ✅ 完了 (2026-03-17)

対象:

- `POST /v1/tasks/{task_id}/integrate`
- `POST /v1/tasks/{task_id}/publish`

確認事項:

- ✅ `accepted -> integrating -> integrated -> publishing/publish_pending_approval -> published`
- ✅ high risk task では rollback notes を保持する
- ✅ Publish 承認は `publish_plan.approval_required` を正本にする

補足:

- 現行アプリ実装には `/integrate/complete`, `/publish/approve`, `/publish/complete` の補助エンドポイントがあるが、API 正本は `docs/api-contract.md` と `docs/openapi.yaml` を優先する

### Step 6. 実行信頼性追補 ✅ 完了 (2026-03-17)

対象:

- retry / escalation policy
- doom-loop detection
- lease / heartbeat / orphan recovery
- stage capability gate
- concurrency control / optimistic locking

確認事項:

- [x] worker-dispatched stages の `retry_policy`, `retry_count`, `failure_class` を schema / OpenAPI に追加する
- [x] `integrate` / `publish` の retry 情報を Control Plane run metadata として文書化する
- [x] `loop_fingerprint` の生成単位を `WorkerJob` と stage event で分離して仕様化する
- [x] `POST /v1/jobs/{job_id}/heartbeat` を API / OpenAPI / schema に追加する
- [x] **RetryManager** ドメイン実装 (25 tests) - failure_class分類、exponential backoff、stage別retry制限
- [x] **LeaseManager** ドメイン実装 (17 tests) - lease取得/解放、heartbeat、orphan検出
- [x] **ConcurrencyManager** ドメイン実装 (15 tests) - worker別/全体の同時実行制限、ジョブキュー
- [x] **CapabilityManager** ドメイン実装 (22 tests) - stage別capability要件、worker登録、検索
- [x] **DoomLoopDetector** ドメイン実装 (15 tests) - simple/complex/state_repeatループ検出
- [x] `POST /v1/jobs/{job_id}/heartbeat` endpoint実装
- [x] dispatch前 capability check実装
- [x] `developing` の worker job に lease / heartbeat導入
- [x] Concurrency control統合 (dispatch時にチェック、result適用時に解放)
- [x] `integrating` / `publishing` の進行監視を Control Plane 側で持つ
- [x] 孤児化時に `publish` は自動再実行せず `blocked` 優先にする
- [x] `integrate` / `publish` は worker capability ではなく policy gate で判定する
- [x] Task / resource lock と optimistic lock (`version`) を schema / OpenAPI へ反映する
- [x] `Task.version` のサーバ実装 (作成時0、更新時インクリメント)
- [x] `publish` の `idempotency_key` 必須を schema / OpenAPI に反映する
- [x] retry / lease / heartbeat / loop / capability / lock の監査イベントを仕様化する

実装メモ:

- `WorkerJob.stage` は `plan` / `dev` / `acceptance` のまま維持する
- `integrate` / `publish` は Control Plane run metadata へ寄せる
- `blocked` の再開先は `blocked_context.resume_state` を正本にする
- `publish_pending_approval` を飛ばす実装にしない

ドメインモジュール構成:

```
src/domain/
├── lease/              # LeaseManager, types (17 tests)
├── retry/              # RetryManager, types (25 tests)
├── concurrency/        # ConcurrencyManager, types (15 tests)
├── capability/         # CapabilityManager, types (22 tests)
├── doom-loop/          # DoomLoopDetector, types (15 tests)
├── risk/               # RiskAssessor, types (19 tests)
├── orphan/             # OrphanRecovery, types (18 tests)
├── repo-policy/        # RepoPolicyService, types (16 tests)
├── stale-check/        # StaleDocsValidator, types (12 tests)
├── side-effect/        # SideEffectAnalyzer, types (20 tests)
├── integration-check/  # BaseShaValidator, types (17 tests)
├── state-machine/      # StateMachine (18 tests)
├── state-mapping/      # Status mapping (30 tests)
├── task/               # TaskValidator (15 tests)
├── worker/             # WorkerPolicy, WorkerAdapter, CodexAdapter, ClaudeCodeAdapter (52 tests)
├── resolver/           # ResolverService (27 tests)
├── tracker/            # TrackerService (34 tests)
├── litellm/            # LiteLLMConnector (16 tests)
├── github-projects/    # GitHubProjectsClient, GitHubProjectsService (78 tests)
├── github-environments/# GitHubEnvironmentsService (24 tests)
├── context-bundle/     # ContextBundle, ContextBundleBuilder, ContextBundleService (27 tests)
├── context-rebuild/    # ContextRebuildService (26 tests)
└── workspace/          # WorkspaceManager (30 tests)
```

## 依存 OSS の確認ポイント

### agent-taskstate

- `typed_ref` の canonical form
- context bundle の参照形式
- state 正本との境界

### memx-resolver

- resolve の入力キー
- ack の書式
- stale 判定の返却形式
- contract refs の取り扱い

### tracker-bridge-materials

- entity link の入力
- sync event の返却形式
- tracker issue / project item / external refs の関係

## ブロッカー判定

以下のいずれかに該当した場合は、そのマイルストーンの実装を開始しない。

- `typed_ref` の形式が依存 OSS と一致しない
- resolver の返却モデルが schema と一致しない
- tracker link の返却モデルが `external_refs` に載らない
- state machine と API 契約の許可遷移がずれている
- OpenAPI と schema の差分が解消されていない

## 完了の定義

実装準備完了は、以下を満たした時点とする。

- 実装対象マイルストーンが 1 つに絞られている
- 依存 OSS の確認項目が埋まっている
- 対応する API 契約、schema、state machine の参照先が明示されている
- 実装順序が `Task -> resolver -> dispatch/results -> tracker -> integrate/publish` で共有されている

## 実装状況 (2026-03-17 時点)

| Step | 名称 | 状態 | 備考 |
|------|------|------|------|
| 1 | Task 入力境界 | ✅ 完了 | objective/typed_ref 必須、validation 実装済 |
| 2 | resolver 接続 | ✅ 完了 | docs/resolve, docs/ack エンドポイント実装済 |
| 3 | worker orchestration | ✅ 完了 | context連携、状態遷移validation実装済 |
| 4 | tracker 接続 | ✅ 完了 | tracker/link、external_refs連携実装済 |
| 5 | Integrate/Publish | ✅ 完了 | 承認フロー含む全エンドポイント実装済 |
| 6 | 実行信頼性追補 | ✅ 完了 | 5モジュール198テスト、heartbeat/capability/concurrency統合済 |

### 未実装・今後の課題

#### テスト未検証 (要外部サービス/APIキー)

| 項目 | 状態 | 必要な環境 |
|------|------|------------|
| GitHub Projects v2 ライブテスト | ✅ 検証完了 (2026-03-18) | GITHUB_TOKEN, GITHUB_OWNER, GITHUB_PROJECT_NUMBER |
| LiteLLM/OpenRouter テスト | ✅ 検証完了 (2026-03-18) | OPENROUTER_API_KEY or OPENAI_API_KEY |
| memx-resolver 連携テスト | ✅ 検証完了 (2026-03-18) | MEMX_RESOLVER_URL (サーバー起動必要) |
| tracker-bridge 連携テスト | ✅ 検証完了 (2026-03-18) | ライブラリテストのみ |

#### 未実装機能

| 項目 | 優先度 | 備考 |
|------|--------|------|
| ワーカーアダプタ | P1 | Codex/Claude Code/Antigravity接続 |
| LiteLLM連携 connector | P1 | 推論の標準経路、routing/fallback |
| GitHub Environments連携 | P1 | Publish承認フロー、deployment protection rules |
| 実際の memx-resolver connector | P2 | 外部サービス呼び出し実装 |
| 実際の tracker-bridge-materials connector | P2 | 外部サービス呼び出し実装 |
| context bundle詳細構造 | P2 | diagnostics, source refs, generator metadata |
| コンテナ作成・破棄 | P2 | Task-scoped workspace実体管理 |
| 高リスク時リセット機能 | P2 | workspace破棄→再作成 |

#### 完了済み (2026-03-17〜18)

- [x] テストコードの追加 (791 tests)
- [x] 実行信頼性追補のドメイン実装 (retry / lease / heartbeat / loop / capability)
- [x] 実行信頼性追補の統合実装 (dispatch連携、endpoint実装)
- [x] `POST /v1/jobs/{job_id}/heartbeat` のサーバ実装
- [x] optimistic lock (`version`) のサーバ実装
- [x] `blocked_context` の理由メタデータ拡張
- [x] OpenAPI / schema の文書更新
- [x] types.ts と schema の整合性修正
- [x] GitHub Projects v2 連携 (ドメイン実装のみ、ライブテスト未検証)

---

## 要件定義との整合性確認 (2026-03-17)

REQUIREMENTS.md との対比による実装状況を以下に示す。

### LiteLLM連携

| 要件 | 状態 | 備考 |
|------|------|------|
| 推論要求をLiteLLMに集約 | ✅ 完了 | LiteLLMConnector (16 tests) |
| model_alias, routing, fallback設定 | ✅ 完了 | modelAliases, fallbackModels設定対応 |
| 障害時はblocked、監査ログへ残す | ⚠️ 部分 | usage tracking実装、blocked連携未実装 |

### agent-taskstate連携

| 要件 | 状態 | 備考 |
|------|------|------|
| canonical typed_ref維持 | ✅ 完了 | 4セグメント形式 |
| context bundle (diagnostics, source refs等) | ✅ 完了 | ContextBundle / ContextBundleBuilder / ContextBundleService (20 tests) |
| state transition契約整合 | ✅ 完了 | ALLOWED_TRANSITIONS実装済 |

### memx-resolver連携

| 要件 | 状態 | 備考 |
|------|------|------|
| docs resolve要求 | ✅ 完了 | `/docs/resolve` エンドポイント |
| chunks get | ⚠️ 部分 | chunk_refs保持のみ |
| reads ack | ✅ 完了 | `/docs/ack` エンドポイント |
| stale check→blocked/rework判断 | ⚠️ 部分 | stale_status保持、判定ロジック未実装 |
| contract resolve | ⚠️ 部分 | contract_refs保持のみ |

### tracker-bridge-materials連携

| 要件 | 状態 | 備考 |
|------|------|------|
| issue cache取得 | ✅ 完了 | external_refs経由で保持、IssueCacheEntry型定義 |
| entity link | ✅ 完了 | `/tracker/link` 実装済 |
| sync event | ✅ 完了 | sync_event_ref生成 |
| context rebuild | ✅ 完了 | ContextRebuildService (23 tests) |

### ワーカー抽象・接続

| 要件 | 状態 | 備考 |
|------|------|------|
| WorkerJob/WorkerResult契約 | ✅ 完了 | types.ts定義済 |
| raw_outputs保持 | ✅ 完了 | フィールド追加済 |
| typed_ref 4セグメント | ✅ 完了 | validation実装済 |
| ワーカーアダプタインターフェース | ✅ 完了 | WorkerAdapter / BaseWorkerAdapter (17 tests) |
| job submit, status poll, cancel | ✅ 完了 | CodexAdapter / ClaudeCodeAdapter実装済 |
| artifact collect, escalation normalize | ✅ 完了 | 各アダプタで実装済 |
| リトライ可否判定 | ✅ 完了 | RetryManager.shouldRetry() - 統合済 |
| 自動フェイルオーバー (Planのみ許可) | ❌ 未実装 | |
| retry_count / failure_class保持 | ⚠️ 部分 | schema / OpenAPI 反映済、実装未反映 |
| loop_fingerprint保持 | ⚠️ 部分 | schema / 補助仕様反映済、実装未反映 |
| lease / heartbeat | ✅ 完了 | LeaseManager実装済、endpoint実装済 |
| Codex アダプタ | ✅ 完了 | CodexAdapter (19 tests) |
| Claude Code アダプタ | ✅ 完了 | ClaudeCodeAdapter (14 tests) |
| Antigravity アダプタ | ✅ 完了 | AntigravityAdapter (24 tests) |

### Publish要件

| 要件 | 状態 | 備考 |
|------|------|------|
| No-op/Dry-run/Applyモード | ✅ 完了 | modeフィールド |
| approval gate | ✅ 完了 | approval_required, approval_token |
| idempotency_key | ✅ 完了 | |
| 副作用カテゴリ分類 | ⚠️ 部分 | allowed_side_effect_categories定義済、判定未実装 |
| ネットワーク/ワークスペース外/-destructive検出 | ❌ 未実装 | |
| 孤児化時のblocked優先 | ❌ 未実装 | publish再実行抑止未実装 |

### PR無し運用 (Direct-to-main)

| 要件 | 状態 | 備考 |
|------|------|------|
| integration branchでCI確認 | ✅ 完了 | completeIntegrate.checks_passed |
| main更新はbotのみ | ⚠️ 仕様のみ | RepoPolicy未実装 |
| base SHA不変確認 | ⚠️ 部分 | main_updated_shaフィールドあり、判定未実装 |
| fast-forward by bot push | ⚠️ 部分 | フロー定義済、実行未実装 |
| RepoPolicy設定 | ❌ 未実装 | update_strategy, main_push_actor等 |
| integration_branch_prefix | ⚠️ 部分 | 固定値 `cp/integrate/` |
| resource lock / optimistic lock | ⚠️ 部分 | schema / OpenAPI 反映済、実装未反映 |

### Acceptance要件

| 要件 | 状態 | 備考 |
|------|------|------|
| Risk level (low/medium/high) | ✅ 完了 | risk_levelフィールド |
| リスク判定ロジック | ❌ 未実装 | 変更範囲、コア領域影響等の自動判定 |
| 強制high条件判定 | ❌ 未実装 | Secrets参照、ネットワーク許可等 |
| 手動検証チェックリスト | ❌ 未実装 | checklistフィールドなし |
| ログArtifact必須 | ⚠️ 仕様のみ | artifactsフィールドあり、必須判定なし |
| high-risk: regression suite必須 | ✅ 完了 | acceptanceでregression確認実装済 |
| high-risk: 追加手動チェック | ❌ 未実装 | |
| high-risk: rollback notes | ✅ 完了 | rollback_notesフィールド |

### 実行信頼性追補

| 要件 | 状態 | 備考 |
|------|------|------|
| stage別 max_retries | ✅ 完了 | RetryManager.getDefaultMaxRetries() - plan:2, dev:3, acceptance:1, integrate:2, publish:1 |
| retryable / non-retryable分類 | ✅ 完了 | RetryManager.classifyFailure() - transient/capacity/policy/logic |
| doom-loop warning / block | ✅ 完了 | DoomLoopDetector - simple/complex/state_repeat検出、統合済 |
| lease発行 | ✅ 完了 | LeaseManager.acquire() - dispatch時に発行 |
| heartbeat受信 | ✅ 完了 | POST /v1/jobs/{job_id}/heartbeat endpoint実装済 |
| orphan recovery | ⚠️ ドメイン実装済 | LeaseManager.detectOrphan() - 自動回復未実装 |
| capability gate | ✅ 完了 | CapabilityManager.validateCapabilities() - dispatch前判定実装済 |
| concurrency control | ✅ 完了 | ConcurrencyManager - dispatch/resultで統合済 |
| blocked_reason / resume_state拡張 | ✅ 完了 | resume_state, capability_missing, lock_conflict, loop_fingerprint, orphaned_run 追加 |
| task/resource lock | ✅ 完了 | ConcurrencyManager - 統合済 |
| optimistic locking (`version`) | ✅ 完了 | Task.version実装済、更新時に自動インクリメント |
| publish idempotency enforcement | ⚠️ 部分 | schema / OpenAPI 反映済、実装強制は未反映 |

### コンテナ実行基盤

| 要件 | 状態 | 備考 |
|------|------|------|
| Task-scoped workspace | ✅ 完了 | WorkspaceManager (30 tests) |
| Run間再利用 | ✅ 完了 | reusableフィールド、lease管理 |
| 高リスク時リセット | ✅ 完了 | resetWorkspace, shouldResetForRisk |
| user namespace等の隔離強化 | ✅ 完了 | WorkspaceIsolation interface |

### GitHub Projects v2連携

| 要件 | 状態 | 備考 |
|------|------|------|
| GraphQL API操作 | ✅ 完了 | GitHubProjectsClient実装 |
| item追加、フィールド更新 | ✅ 完了 | addProjectItem, updateItemField実装 |
| GitHub App認証 | ✅ 完了 | tokenType: 'github_app'対応 |
| PAT認証 | ✅ 完了 | tokenType: 'pat'対応 |

### GitHub Environments連携

| 要件 | 状態 | 備考 |
|------|------|------|
| deployment protection rules | ✅ 完了 | GitHubEnvironmentsService (24 tests) |
| Secrets保護連携 | ✅ 完了 | 環境シークレット管理API実装済 |
| approval workflow | ✅ 完了 | requestDeploymentApproval実装済 |
| branch policy check | ✅ 完了 | checkProtectionRules実装済 |

### 監査ログ

| 要件 | 状態 | 備考 |
|------|------|------|
| StateTransitionEvent記録 | ✅ 完了 | eventsマップ保持 |
| Publish/main更新/verdict記録 | ✅ 完了 | |
| LiteLLM usage, routing, fallback | ⚠️ 部分 | usage.litellmフィールドあり |
| memx resolver参照 | ⚠️ 部分 | resolver_refs保持 |
| context bundle生成メタデータ | ❌ 未実装 | |
| retry / lease / heartbeat / loop / capability / lock イベント | ⚠️ 部分 | 仕様 / schema 反映済、実装未反映 |

---

## 優先度付き実装TODO

### 🔴 P0: 要件でMust (次フェーズで優先)

1. **リスク判定ロジック** - ✅ 完了 (2026-03-17) - RiskAssessor ドメイン実装 (19 tests)
2. **手動検証チェックリスト** - ✅ 完了 (2026-03-17) - ManualChecklistItem type追加
3. **RepoPolicy** - ✅ 完了 (2026-03-17) - RepoPolicy type / RepoPolicyService 実装 (16 tests)
4. **GitHub Projects v2連携** - ✅ 完了 (2026-03-17) - GitHubProjectsClient / GitHubProjectsService 実装 (54 tests)
5. **実行信頼性統合** - ✅ 完了
   - ✅ dispatch前 capability check
   - ✅ developing に lease / heartbeat 導入
   - ✅ `POST /v1/jobs/{job_id}/heartbeat` endpoint実装
   - ✅ 孤児化時の blocked 優先処理 - OrphanRecovery ドメイン実装 (18 tests)

### 🟡 P1: Should実装

1. **ワーカーアダプタ** - ✅ 完了 (2026-03-18) - CodexAdapter (19 tests), ClaudeCodeAdapter (14 tests), AntigravityAdapter (24 tests)
2. **LiteLLM連携** - ✅ 完了 (2026-03-18) - LiteLLMConnector (16 tests)
3. **stale判定によるacceptance gate** - ✅ 完了 (2026-03-17) - StaleDocsValidator (12 tests)
4. **GitHub Environments連携** - ✅ 完了 (2026-03-18) - GitHubEnvironmentsService (24 tests)
5. **副作用カテゴリ検出** - ✅ 完了 (2026-03-17) - SideEffectAnalyzer (15 tests)
6. **base SHA不変確認ロジック** - ✅ 完了 (2026-03-17) - BaseShaValidator (14 tests)
7. ~~**optimistic lock (`version`)** - サーバ実装~~ ✅ 完了 (2026-03-17)

### 🟢 P2: 機能強化

1. **context bundle詳細構造** - ✅ 完了 (2026-03-18) - ContextBundle / ContextBundleBuilder / ContextBundleService (20 tests)
2. **コンテナ作成・破棄** - ✅ 完了 (2026-03-18) - WorkspaceManager (30 tests)
3. **高リスク時リセット機能** - ✅ 完了 (2026-03-18) - WorkspaceManager.resetWorkspace, shouldResetForRisk
4. **user namespace等の隔離強化** - ✅ 完了 (2026-03-18) - WorkspaceIsolation interface
5. **context rebuild** - ✅ 完了 (2026-03-18) - ContextRebuildService (23 tests) - tracker-bridge-materials連携

---

## テスト実行状況

```
npm test

 Test Files  37 passed | 1 skipped (38)
      Tests  802 passed | 15 skipped (817)
   Duration  ~3.5s
```

### ドメイン別テスト数

| Domain | Tests |
|--------|-------|
| github-projects (domain) | 55 |
| retry | 25 |
| state-mapping | 30 |
| workspace-manager | 30 |
| context-bundle | 27 |
| context-rebuild | 26 |
| capability | 22 |
| github-environments | 24 |
| side-effect | 20 |
| risk | 19 |
| codex-adapter | 19 |
| antigravity-adapter | 24 |
| state-machine | 18 |
| orphan | 18 |
| lease | 17 |
| worker-adapter | 17 |
| integration-check | 17 |
| github-projects (integration) | 17 (2 skipped) |
| resolver-service | 17 |
| claude-code-adapter | 16 |
| litellm-connector | 16 |
| tracker-bridge | 22 (1 skipped) |
| repo-policy | 16 |
| concurrency | 15 |
| doom-loop | 15 |
| task-validator | 15 |
| memx-resolver | 24 (0 skipped, verified 2026-03-18) |
| worker-policy | 13 |
| stale-check | 12 |
| tracker-service | 12 |
| policy-gate-integration | 31 |
| integrate-publish | 10 |
| resolver | 10 |
| litellm (integration) | 7 (0 skipped, verified 2026-03-18) |
| tracker | 5 |
| task | 7 |
| worker | 7 |
| full-flow | 3 |
| github-projects-live | 6 (6 skipped, verified 2026-03-18) |

### スキップテスト一覧

ライブテストは外部APIトークンが必要:

| Test File | Skipped | Required Env | Status |
|-----------|---------|--------------|--------|
| github-projects-live.test.ts | 6 | GITHUB_TOKEN, GITHUB_OWNER, GITHUB_PROJECT_NUMBER | ✅ 検証完了 |
| litellm-integration.test.ts | 0 | OPENROUTER_API_KEY or OPENAI_API_KEY | ✅ 検証完了 |
| memx-resolver-integration.test.ts | 0 | MEMX_RESOLVER_URL | ✅ 検証完了 |
| tracker-bridge-integration.test.ts | 1 | TRACKER_BRIDGE_URL | ✅ 型定義テストのみ |
| github-projects-integration.test.ts | 2 | GITHUB_TOKEN | |

---

## 仕様書・実装整合性確認 (2026-03-17)

Schema (docs/schemas/*.schema.json) と types.ts の整合性を確認し、以下の修正を実施。

### 修正内容

| 対象 | 修正前 | 修正後 |
|------|--------|--------|
| **Task.version** | 未実装 | `version: number` 追加、作成時0、更新時インクリメント |
| **TaskState** | `completed` が存在 | `completed` を削除 (schemaにない) |
| **BlockedContext** | 基本フィールドのみ | `capability_missing`, `lock_conflict`, `loop_fingerprint`, `orphaned_run` 追加、`waiting_on` enum拡張 |
| **WorkerJob** | retry/leaseフィールドなし | `retry_policy`, `retry_count`, `loop_fingerprint`, `lease_owner`, `lease_expires_at` 追加 |
| **WorkerResult** | failure_codeなし | `retry_count`, `failure_class`, `failure_code` 追加 |
| **RetryPolicy** | 未定義 | 新規インターフェース追加 |

### 整合性確認済み

- State Machine: 全52の許可遷移が `ALLOWED_TRANSITIONS` と完全一致
- ResolverRefs, PublishPlan, RepoRef, WorkspaceRef, ExternalRef: 完全一致

---

## OSS連携テスト (2026-03-17)

外部OSSとの連携テストを追加。APIキーは `llm_orch/.env` 等から読み込み。

### テストファイル

| ファイル | テスト数 | 説明 |
|----------|---------|------|
| `test/litellm-integration.test.ts` | 5 (2 live) | LiteLLM/OpenAI API連携 |
| `test/memx-resolver-integration.test.ts` | 14 (2 live) | memx-resolver docs/ack/stale |
| `test/tracker-bridge-integration.test.ts` | 16 (1 live) | tracker-bridge entity link |
| `test/github-projects-integration.test.ts` | 17 (2 live) | GitHub Projects v2 GraphQL |
| `test/github-projects-live.test.ts` | 6 (6 live) | GitHub Projects v2 実API操作 |

### ライブテスト実行方法

```bash
# LiteLLM/OpenAI API
export OPENAI_API_KEY=$(cat ../llm_orch/.env | grep OPENAI_API_KEY | cut -d= -f2)
npm test -- --run test/litellm-integration.test.ts

# memx-resolver (要サーバー起動)
export MEMX_RESOLVER_URL=http://localhost:8080
npm test -- --run test/memx-resolver-integration.test.ts

# GitHub Projects v2 (要PAT/GitHub App)
export GITHUB_TOKEN=ghp_xxx
export GITHUB_OWNER=your-org
export GITHUB_PROJECT_NUMBER=1
npm test -- --run test/github-projects-live.test.ts
```

### APIキー設定

APIキーは環境変数で管理してください：

- `OPENAI_API_KEY` - OpenAI API キー
- `GITHUB_TOKEN` - GitHub Personal Access Token (project scope required)
