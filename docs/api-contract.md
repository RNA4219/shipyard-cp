# shipyard-cp API Contract Draft

## 目的

本書は Task / WorkerJob / WorkerResult / StateTransitionEvent を扱うための最小 API 契約案である。実装順序は、Task 作成、Job ディスパッチ、Result 反映、状態遷移の監査、Integrate / Publish 実行の順を想定する。

## 基本方針

- API は Control Plane 正本のみが Task の `state` を更新できる。
- ワーカーは `WorkerJob` を pull または push 方式で受け取ってもよいが、結果反映は `WorkerResult` 契約に正規化する。
- 状態遷移は副作用ではなくイベントとして必ず `StateTransitionEvent` を記録する。
- `Integrate` と `Publish` はワーカー API ではなく Control Plane API として分離する。
- `published` を終端状態とし、`completed` 状態は持たない。
- Task / external ref / context bundle / typed_ref の canonical contract は `agent-taskstate` と整合させる。
- tracker 連携は `tracker-bridge-materials` の helper layer を通し、docs / contracts 解決は `memx-resolver` を通す。

## エンドポイント一覧

| Method | Path | 用途 |
|---|---|---|
| `POST` | `/v1/tasks` | Task 作成 |
| `GET` | `/v1/tasks/{task_id}` | Task 取得 |
| `POST` | `/v1/tasks/{task_id}/dispatch` | 次工程 Job を生成 |
| `POST` | `/v1/tasks/{task_id}/results` | WorkerResult 反映 |
| `POST` | `/v1/tasks/{task_id}/transitions` | 手動またはポリシー起因の遷移記録 |
| `POST` | `/v1/tasks/{task_id}/integrate` | Integrate 開始 |
| `POST` | `/v1/tasks/{task_id}/publish` | Publish 開始 |
| `POST` | `/v1/jobs/{job_id}/heartbeat` | 実行中 worker job の heartbeat 更新 |
| `POST` | `/v1/tasks/{task_id}/cancel` | Task 中止 |
| `GET` | `/v1/tasks/{task_id}/events` | 状態遷移イベント一覧 |
| `GET` | `/v1/jobs/{job_id}` | WorkerJob または進行状況取得 |
| `POST` | `/v1/tasks/{task_id}/docs/resolve` | memx-resolver で読むべき文書を解決 |
| `POST` | `/v1/tasks/{task_id}/docs/ack` | memx-resolver へ読了記録を残す |
| `POST` | `/v1/tasks/{task_id}/tracker/link` | tracker-bridge-materials で tracker entity を紐付ける |

## 主要リクエスト / レスポンス

### `POST /v1/tasks`

新規 Task を登録する。初期状態は `queued`。

Request body:
- `title`
- `objective`
- `typed_ref`
- `description` optional
- `repo_ref`
- `risk_level` optional
- `labels` optional
- `publish_plan` optional
- `external_refs` optional

Response:
- `201 Created`
- body は [task.schema.json](./schemas/task.schema.json) 準拠

### `POST /v1/tasks/{task_id}/dispatch`

Task の現在状態に応じて次の `WorkerJob` を発行する。通常は `queued -> planning`, `planned -> developing`, `dev_completed -> accepting` のときに呼ばれる。

Request body:
- `target_stage`: `plan` / `dev` / `acceptance`
- `worker_selection` optional
- `override_risk_level` optional
- `expected_version` optional

補足:

- `dispatch` API 自体は `skills` のような専用入力を持たない。
- 追加の作業ガイダンスが必要な場合は、Control Plane が `WorkerJob.input_prompt` と `WorkerJob.context.references` / `constraints` に正規化してワーカーへ渡す。
- `SKILL.md` パスや skill 名を直接解釈して worker 側で展開する契約にはなっていない。

Response:
- `202 Accepted`
- body は [worker-job.schema.json](./schemas/worker-job.schema.json) 準拠

