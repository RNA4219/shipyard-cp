# Schema Index

## 概要

shipyard-cp の Control Plane 契約を構成する JSON Schema 一覧。

## 一覧

- [task.schema.json](./task.schema.json)
  - Task の正本状態、risk、workspace、publish_plan、blocked_context を保持する。
- [worker-job.schema.json](./worker-job.schema.json)
  - Control Plane からワーカーへ投入する正規化済みジョブ契約。
- [worker-result.schema.json](./worker-result.schema.json)
  - ワーカー実行結果の正規化契約。成果物、テスト結果、verdict、usage を含む。
- [state-transition-event.schema.json](./state-transition-event.schema.json)
  - 監査用の状態遷移イベント契約。
- [heartbeat-request.schema.json](./heartbeat-request.schema.json)
  - 実行中 worker job の heartbeat 更新要求。
- [heartbeat-response.schema.json](./heartbeat-response.schema.json)
  - heartbeat 更新応答。lease 更新結果を返す。

## 依存関係の見方

- `Task` は `active_job_id` と `last_verdict` により `WorkerJob` / `WorkerResult` と結びつく。
- `StateTransitionEvent` は `Task.state` の変化を監査する。
- `openapi.yaml` はこれらの schema を API コンポーネントとして参照する。

## 推奨利用順

1. `task.schema.json`
2. `worker-job.schema.json`
3. `worker-result.schema.json`
4. `state-transition-event.schema.json`
5. `heartbeat-request.schema.json`
6. `heartbeat-response.schema.json`
7. `../openapi.yaml`
