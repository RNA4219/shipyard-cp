# OpenCode Serve / Session Reuse 実装指示書

## 目的

本書は、`shipyard-cp` に `opencode serve` と `session reuse` を導入する Phase 2 の実装指示書である。

Phase 1 の `opencode run` 統合はすでに存在する前提とし、本書ではそれを壊さずに `serve` ベースの常駐実行と same-stage session reuse を追加する。

## 正本ドキュメント

実装時は次を正本として参照すること。

- 要件: [REQUIREMENTS.md](./REQUIREMENTS.md)
- Phase 1 仕様: [OPENCODE_SPECIFICATION.md](./OPENCODE_SPECIFICATION.md)
- Phase 2 要件: [OPENCODE_SERVE_REQUIREMENTS.md](./OPENCODE_SERVE_REQUIREMENTS.md)
- Phase 2 仕様: [OPENCODE_SERVE_SPECIFICATION.md](./OPENCODE_SERVE_SPECIFICATION.md)
- API 補遺: [OPENCODE_API_CONTRACT.md](./OPENCODE_API_CONTRACT.md)

本書は作業順と実装上の注意を定義する。要求事項そのものは上位文書を優先する。

## 最重要方針

1. `WorkerType` を増やさない
2. `opencode` を public API に露出しない
3. session reuse は `task-local` かつ `same-stage-bucket` のみ許可する
4. `dev` session を `acceptance` に再利用しない
5. `serve` が失敗しても `run` fallback を残す
6. orchestration / approval / retry / lease / audit の主導権は `shipyard-cp` 側に残す

## 実装スコープ

今回の必須スコープは次のとおり。

### A. 実行モード切替

- `opencode` backend の実行モードとして `run` と `serve` を持てるようにする
- デフォルトは `run` のままとし、明示設定時のみ `serve` を有効にする

### B. server instance 管理

- `opencode serve` の起動、ヘルスチェック、停止を管理する

### C. session registry

- `task_id`、`workspace_ref`、`logical_worker`、`stage_bucket`、`policy_fingerprint` で session を追跡する

### D. same-stage session reuse

- `plan -> plan`
- `dev -> dev`
- `acceptance -> acceptance`

のみ reuse を許可する

### E. fallback

- `serve` 起動失敗、session 作成失敗、server crash 時に `run` 実装へ fallback できるようにする

### F. 監査

- server lifecycle
- session create / lease / release / cleanup
- reuse hit / miss
- fallback

を audit / log に残す

## 非スコープ

今回の実装では次は必須にしない。

- stage を跨ぐ session reuse
- warm pool
- 複数 agent 協調の最適化
- event stream の完全意味解析
- workspace materialization の全面実装
- public API 変更

## 実装ルール

### 1. public API を変えない

- `DispatchRequest` に backend や session 関連フィールドを追加しないこと
- `WorkerType` に `opencode` を追加しないこと
- session ID を public contract の必須項目にしないこと

### 2. reuse は保守的に始める

- 初期実装では same-stage 以外の reuse を禁止すること
- permission 差分があるなら reuse しないこと
- `dev -> acceptance` の reuse を絶対に許可しないこと

### 3. fallback を消さない

- `OpenCodeExecutor(run mode)` は fallback として残すこと
- `serve` が不安定でも既存経路で動作継続できるようにすること

### 4. session は job より広くても task より狭くする

- task を跨ぐ session 共有は禁止
- workspace を跨ぐ session 共有は禁止

### 5. policy fingerprint を必ず使う

- approval policy と workspace 条件が違う session を reuse しないこと

## 推奨ファイル構成

最低限、次のような構成で実装することを推奨する。

```text
src/infrastructure/
  opencode-server-manager.ts
  opencode-session-executor.ts

src/domain/worker/
  opencode-session-registry.ts
  opencode-serve-adapter.ts
  opencode-event-ingestor.ts

src/config/
  index.ts
```

既存の `opencode-executor.ts` と `opencode-adapter.ts` は残し、`serve` 導入後も fallback に使えるようにする。

## 実装タスク

### Task 1. 設定追加

対象:

- `src/config/index.ts`
- `.env.example`

追加候補:

- `OPENCODE_MODE=run|serve`
- `OPENCODE_SERVE_PATH`
- `OPENCODE_SERVE_BASE_URL`
- `OPENCODE_SESSION_REUSE=disabled|same_stage`
- `OPENCODE_SESSION_TTL_MS`
- `OPENCODE_SERVER_STARTUP_TIMEOUT_MS`
- `OPENCODE_REUSE_LEASE_TTL_MS`

期待値:

- デフォルトは `run`
- 明示設定時のみ `serve`
- `session reuse` はデフォルト無効

### Task 2. server manager 実装

対象:

- `src/infrastructure/opencode-server-manager.ts`

実装内容:

- `opencode serve` の起動
- ready 判定のヘルスチェック
- 停止
- crash 検知

期待値:

- server instance を 1 つ以上管理できる
- `ensureServerReady()` が使える

