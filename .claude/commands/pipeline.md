---
name: pipeline
description: Run and resume the governed shipyard pipeline
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
0. Backend自動起動確認
   npm run ensure:win

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
shipyard pipeline "<objective>" --repo <owner/name> --base-sha <sha> [--publish-mode dry_run|no_op|apply]
```

Acceptance workerが完了するとTaskは `accepting` に留まり、CLIは終了コード2で停止します。

```bash
shipyard accept <task_id> --all --checked-by <operator>
shipyard pipeline --resume <task_id> --base-sha <sha>
```

apply publishで承認が必要な場合も終了コード2で停止します。自動承認は行いません。

```bash
shipyard publish approve <task_id> --approval-token <token>
```
