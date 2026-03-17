# shipyard-cp 追加要件定義

## 目的

本書は、既存の [REQUIREMENTS.md](./REQUIREMENTS.md) と [docs/state-machine.md](./docs/state-machine.md) に対する追加要件を定義する。対象は、長時間実行ジョブを安全に運用するために不足している次の 5 項目である。

1. リトライ上限とエスカレーション
2. ドゥームループ検知
3. リース / ハートビート / 孤児ジョブ回復
4. ステージ別ケーパビリティ検証
5. 同時実行制御

本書は調査メモではなく、実装・API・状態遷移・運用監視に落とし込める追加仕様を定義する。既存文書と矛盾する場合は、状態名と責務境界については `REQUIREMENTS.md` と `docs/state-machine.md` を優先し、本書はその追補として扱う。

## 適用範囲

- 対象ステージ: `plan`, `dev`, `acceptance`, `integrate`, `publish`
- 対象コンポーネント: orchestrator core, worker adapter, workspace runtime, oss connectors
- 対象データ: Task, WorkerJob, WorkerResult, state transition event, operational metrics, Control Plane run metadata

## 追加方針

- 追加要件は既存の状態集合を増やさないことを原則とする。新たな運用上の詳細は `blocked_reason`, `resume_state`, `failure_reason`, `policy_decision` 等のメタデータで表現する。
- `main` 更新は引き続き `integrate` の責務とし、本書でも変更しない。
- すべての自動制御は、監査イベントとして記録されることを必須とする。
- 自動回復系の機能は、必ず停止条件を持つこと。無限リトライや無制限再開は禁止する。

## 優先度サマリー

| 項目 | 優先度 | 理由 |
|---|---|---|
| リース / ハートビート / 孤児ジョブ回復 | High | 長時間実行ジョブの停止放置を防ぐため |
| リトライ上限とエスカレーション | High | 無限再試行と過剰負荷を防ぐため |
| 同時実行制御 | High | 二重実行や競合更新を防ぐため |
| ドゥームループ検知 | Medium | 同一失敗の反復を早期停止するため |
| ステージ別ケーパビリティ検証 | Medium | 権限不足の後段失敗を早期に防ぐため |

## 共通要件

### 用語

- `retryable failure`: 同一ジョブを自動再試行してよい失敗
- `terminal failure`: 自動再試行してはならない失敗
- `blocked`: 外部依存、承認待ち、入力不足、運用ポリシー待ちにより再開可能な停止
- `rework_required`: 実装または計画の作り直しが必要な差し戻し
- `lease`: 実行中ジョブに対する一時的な占有権
- `heartbeat`: lease を延長するための生存通知
- `resource lock`: branch, environment, task など競合対象への排他ロック

### 失敗分類

Control Plane は、すべての失敗を少なくとも次の 4 区分へ正規化しなければならない。

- `retryable_transient`: 一時障害。自動再試行可
- `retryable_capacity`: 混雑、レート制限、タイムアウト。自動再試行可
- `non_retryable_policy`: 権限不足、承認拒否、禁止操作
- `non_retryable_logic`: 不正入力、契約違反、検収不合格、恒久失敗

### 監査

以下の自動判断は、すべて state transition event または job event として記録しなければならない。

- リトライ実行
- リトライ打ち切り
- ループ警告
- ループ停止
- lease 発行
- heartbeat 欠落による孤児判定
- capability 不足判定
- lock 取得成功 / 失敗

記録項目は最低限 `event_id`, `task_id`, `job_id`, `event_type`, `decision`, `reason`, `actor_type`, `occurred_at` を含むこと。

## 1. リトライ上限とエスカレーション

### 背景

既存仕様は `blocked`, `rework_required`, `failed` の区別はあるが、同一ステージ失敗時に何回まで自動再試行するかが未定義である。このままでは、ワーカー障害や外部 API 障害が長時間ループし、システム負荷と調査コストを増加させる。

### 決定

