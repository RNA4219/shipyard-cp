# OpenCode 統合設計メモ

## 目的

`shipyard-cp` の orchestration / policy / audit / state machine を維持したまま、coding agent の実行 substrate を `opencode` ベースへ置き換えるための設計メモである。

今回のメモでは、次の 2 つを同時に満たすことを目的とする。

- `shipyard-cp` が抱えていた「GLM-5 を `claude_code` として代用し、CLI 系 adapter が起動経路に乗っていない」課題を解消する
- 将来的に `opencode serve` / session / built-in agent を使った本格統合へ拡張できる境界を決める

## 現状課題

### 1. 実行 substrate と論理 worker が混ざっている

現行実装では `JobService.initialize()` が `GLM5Adapter({ workerType: 'claude_code' })` のみを登録していた。

その結果、次の問題があった。

- 論理 worker 名 `claude_code` の裏で、実際には Claude Code CLI ではなく GLM-5 completion が動く
- `claude-code-adapter.ts` / `codex-adapter.ts` が存在しても、実行経路では使われない
- `submitJob(job, 'claude_code')` の hardcode により、dispatch で選ばれた worker を無視する

### 2. 「ツールを使える」と宣言しても、実際の coding agent 実行になっていない

`GLM5Adapter` は capability 上 `supports_tools: true` を返すが、実装上は LiteLLM 経由の chat completion を呼ぶだけであり、ファイル編集や bash 実行の substrate を持たない。

このため、`edit_repo` / `run_tests` / `needs_approval` の能力が実ジョブと整合していなかった。

### 3. 実 worker の差し替え余地が少ない

実行 backend の選択がコードに埋め込まれており、短期の CLI 連携と中長期の `opencode` 統合を同じ枠組みで扱いづらかった。

## 設計方針

### 基本原則

- `shipyard-cp` は orchestration を保持する
- 論理 worker type (`codex`, `claude_code`, `google_antigravity`) は既存 contract を維持する
- 実行 substrate は logical worker の裏側 backend として選択可能にする
- LiteLLM は「推論 gateway」の責務に留め、coding agent 実行 substrate を兼務させない
- `opencode` は第一級 substrate として扱うが、state machine の主導権は `shipyard-cp` に残す

### 今回の実装で採る構造

```text
DispatchOrchestrator
  -> WorkerJob(worker_type=codex/claude_code/google_antigravity)
  -> JobService
       -> backend selection from config
       -> WorkerExecutor.registerAdapter(logical worker -> backend adapter)
            codex         -> OpenCodeAdapter or CodexAdapter
            claude_code   -> OpenCodeAdapter or GLM5Adapter or ProductionClaudeCodeAdapter or ClaudeCodeAdapter
            google_antigravity -> AntigravityAdapter
```

この構造により、API / state / audit で見える `worker_type` は従来どおりに保ちつつ、実行基盤だけを `opencode` に切り替えられる。

## OpenCode 統合戦略

### Phase 1: CLI substrate として統合

今回実装する範囲。

- `OpenCodeExecutor` を追加し、`opencode run` を非対話ジョブとして実行する
- `OpenCodeAdapter` を追加し、論理 worker (`codex` / `claude_code`) の backend として利用可能にする
- `JobService` で backend 選択を設定化し、hardcode をやめる

### Phase 2: server/session 統合

将来拡張。

- `opencode serve` を headless worker endpoint として起動
- `job_id <-> session_id` の対応を保存
- long-running session で Plan / Dev / Acceptance の再接続、artifact 回収、cancel を強化
- transcript / event stream を監査ログへ逐次反映

詳細要件と仕様は次を参照する。

- [OPENCODE_SERVE_REQUIREMENTS.md](./OPENCODE_SERVE_REQUIREMENTS.md)
- [OPENCODE_SERVE_SPECIFICATION.md](./OPENCODE_SERVE_SPECIFICATION.md)
- [OPENCODE_SERVE_IMPLEMENTATION_INSTRUCTIONS.md](./OPENCODE_SERVE_IMPLEMENTATION_INSTRUCTIONS.md)
- [OPENCODE_SERVE_PHASE2B_REQUIREMENTS.md](./OPENCODE_SERVE_PHASE2B_REQUIREMENTS.md)
- [OPENCODE_SERVE_PHASE2B_IMPLEMENTATION_INSTRUCTIONS.md](./OPENCODE_SERVE_PHASE2B_IMPLEMENTATION_INSTRUCTIONS.md)
- [OPENCODE_SERVE_PHASE2B_COMPLETION.md](./OPENCODE_SERVE_PHASE2B_COMPLETION.md)
- [OPENCODE_SERVE_PHASE2C_REQUIREMENTS.md](./OPENCODE_SERVE_PHASE2C_REQUIREMENTS.md)
- [OPENCODE_SERVE_PHASE2C_IMPLEMENTATION_INSTRUCTIONS.md](./OPENCODE_SERVE_PHASE2C_IMPLEMENTATION_INSTRUCTIONS.md)
- [OPENCODE_SERVE_PHASE2C_COMPLETION.md](./OPENCODE_SERVE_PHASE2C_COMPLETION.md)

