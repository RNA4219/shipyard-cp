# OpenCode Serve / Session Reuse 要件定義書

## 文書の目的

本書は、`shipyard-cp` における `opencode serve` と `session reuse` の次フェーズ要件を定義する。

既存の `opencode run` 統合は Phase 1 とし、本書はその上に載る Phase 2 の要件である。既存の単発実行を壊さず、`serve` ベースの常駐実行とセッション再利用を安全に導入することを目的とする。

## 正本の位置づけ

参照順序は次のとおり。

1. [REQUIREMENTS.md](./REQUIREMENTS.md)
2. [OPENCODE_SPECIFICATION.md](./OPENCODE_SPECIFICATION.md)
3. 本書
4. 将来の詳細仕様書

本書と既存要件が衝突する場合は、上位文書を優先する。

## 背景

Phase 1 の `opencode run` は、単発ジョブとしては安全で扱いやすいが、次の限界を持つ。

- ジョブごとにプロセス初期化が必要
- 同一 task の複数ジョブ間で会話文脈や agent 状態を引き継げない
- `plan` / `dev` / `acceptance` の繰り返し実行で起動コストが積み重なる
- transcript / event stream / permission request を逐次的に扱いにくい

一方で、`serve` と `session reuse` を導入すると、文脈継続やレイテンシ改善が見込める反面、権限漏れ、セッション汚染、再接続、監査、破棄条件の設計が必要になる。

## 目的

本フェーズの目的は次のとおり。

1. `opencode serve` を headless 実行基盤として扱えるようにする
2. 同一 task / workspace / policy 条件下で session を安全に再利用できるようにする
3. `shipyard-cp` 側に orchestration / approval / audit / state machine の主導権を残す
4. 既存の `run` 実装を fallback として維持する

## 非目的

本フェーズでは次を行わない。

- `WorkerType` に `opencode` を追加すること
- API request で backend 名や session ID を public に露出すること
- `shipyard-cp` の state machine を `opencode` 側へ移譲すること
- `plan` / `dev` / `acceptance` を 1 本の無制限 session にまとめること
- `google_antigravity` の実行 substrate を `serve` 化すること
- `workspace materialization` の完全実装

## 用語

### server instance

`opencode serve` により起動される常駐プロセス。1 つ以上の session を収容できる実行母体を指す。

### session

server instance にぶら下がる会話・実行文脈の単位。agent 状態、会話履歴、ツール利用文脈を保持しうる。

### session reuse

既存 session を新しい `WorkerJob` に再利用すること。単なる server 再利用ではなく、session レベルで文脈を継続することを指す。

### session boundary

再利用を許してよい範囲を決める境界。最低限 `task_id`、`workspace_ref`、`logical worker`、`stage bucket`、`approval/policy fingerprint` を含む。

### stage bucket

permission 漏れを防ぐための reuse 境界。最低限、`plan`、`dev`、`acceptance` を別 bucket として扱う。

## 絶対制約

### CR-01 Public API 非露出

- `opencode` は public な `WorkerType` にしてはならない
- API request / response に backend 名や session ID を必須公開してはならない

### CR-02 orchestration 主導権維持

- state machine、approval、retry、lease、audit の主導権は `shipyard-cp` 側に残す
- `opencode` は実行 substrate であり、工程責任の正本になってはならない

### CR-03 permission 漏れ禁止

- `dev` session をそのまま `acceptance` に再利用してはならない
- より強い権限で開始した session を、より弱い権限の stage へ横流ししてはならない
- stage を跨ぐ reuse はデフォルト禁止とする

### CR-04 fallback 維持

- `serve` が利用不能な場合、`run` へ安全に fallback できること
- fallback の有無は監査ログへ残ること

## 機能要件

### FR-01 server lifecycle 管理

Control Plane は `opencode serve` の起動、ヘルスチェック、停止、異常終了検知を管理できること。

最低限必要な機能:

- 起動済み / 未起動の判定
- ヘルスチェック
- graceful shutdown
- crash 検知
- 再起動方針

### FR-02 session registry

Control Plane は session を追跡する registry を持つこと。

registry は最低限次を保持する。

- `session_id`
- `server_instance_id`
- `task_id`
- `workspace_ref`
- `logical_worker`
- `stage_bucket`
- `policy_fingerprint`
- `status`
- `created_at`
- `last_used_at`
- `leased_by_job_id` optional
- `expires_at` optional

### FR-03 session reuse 判定

