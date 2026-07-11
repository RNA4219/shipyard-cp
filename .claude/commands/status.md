---
name: status
description: Check task state and events with the shipyard CLI
user_invocable: true
---

# Status

```bash
shipyard status
shipyard status <task_id> [--events] [--json]
shipyard status <task_id> --watch
```

`--watch` は終端・blocked・rework状態まで監視します。手動対応が必要な終了コードは2です。
