---
intent_id: TASK-BOUNDED-GLM-ADVISORY-20260718
owner: shipyard-cp
status: completed
last_reviewed_at: 2026-07-18
next_review_due: 2026-08-18
---

# Task Seed: Bounded GLM Advisory Bridge

## Objective

Shipyard-cpが既に管理するGLM credentialとDashScope `glm-5`経路を、外部control planeから利用できるread-only JSON advisory境界として提供する。

## Scope

- request fileからsanitized promptだけを受理する単発CLI
- `CLAUDE_WORKER_BACKEND=glm`、exact `glm-5`、DashScope coding-intl `/v1`、credential存在のpreflight
- temperature 0、1024 output tokens、fallback/tool execution/external deliveryなし
- credential、prompt、provider error本文をstdout・log・artifactへ出さない
- Arrival promotion operatorとのactual advisory実証

## Invariants

- credential値はShipyard-cp runtime memory外へ出さない。
- bridgeはrepo edit、tool call、task transition、accept、integrate、publishを実行しない。
- model substitution、fallback、local absolute path、credential materialを拒否する。
- bridge成功は上流のpromotion authorityまたはEvidence authorityにならない。

## Acceptance Criteria

- bounded bridge unit testとTypeScript checkが成功する。
- secret値を含まないpreflightがexact provider/modelを返す。
- actual `glm-5` responseをstrict wrapperで返し、上流が独立検証できる。
- 既存shipyard-cp差分を変更・commit対象へ混入させない。

## Rollback

新規bridge、test、Task/Acceptance、CLI文書の追加だけを戻す。既存worker、API、state machine、credential設定は変更しない。

## Current Result

completed。preflight、TypeScript check、ESLint、2230 backend tests、actual DashScope `glm-5` direct run、OpenClaw trigger経由runが成功した。credential値はShipyard-cp runtime memory外へ投影されず、fallback/tool/deliveryは0。Arrivalは最初のreason-code mismatchをquarantineし、後続advisoryをledger不変で受理した。
