# shipyard-cp 実行信頼性仕様

## 目的

本書は、`REQUIREMENTS.md` にある実行信頼性要件を実装可能な粒度へ分解する補助仕様である。対象は次の 5 項目。

- retry / escalation policy
- doom-loop detection
- lease / heartbeat / orphan recovery
- stage capability gate
- concurrency control

`integrate` / `publish` は Control Plane run、`plan` / `dev` / `acceptance` は worker-dispatched stages として扱う。責務境界は既存仕様を変更しない。

## 適用対象

| 対象 | 担当 |
|---|---|
| `plan` / `dev` / `acceptance` の再試行・ループ検知・capability 判定 | Worker orchestration |
| `developing` の lease / heartbeat | Worker adapter + Control Plane |
| `integrating` / `publishing` の lease 相当監視 | Control Plane |
| `integrate` / `publish` の lock / optimistic lock / idempotency | Control Plane |

## 1. Retry / Escalation

### 失敗分類

Control Plane は失敗を最低限次へ分類する。

- `retryable_transient`
- `retryable_capacity`
- `non_retryable_policy`
- `non_retryable_logic`

### 既定ポリシー

| ステージ | max_retries | 上限到達時の既定 |
|---|---|---|
| `plan` | 2 | `blocked` |
| `dev` | 3 | `blocked` または `rework_required` |
| `acceptance` | 1 | `rework_required` |
| `integrate` | 2 | `blocked` |
| `publish` | 1 | `blocked` |

### ルール

- 自動再試行は `retryable_transient` / `retryable_capacity` のみ。
- `non_retryable_policy` は即停止。
- `publish` は副作用のため、再試行前に完了有無が識別できること。
- retry は指数バックオフ + ジッタ。

### 最低データ項目

- `retry_policy.max_retries`
- `retry_policy.backoff_base_seconds`
- `retry_policy.max_backoff_seconds`
- `retry_policy.jitter_enabled`
- `retry_count`
- `failure_class`
- `failure_code`

## 2. Doom-loop Detection

### `loop_fingerprint`

worker-dispatched stages では job 単位、`integrate` / `publish` では stage event 単位で保持する。

最小構成:

- `stage`
- `worker_type` optional
- `normalized_prompt_hash`
- `repo_ref`
- `typed_ref`
- `target_resource_key` optional

### 既定しきい値

- `loop_window_size = 20`
- `loop_warn_threshold = 3`
- `loop_block_threshold = 4`

### ルール

- warn 到達時は warning event を記録し、次回入力へ warning artifact を付与してよい。
- block 到達時は `blocked` に遷移し、`resume_state` を保持する。
- 再開後も同一 fingerprint の履歴は直ちに消さない。

## 3. Lease / Heartbeat / Orphan Recovery

### 対象

- `developing`: worker heartbeat 必須
- `integrating`: Control Plane 内部監視
- `publishing`: Control Plane 内部監視

### 既定値

- `lease_duration_seconds = 300`
- `heartbeat_interval_seconds = 60`
- `heartbeat_grace_multiplier = 3`

### ルール

- active 実行は lease 必須。
- worker-dispatched stage では `POST /v1/jobs/{job_id}/heartbeat` を使用。
- `integrate` / `publish` は内部 event による進行監視でよい。
- orphan 判定時は lease を失効させ、二重実行を防いでから回復方針を決める。
- `publish` で副作用完了が不明なら自動再実行しない。

### 回復アクション

- `retry`
- `block`
- `fail`

既定は `publish = block`、それ以外は policy に従う。

## 4. Stage Capability Gate

### worker capability 語彙

既存仕様どおり次を使う。

- `plan`
- `edit_repo`
- `run_tests`
- `needs_approval`
- `networked`
- `produces_patch`
- `produces_verdict`

### 必須マトリクス

| ステージ | 必須 capability |
|---|---|
| `plan` | `plan` |
| `dev` | `edit_repo`, `run_tests` |
| `acceptance` | `produces_verdict` |

追加条件:

- ネットワーク要件があるなら `networked`
- 承認フローがあるなら `needs_approval`
- patch 成果物を要求するなら `produces_patch`

### 非対象

- `integrate`
- `publish`

これらは worker capability ではなく policy gate で判定する。

## 5. Concurrency Control

### ロック対象

- `task:{task_id}`
- `repo_branch:{repo_ref}:{branch}`
- `environment:{environment_name}`
- `publish_target:{provider}:{target_id}`

### ルール

- 同一 Task の active job は 1 つまで。
- `integrate` / `publish` では resource lock を取る。
- 状態更新は optimistic lock (`version`) 前提。
- `publish` は `idempotency_key` 必須。
- `integrate` は必要に応じて重複防止キーを持てるが必須ではない。

## blocked 運用メタデータ

`blocked` は単独状態のまま、次の補助情報で再開を制御する。

- `blocked_context.reason`
- `blocked_context.resume_state`
- `blocked_context.capability_missing` optional
- `blocked_context.lock_conflict` optional
- `blocked_context.loop_fingerprint` optional
- `blocked_context.orphaned_run` optional

## 実装順

1. retry / failure_class
2. heartbeat endpoint と lease
3. blocked_context 拡張
4. capability gate
5. task/resource lock
6. doom-loop detection

## 関連文書

- [REQUIREMENTS.md](../REQUIREMENTS.md)
- [state-machine.md](./state-machine.md)
- [api-contract.md](./api-contract.md)
- [RUNBOOK.md](../RUNBOOK.md)
