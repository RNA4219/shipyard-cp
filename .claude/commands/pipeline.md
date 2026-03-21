---
name: pipeline
description: Run full pipeline (plan -> dev -> acceptance -> integrate -> publish)
user_invocable: true
---

# Full Pipeline Execution

Plan → Dev → Acceptance → Integrate → Publish の完全パイプラインを実行。

## 使い方

```
/pipeline <objective> --repo <owner/name>
```

## 実行フロー

```
1. Task作成
   POST /v1/tasks

2. Plan Stage
   POST /v1/tasks/{task_id}/dispatch { target_stage: "plan" }
   → 結果待ち: WebSocketまたはポーリング

3. Dev Stage
   POST /v1/tasks/{task_id}/dispatch { target_stage: "dev" }
   → 結果待ち

4. Acceptance Stage
   POST /v1/tasks/{task_id}/dispatch { target_stage: "acceptance" }
   → 結果待ち

5. Integrate
   POST /v1/tasks/{task_id}/integrate { base_sha: "..." }
   → 結果待ち

6. Publish
   POST /v1/tasks/{task_id}/publish { mode: "apply", idempotency_key: "..." }
   → 承認必要時: POST /v1/tasks/{task_id}/publish/approve
```

## API実行スクリプト例

```bash
#!/bin/bash
set -e

API_URL="http://localhost:3000"
API_KEY="your-api-key"

# 1. Task作成
TASK=$(curl -s -X POST $API_URL/v1/tasks \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{
    "title": "Implement feature",
    "objective": "Add new feature to the application",
    "typed_ref": "pipeline_001",
    "repo_ref": {
      "provider": "github",
      "owner": "myorg",
      "name": "myrepo",
      "default_branch": "main"
    }
  }')
TASK_ID=$(echo $TASK | jq -r '.task_id')
echo "Created task: $TASK_ID"

# 2. Plan Stage
curl -s -X POST $API_URL/v1/tasks/$TASK_ID/dispatch \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{"target_stage": "plan"}'
echo "Dispatched to plan stage"

# 3. Wait for plan completion (polling)
while true; do
  STATE=$(curl -s $API_URL/v1/tasks/$TASK_ID | jq -r '.state')
  echo "Current state: $STATE"
  if [ "$STATE" == "planned" ]; then break; fi
  sleep 5
done

# 4. Dev Stage
curl -s -X POST $API_URL/v1/tasks/$TASK_ID/dispatch \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{"target_stage": "dev"}'

# ... continue for acceptance, integrate, publish
```

## 結果確認

各Stageの結果は `POST /v1/tasks/{task_id}/results` でWorkerから報告される。

```bash
# Events確認
curl $API_URL/v1/tasks/$TASK_ID/events

# Audit Events
curl $API_URL/v1/tasks/$TASK_ID/audit-events

# Run Timeline
curl $API_URL/v1/runs/{run_id}/timeline
```

## 承認フロー

`risk_level: "high"` の場合、Publishで承認が必要:

```bash
# Publish要求
RESPONSE=$(curl -s -X POST $API_URL/v1/tasks/$TASK_ID/publish \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{
    "mode": "apply",
    "idempotency_key": "unique-key-123"
  }')

# 承認トークン取得
APPROVAL_TOKEN=$(echo $RESPONSE | jq -r '.approval_token')

# 承認実行 (admin権限必要)
curl -X POST $API_URL/v1/tasks/$TASK_ID/publish/approve \
  -H "Content-Type: application/json" \
  -H "X-Admin-API-Key: $ADMIN_API_KEY" \
  -d "{\"approval_token\": \"$APPROVAL_TOKEN\"}"
```