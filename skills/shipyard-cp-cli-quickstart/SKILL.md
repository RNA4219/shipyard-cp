---
name: shipyard-cp-cli-quickstart
description: shipyard-cpの実行可能CLIでtask作成、dispatch、状態確認を行う。
---

# shipyard-cp CLI Quickstart

## 読み順

1. `docs/cli-usage.md`
2. `README.md`
3. `.claude/commands/run.md`
4. `.claude/commands/status.md`

## 実行

```powershell
pnpm install
pnpm run build:backend
$env:SHIPYARD_API_URL = "http://localhost:3100"
$env:SHIPYARD_API_KEY = "<operator-key>"
node ./dist/cli.js run "Plan the change" --repo owner/repo
node ./dist/cli.js status <task_id> --events
```

日常運用は `shipyard` CLIを主導線とし、API直打ちは診断時だけ使用する。