- ステージ単位で `max_retries` を持つ。
- 失敗時は `failure_class` によって、自動再試行、`blocked`、`rework_required`、`failed` を分岐する。
- 再試行は必ず指数バックオフとジッタを伴う。
- `max_retries` 到達後は同一条件で再実行せず、必ずエスカレーションする。

### 必須要件

- `plan`, `dev`, `acceptance`, `integrate`, `publish` の各ステージに `max_retries` を設定できること。
- `WorkerResult.status = failed` のとき、Control Plane は `failure_class` と `retry_count` を用いて次アクションを決定すること。
- `retryable_transient` と `retryable_capacity` のみ自動再試行対象とすること。
- `retry_count < max_retries` のときのみ同一ステージへ再投入できること。
- `retry_count >= max_retries` のときは次で分岐すること。
  - `plan`, `dev`, `acceptance`: `rework_required` または `blocked`
  - `integrate`, `publish`: `blocked` または `failed`
- 承認拒否、権限不足、契約違反、手動検収不合格は自動再試行してはならない。

### 推奨初期値

| ステージ | max_retries | 既定動作 |
|---|---|---|
| `plan` | 2 | 失敗時は `blocked` 優先 |
| `dev` | 3 | 一時障害のみ再試行 |
| `acceptance` | 1 | 自動再試行より `rework_required` 優先 |
| `integrate` | 2 | 競合時は `blocked` |
| `publish` | 1 | 副作用のため保守的運用 |

### API / 契約追加

`WorkerJob` には、既存仕様どおり worker-dispatched stages である `plan` / `dev` / `acceptance` に対して以下を追加する。

- `retry_policy.max_retries`
- `retry_policy.backoff_base_seconds`
- `retry_policy.max_backoff_seconds`
- `retry_policy.jitter_enabled`
- `retry_count`

`WorkerResult` または job event には以下を追加する。

- `failure_class`
- `failure_code`
- `failure_summary`
- `retry_scheduled_at` optional

`integrate` / `publish` については `WorkerJob` を拡張せず、Control Plane run metadata または stage event に同等の retry 情報を保持する。

### 状態遷移ルール

- 自動再試行中は Task の大域状態を維持してよいが、job event には `retrying` を記録すること。
- 再試行打ち切り時は `blocked` または `rework_required` へ明示遷移すること。
- `failed` は `terminal failure` のみで使用すること。

### 受け入れ条件

- 同一 `job_id` 系列で再試行回数が上限を超えない。
- 上限到達後に追加の自動再試行が走らない。
- `failure_class = non_retryable_policy` の場合、1 回で停止する。
- メトリクスでステージ別 retry 回数と limit hit 回数を取得できる。

## 2. ドゥームループ検知

### 背景

同一入力、同一操作、同一失敗が繰り返されると、LLM ワーカーや adapter が意味のない反復を続ける。既存仕様には、反復そのものを安全装置として止めるルールがない。

### 決定

- Control Plane はジョブ実行ごとに `loop_fingerprint` を生成する。
- 直近ウィンドウ内で閾値超過した場合、まず警告、次に停止の二段階制御を行う。
- ドゥームループ検知は Task 全体ではなく、Task 内のステージ別に判定する。

### `loop_fingerprint` の最小構成

- `stage`
- `worker_type`
- `normalized_prompt_hash`
- `repo_ref`
- `typed_ref`
- `target_resource_key` optional

### 必須要件

- 直近 `loop_window_size` 件の fingerprint 履歴を保持すること。
- 同一 fingerprint が `loop_warn_threshold` に到達したら警告イベントを発行すること。
- 警告後に同一 fingerprint が `loop_block_threshold` に到達したら自動実行を停止し、`blocked` へ遷移すること。
- `blocked_reason = doom_loop_detected` と `resume_state` を保存すること。
- 人手再開後も履歴は直ちに全消去せず、少なくとも 1 回の再発判定に使えること。

### 推奨初期値

- `loop_window_size = 20`
- `loop_warn_threshold = 3`
- `loop_block_threshold = 4`

### API / 契約追加

