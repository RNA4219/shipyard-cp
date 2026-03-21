# shipyard-cp 監査イベント仕様

## 目的

本書は、実行信頼性追補で増えるイベント種別と最低フィールドを定義する。

## 基本方針

- state transition event を中心にしつつ、job / run の運用イベントも記録する。
- worker-dispatched stages と Control Plane run で `job_id` / `run_id` を使い分けてよい。
- event 名は安定した列挙値として扱う。

## 必須共通フィールド

- `event_id`
- `task_id`
- `event_type`
- `actor_type`
- `actor_id`
- `occurred_at`
- `reason` optional
- `job_id` optional
- `run_id` optional
- `typed_ref` optional

## event_type 一覧

### retry / failure

- `job.retry_scheduled`
- `job.retry_exhausted`
- `job.failure_classified`

### loop detection

- `job.loop_warning`
- `job.loop_blocked`

### lease / heartbeat / orphan

- `job.lease_acquired`
- `job.heartbeat_received`
- `job.lease_expired`
- `job.orphan_detected`
- `job.orphan_recovered`

### capability / policy

- `job.capability_blocked`
- `run.policy_check_failed`
- `run.approval_required`

### lock / concurrency

- `run.lock_acquired`
- `run.lock_conflict`
- `task.version_conflict`

## 追加フィールド

### retry 系

- `retry_count`
- `max_retries`
- `failure_class`
- `failure_code`

### loop 系

- `loop_fingerprint`
- `loop_occurrence_count`
- `loop_window_size`

### heartbeat 系

- `lease_owner`
- `lease_expires_at`
- `last_heartbeat_at`
- `recovery_action` optional

### capability / policy 系

- `required_capabilities` optional
- `present_capabilities` optional
- `missing_capabilities` optional
- `policy_checks` optional

### lock 系

- `resource_key`
- `lock_id`
- `version`

## ログ最小要件

- retry 実行と打ち切りが追えること
- doom-loop の warn / block が追えること
- heartbeat 受信と orphan 判定が追えること
- capability block と lock conflict が追えること
- publish の idempotency 関連イベントと紐付けられること

## 関連文書

- [REQUIREMENTS.md](./project/REQUIREMENTS.md)
- [execution-reliability.md](./execution-reliability.md)
- [lock-and-lease.md](./lock-and-lease.md)

