---
name: agents
description: Show available workers and their capabilities
user_invocable: true
---

# Available Agents

利用可能なWorkerとそのケーパビリティを表示。

## Worker Types

| Worker | 説明 | Capabilities |
|--------|------|--------------|
| `codex` | OpenAI Codex系 | `plan`, `edit_repo`, `run_tests`, `produces_patch`, `produces_verdict` |
| `claude_code` | Claude Code | `plan`, `edit_repo`, `run_tests`, `needs_approval`, `produces_patch`, `produces_verdict`, `networked` |
| `google_antigravity` | Google Agent | `plan`, `produces_verdict` |

## Stage別の必須Capability

| Stage | 必須Capability |
|-------|----------------|
| `plan` | `plan` |
| `dev` | `edit_repo`, `run_tests` |
| `acceptance` | `produces_verdict` |

## 条件付きCapability

| Capability | 条件 |
|------------|------|
| `networked` | ネットワークアクセスが必要な場合 |
| `needs_approval` | 承認フロー内で危険操作を行う場合 |
| `produces_patch` | Patch成果物を生成する場合 |

## API確認

```bash
# Worker capability確認 (内部API)
# dispatch時に自動的にチェックされる

# 手動確認の例
curl -X POST http://localhost:3000/v1/tasks/{task_id}/dispatch \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{
    "target_stage": "dev",
    "worker_selection": "google_antigravity"
  }'

# Response (capability不足の場合):
# {
#   "success": false,
#   "blocked": true,
#   "reason": "insufficient_capability",
#   "missing_capabilities": ["edit_repo", "run_tests"]
# }
```

## 選択ガイド

### Plan Stage
- どのWorkerでも可能
- `claude_code` が推奨（詳細な計画立案）

### Dev Stage
- `codex` または `claude_code`
- ネットワーク必要時は `claude_code`

### Acceptance Stage
- どのWorkerでも可能
- `google_antigravity` はverdict生成専用