### Phase 3: agent-aware 統合

将来拡張。

- `build` / `plan` built-in agents を stage policy にマップ
- `explore` / `general` 等の subagent 利用を adapter 内で吸収
- agent 切り替えや child session を 1 つの `WorkerJob` に畳み込んで監査可能にする

## コンポーネント設計

### OpenCodeExecutor

責務:

- 実行ディレクトリ決定
- prompt / `opencode.json` の一時生成
- `opencode run` の subprocess 実行
- stdout / stderr の保存
- artifact の回収

補足:

- `workspace_ref.kind === 'host_path'` かつ `workspace_id` が絶対パスなら、その場所で実行する
- それ以外は `WORKER_WORK_DIR/<job_id>` を一時 workspace とする

これは将来、workspace materialization が実装された時に host path 実行へ自然に移行するための最小措置である。

### OpenCodeAdapter

責務:

- `WorkerAdapter` 契約への正規化
- job submit / poll / cancel
- OpenCode の実行結果を `WorkerResult` へ変換
- substrate metadata を記録

正規化方針:

- patch らしき unified diff が出た場合は `patch_ref` へ格納
- acceptance では JSON verdict またはテキスト heuristic から `verdict` を作る
- stdout / stderr / config / prompt は artifact として保存する
- `metadata.substrate = "opencode"` を付与する

## 権限と approval の扱い

OpenCode は permission モデルを持つため、`shipyard-cp` 側の approval policy と矛盾しないように一時 `opencode.json` を生成する。

今回の最小マッピング:

- `plan`: `edit=deny`, `bash=deny`, `webfetch=deny`
- `dev`: `edit=allow`, `bash=allow`, `webfetch` は network 許可時のみ `allow`
- `acceptance`: `edit=deny`, `bash=allow`, `webfetch` は network 許可時のみ `allow`

この設計により、少なくとも「Plan で変更しない」「Acceptance で編集しない」という大枠は守れる。

## 今回解消する課題

### 課題1: ツール統合が必要

対応:

- `OpenCodeAdapter` と `OpenCodeExecutor` を追加
- `opencode run` を CLI substrate として使えるようにした

効果:

- 実ファイル探索 / bash / 編集を行う coding agent substrate への接続口ができた
- GLM completion だけでは扱えなかった coding agent 実行面を分離できた

### 課題2: `job-service.ts` では GLM5Adapter のみ登録

対応:

- `JobService.initialize()` を backend 選択式へ変更
- `codex` と `claude_code` の論理 worker ごとに adapter を登録
- `google_antigravity` も初期化経路へ追加

効果:

- CLI / OpenCode / GLM の切り替えが設定ベースで可能になった
- `GLM5Adapter` を `claude_code` に固定代入する構造を解消した

### 課題3: submit 時に worker 選定が無視される

対応:

- `submitJob(job, 'claude_code')` の hardcode を廃止
- `submitJob(job, job.worker_type)` へ修正

効果:

- dispatch 時に決まった logical worker selection が実際の submit に反映される

## 残課題

今回の実装では、次はまだ未解決である。

- repo checkout / workspace materialization は未実装
- `opencode serve` / session reuse は未実装
- built-in agent の明示切り替えは設計メモ先行で、runtime 実装は最小
- tool event / permission event の詳細構造は upstream の server mode に寄せて強化余地あり

## 推奨する次の実装

1. `workspace_ref` に実体パスを持たせ、repo checkout 済み workspace で OpenCode を動かす
2. `opencode serve` ベースの adapter を追加し、session 継続と event stream を扱う
3. stage ごとの agent マッピングを config 化し、`plan` / `build` / custom review agent を切り替えられるようにする
4. `WorkerResult.requested_escalations` を OpenCode の permission event から厳密生成する
