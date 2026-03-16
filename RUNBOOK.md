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
- JSON Schema の正本は [docs/schemas](./docs/schemas)
- OpenAPI の正本は [docs/openapi.yaml](./docs/openapi.yaml)
- `published` を終端状態とする

## 実装前の確認手順

1. [docs/implementation-prep.md](./docs/implementation-prep.md) を読む
2. `agent-taskstate` の `typed_ref` と context bundle の前提を確認する
3. `memx-resolver` の resolve / ack / stale 入出力を確認する
4. `tracker-bridge-materials` の tracker link / sync event モデルを確認する
5. `openapi.yaml` と schema の差分がないか確認する
6. 実装対象マイルストーンを 1 つに絞る

## 実装順序

### Step 1. Task 入力境界

対象:

- `POST /v1/tasks`
- `Task` schema
- `typed_ref` validation

確認事項:

- `objective` 必須
- `typed_ref` 必須
- `publish_plan` を保持できる
- `external_refs` を保持できる

### Step 2. resolver 接続

対象:

- `POST /v1/tasks/{task_id}/docs/resolve`
- `POST /v1/tasks/{task_id}/docs/ack`
- `resolver_refs`

確認事項:

- `doc_refs` / `chunk_refs` / `contract_refs` を保持できる
- `ack_ref` を記録できる
- stale docs が acceptance gate に渡る

### Step 3. worker orchestration

対象:

- `POST /v1/tasks/{task_id}/dispatch`
- `POST /v1/tasks/{task_id}/results`
- `StateTransitionEvent`

確認事項:

- `WorkerJob` に resolver / tracker 文脈が流れる
- `WorkerResult` が `typed_ref` と `context_bundle_ref` を返せる
- 許可遷移外は拒否される

### Step 4. tracker 接続

対象:

- `POST /v1/tasks/{task_id}/tracker/link`
- `external_refs`
- `sync_event_ref`

確認事項:

- tracker は正本でない
- `typed_ref` をキーに internal task と接続する
- `github_project_item` と tracker entity を併存できる

### Step 5. Integrate / Publish

対象:

- `POST /v1/tasks/{task_id}/integrate`
- `POST /v1/tasks/{task_id}/publish`

確認事項:

- `accepted -> integrating -> integrated -> publishing/publish_pending_approval -> published`
- high risk task では rollback notes を保持する
- Publish 承認は `publish_plan.approval_required` を正本にする

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
