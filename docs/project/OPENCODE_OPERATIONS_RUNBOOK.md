# OpenCode 統合運用 Runbook

## 文書の目的

本書は、`shipyard-cp` で `opencode` backend を使う際の運用手順、確認ポイント、異常時の切り分けを定義する。

実装仕様は [OPENCODE_SPECIFICATION.md](./OPENCODE_SPECIFICATION.md)、API 上の解釈は [OPENCODE_API_CONTRACT.md](./OPENCODE_API_CONTRACT.md) を参照する。本書は運用者向けの実務手順である。

## 対象読者

- backend 実装者
- ローカル検証担当
- acceptance 前の確認担当
- 障害切り分け担当

## 運用前提

- `WorkerType` は `codex` / `claude_code` / `google_antigravity`
- `opencode` は `codex` または `claude_code` の backend としてのみ使う
- `google_antigravity` は本書の直接対象外
- 実行 substrate は `opencode run`

## 起動前チェック

### 設定

最低限確認する環境変数は次のとおり。

```dotenv
CLAUDE_WORKER_BACKEND=opencode
CODEX_WORKER_BACKEND=opencode
OPENCODE_CLI_PATH=opencode
WORKER_WORK_DIR=/tmp/shipyard-jobs
WORKER_JOB_TIMEOUT=600000
```

### 意味

| 変数 | 期待値 |
| --- | --- |
| `CLAUDE_WORKER_BACKEND` | `claude_code` の実 backend |
| `CODEX_WORKER_BACKEND` | `codex` の実 backend |
| `OPENCODE_CLI_PATH` | CLI 実行ファイル |
| `WORKER_WORK_DIR` | host_path 未指定時の作業領域 |
| `WORKER_JOB_TIMEOUT` | タイムアウト上限 |

### 確認観点

1. `CLAUDE_WORKER_BACKEND` と `CODEX_WORKER_BACKEND` が意図した backend になっている
2. `OPENCODE_CLI_PATH` が PATH または絶対パスとして解決可能
3. `WORKER_WORK_DIR` が作成可能

## 実行時の正常系フロー

### flow

1. task を作成する
2. dispatch で `plan` / `dev` / `acceptance` の job を発行する
3. `JobService` が logical worker に応じて adapter を選ぶ
4. `OpenCodeAdapter` が `OpenCodeExecutor.execute(job)` を呼ぶ
5. workspace に `prompt.md` と `opencode.json` を生成する
6. `opencode run "<prompt>"` を実行する
7. `stdout.log` と `stderr.log` を回収する
8. `WorkerResult` へ正規化して state machine へ戻す

## ステージ別確認項目

### plan

- `edit=deny`
- `bash=deny`
- `webfetch=deny`
- 期待成果物は計画 summary または artifact

### dev

- `edit=allow`
- `bash=allow`
- `webfetch` は `network_access` 許可時のみ allow
- 差分またはテスト結果が残ること

### acceptance

- `edit=deny`
- `bash=allow`
- `webfetch` は `network_access` 許可時のみ allow
- verdict が残ることが望ましい

## 生成物チェック

`opencode` backend 実行時は、最低限次を確認する。

| ファイル | 目的 | 期待 |
| --- | --- | --- |
| `prompt.md` | 入力再現 | job ごとに存在 |
| `opencode.json` | permission 再現 | stage に応じた内容 |
| `stdout.log` | 実行出力 | 空でもファイルは存在 |
| `stderr.log` | エラー出力 | 空でもファイルは存在 |

## JobService の期待挙動

### 初期化

`initialize()` では次を満たすことを確認する。

1. `codex` adapter が登録される
2. `claude_code` adapter が登録される
3. `google_antigravity` adapter が登録される
4. `claude_code` が GLM 一択になっていない

### submit

dispatch 後の submit では、次を必ず確認する。

1. `submitJob(job, job.worker_type)` を使う
2. hardcode された `'claude_code'` 経路がない

## 障害切り分け

### 症状: dispatch は成功するが、実際のファイル編集が起きない

確認順:

1. `CLAUDE_WORKER_BACKEND` / `CODEX_WORKER_BACKEND` が `glm` や `simulation` になっていないか
2. `WorkerResult.metadata.substrate` が `opencode` か
3. artifact に `prompt.md` / `opencode.json` があるか
4. `stdout.log` / `stderr.log` に CLI 実行痕跡があるか

典型原因:

- backend が `opencode` ではない
- CLI 実行失敗
- host_path 以外で workspace が cleanup され、再確認場所を誤認している

### 症状: `claude_code` だけが動き、`codex` が動かない

確認順:

1. `CODEX_WORKER_BACKEND` の設定値
2. `initialize()` で `codex` adapter が登録されているか
3. dispatch request の `worker_selection` が `codex` か

### 症状: dispatch で選んだ worker と実行 worker が一致しない

確認順:

1. `WorkerJob.worker_type`
2. `submitJob(job, job.worker_type)` 呼び出し
3. hardcode submit の残存有無

### 症状: acceptance で編集が走ってしまう

確認順:

1. `opencode.json` の `permission.edit`
2. `job.stage`
3. permission 変換ロジック

### 症状: network を使ってほしくないのに webfetch される

確認順:

1. `approval_policy.allowed_side_effect_categories`
2. `network_access` が含まれていないか
3. `opencode.json.permission.webfetch`

## 後方互換チェック

### GLM へ戻す場合

```dotenv
CLAUDE_WORKER_BACKEND=glm
```

このときの期待値:

1. `claude_code` は `GLM5Adapter`
2. `opencode` CLI がなくても `claude_code` 経路は動く
3. `WorkerType` は変わらない

### simulation へ戻す場合

```dotenv
CODEX_WORKER_BACKEND=simulation
CLAUDE_WORKER_BACKEND=simulation
```

このときの期待値:

1. 実 CLI 不要
2. テスト用途の確認が可能

## 受け入れチェックリスト

### 文書

1. 要件、仕様、API 補遺、実装指示、Runbook が repo にある

### 設定

1. backend 設定値が明示されている
2. `OPENCODE_CLI_PATH` が定義されている

### 実行

1. `claude_code` を `opencode` backend で初期化できる
2. `codex` を `opencode` backend で初期化できる
3. dispatch で決まった worker が submit に反映される
4. artifact 4 点が確認できる

### 後方互換

1. `glm` に戻せる
2. `simulation` に戻せる

## レビュー時の観点

1. API に backend 名を露出していないか
2. `WorkerType` を増やしていないか
3. stage ごとの permission が崩れていないか
4. 失敗時に stdout/stderr が残るか
5. cleanup 条件が host_path と managed workspace で分かれているか

## 今回あえて実装しない項目

本書は次を前提にするが、今回の完了条件には含めない。

- `opencode serve` の長寿命 session 管理
- workspace materialization の完全実装
- event stream の高精度解析
- backend を API リクエスト単位で切り替える機能
