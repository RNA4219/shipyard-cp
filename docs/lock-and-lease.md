# shipyard-cp Lock / Lease 仕様

## 目的

本書は、`integrate` / `publish` の排他制御と、長時間実行ジョブの lease / heartbeat の扱いを切り分けて定義する。

## 用語

- `task lock`: 同一 Task の多重実行を防ぐロック
- `resource lock`: branch / environment / publish target に対するロック
- `lease`: 実行権の時限保持
- `heartbeat`: lease 延長用の生存通知

## 1. Lock

### task lock

- 対象: `dispatch`, `results`, `integrate`, `publish`
- 目的: `active_job_id` の多重化防止

### resource lock

| resource_key | 用途 |
|---|---|
| `repo_branch:{repo_ref}:{branch}` | integrate の branch 競合防止 |
| `environment:{environment_name}` | publish の環境競合防止 |
| `publish_target:{provider}:{target_id}` | 外部副作用の二重実行防止 |

### lock record

- `lock_id`
- `resource_key`
- `owner_job_id` or `owner_run_id`
- `acquired_at`
- `expires_at`

### lock 失敗時

- 既定は `blocked`
- `blocked_context.reason = concurrent_execution`

## 2. Optimistic Lock

Task 更新系 API は `version` を受け、現在値と一致しなければ `409 Conflict`。

対象:

- `POST /v1/tasks/{task_id}/dispatch`
- `POST /v1/tasks/{task_id}/results`
- `POST /v1/tasks/{task_id}/integrate`
- `POST /v1/tasks/{task_id}/publish`
- `POST /v1/tasks/{task_id}/transitions`

## 3. Lease

### lease を持つ対象

- `developing` の worker job
- `integrating` の Control Plane run
- `publishing` の Control Plane run

### lease 項目

- `lease_owner`
- `lease_expires_at`
- `last_heartbeat_at` optional
- `orphaned_at` optional

## 4. Heartbeat

### worker-dispatched stage

API:

- `POST /v1/jobs/{job_id}/heartbeat`

request:

- `worker_id`
- `stage`
- `progress` optional
- `observed_at`

response:

- `lease_expires_at`
- `next_heartbeat_due_at`

### Control Plane run

`integrate` / `publish` は内部 event で進捗監視してよい。外部 API は必須ではない。

## 5. Orphan Recovery

### 判定

- `now > lease_expires_at`
- owner から heartbeat または進捗更新がない

### 既定動作

| ステージ | 回復 |
|---|---|
| `developing` | retry または block |
| `integrating` | block |
| `publishing` | block |

`publishing` は副作用の完了有無が不明なら自動再実行しない。

## 6. 実装メモ

- lock と lease は別概念として実装する。
- lock は競合防止、lease は生存確認。
- orphan recovery 前に既存 lease を無効化する。

## 関連文書

- [execution-reliability.md](./execution-reliability.md)
- [api-contract.md](./api-contract.md)
- [state-machine.md](./state-machine.md)
