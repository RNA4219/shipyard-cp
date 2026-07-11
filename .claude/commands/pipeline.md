---
name: pipeline
description: Run and resume the governed shipyard pipeline
user_invocable: true
---

# Pipeline

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
