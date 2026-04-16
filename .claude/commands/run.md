---
name: run
description: Create a task and dispatch to an agent (single run)
user_invocable: true
---

# Run Single Agent

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
| `--worker` | | Worker type: `codex`, `claude_code`, `google_antigravity` |
| `--stage` | | Stage: `plan`, `dev`, `acceptance` |

## 実行手順

1. サーバーが起動しているか確認 (`npm run dev`)
2. Task作成: `POST /v1/tasks`
3. Dispatch: `POST /v1/tasks/{task_id}/dispatch`

## 例

### Plan Stage
```bash
curl -X POST http://localhost:3100/v1/tasks \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{
    "title": "Implement feature X",
    "objective": "Add feature X to the codebase",
    "typed_ref": "task_001",
    "repo_ref": {
      "provider": "github",
      "owner": "myorg",
      "name": "myrepo",
      "default_branch": "main"
    }
  }'

# Response: { "task_id": "task_abc123", ... }

# Dispatch to plan stage
curl -X POST http://localhost:3100/v1/tasks/task_abc123/dispatch \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{
    "target_stage": "plan",
    "worker_selection": "claude_code"
  }'
```

### Dev Stage (after plan)
```bash
curl -X POST http://localhost:3100/v1/tasks/task_abc123/dispatch \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{
    "target_stage": "dev",
    "worker_selection": "claude_code"
  }'
```

## 状態遷移

```
queued -> planning -> planned -> developing -> dev_completed -> accepting -> accepted
```