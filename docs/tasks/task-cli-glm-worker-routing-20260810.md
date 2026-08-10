---
task_id: 20260810-01
intent_id: INT-CLI-GLM-WORKER-ROUTING-001
owner: shipyard-cp
status: done
last_reviewed_at: 2026-08-10
next_review_due: 2026-09-10
---

# Task Seed: CLI GLM Worker Routing Repair

## Objective

CLI文書が案内していた`--worker glm_5`とpublic APIのlogical worker契約の不一致を解消し、
GLM利用時に`codex`既定値から未導入のOpenCodeへ誤配送される経路を避ける。

## Scope

- CLIで`glm_5`を後方互換aliasとして`claude_code`へ正規化する。
- 未知のworker値をTask作成前に拒否する。
- README、CLI Usage、GLM quickstart、command wrapperをlogical worker/backend分類へ揃える。
- 既存lintとdocumentation freshness gateの失敗を解消する。
- API、`WorkerType`、route schema、state machineは変更しない。

## Acceptance

- [AC-20260810-01](../acceptance/AC-20260810-01.md)