### `POST /v1/tasks/{task_id}/results`

ワーカー完了結果を反映する。Control Plane は結果を検証し、必要なら状態遷移イベントを自動生成する。

Request body:
- [worker-result.schema.json](./schemas/worker-result.schema.json) 準拠

Response:
- `200 OK`
- body:
  - `task`
  - `emitted_events`
  - `next_action`: `dispatch_dev` / `dispatch_acceptance` / `integrate` / `publish` / `wait_manual` / `none`

補足:

- `WorkerResult` には `failure_class`, `failure_code`、必要に応じて `retry_count` を含めてよい。

### `POST /v1/tasks/{task_id}/transitions`

人手承認、手動 Acceptance、ポリシー解除など、ワーカー結果では表せない遷移を明示記録する。許可される `from_state -> to_state` は [state-machine.md](./state-machine.md) の「許可遷移一覧」に一致しなければならない。

Request body:
- [state-transition-event.schema.json](./schemas/state-transition-event.schema.json) 準拠

Response:
- `200 OK`
- body は記録済みイベント

### `POST /v1/tasks/{task_id}/integrate`

accepted Task に対して integration branch 作成、CI 確認、main 更新を行う。

Request body:
- `expected_state`: `accepted`
- `base_sha`
- `branch_ref` or `patch_ref`

Response:
- `202 Accepted`
- body:
  - `task_id`
  - `state`: `integrating`
  - `integration_branch`
  - `run_id` optional

### `POST /v1/tasks/{task_id}/publish`

integrated Task に対して Publish を開始する。No-op / Dry-run / Apply を共通エンドポイントで扱い、最終終端は `published` とする。

Request body:
- `mode`: `no_op` / `dry_run` / `apply`
- `idempotency_key`
- `approval_token` optional

Response:
- `202 Accepted`
- body:
  - `task_id`
  - `state`: `publishing` or `publish_pending_approval`
  - `publish_run_id`

### `POST /v1/jobs/{job_id}/heartbeat`

実行中の worker-dispatched job に対して heartbeat を反映する。`integrate` / `publish` の進行監視は Control Plane 内部イベントで扱ってよい。

Request body:
- `worker_id`
- `stage`
- `progress` optional
- `observed_at`

Response:
- `200 OK`
- body:
  - `job_id`
  - `lease_expires_at`
  - `next_heartbeat_due_at`

### `POST /v1/tasks/{task_id}/docs/resolve`

memx-resolver を使って、feature / task / topic から読むべき文書を解決する。

Request body:
- `feature` optional
- `topic` optional
- `task_seed` optional

Response:
- `200 OK`
- body:
  - `typed_ref`
  - `doc_refs`
  - `chunk_refs`
  - `contract_refs`
  - `stale_status`

### `POST /v1/tasks/{task_id}/docs/ack`

memx-resolver へ読了記録を残す。

Request body:
- `doc_id`
- `version`
- `task_id`

Response:
- `200 OK`
- body:
  - `ack_ref`

### `POST /v1/tasks/{task_id}/tracker/link`

tracker-bridge-materials を使って tracker entity と internal task を紐付ける。

Request body:
- `typed_ref`
- `connection_ref`
- `entity_ref`

Response:
- `200 OK`
- body:
  - `typed_ref`
  - `external_refs`
  - `sync_event_ref`

## バリデーションルール

