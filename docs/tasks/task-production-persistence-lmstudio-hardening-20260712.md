---
intent_id: TASK-PRODUCTION-PERSISTENCE-LMSTUDIO-20260712
owner: shipyard-cp
status: active
last_reviewed_at: 2026-07-12
next_review_due: 2026-08-12
---

# Task Seed: Production Persistence and LM Studio Hardening

## Objective

Redisを本番主系ストアとし、LM Studio / LM Linkを既存logical workerの安全な低リスクbackendとして統合する。

## Scope

1. `shipyard-cp:v2:` namespace、TTL、Redis readiness、Lua version CAS、再起動復元。
2. Task、Job、Result、event、audit、checkpoint、policy、idempotency、retrospectiveの耐久化。
3. OpenAI互換 LM Studio adapterとLM Link透過接続。
4. stage/risk backend routing、plan限定fallback、backend/audit記録。
5. compose実証、LM Studio / LM Link手動実証、SBOM・署名・Acceptance証跡。

## Invariants

- productionは`STORE_BACKEND=redis`でfail-closedとし、memoryへ自動fallbackしない。
- `WorkerType`と`WorkerJob.input_prompt`、既存HTTP JSON正常系を変更しない。
- LM Studioは`/v1/models`と`/v1/chat/completions`だけを使い、モデルライフサイクルやLM Link deviceを操作しない。

## Acceptance Criteria

- Lua CAS、TTL、時系列event、Redis再起動後のgovernance record復元を自動・実コンテナで確認する。
- low-risk plan/devがLM Studio、最終Acceptanceが外部backendとなり、planだけが既定fallbackする。
- 実LM StudioとLM Linkのredact済みログ、Job/Result/auditをAcceptance Recordへ集約する。

## Rollback

v0.4.xのmemory状態は移行しない。v2 Redis keyを書いた後は、v2を読めない旧版へrollbackしない。LM Studio routingを停止する場合は`LMSTUDIO_ENABLED=false`とし、外部backendを維持する。
