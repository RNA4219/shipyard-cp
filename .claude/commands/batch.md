---
name: batch
description: Run multiple agents in parallel
user_invocable: true
---

# Run Multiple Agents (Batch)

複数のTaskを作成して並列でエージェントを実行する。

## 使い方

```
/batch <file.json>
```

または

```
/batch --tasks "task1,task2,task3"
```

## 実行手順

1. 各Taskを `POST /v1/tasks` で作成
2. 全Task作成後、各Taskに対して `POST /v1/tasks/{task_id}/dispatch` を実行
3. 並列実行状況をWebSocketで監視

## Batch File Format

```json
{
  "tasks": [
    {
      "title": "Task 1",
      "objective": "Objective 1",
      "typed_ref": "batch_001",
      "repo_ref": {
        "provider": "github",
        "owner": "myorg",
        "name": "repo1",
        "default_branch": "main"
      },
      "dispatch": {
        "target_stage": "plan",
        "worker_selection": "claude_code"
      }
    },
    {
      "title": "Task 2",
      "objective": "Objective 2",
      "typed_ref": "batch_002",
      "repo_ref": {
        "provider": "github",
        "owner": "myorg",
        "name": "repo2",
        "default_branch": "main"
      },
      "dispatch": {
        "target_stage": "plan",
        "worker_selection": "codex"
      }
    }
  ]
}
```

## API実行例

```bash
# Task 1
TASK1=$(curl -s -X POST http://localhost:3000/v1/tasks \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{...}' | jq -r '.task_id')

# Task 2
TASK2=$(curl -s -X POST http://localhost:3000/v1/tasks \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{...}' | jq -r '.task_id')

# 並列dispatch
curl -X POST http://localhost:3000/v1/tasks/$TASK1/dispatch \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{"target_stage": "plan"}' &

curl -X POST http://localhost:3000/v1/tasks/$TASK2/dispatch \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{"target_stage": "plan"}' &

wait
```

## 並列実行制限

`config.json` の設定に従う:

| 設定 | 値 | 説明 |
|------|------|------|
| `max_concurrent_agents` | 300 | 最大同時エージェント数 |
| `max_spawns_per_window` | 150 | 60秒あたりのspawn上限 |

## 進行状況監視

```bash
# WebSocket接続
wscat -c ws://localhost:3000/ws

# 全Task一覧
curl http://localhost:3000/v1/tasks
```