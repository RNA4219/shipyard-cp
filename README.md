# shipyard-cp

LiteLLM を推論ゲートウェイ、Codex / Claude Code / Google Antigravity をワーカーとして扱う AI orchestration control plane。

## 概要

`shipyard-cp` は、AIエージェントによるタスク実行を管理するコントロールプレーンです。以下の機能を提供します：

- **タスク管理**: 作成、状態遷移、結果収集
- **ワーカーオーケストレーション**: Codex / Claude Code / Antigravity へのジョブディスパッチ
- **推論ゲートウェイ**: LiteLLM 経由での LLM 推論集約
- **GitHub連携**: Projects v2、Environments、Deployment Protection
- **実行信頼性**: Retry、Lease、Heartbeat、Doom-loop検出、Capability Gate

## セットアップ

```bash
npm install
npm run dev
```

`GET /healthz` で疎通確認。`GET /openapi.yaml` で OpenAPI を返す。

## テスト実行

```bash
npm test
```

現在のテスト状況:
```
Test Files  36 passed | 1 skipped (37)
Tests       624 passed | 13 skipped (637)
Duration    ~3.5s
```

スキップテストは外部APIトークンが必要なライブテストです。
GitHub Projects v2 ライブテストは新規トークンで検証完了済み（6/6 passed）。

## ドキュメント

- [REQUIREMENTS.md](./REQUIREMENTS.md): 要件定義
- [RUNBOOK.md](./RUNBOOK.md): 実装着手手順・進捗管理
- [docs/state-machine.md](./docs/state-machine.md): 状態遷移仕様
- [docs/api-contract.md](./docs/api-contract.md): API 契約
- [docs/execution-reliability.md](./docs/execution-reliability.md): 実行信頼性補助仕様
- [docs/lock-and-lease.md](./docs/lock-and-lease.md): lock / lease / heartbeat 詳細
- [docs/audit-events.md](./docs/audit-events.md): 監査イベント種別
- [docs/openapi.yaml](./docs/openapi.yaml): OpenAPI 3.1 仕様
- [docs/schemas/](./docs/schemas/): JSON Schema 一覧

## 実装状況

### Step 1-6: 完了 (2026-03-17〜18)

| Step | 名称 | 状態 |
|------|------|------|
| 1 | Task 入力境界 | ✅ 完了 |
| 2 | resolver 接続 | ✅ 完了 |
| 3 | worker orchestration | ✅ 完了 |
| 4 | tracker 接続 | ✅ 完了 |
| 5 | Integrate/Publish | ✅ 完了 |
| 6 | 実行信頼性追補 | ✅ 完了 |

### 優先度別完了項目

**P0 (Must)**: 全て完了
- RiskAssessor, ManualChecklistItem, RepoPolicy, GitHub Projects v2連携, 実行信頼性統合

**P1 (Should)**: 全て完了
- WorkerAdapter (Codex/Claude Code), LiteLLM連携, StaleDocsValidator, GitHub Environments, SideEffectAnalyzer, BaseShaValidator

**P2 (機能強化)**: 全て完了
- Context Bundle, Workspace Manager, 高リスク時リセット, 隔離強化, Context Rebuild

## ドメインモジュール

```
src/domain/
├── lease/              # LeaseManager (17 tests)
├── retry/              # RetryManager (25 tests)
├── concurrency/        # ConcurrencyManager (15 tests)
├── capability/         # CapabilityManager (22 tests)
├── doom-loop/          # DoomLoopDetector (15 tests)
├── risk/               # RiskAssessor (19 tests)
├── orphan/             # OrphanRecovery (18 tests)
├── repo-policy/        # RepoPolicyService (16 tests)
├── stale-check/        # StaleDocsValidator (12 tests)
├── side-effect/        # SideEffectAnalyzer (20 tests)
├── integration-check/  # BaseShaValidator (17 tests)
├── state-machine/      # StateMachine (18 tests)
├── state-mapping/      # Status mapping (30 tests)
├── task/               # TaskValidator (15 tests)
├── worker/             # WorkerAdapter, CodexAdapter, ClaudeCodeAdapter (52 tests)
├── resolver/           # ResolverService (27 tests)
├── tracker/            # TrackerService (34 tests)
├── litellm/            # LiteLLMConnector (16 tests)
├── github-projects/    # GitHubProjectsClient, GitHubProjectsService (78 tests)
├── github-environments/# GitHubEnvironmentsService (24 tests)
├── context-bundle/     # ContextBundle, ContextBundleService (27 tests)
├── context-rebuild/    # ContextRebuildService (26 tests)
└── workspace/          # WorkspaceManager (30 tests)
```

## API エンドポイント

### Task 管理
- `POST /v1/tasks` - タスク作成
- `GET /v1/tasks/{task_id}` - タスク取得
- `GET /v1/tasks` - タスク一覧

### Document Resolver
- `POST /v1/tasks/{task_id}/docs/resolve` - ドキュメント解決
- `POST /v1/tasks/{task_id}/docs/ack` - ドキュメント確認

### Worker Orchestration
- `POST /v1/tasks/{task_id}/dispatch` - ワーカーディスパッチ
- `POST /v1/tasks/{task_id}/results` - 結果受信
- `POST /v1/jobs/{job_id}/heartbeat` - ハートビート

### Tracker 連携
- `POST /v1/tasks/{task_id}/tracker/link` - トラッカー連携

### Integrate / Publish
- `POST /v1/tasks/{task_id}/integrate` - 統合開始
- `POST /v1/tasks/{task_id}/publish` - 公開開始

## 依存 OSS

- **agent-taskstate**: internal task state / typed_ref / context bundle の正本
- **memx-resolver**: docs resolve / chunks / ack / stale / contract resolve
- **tracker-bridge-materials**: tracker issue / project item / sync event / entity link

## 環境変数

| 変数名 | 用途 |
|--------|------|
| `GITHUB_TOKEN` | GitHub API 認証 (PAT or GitHub App) |
| `OPENAI_API_KEY` | LiteLLM/OpenAI API |
| `MEMX_RESOLVER_URL` | memx-resolver サーバーURL |
| `TRACKER_BRIDGE_URL` | tracker-bridge サーバーURL |

## 今後の実装予定

- Antigravity アダプタ (Google Antigravity)
- 自動フェイルオーバー (Planのみ許可)
- 孤児化時の publish 再実行抑止
- ネットワーク/ワークスペース外/destructive検出