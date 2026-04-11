# OpenCode 統合 API 契約補遺

## 文書の目的

本書は、`shipyard-cp` の既存 API 契約を前提に、`opencode` 統合時の解釈と運用上の扱いを具体化する補遺である。

正本の優先順位は次のとおり。

1. [docs/openapi.yaml](../openapi.yaml)
2. [docs/api-contract.md](../api-contract.md)
3. [REQUIREMENTS.md](./REQUIREMENTS.md)
4. [OPENCODE_SPECIFICATION.md](./OPENCODE_SPECIFICATION.md)
5. 本書

本書は公開 API を増やすものではない。既存 API を `opencode` backend で使うときの意味付け、期待入出力、失敗時の扱いを明文化する。

## 基本方針

- API 利用者は `opencode` を直接指定しない
- API 利用者が扱うのは `worker_type` だけである
- `opencode` は `codex` または `claude_code` logical worker の backend として内部解決される
- `WorkerType` は公開契約として増やさない
- backend 選択は環境設定で固定され、API リクエストごとに切り替えない

## API と backend の責務分離

| 層 | 利用者から見えるか | 例 |
| --- | --- | --- |
| Public API | 見える | `worker_selection=claude_code` |
| logical worker | 見える | `codex`, `claude_code`, `google_antigravity` |
| backend | 見えない | `opencode`, `glm`, `claude_cli`, `simulation` |
| substrate | 見えない | `opencode run` |

## backend 解決ルール

### `worker_selection=codex`

- `CODEX_WORKER_BACKEND=opencode` の場合:
  - `OpenCodeAdapter(workerType='codex')`
- `CODEX_WORKER_BACKEND=simulation` の場合:
  - `CodexAdapter(workerType='codex')`

### `worker_selection=claude_code`

- `CLAUDE_WORKER_BACKEND=opencode` の場合:
  - `OpenCodeAdapter(workerType='claude_code')`
- `CLAUDE_WORKER_BACKEND=glm` の場合:
  - `GLM5Adapter(workerType='claude_code')`
- `CLAUDE_WORKER_BACKEND=claude_cli` の場合:
  - `ProductionClaudeCodeAdapter(workerType='claude_code')`
- `CLAUDE_WORKER_BACKEND=simulation` の場合:
  - `ClaudeCodeAdapter(workerType='claude_code')`

## `POST /v1/tasks/{task_id}/dispatch` の補足契約

### 目的

dispatch は「logical worker を選ぶ」API であり、「backend を選ぶ」API ではない。

### Request 解釈

```json
{
  "target_stage": "dev",
  "worker_selection": "claude_code"
}
```

この入力の意味は次のとおり。

1. dev stage 用の `WorkerJob` を生成する
2. logical worker は `claude_code` を要求する
3. 実 backend は server 側設定から解決する

### Response 期待値

`WorkerJob.worker_type` には必ず logical worker が入る。

```json
{
  "job_id": "job_123",
  "stage": "dev",
  "worker_type": "claude_code"
}
```

ここに `opencode` は出ない。

### 不変条件

1. dispatch 応答の `worker_type` は submit 時にも同じ値が使われる
2. `job.worker_type` を submit 側で別値に上書きしてはならない
3. `worker_selection` 未指定時も、内部選定結果は `WorkerJob.worker_type` に確定値として入る

## `WorkerJob` の補足契約

### `input_prompt`

- `opencode run` へ最終的に渡る本文
- 実装ガイダンス、参照文書、制約はここへ正規化される
- API 利用者は CLI 用の個別フラグを直接持ち込まない

### `workspace_ref`

`opencode` backend 時の解釈:

- `kind=host_path` かつ絶対パス:
  - そのパスを実行ディレクトリとして使う
- それ以外:
  - `WORKER_WORK_DIR/<job_id>` を使う

### `approval_policy`

`opencode` backend 時の permission 変換元になる。