- job event:
  - `loop_fingerprint`
  - `loop_occurrence_count`
  - `loop_window_size`
  - `loop_action`: `none` / `warn` / `block`
- Task metadata:
  - `blocked_reason`
  - `resume_state`
  - `loop_last_fingerprint`

`loop_fingerprint` は `WorkerJob` 対象の `plan` / `dev` / `acceptance` では job 単位で保持し、`integrate` / `publish` では stage event 単位で保持する。

### 状態遷移ルール

- 警告のみの場合は状態遷移しないが、次回のジョブ入力へ warning artifact を付与してよい。
- 停止時は `blocked` へ遷移し、`resume_state` には元のステージを保存する。
- 人手が再開を許可した場合のみ、`blocked -> {planning|developing|accepting|integrating|publishing}` の既存遷移を使う。

### 受け入れ条件

- 同一 fingerprint が閾値未満なら通常実行される。
- 閾値到達時に 1 回だけ警告される。
- 停止閾値到達時に追加ジョブが投入されず `blocked` になる。
- 監査ログから fingerprint 単位の発生履歴を追跡できる。

## 3. リース / ハートビート / 孤児ジョブ回復

### 背景

長時間実行の `dev`, `integrate`, `publish` では、ワーカー断やネットワーク断によりジョブが未完了のまま残る。既存仕様は `blocked` への遷移条件は持つが、実行中ジョブの生存監視と再回復が不足している。

### 決定

- 実行中ジョブは必ず `lease` を取得する。
- 長時間ジョブは必ず heartbeat を送る。
- lease 期限切れ時は孤児ジョブと判定し、ポリシーに応じて再取得または停止する。

### 必須要件

- `developing` の worker job と、`integrating` / `publishing` の Control Plane run は lease なしで実行開始してはならない。
- worker adapter は heartbeat 対応の worker job について、`heartbeat_interval_seconds` ごとに heartbeat を送信すること。
- `integrating` / `publishing` については、worker heartbeat ではなく Control Plane 自身の進行監視または同等の内部 heartbeat を持つこと。
- Control Plane は `lease_expires_at` を過ぎたジョブを孤児候補として検知できること。
- 孤児判定時は、二重実行を防ぐため既存 lease を失効させたうえで次アクションを決定すること。
- 再実行可能なら同一 Task の新規 job として再投入し、不可なら `blocked` または `failed` に遷移すること。
- 孤児判定イベントは必ず記録すること。

### 推奨初期値

| 項目 | 値 |
|---|---|
| `lease_duration_seconds` | 300 |
| `heartbeat_interval_seconds` | 60 |
| `heartbeat_grace_multiplier` | 3 |

### API / 契約追加

- `POST /jobs/{job_id}/heartbeat`
  - request: `worker_id`, `stage`, `progress`, `observed_at`
  - response: `lease_expires_at`, `next_heartbeat_due_at`
- job metadata:
  - `lease_owner`
  - `lease_expires_at`
  - `last_heartbeat_at`
  - `orphaned_at` optional
  - `recovery_action`: `retry` / `block` / `fail`

`POST /jobs/{job_id}/heartbeat` は worker-dispatched stages を主対象とし、`integrate` / `publish` の進行監視は内部 event として実装してよい。

### 状態遷移ルール

- heartbeat 欠落のみでは即 `failed` にしてはならない。
- 一時的な通信断は `retryable_transient` として扱ってよいが、二重実行防止が先である。
- 孤児回復後の再開先は原則として元ステージとする。
- `publish` で副作用が不明なまま孤児化した場合は自動再実行せず `blocked` とすること。

### 受け入れ条件

- heartbeat が継続する限り lease が延長される。
- heartbeat 停止後に lease 期限切れを検知できる。
- 孤児判定後に同じ lease_owner で処理を継続できない。
- `publish` 中の孤児化では自動 apply 再実行を抑止できる。

## 4. ステージ別ケーパビリティ検証

### 背景

既存要件は `capabilities` の存在を定義しているが、どのステージ遷移でどの能力が必須か、事前検証の粒度が十分ではない。このため、実行途中で権限不足が発覚して失敗する可能性がある。

