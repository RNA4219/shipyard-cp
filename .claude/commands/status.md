---
name: status
description: Check task and job status
user_invocable: true
---

# Task Status

TaskとJobの状態を確認。

## 使い方

```
/status [task_id]
```

## API

### 全Task一覧
```bash
curl http://localhost:3000/v1/tasks
```

### 特定Task
```bash
curl http://localhost:3000/v1/tasks/{task_id}
```

### Task Events
```bash
curl http://localhost:3000/v1/tasks/{task_id}/events
```

### Job Status
```bash
curl http://localhost:3000/v1/jobs/{job_id}
```

### Run Status
```bash
curl http://localhost:3000/v1/runs/{run_id}
```

## 状態一覧

| State | 説明 |
|-------|------|
| `queued` | 作成直後 |
| `planning` | Plan実行中 |
| `planned` | Plan完了 |
| `developing` | Dev実行中 |
| `dev_completed` | Dev完了 |
| `accepting` | Acceptance実行中 |
| `accepted` | Acceptance完了 |
| `integrating` | Integration実行中 |
| `integrated` | Integration完了 |
| `publish_pending_approval` | Publish承認待ち |
| `publishing` | Publish実行中 |
| `published` | 完了 |
| `blocked` | ブロック中 |
| `rework_required` | 作り直し必要 |
| `failed` | 失敗 |
| `cancelled` | キャンセル |

## Blocked理由

| Reason | 説明 |
|--------|------|
| `insufficient_capability` | Capability不足 |
| `concurrent_execution` | 同時実行競合 |
| `doom_loop_detected` | ループ検出 |
| `agent_tree_limit_exceeded` | エージェント上限超過 |
| `orphaned_run` | 孤児ジョブ |