| field | 用途 |
| --- | --- |
| `mode` | 高位方針 |
| `allowed_side_effect_categories` | `webfetch` などの許可判定 |
| `sandbox_profile` | 補助的メタデータ |

## `WorkerResult` の補足契約

### `metadata`

`opencode` backend で成功した結果には、少なくとも次が入ることを期待する。

```json
{
  "substrate": "opencode",
  "logical_worker": "claude_code"
}
```

### `artifacts`

最低限の artifact は次の 4 種である。

| artifact | kind | 意味 |
| --- | --- | --- |
| `stdout.log` | `log` | 実行標準出力 |
| `stderr.log` | `log` | 実行標準エラー |
| `prompt.md` | `report` | 再現用入力 |
| `opencode.json` | `json` | 実行時 permission 設定 |

### `patch_ref`

stdout に unified diff の兆候があるときだけ設定される。

判定条件:

- `--- `
- `+++ `

の両方を含むこと。

### `verdict`

`acceptance` stage では次の順で判定する。

1. stdout 全文を JSON として parse
2. `outcome` があれば採用
3. parse 失敗時はテキスト heuristic
4. `reject` または `rework` を含むと `rework`
5. それ以外は `accept`

## ステージ別 API 期待挙動

### plan

- API 利用者は通常 `target_stage=plan` を投げる
- `opencode` 側では `edit/bash/webfetch` すべて deny
- `WorkerResult` には計画 summary または artifact が残ることを期待する

### dev

- repo 編集とローカル bash 実行を許可する
- `allowed_side_effect_categories` に `network_access` がない限り `webfetch` は deny
- 差分がある場合は `patch_ref` または artifact 群で追跡可能であること

### acceptance

- 追加編集は行わない前提
- テスト、検証、判定は可能
- `WorkerResult.verdict` を返すことが望ましい

## API から見た成功・失敗

### dispatch 成功

- HTTP は `202 Accepted`
- 返る `WorkerJob.worker_type` は logical worker

### result 成功

- HTTP は `200 OK`
- `ResultApplyResponse.task` の state が次工程へ進む

### backend 失敗

API 利用者に見える主な失敗経路は次のとおり。

| 状況 | API / 状態 |
| --- | --- |
| adapter submit 失敗 | dispatch 側でエラー |
| CLI 実行失敗 | `/results` 反映時に `failed` 系へ遷移 |
| タイムアウト | `WorkerResult` または job poll 上で失敗扱い |
| capability mismatch | dispatch で `blocked` 相当 |

## 代表シナリオ

### シナリオ1: `claude_code` を `opencode` backend で dev 実行

1. `POST /v1/tasks/{task_id}/dispatch`
2. request:

```json
{
  "target_stage": "dev",
  "worker_selection": "claude_code"
}
```

3. response:

```json
{
  "job_id": "job_dev_001",
  "stage": "dev",
  "worker_type": "claude_code"
}
```

4. server 内部では `OpenCodeAdapter(workerType='claude_code')` が使われる
5. 後続 `WorkerResult.metadata.substrate` は `opencode`

### シナリオ2: `claude_code` を GLM backend に戻す

1. 環境設定を `CLAUDE_WORKER_BACKEND=glm` に変更
2. 同じ API request を送る
3. API 上の見え方は同じ
4. server 内部だけが `GLM5Adapter` へ切り替わる

## 非互換変更として扱うべき事項

次のいずれかを行う場合は、単なる補遺ではなく API 契約変更として扱う。

1. `WorkerType` に `opencode` を追加する
2. `dispatch` request で backend 指定を受け付ける
3. `WorkerResult.metadata` を必須契約へ昇格する
4. `WorkerJob` に `backend` フィールドを公開追加する

## レビュー観点

本補遺に照らしたレビュー観点は次のとおり。

1. API 層に backend 名が漏れていないか
2. `job.worker_type` が submit 時に変えられていないか
3. `opencode` backend 時の artifact 最低 4 点が再現できるか
4. `CLAUDE_WORKER_BACKEND=glm` で後方互換が維持されるか