### Task 3. session registry 実装

対象:

- `src/domain/worker/opencode-session-registry.ts`

実装内容:

- `SessionRecord` の保存
- `findReusableSession()`
- `createSessionRecord()`
- `leaseSession()`
- `releaseSession()`
- `markSessionDead()`

期待値:

- same-stage reuse 判定が registry 経由で行える

### Task 4. session executor 実装

対象:

- `src/infrastructure/opencode-session-executor.ts`

実装内容:

- session 作成
- session 接続
- prompt 投入
- 実行完了待ち
- cancel
- transcript / stdout / stderr 回収

期待値:

- 単発 `run` ではなく session ベース実行ができる

### Task 5. event ingestor 実装

対象:

- `src/domain/worker/opencode-event-ingestor.ts`

実装内容:

- permission request
- tool use
- transcript
- stdout / stderr

を内部イベント / `WorkerResult` 向けに正規化する

期待値:

- `requested_escalations` と raw outputs が `serve` でも組み立てられる

### Task 6. serve adapter 実装

対象:

- `src/domain/worker/opencode-serve-adapter.ts`
- `src/domain/worker/index.ts`

実装内容:

- `OpenCodeServeAdapter` を `WorkerAdapter` 契約へ適合させる
- same-stage reuse 判定
- session lease / release
- `run` fallback
- `WorkerResult.metadata.execution_mode = "serve"` を付与

期待値:

- `OpenCodeAdapter` とは別の実装として責務分離される
- 既存 `OpenCodeAdapter(run mode)` を壊さない

### Task 7. JobService / 初期化切替

対象:

- `src/store/services/job-service.ts`

実装内容:

- `opencodeMode === "serve"` のときは `OpenCodeServeAdapter`
- `opencodeMode === "run"` のときは既存 `OpenCodeAdapter`
- `codex` / `claude_code` の logical worker 契約は維持

期待値:

- public な `worker_type` を変えずに実行モードを切り替えられる

### Task 8. 監査と observability

対象:

- 監査イベント生成箇所
- metrics / logger

実装内容:

- server start / stop
- session create / reuse hit / reuse miss / cleanup
- fallback

の記録を追加する

期待値:

- session lifecycle が追跡可能になる

### Task 9. テスト追加

対象:

- adapter 単体テスト
- registry 単体テスト
- server manager 単体テスト
- JobService 初期化テスト

最低限の観点:

1. `serve` 起動成功
2. `dev -> dev` reuse 成功
3. `dev -> acceptance` reuse 禁止
4. policy fingerprint 不一致で reuse 禁止
5. `serve` 異常時の `run` fallback

## reuse 判定で必ず守る条件

次の全条件を満たす場合にのみ reuse してよい。

1. 同一 `task_id`
2. 同一 `workspace_ref`
3. 同一 `logical_worker`
4. 同一 `stage_bucket`
5. 同一 `policy_fingerprint`
6. session 状態が `ready` または `idle`
7. session が他 job に lease されていない

1つでも外れたら新 session を作ること。

## stage 別方針

### plan

- `plan -> plan` 再実行時のみ reuse 可
- `plan -> dev` 継続禁止

### dev

- `dev -> dev` 再実行時のみ reuse 可
- `dev -> acceptance` 継続禁止

### acceptance

- `acceptance -> acceptance` 再実行時のみ reuse 可
- `edit=deny`

## fallback 方針

次の場合は `run` mode へ fallback してよい。

1. `opencode serve` 起動失敗
2. ヘルスチェック失敗
3. session 作成失敗
4. leased session crash

ただし、fallback したことを必ず監査ログへ残すこと。

## 受け入れ条件

次を満たしたら Phase 2A の実装は完了とする。

1. `opencodeMode=serve` で server instance を起動できる
2. `plan` / `dev` / `acceptance` の session を作成できる
3. same-stage reuse ができる
4. `dev -> acceptance` の reuse が禁止される
5. policy fingerprint 不一致で reuse されない
6. `serve` 異常時に `run` fallback できる
7. audit / log に session lifecycle が残る
8. `npm run check` が通る
9. `npm test` が通る

## 実装後に確認すべきこと

- `OPENCODE_MODE=serve` で `claude_code` / `codex` が起動すること
- `OPENCODE_MODE=run` に戻すと既存挙動へ戻ること
- `OPENCODE_SESSION_REUSE=same_stage` で same-stage reuse だけが有効になること
- `OPENCODE_SESSION_REUSE=disabled` で毎回新 session になること
- `WorkerResult.metadata.execution_mode = "serve"` が付与されること
- `WorkerResult.metadata.substrate = "opencode"` が維持されること

## 次フェーズへの申し送り

Phase 2A 完了後は、次の順で進めること。

1. event stream 正規化の強化
2. transcript の構造化保存
3. cleanup / orphan recovery の強化
4. agent-aware session policy
5. warm pool と reuse 最適化

本書の目的は、最初から高度な reuse を入れることではなく、安全な same-stage reuse と fallback を先に固めることである。