### 決定

- capability 検証はステージ開始前の必須ガードとする。
- ワーカー選定は名前ベースではなく capability と policy の一致で行う。
- 不足 capability は即 `blocked` とし、無理に実行しない。

### 必須 capability マトリクス

worker-dispatched stages に対する既存 capability 語彙は次を用いる。

| ステージ | 必須 capability |
|---|---|
| `plan` | `plan` |
| `dev` | `edit_repo`, `run_tests` |
| `acceptance` | `produces_verdict` |

追加条件:

- ネットワークが必要なジョブでは `networked`
- 承認フロー下で危険操作を扱う場合は `needs_approval`
- patch を成果物とする場合は `produces_patch`

補足:

- `integrate` は既存仕様上 Control Plane の責務であり、worker capability 表には含めない。代わりに bot push 権限、base SHA 確認、integration branch 上の CI 成功をガード条件として扱う。
- `publish` も Control Plane 管轄であり、capability 表には含めない。Dry-run / Apply のモード差分は `approval_policy`, `apply_enabled`, `idempotency_key`, network 利用可否など既存要件で表現する。

### 必須要件

- ジョブ投入前に `required_capabilities - worker.capabilities` を計算すること。
- 差分が空でない場合、そのジョブを投入してはならない。
- capability 不足時は `blocked` に遷移し、`blocked_reason = insufficient_capability` を記録すること。
- capability は静的設定だけでなく、worker adapter が返す実行時能力も加味できること。

### API / 契約追加

- `WorkerJob.capability_requirements` は worker-dispatched stages では必須
- `WorkerDescriptor.capabilities`
- capability 判定結果:
  - `capability_check.required`
  - `capability_check.present`
  - `capability_check.missing`

`integrate` / `publish` では `WorkerJob.capability_requirements` の代わりに、Control Plane run metadata へ `policy_checks` または同等の検証結果を保持する。

### 状態遷移ルール

- `queued -> planning`, `planned -> developing`, `dev_completed -> accepting` の前に worker capability check を挟むこと。
- `accepted -> integrating` の前には worker capability ではなく、既存要件に定義された bot push 権限と integration policy の検証を挟むこと。
- `integrated -> publish_pending_approval` または `integrated -> publishing` の前には、approval gate、network 利用可否、project policy の検証を挟むこと。
- 不足時は対象ステージへ遷移せず `blocked` とする。
- capability が追加されて再開可能になった場合のみ、既存の `blocked -> resume_state` を使用する。

### 受け入れ条件

- capability 不足ジョブが実際にワーカーへ送られない。
- `blocked_reason` から不足 capability を特定できる。
- ステージ別の capability mismatch 件数を集計できる。

## 5. 同時実行制御

### 背景

Task、branch、environment などの共有リソースに対し複数ジョブが同時に走ると、二重適用やベース SHA 競合が起こる。現状は `active_job_id` のメモ程度で、排他制御の仕様としては不足している。

### 決定

- Task 単位と resource 単位の二層ロックを導入する。
- 状態更新は楽観ロックを前提とする。
- `publish` は既存要件どおり `idempotency_key` を必須とする。
- `integrate` は必要に応じて重複防止キーを持てるが、必須要件にはしない。

### 必須要件

- 同一 Task で同時に複数の active job を持たないこと。
- 同一 `resource_key` に対する `integrate` または `publish` は同時実行してはならない。
- state 更新 API は `version` を用いた楽観ロックを行うこと。
- 競合時は黙って上書きせず、`409 Conflict` 相当で失敗させること。
- lock には有効期限を持たせ、異常終了時に回収可能であること。
- `publish` 実行は `idempotency_key` なしでは開始してはならない。

### ロック対象

- `task:{task_id}`
- `repo_branch:{repo_ref}:{branch}`
- `environment:{environment_name}`
- `publish_target:{provider}:{target_id}`

### API / 契約追加

- Job / Task update request:
  - `version`
