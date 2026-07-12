---
intent_id: TASK-SELF-IMPROVEMENT-RUNTIME-OBSERVATIONS-20260712
owner: shipyard-cp
status: completed
last_reviewed_at: 2026-07-12
next_review_due: 2026-08-11
---

# Task Seed: Self-improvement Runtime Observations

## Objective

既存Auditを正本として、workflow-cookbookの`self-improvement/v1`へ安全なruntime観測をexportし、Evidenceの明示ackを記録する。

## Invariants

- Gate判定engineと自己改善DTOの正本をshipyard-cpへ複製しない。
- prompt、raw output、token、Authorization、artifact本文をexportしない。
- GETはackを発生させず、自動Gate削除・policy変更を行わない。

## Acceptance Criteria

- API/CLI、legacy unknown変換、一方向Retrospective adapter、Audit復元projectionを自動テストする。
- `check:all`とbackend全件3回を記録する。
- 30日shadow運用の結果はAcceptanceへ追記し、Gate変更は別Taskにする。
