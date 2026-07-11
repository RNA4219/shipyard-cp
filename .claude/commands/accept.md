---
name: accept
description: Complete the mandatory manual acceptance gate
user_invocable: true
---

# Accept

```bash
shipyard accept <task_id> --all --checked-by <operator> [--notes <text>]
shipyard accept <task_id> --check <item_id> --checked-by <operator>
```

完了済みchecklist、accept verdict、log artifact、fresh docsが揃わない場合はacceptedへ進みません。