- `POST /v1/tasks` では `objective` と `typed_ref` を必須とする。
- `typed_ref` は 4 セグメント canonical form `<domain>:<entity_type>:<provider>:<entity_id>` に一致しなければならない。
- `POST /v1/tasks/{task_id}/results` では `job_id` が Task の `active_job_id` と一致しない場合 `409 Conflict`。
- `POST /v1/tasks/{task_id}/dispatch` は `expected_version` が現在の Task version と一致しない場合 `409 Conflict`。
- `POST /v1/tasks/{task_id}/integrate` は `state != accepted` の場合 `409 Conflict`。
- `POST /v1/tasks/{task_id}/publish` は `state != integrated` の場合 `409 Conflict`。
- `POST /v1/jobs/{job_id}/heartbeat` は worker-dispatched stages の active job にのみ受理され、lease 期限切れ後は `409 Conflict` または `410 Gone` を返してよい。
- `high` リスク Task が `accepted` へ遷移するには、`WorkerResult.test_results` に少なくとも 1 件 `suite = regression` かつ `status = passed` が必要。
- Plan 成功の `WorkerResult` は、`verdict` または 1 件以上の `artifacts` を持つこと。
- `apply` Publish は `publish_plan.approval_required = true` かつ承認未完了なら `202` で `publish_pending_approval` を返す。
- `publish` は全モードで `idempotency_key` 必須とする。特に `mode = apply` では二重副作用防止のため必須要件として扱う。
- `integrate` / `publish` 開始時に lock が取得できない場合は `409 Conflict` または `202` + `blocked` 相当の応答を返してよい。
- `POST /v1/tasks/{task_id}/transitions` は、許可遷移一覧外の遷移を `409 Conflict` で拒否する。
- stale docs が未解消なら `accepting -> accepted` を拒否できる。

## 許可遷移の API 正本

以下を API 契約上の許可遷移とする。

- `queued -> queued`
- `queued -> planning`
- `queued -> cancelled`
- `queued -> failed`
- `planning -> planned`
- `planning -> rework_required`
- `planning -> blocked`
- `planning -> cancelled`
- `planning -> failed`
- `planned -> developing`
- `planned -> cancelled`
- `planned -> failed`
- `developing -> dev_completed`
- `developing -> rework_required`
- `developing -> blocked`
- `developing -> cancelled`
- `developing -> failed`
- `dev_completed -> accepting`
- `dev_completed -> cancelled`
- `dev_completed -> failed`
- `accepting -> accepted`
- `accepting -> rework_required`
- `accepting -> blocked`
- `accepting -> cancelled`
- `accepting -> failed`
- `rework_required -> developing`
- `rework_required -> cancelled`
- `rework_required -> failed`
- `accepted -> integrating`
- `accepted -> cancelled`
- `accepted -> failed`
- `integrating -> integrated`
- `integrating -> blocked`
- `integrating -> cancelled`
- `integrating -> failed`
- `integrated -> publish_pending_approval`
- `integrated -> publishing`
- `integrated -> cancelled`
- `integrated -> failed`
- `publish_pending_approval -> publishing`
- `publish_pending_approval -> cancelled`
- `publish_pending_approval -> failed`
- `publishing -> published`
- `publishing -> blocked`
- `publishing -> cancelled`
- `publishing -> failed`
- `blocked -> planning`
- `blocked -> developing`
- `blocked -> accepting`
- `blocked -> integrating`
- `blocked -> publishing`
- `blocked -> cancelled`
- `blocked -> failed`

## OpenAPI へ落とすときのコンポーネント候補

- `Task`
- `WorkerJob`
- `WorkerResult`
- `StateTransitionEvent`
- `DispatchRequest`
- `IntegrateRequest`
- `PublishRequest`
- `ResolveDocsRequest`
- `TrackerLinkRequest`
- `ErrorResponse`

## 実装順序の推奨

1. `POST /v1/tasks`
2. `POST /v1/tasks/{task_id}/docs/resolve`
3. `POST /v1/tasks/{task_id}/dispatch`
4. `POST /v1/tasks/{task_id}/results`
5. `GET /v1/tasks/{task_id}` / `GET /v1/tasks/{task_id}/events`
6. `POST /v1/tasks/{task_id}/tracker/link`
7. `POST /v1/tasks/{task_id}/integrate`
8. `POST /v1/tasks/{task_id}/publish`

この順で進めると、resolver / state / tracker の基盤を先に繋いでから Integrate / Publish を足せる。
