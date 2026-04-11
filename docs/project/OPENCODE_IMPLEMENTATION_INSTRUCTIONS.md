# OpenCode 統合 実装指示書

## 目的

本書は、`shipyard-cp` に `opencode` を coding agent substrate として統合する実装作業の指示書である。

実装時の最重要方針は次の 3 点とする。

1. `shipyard-cp` は orchestration / policy / audit / state machine の主導権を保持する
2. `opencode` は Plan / Dev / Acceptance 実行を担う substrate として扱う
3. LiteLLM は model routing / fallback / usage accounting の標準入口として残す

## 背景

現状の課題は次のとおりだった。

- `JobService` が `GLM5Adapter` しか初期化しておらず、論理 worker と実行 backend が分離されていない
- `submitJob(job, 'claude_code')` の hardcode により、dispatch で選定した worker が submit 時に無視される
- `GLM5Adapter` は completion 実行であり、実ファイル編集や bash 実行を伴う coding agent substrate ではない
- `claude-code-adapter.ts`、`codex-adapter.ts` は存在しても、実運用経路に乗っていない

この課題を解消するため、`opencode` を第一級 substrate として扱う構造に拡張する。

## 正本ドキュメント

実装時は次の文書を正本として参照すること。

- 要件定義: [REQUIREMENTS.md](./REQUIREMENTS.md)
- 設計メモ: [OPENCODE_INTEGRATION_MEMO.md](./OPENCODE_INTEGRATION_MEMO.md)

本書は実装の指示文書であり、要求事項そのものは `REQUIREMENTS.md` を優先する。

## 実装スコープ

今回の必須実装スコープは以下とする。

### A. backend 選択の明示化

- 論理 worker type は既存の `codex` / `claude_code` / `google_antigravity` を維持する
- 実行 backend は設定で切り替え可能にする
- `claude_code` の backend は少なくとも `opencode` / `glm` / `claude_cli` / `simulation` を扱えるようにする
- `codex` の backend は少なくとも `opencode` / `simulation` を扱えるようにする

### B. OpenCode CLI substrate の導入

- `opencode run` を用いた単発実行 substrate を adapter で扱えるようにする
- stage ごとに適切な permission を OpenCode へ反映する
- stdout / stderr / prompt / config を artifact として保存する
- `WorkerResult` へ正規化して保存する

### C. worker selection の正常化

- dispatch で決まった `job.worker_type` を submit 時に必ず使う
- hardcode された `'claude_code'` submit を廃止する

### D. 文書更新

- 実装後の設計意図が分かるよう、設定例や backend 選択方法を docs へ残す

## 非スコープ

今回の実装では、以下は必須にしない。

- `opencode serve` ベースの long-running session 統合
- repo checkout / clone / workspace materialization の全面実装
- OpenCode の内部 event stream を完全に `requested_escalations` へ変換する高精度パーサ
- built-in subagent を複数使う orchestration

これらは将来拡張として設計メモに沿って段階的に進める。

## 実装ルール

### 1. orchestration の主導権を奪わない

- `opencode` に task state の責務を持たせないこと
- stage 遷移、approval gate、audit event、retry、lease は引き続き `shipyard-cp` 側が管理すること
- `opencode` の session や agent 名は adapter 内部詳細として扱い、公開 API 契約へ漏らし過ぎないこと

### 2. LiteLLM の責務を壊さない

- `opencode` を導入しても LiteLLM gateway を除去しないこと
- model routing / fallback / usage accounting の標準入口は LiteLLM のままとすること
- `opencode` が直接 provider を叩く経路を持つ場合は、例外設定として明示管理すること

### 3. logical worker と backend を分離する

- `WorkerType` をむやみに増やさないこと
- `opencode` はまず logical worker の backend / substrate として入れること
- API 契約の互換性を保つこと

### 4. stage ごとの責務分離を守る

- `plan` は read-only / no-edit を原則とする
- `dev` は編集可とする
- `acceptance` は原則 no-edit とし、検証中心とする

