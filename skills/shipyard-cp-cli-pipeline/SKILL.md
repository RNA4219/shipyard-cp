---
name: shipyard-cp-cli-pipeline
description: shipyard CLIでplanからpublishまでを実行し、manual acceptanceとpublish approvalで安全に停止・再開する。
---

# shipyard-cp CLI Pipeline

```bash
shipyard pipeline "<objective>" --repo owner/repo --base-sha <sha>
```

Acceptance workerのacceptは証跡でありhuman approvalではない。CLIが終了コード2で停止したら、checklistとlogを確認して次を実行する。

```bash
shipyard accept <task_id> --all --checked-by <operator>
shipyard pipeline --resume <task_id> --base-sha <sha>
```

publish applyが承認待ちになった場合は `SHIPYARD_ADMIN_API_KEY` を設定し、`shipyard publish approve`を明示実行する。gateを飛ばしてはならない。
