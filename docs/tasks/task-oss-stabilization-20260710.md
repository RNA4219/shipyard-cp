---
intent_id: TASK-OSS-STABILIZATION-20260710
owner: shipyard-cp
status: active
last_reviewed_at: 2026-07-11
next_review_due: 2026-08-11
---

# Task Seed: OSS Stabilization and Distribution Hardening

## Objective

shipyard-cpをNode 24 LTS / pnpm 9 / port 3100へ統一し、production container、frontend gate、manual Acceptance、実行可能CLI、安定したtest、署名付きreleaseを同一リリースで成立させる。

## Scope

1. production composeとDockerの認証・Redis・non-root・health契約
2. pnpm monorepoとbackend/frontend/E2E/container CI
3. 全Taskの明示manual Acceptance
4. `shipyard` CLIとClaude Code / Codex wrapper
5. flaky/load test修正とResultOrchestrator分割
6. scan、SBOM、署名、provenance付きGHCR release
7. docs freshness、manual black-box、Acceptance Record

## Invariants

- backend標準portは3100のみ。
- `WorkerJob.input_prompt`と既存API JSON shapeの後方互換を維持する。
- workerのaccept verdictだけではacceptedへ遷移しない。
- apply publishとadmin approvalを自動化しない。
- staging/production deployはshipyard-cp release workflowの責務にしない。
- secretはCLI引数、repo、artifactへ保存しない。

## Acceptance Criteria

- backend/frontend/CLI/buildとrepository gateが成功する。
- backend全testを3回連続で実行してflakeがない。
- frontend unit 95件以上とproduction buildが成功する。
- manual Acceptanceのnegative/positive state遷移が自動・手動証跡で確認できる。
- production composeがhealth、401、operator 200、Redis永続化、non-rootを満たす。
- release workflowがdeploy placeholderを含まず、scan/SBOM/sign/attest/pushを定義する。
- `docs/acceptance/AC-20260710-01.md`がstrict Gateの根拠と判定を記録する。

## Rollback

各PR単位でrollback可能にする。manual Acceptance意味変更を戻す場合もAPI wire shapeは維持し、state-machine/OpenAPI/READMEを同時に戻す。container変更は直前のversioned image digestへrollbackする。
