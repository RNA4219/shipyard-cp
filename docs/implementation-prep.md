# shipyard-cp 実装準備メモ

## 目的

本書は、`shipyard-cp` の実装に着手する前に読む順番、依存 OSS の責務境界、最初の実装単位、確認ゲートを整理するための準備メモである。

`shipyard-cp` は単独で完結する control plane ではなく、以下 3 つの OSS を前提に組み立てる。

- `agent-taskstate`: internal task state / typed_ref / context bundle の正本
- `memx-resolver`: docs resolve / chunks / ack / stale / contract resolve
- `tracker-bridge-materials`: tracker issue / project item / sync event / entity link

## 先に読むもの

実装着手前の推奨読み順は以下とする。

1. [REQUIREMENTS.md](../REQUIREMENTS.md)
2. [state-machine.md](./state-machine.md)
3. [api-contract.md](./api-contract.md)
4. [openapi.yaml](./openapi.yaml)
5. [task.schema.json](./schemas/task.schema.json)
6. [worker-job.schema.json](./schemas/worker-job.schema.json)
7. [worker-result.schema.json](./schemas/worker-result.schema.json)
8. [state-transition-event.schema.json](./schemas/state-transition-event.schema.json)

依存 OSS 側の読み順は以下を推奨する。

1. `C:\Users\ryo-n\Codex_dev\agent-taskstate\README.md`
2. `C:\Users\ryo-n\Codex_dev\memx-resolver\README.md`
3. `C:\Users\ryo-n\Codex_dev\memx-resolver\docs\HUB.codex.md`
4. `C:\Users\ryo-n\Codex_dev\tracker-bridge-materials\README.md`

## OSS 境界

### shipyard-cp が持つ責務

- Task orchestration の進行制御
- WorkerJob / WorkerResult の正規化
- state transition の監査記録
- Integrate / Publish の制御
- LiteLLM を通した worker 呼び出しポリシー

### agent-taskstate に委譲する責務

- canonical `typed_ref`
- task state の保存モデルとの整合
- context bundle 参照
- internal entity の識別子規約

### memx-resolver に委譲する責務

- docs resolve
- chunk resolve
- read ack
- stale 判定
- contract ref 解決

### tracker-bridge-materials に委譲する責務

- tracker issue / entity の解決
- project item / issue cache / entity link
- sync event の記録
- tracker 由来 context の rebuild

## 実装開始時の前提

- `typed_ref` は 4 セグメント canonical form を前提とする
- `published` を終端状態とする
- Publish 承認の正本は `publish_plan.approval_required`
- tracker は source of truth ではなく external system として扱う
- stale docs 未解消時は `accepting -> accepted` を拒否できる

## 最初の実装マイルストーン

### M1. Task 正本の入力境界

対象:

- `POST /v1/tasks`
- `Task` schema
- `typed_ref` の canonical validation

完了条件:

- Task 作成時に `objective` と `typed_ref` を必須チェックできる
- `publish_plan` と `external_refs` を正本モデルへ保持できる

### M2. resolver 接続

対象:

- `POST /v1/tasks/{task_id}/docs/resolve`
- `POST /v1/tasks/{task_id}/docs/ack`
- `resolver_refs` の Task / Result / Event 反映

完了条件:

- Task に `doc_refs` / `chunk_refs` / `ack_refs` / `contract_refs` を保持できる
- stale 判定を acceptance gate の入力へ渡せる

### M3. worker orchestration 最小閉ループ

対象:

- `POST /v1/tasks/{task_id}/dispatch`
- `POST /v1/tasks/{task_id}/results`
- `StateTransitionEvent`

完了条件:

- `queued -> planning -> planned -> developing -> dev_completed -> accepting` まで閉じる
- `WorkerResult` に `typed_ref` / `resolver_refs` / `context_bundle_ref` を反映できる

### M4. tracker 接続

対象:

- `POST /v1/tasks/{task_id}/tracker/link`
- `external_refs` の更新
- `sync_event_ref` の記録

完了条件:

- tracker entity と internal task を `typed_ref` で結べる
- `github_project_item` と tracker entity の両方を保持できる

### M5. Integrate / Publish

対象:

- `POST /v1/tasks/{task_id}/integrate`
- `POST /v1/tasks/{task_id}/publish`

完了条件:

- `accepted -> integrating -> integrated -> publishing/publish_pending_approval -> published` を踏める
- high risk task の rollback notes を Publish 前に保持できる

## インターフェース準備

実装開始時に先に切るべきインターフェースは以下。

- `TaskRepository`
- `EventRepository`
- `WorkerAdapter`
- `TaskStateAdapter`
- `ResolverAdapter`
- `TrackerBridgeAdapter`
- `PublishExecutor`

各 adapter の最低要件:

- `TaskStateAdapter`: `typed_ref` canonical check、context bundle ref 解決
- `ResolverAdapter`: docs resolve、ack、stale check、contract refs 解決
- `TrackerBridgeAdapter`: entity link、sync event 作成、project item 参照の整合

## 実装前チェックリスト

- [ ] `openapi.yaml` を外部 validator で lint 済み
- [ ] schema から型生成するか hand-written type にするか決定済み
- [ ] `agent-taskstate` 側で受け入れる `typed_ref` 形式を再確認済み
- [ ] `memx-resolver` 側の resolve / ack 入出力を実コードで確認済み
- [ ] `tracker-bridge-materials` 側の link / sync event モデルを確認済み
- [ ] `shipyard-cp` が state の正本であり、tracker を正本化しない方針を再確認済み
- [ ] high risk task の acceptance / publish gate をテスト観点として分離済み

## 実装しないもの

本段階では以下を実装準備の対象外とする。

- 本番用永続化の詳細設計
- 実 worker adapter の具体実装
- 実 GitHub Actions / release / deployment 連携
- 実 tracker backend の接続コード

## 着手宣言の目安

以下が満たせれば、仕様書段階から実装段階へ移ってよい。

- `shipyard-cp` の正本契約が `Task / WorkerJob / WorkerResult / StateTransitionEvent / OpenAPI` で揃っている
- 依存 OSS の責務境界が文書で固定されている
- 最初の実装順が `Task -> resolver -> dispatch/results -> tracker -> integrate/publish` で共有されている