- Lock record:
  - `lock_id`
  - `resource_key`
  - `owner_job_id`
  - `acquired_at`
  - `expires_at`
- Publish / Integrate metadata:
  - `idempotency_key`

`idempotency_key` は既存の `Publish approval gate` で必須とされる `publish` を主対象とし、`integrate` では必要なら同等の重複防止キーを任意で保持してよいが、`REQUIREMENTS.md` の正本は `publish` 側の必須要件を優先する。

### 状態遷移ルール

- lock 取得前に `accepted -> integrating` または Publish 実行系ステージへ進めない。
- lock 取得失敗時は `blocked` とし、`blocked_reason = concurrent_execution` を記録する。
- `integrating` 中の base SHA 競合は再試行対象ではなく、まず `blocked` にして再計画または再同期判断を待つこと。

### 受け入れ条件

- 同一 branch に対する 2 件目の integrate job が開始されない。
- 楽観ロック競合時に更新が失敗し、監査イベントが残る。
- `publish` の再送時に idempotency key で二重副作用を抑止できる。

## データモデル追補

以下のフィールドは最低限追加可能でなければならない。

### Task

- `state`
- `version`
- `active_job_id` optional
- `blocked_reason` optional
- `resume_state` optional
- `risk_level`

### WorkerJob

- `job_id`
- `task_id`
- `stage`
- `retry_count`
- `retry_policy`
- `capability_requirements`
- `loop_fingerprint`
- `lease_owner` optional
- `lease_expires_at` optional
- `resource_keys` optional

注記:

- `WorkerJob.stage` は既存仕様どおり `plan` / `dev` / `acceptance` を前提とする。
- `integrate` / `publish` の retry, lease, idempotency, policy check は WorkerJob ではなく Control Plane run metadata へ保持する。

### WorkerResult / Job Event

- `failure_class` optional
- `failure_code` optional
- `loop_action` optional
- `last_heartbeat_at` optional
- `orphaned_at` optional
- `capability_check` optional
- `lock_conflict` optional

## 運用メトリクス

最低限、次のメトリクスを取得できなければならない。

- `job_retries_total{stage, failure_class}`
- `job_retry_limit_reached_total{stage}`
- `doom_loop_warnings_total{stage}`
- `doom_loop_blocks_total{stage}`
- `job_lease_expired_total{stage}`
- `job_orphan_recovered_total{stage, recovery_action}`
- `capability_mismatch_total{stage, capability}`
- `resource_lock_conflict_total{resource_type}`
- `state_update_conflict_total`
- `publish_idempotency_reuse_total`

## 実装順序

1. リース / ハートビート / 孤児ジョブ回復
2. リトライ上限とエスカレーション
3. 同時実行制御
4. ステージ別ケーパビリティ検証
5. ドゥームループ検知

## 既存文書への反映ポイント

- `REQUIREMENTS.md`
  - WorkerJob / WorkerResult 契約へ retry, lease, capability を追記
  - Publish approval gate と Control Plane run metadata へ idempotency を追記
  - blocked 理由の分類を追記
- `docs/state-machine.md`
  - `blocked` の理由と `resume_state` 運用を追記
  - 各ステージ開始前の guard 条件として capability, lock, lease を追記
- `docs/api-contract.md`
  - heartbeat, optimistic lock, conflict, retry metadata を追記
- `docs/openapi.yaml`
  - heartbeat endpoint と conflict response を追加

## レビュー結論

既存の `ADD_REQUIREMENTS.md` は、追加すべき観点の洗い出しとしては有用だったが、次の理由で要件定義としては不十分だった。

- 既存状態名と整合しない仮状態名が混在していた。
- 調査メモと仕様が混在し、必須要件と参考情報の境界が曖昧だった。
- API 変更案が既存契約へどう反映されるかが不明瞭だった。
- 受け入れ条件が不足し、実装完了判定に使いづらかった。
- 出典参照記法が未解決のままで、仕様文書として完結していなかった。

本書ではそれらを解消し、shipyard-cp の既存設計に接続できる追加仕様へ正規化した。