## 実装タスク

### Task 1. 設定追加

対象:

- `src/config/index.ts`
- `.env.example`

実装内容:

- `CLAUDE_WORKER_BACKEND`
- `CODEX_WORKER_BACKEND`
- `OPENCODE_CLI_PATH`

期待値:

- backend 選択が環境変数で切り替え可能
- デフォルトは `opencode` を優先

### Task 2. OpenCode executor 追加

対象:

- `src/infrastructure/opencode-executor.ts`
- `src/infrastructure/index.ts`

実装内容:

- `opencode run` を subprocess で実行する executor を追加
- 実行ディレクトリを job ごとに解決
- prompt と一時 `opencode.json` を生成
- stdout / stderr / prompt / config を artifact 化
- timeout / cancel を提供

期待値:

- OpenCode CLI が worker substrate として呼び出せる

### Task 3. OpenCode adapter 追加

対象:

- `src/domain/worker/opencode-adapter.ts`
- `src/domain/worker/index.ts`

実装内容:

- `WorkerAdapter` 契約へ準拠する `OpenCodeAdapter` を追加
- logical worker type は `codex` または `claude_code` を受け取る
- OpenCode 実行結果を `WorkerResult` へ正規化
- `metadata.substrate = "opencode"` を残す

期待値:

- `opencode` を logical worker backend として登録可能

### Task 4. JobService 初期化正常化

対象:

- `src/store/services/job-service.ts`

実装内容:

- `GLM5Adapter` 単独登録をやめる
- backend 設定に応じて logical worker ごとに adapter を登録する
- `submitJob(job, job.worker_type)` へ修正する

期待値:

- dispatch で選定した worker が submit に反映される
- `codex` / `claude_code` が両方初期化される

### Task 5. 設計文書の追加

対象:

- `docs/project/OPENCODE_INTEGRATION_MEMO.md`
- 必要に応じて `README` / `RUNBOOK`

実装内容:

- なぜ `opencode` を substrate として扱うか
- なぜ `WorkerType` を増やさないか
- backend 選択の使い方

期待値:

- 後続実装者が intent を追跡できる

## OpenCode permission マッピング

最低限、次の mapping を採用すること。

### plan

- `edit: deny`
- `bash: deny`
- `webfetch: deny`

### dev

- `edit: allow`
- `bash: allow`
- `webfetch: allow` は network 許可時のみ

### acceptance

- `edit: deny`
- `bash: allow`
- `webfetch: allow` は network 許可時のみ

補足:

- より細かい command pattern 制御は将来拡張でよい
- 今回は責務分離を壊さない最小構成を優先する

## 受け入れ条件

次を満たしたら今回の実装は完了とする。

1. `JobService` が `GLM5Adapter` 一択ではなくなる
2. dispatch で決まった worker type が submit に反映される
3. `opencode` を backend とする `codex` / `claude_code` adapter が初期化できる
4. `npm run check` が通る
5. `npm test` が通る
6. 要件書と設計メモが repo 内に残る

## 実装後に確認すべきこと

- `CLAUDE_WORKER_BACKEND=opencode` で起動した場合、`claude_code` logical worker が OpenCode substrate を使うこと
- `CLAUDE_WORKER_BACKEND=glm` に切り替えた場合、後方互換として GLM backend へ戻せること
- `CODEX_WORKER_BACKEND=opencode` で `codex` worker が初期化されること
- テスト環境では OpenCode 実 CLI がなくてもテストが落ちないこと

## 次フェーズへの申し送り

次に進む実装者は、以下の順で進めること。

1. workspace materialization
2. `opencode serve` / session reuse
3. stage ごとの built-in agent マッピング強化
4. permission event / tool use event の監査正規化強化

本書の目的は、いきなり完成系へ飛ばず、まず現在の課題を確実に解消しつつ `opencode` へ移行できる土台を整えることである。