session reuse は次の全条件を満たす場合にのみ許可する。

1. 同一 `task_id`
2. 同一 `workspace_ref`
3. 同一 `logical_worker`
4. 同一 `stage_bucket`
5. 同一 `policy_fingerprint`
6. session 状態が `ready` または `idle`
7. 他 job に lease されていない

### FR-04 stage 間分離

- `plan` と `dev` は別 session とする
- `dev` と `acceptance` は別 session とする
- 同一 task でも stage が変わるたびに新 session 作成を標準とする
- 将来例外を入れる場合でも、明示 policy が必要

### FR-05 permission 適用

session へ渡す permission は `WorkerJob.approval_policy` と stage に基づき、`shipyard-cp` が決定すること。

最低限:

- `plan`: `edit=deny`, `bash=deny`, `webfetch=deny`
- `dev`: `edit=allow`, `bash=allow`, `webfetch` 条件付き
- `acceptance`: `edit=deny`, `bash=allow`, `webfetch` 条件付き

### FR-06 event / transcript 回収

`serve` 利用時は、最低限次を回収できること。

- transcript
- tool use
- permission request
- stdout / stderr
- 終了コードまたは session close 理由

これらは `WorkerResult` と監査イベントへ正規化できること。

### FR-07 cancel / timeout

Control Plane は session ベース実行に対して cancel を発行できること。timeout 時は job 単位で失敗させ、必要なら session も破棄できること。

### FR-08 session cleanup

不要 session は自動または明示的に cleanup できること。

cleanup 条件の最低限:

- task 完了
- task 取消
- task 失敗
- TTL 超過
- policy fingerprint 不一致
- workspace 不整合
- server crash 後の orphan session

### FR-09 observability

最低限次を観測できること。

- server 起動数
- active session 数
- reuse 成功率
- reuse miss 理由
- fallback 回数
- session crash 回数
- session age
- session lease 競合回数

### FR-10 compatibility

既存の `run` 方式を壊さず、設定で `serve` モードを有効化できること。

## 監査要件

最低限、次の監査イベントを残すこと。

- server 起動
- server 停止
- session 作成
- session lease 取得
- session reuse 成功
- session reuse miss
- session policy mismatch
- session timeout
- session cancel
- session cleanup
- `serve` から `run` への fallback

## セキュリティ要件

### SR-01 権限昇格防止

- 低権限 stage が高権限 session を再利用してはならない
- policy fingerprint 不一致時は reuse せず新 session を作ること

### SR-02 workspace 越境禁止

- 別 workspace の session を使い回してはならない
- `workspace_ref` が変わった場合は reuse 禁止

### SR-03 task 越境禁止

- 別 task の session を使い回してはならない
- reuse 単位は task-local を原則とする

## 運用要件

### OR-01 起動方式

- 初期実装では 1 node あたり 1 つ以上の server instance を持てる
- server instance の多重起動方針は設定で制御できる

### OR-02 障害時方針

- server が死んだ場合、in-flight job を失敗または retryable として扱う基準を持つこと
- session registry 上の orphan session を回収できること

### OR-03 rollback 方針

- `serve` 導入後も設定で `run` へ戻せること
- rollback によって public API 契約が変わってはならない

## 受け入れ条件

### AC-01 server 管理

- `opencode serve` を起動し、ヘルスチェックで ready 判定できる

### AC-02 session 作成

- `plan` / `dev` / `acceptance` の各 stage で session を作成できる

### AC-03 reuse 成功

- 同一 task、同一 workspace、同一 stage bucket、同一 policy 条件の再実行で reuse できる

### AC-04 reuse 禁止

- `dev` session は `acceptance` に再利用されない
- `workspace_ref` 不一致時に reuse されない
- policy fingerprint 不一致時に reuse されない

### AC-05 fallback

- `serve` 異常時に `run` へ fallback できる

### AC-06 audit

- session lifecycle と fallback が監査ログに残る

## 実装フェーズの推奨分割

### Phase 2A

- server instance 管理
- session registry
- same-stage reuse
- fallback

### Phase 2B

- event stream 正規化
- transcript 収集強化
- cleanup / recovery 強化

### Phase 2C

- agent-aware session policy
- session warm pool
- reuse 最適化

## 今回の設計で固定する判断

1. session reuse は「task-local」「same-stage-bucket」のみ許可する
2. `dev` と `acceptance` の session は分離する
3. `serve` は追加 backend ではなく、`opencode` backend の実行モード差分として扱う
4. public API は変更しない
