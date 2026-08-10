---
name: run
description: Create a task and dispatch it with the shipyard CLI
user_invocable: true
---

# Run

Taskを作成してエージェントにdispatchする。

## 使い方

```
/run <objective> [--repo <owner/name>] [--worker <type>] [--stage <stage>]
```

## 引数

| 引数 | 必須 | 説明 |
|------|------|------|
| `<objective>` | ✓ | Taskの目的 |
| `--repo` | | 対象リポジトリ (例: `anthropics/claude-code`) |
| `--worker` | | Logical worker type: `codex`, `claude_code`, `google_antigravity`。`glm_5`はCLI互換alias |
| `--stage` | | Stage: `plan`, `dev`, `acceptance` |

## 実行手順

1. サーバーを自動起動確認する (`npm run ensure:win`)
2. Task作成: `POST /v1/tasks`
3. Dispatch: `POST /v1/tasks/{task_id}/dispatch`

`ensure:win` は `http://127.0.0.1:3100/healthz` を確認し、未起動ならバックグラウンドで `node dist/server.js` を起動してから処理を続ける。

## 例

### Plan Stage
```bash
shipyard run "<objective>" --repo <owner/name> [--worker codex|claude_code|google_antigravity|glm_5] [--stage plan|dev|acceptance]
```

GLM-5を使う場合はserver側を`CLAUDE_WORKER_BACKEND=glm`にし、`--worker claude_code`を指定します。CLIの`--worker glm_5`は`claude_code`へ正規化されますが、API直打ちでは`worker_selection: "claude_code"`を使います。

認証は `SHIPYARD_API_KEY`、接続先は `SHIPYARD_API_URL` で設定します。
`--typed-ref` 未指定時はcanonical local typed_refを自動生成します。機械処理では `--json` を使います。
