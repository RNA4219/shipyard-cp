# shipyard-cp

LiteLLM を推論ゲートウェイ、Codex / Claude Code / Google Antigravity をワーカーとして扱う AI orchestration control plane。

## 概要

`shipyard-cp` は、AIエージェントによるタスク実行を管理するコントロールプレーンです。以下の機能を提供します：

- **タスク管理**: 作成、状態遷移、結果収集
- **ワーカーオーケストレーション**: Codex / Claude Code / Antigravity へのジョブディスパッチ
- **推論ゲートウェイ**: LiteLLM 経由での LLM 推論集約
- **GitHub連携**: Projects v2、Environments、Deployment Protection
- **実行信頼性**: Retry、Lease、Heartbeat、Doom-loop検出、Capability Gate
- **Web UI**: VS Code風ダッシュボード、リアルタイム更新

## セットアップ

```bash
npm install
npm run dev
```

`GET /healthz` で疎通確認。`GET /openapi.yaml` で OpenAPI を返す。

## Docker Compose での実行

```bash
docker compose up --build
```

- **UI**: http://localhost:8080
- **API**: http://localhost:3000

## テスト実行

```bash
npm test
```

現在のテスト状況:
```
Test Files  65 passed | 1 skipped (66)
Tests       1266 passed | 15 skipped (1281)
Duration    ~8s
```

スキップテストは外部APIトークンが必要なライブテストです。
- GitHub Projects v2 ライブテスト: 検証完了 (6/6 passed)
- LiteLLM/OpenRouter テスト: 検証完了 (7/7 passed)
- memx-resolver 連携テスト: 検証完了 (24/24 passed)

## ドキュメント

- [REQUIREMENTS.md](./REQUIREMENTS.md): 要件定義
- [RUNBOOK.md](./RUNBOOK.md): 実装着手手順・進捗管理
- [docs/state-machine.md](./docs/state-machine.md): 状態遷移仕様
- [docs/api-contract.md](./docs/api-contract.md): API 契約
- [docs/execution-reliability.md](./docs/execution-reliability.md): 実行信頼性補助仕様
- [docs/lock-and-lease.md](./docs/lock-and-lease.md): lock / lease / heartbeat 詳細
- [docs/audit-events.md](./docs/audit-events.md): 監査イベント種別
- [docs/ADR/README.md](./docs/ADR/README.md): 主要なアーキテクチャ判断 (ADR)
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

### Phase A-D: 完了 (2026-03-19〜20)

| Phase | 名称 | 状態 |
|-------|------|------|
| A | Run 可視化 (Read Model) | ✅ 完了 |
| B | Git Checkpoint 記録 | ✅ 完了 |
| C | Retrospective 生成 | ✅ 完了 |
| D | UI / Dashboard | ✅ 完了 |

### 優先度別完了項目

**P0 (Must)**: 全て完了
- RiskAssessor, ManualChecklistItem, RepoPolicy, GitHub Projects v2連携, 実行信頼性統合

**P1 (Should)**: 全て完了
- WorkerAdapter (Codex/Claude Code/Antigravity), LiteLLM連携, StaleDocsValidator, GitHub Environments, SideEffectAnalyzer, BaseShaValidator

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
├── worker/             # WorkerAdapter, CodexAdapter, ClaudeCodeAdapter, AntigravityAdapter (76 tests)
├── resolver/           # ResolverService (27 tests)
├── tracker/            # TrackerService (34 tests)
├── litellm/            # LiteLLMConnector (16 tests)
├── github-projects/    # GitHubProjectsClient, GitHubProjectsService (78 tests)
├── github-environments/# GitHubEnvironmentsService (24 tests)
├── context-bundle/     # ContextBundle, ContextBundleService (27 tests)
├── context-rebuild/    # ContextRebuildService (26 tests)
├── workspace/          # WorkspaceManager (30 tests)
├── run/                # RunService, RunTimeoutService (27 tests)
├── checkpoint/         # CheckpointService (17 tests)
├── retrospective/      # RetrospectiveService (19 tests)
├── acceptance/         # AcceptanceService (18 tests)
├── result/             # ResultOrchestrator (22 tests)
├── dispatch/           # DispatchOrchestrator (11 tests)
├── integration/        # IntegrationOrchestrator (15 tests)
└── publish/            # PublishOrchestrator (14 tests)
```

## API エンドポイント

### Task 管理
- `POST /v1/tasks` - タスク作成
- `GET /v1/tasks` - タスク一覧
- `GET /v1/tasks/{task_id}` - タスク取得
- `POST /v1/tasks/{task_id}/dispatch` - ワーカーディスパッチ
- `POST /v1/tasks/{task_id}/results` - 結果受信
- `POST /v1/tasks/{task_id}/cancel` - タスクキャンセル

### Run 管理
- `GET /v1/runs` - Run一覧
- `GET /v1/runs/{run_id}` - Run詳細
- `GET /v1/runs/{run_id}/timeline` - 状態遷移タイムライン
- `GET /v1/runs/{run_id}/audit-summary` - 監査サマリー
- `GET /v1/runs/{run_id}/checkpoints` - チェックポイント一覧
- `GET /v1/runs/{run_id}/retrospective` - Retrospective取得

### Document Resolver
- `POST /v1/tasks/{task_id}/docs/resolve` - ドキュメント解決
- `POST /v1/tasks/{task_id}/docs/ack` - ドキュメント確認
- `POST /v1/chunks:get` - チャンク取得
- `POST /v1/contracts:resolve` - コントラクト解決

### Worker Orchestration
- `POST /v1/jobs/{job_id}/heartbeat` - ハートビート

### Tracker 連携
- `POST /v1/tasks/{task_id}/tracker/link` - トラッカー連携

### Integrate / Publish
- `POST /v1/tasks/{task_id}/integrate` - 統合開始
- `POST /v1/tasks/{task_id}/integrate/complete` - 統合完了
- `POST /v1/tasks/{task_id}/publish` - 公開開始
- `POST /v1/tasks/{task_id}/publish/approve` - 公開承認
- `POST /v1/tasks/{task_id}/publish/complete` - 公開完了

### WebSocket
- `GET /ws` - リアルタイム更新用WebSocket

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
| `REDIS_URL` | Redis接続URL (オプション) |

## Web UI (web/)

VS Code風のダッシュボードUIを提供。

**技術スタック:**
- Vite + React + TypeScript
- Tailwind CSS (VS Code風ダークテーマ)
- React Router + TanStack Query
- WebSocket によるリアルタイム更新

**機能:**
- Task一覧・詳細 (状態、リスク、dispatch/cancel)
- Run一覧・詳細 (タイムライン、監査サマリー)
- WebSocket接続状態表示