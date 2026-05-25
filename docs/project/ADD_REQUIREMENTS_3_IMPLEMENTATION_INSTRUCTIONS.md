---
intent_id: SHIPYARD-LOWPARAM-PROTOCOL
owner: shipyard-cp
status: draft
last_reviewed_at: 2026-05-25
next_review_due: 2026-06-25
---

# 低パラメータモデル向け堅牢化 実装手順書

## 目的

本書は [ADD_REQUIREMENTS_3_SPECIFICATION.md](./ADD_REQUIREMENTS_3_SPECIFICATION.md) を実装へ進めるための手順書である。

workflow-cookbook の流儀に従い、要求を小さな Task Seed 相当の単位へ分け、各単位に対象ファイル、実行コマンド、検収条件、rollback 観点を持たせる。

## 正本ドキュメント

- [ADD_REQUIREMENTS_3.md](./ADD_REQUIREMENTS_3.md)
- [ADD_REQUIREMENTS_3_BREAKDOWN.md](./ADD_REQUIREMENTS_3_BREAKDOWN.md)
- [ADD_REQUIREMENTS_3_SPECIFICATION.md](./ADD_REQUIREMENTS_3_SPECIFICATION.md)
- [RUNBOOK.md](./RUNBOOK.md)
- [../api-contract.md](../api-contract.md)
- [../schemas](../schemas)
- [../audit-events.md](../audit-events.md)

## 最重要方針

1. `WorkerStage` は `plan` / `dev` / `acceptance` のまま維持する
2. `integrate` / `publish` は worker stage にしない
3. `WorkerJob.input_prompt` は後方互換として残す
4. validator failure は state transition に進めない
5. 小モデルには patch 本体より `tool_plan` / `edit_intent` を優先させる
6. docs、schema、TypeScript type、test を同じ PR 内で揃える

## 推奨ブランチ

```bash
git checkout -b codex/lowparam-protocol
```

## Phase 0: 契約整合化

### Task 0-1 API port の正本確認

目的:
3100 / 3000 の混在を解消し、低パラメータモデル導入前に契約の揺れを減らす。

対象:

- `README.md`
- `docs/openapi.yaml`
- `docs/DEPLOYMENT.md`
- `infra/docker-compose.yml`
- `infra/docker/docker-compose.yml`

手順:

1. local API の既定 port を確認する
2. compose と OpenAPI servers の差分を確認する
3. 互換目的の port がある場合は明示する
4. docs と infra の説明を揃える

確認:

```bash
npm run check
npm test
```

完了条件:

- README / OpenAPI / compose の説明が矛盾しない
- 互換 port がある場合は用途が文書化されている

### Task 0-2 GLM の分類を統一

目的:
`glm_5` を public worker type とするか、`claude_code` backend とするかを統一する。

対象:

- `README.md`
- `docs/api-contract.md`
- `docs/openapi.yaml`
- `docs/schemas/worker-job.schema.json`
- `src/types/base.ts`
- `src/domain/worker/glm5-adapter.ts`

手順:

1. 実装上の `WorkerType` を確認する
2. public API に `glm_5` を出すか決める
3. 後方互換が必要なら alias 層を作る
4. schema / OpenAPI / README を同時更新する

完了条件:

- `WorkerType` と schema enum が一致する
- GLM backend の扱いが README と実装で一致する

### Task 0-3 `/publish/approve` の正本化

目的:
実装済み endpoint を API 正本に載せる。

対象:

- `docs/api-contract.md`
- `docs/openapi.yaml`
- `src/routes/route-schemas.ts`
- `test/routes.test.ts`

手順:

1. 既存 route の request / response を確認する
2. OpenAPI path を追加する
3. admin 権限が必要なことを明記する
4. route test を追加または更新する

完了条件:

- OpenAPI に `/v1/tasks/{task_id}/publish/approve` がある
- admin 権限の説明がある
- route test が通る

## Phase 1: InstructionEnvelopeV2

### Task 1-1 schema / type 追加

対象:

- `docs/schemas/instruction-envelope-v2.schema.json`
- `docs/schemas/README.md`
- `src/types/instruction.ts`
- `src/types/index.ts`

手順:

1. JSON Schema Draft 2020-12 で schema を追加する
2. `additionalProperties: false` を基本にする
3. `authority.source` と `required_output.kind` を enum 化する
4. TypeScript type を追加して export する
5. schema index に追加する

テスト:

- schema の JSON parse test
- type import の compile check

確認:

```bash
npm run check
npm test -- static-docs.test.ts
```

完了条件:

- schema が `/schemas` endpoint から取得できる
- TypeScript type が import できる

### Task 1-2 InstructionCompiler 追加

対象:

- `src/domain/instruction/instruction-compiler.ts`
- `src/domain/instruction/index.ts`
- `test/instruction-compiler.test.ts`

手順:

1. `Task` と `WorkerJob` から envelope を作る関数を実装する
2. `approval_policy` から `policy` authority を作る
3. `requested_outputs` から `required_output.kind` を決める
4. resolver / tracker refs を evidence 扱いにする
5. stage ごとの `must` / `must_not` を追加する

完了条件:

- `plan` envelope に write 系 tool が含まれない
- `dev` envelope が `tool_plan` または `edit_intent` を要求する
- `acceptance` envelope が `acceptance_verdict` を要求する

### Task 1-3 DispatchOrchestrator へ接続

対象:

- `src/domain/dispatch/dispatch-orchestrator.ts`
- `src/types/job.ts`
- `docs/schemas/worker-job.schema.json`
- `test/dispatch-orchestrator.test.ts`

手順:

1. `WorkerJob.metadata.instruction_envelope_version = "2.0"` を保存する
2. envelope ref を `metadata` または `context` に保存する
3. 既存 adapter が envelope 未対応でも動くようにする
4. dispatch test に metadata 確認を追加する

完了条件:

- 既存 `WorkerJob` の必須フィールドは変えない
- envelope 生成失敗時は dispatch を止め、audit に理由を残す

## Phase 2: Result validation

### Task 2-1 SchemaValidator 追加

対象:

- `src/domain/validation/schema-validator.ts`
- `src/domain/validation/index.ts`
- `test/schema-validator.test.ts`

手順:

1. `WorkerResult` の最小必須チェックを実装する
2. `status=succeeded` の追加条件を実装する
3. error code / path / message を返す
4. Ajv 導入が必要な場合は別 PR に分ける

完了条件:

- 必須配列欠損が reject される
- succeeded なのに output がない結果が reject される

### Task 2-2 StageSemanticValidator 追加

対象:

- `src/domain/stage-validation/stage-semantic-validator.ts`
- `src/domain/stage-validation/index.ts`
- `test/stage-semantic-validator.test.ts`

手順:

1. `plan` / `dev` / `acceptance` ごとの validator を実装する
2. `WorkerJob.stage` を正本にして判定する
3. policy violation と logic failure を分けて返す
4. stale docs や requested escalation の扱いを明示する

完了条件:

- plan で patch が返ると reject される
- dev で output がないと reject される
- acceptance で verdict がないと reject される

### Task 2-3 ResultOrchestrator へ接続

対象:

- `src/domain/result/result-orchestrator.ts`
- `test/result-orchestrator.test.ts`

手順:

1. `applyResult()` の先頭で validation を実行する
2. validation failure を `WorkerResult.status=failed` 相当に正規化する
3. retry / blocked の既存分岐へ流す
4. validation failure で success transition しないことを確認する

完了条件:

- invalid result が `planned` / `dev_completed` / `accepted` へ進まない
- failure class が設定される
- audit event が残る

## Phase 3: Tool-first dev

### Task 3-1 tool_plan schema 追加

対象:

- `docs/schemas/tool-plan.schema.json`
- `src/types/instruction.ts`
- `test/static-docs.test.ts`

手順:

1. `summary` / `calls` / `evidence` の最小 schema を作る
2. `calls[].tool` を allowlist enum にする
3. args は初期段階では object とし、後続で tool 別 schema に分ける

完了条件:

- allowlist 外 tool が reject される
- `tool_plan` artifact の validation ができる

### Task 3-2 GLM / local small model prompt を JSON-only 化

対象:

- `src/domain/worker/glm5-adapter.ts`
- `src/domain/worker/opencode-serve-adapter.ts`
- `test/glm5-adapter.test.ts`
- `test/opencode-serve-adapter.test.ts`

手順:

1. envelope 対応時は JSON-only system prompt を使う
2. raw output を必ず artifact に残す
3. parse 失敗は failed result に正規化する
4. usage に model / provider / tokens / cost を残す

完了条件:

- GLM 経路で structured output が parse される
- parse 失敗が unhandled exception にならない

## Phase 4: Audit / metrics / regression

### Task 4-1 audit event 追加

対象:

- `docs/audit-events.md`
- `src/types/audit.ts` または audit event 定義箇所
- `test/audit*.test.ts`

追加 event:

- `instruction.envelopeCompiled`
- `instruction.schemaRejected`
- `instruction.semanticRejected`
- `instruction.repairAttempted`
- `instruction.escalated`
- `instruction.authorityConflict`

完了条件:

- task_id / job_id / stage / worker_type / reason を追える

### Task 4-2 metrics 追加

対象:

- `src/monitoring/metrics/metrics-collector.ts`
- `test/metrics*.test.ts`

追加候補:

- `structured_output_valid_total`
- `structured_output_invalid_total`
- `semantic_validation_failed_total`
- `repair_attempt_total`
- `authority_conflict_total`

完了条件:

- validation 結果が metrics に反映される
- label に stage / worker_type が含まれる

### Task 4-3 drift regression suite

対象:

- `test/instruction-compiler.test.ts`
- `test/stage-semantic-validator.test.ts`
- `test/authority-conflict.test.ts`

ケース:

1. retrieved doc が policy に反する命令を含む
2. tool output が command 実行を要求する
3. user instruction が approval policy を下げようとする
4. plan stage が patch を返す
5. acceptance stage が edit を返す

完了条件:

- 高権限 instruction が勝つ
- 低権限 instruction は evidence として残る
- unsafe output は state transition に進まない

## 実行コマンド

通常確認:

```bash
npm run check
npm test
npm run build
```

部分確認:

```bash
npx vitest run test/instruction-compiler.test.ts
npx vitest run test/schema-validator.test.ts
npx vitest run test/stage-semantic-validator.test.ts
npx vitest run test/result-orchestrator.test.ts
```

frontend は原則対象外だが、補助 UI へ validation 状態を出す場合は次も実行する。

```bash
cd web
npm test
npm run build
```

## PR 分割

### PR-1 Envelope 基盤

- schema / type
- compiler
- dispatch metadata 接続
- unit tests

### PR-2 Result validation

- schema validator
- stage semantic validator
- result orchestrator 接続
- validation tests

### PR-3 Tool-first dev

- tool_plan schema
- GLM / local model JSON-only prompt
- adapter normalization tests

### PR-4 Observability / regression

- audit events
- metrics
- adversarial regression tests

## 検収記録

workflow-cookbook の acceptance 運用に合わせ、各 PR で検収記録相当の情報を PR 本文または repo 内ドキュメントに残す。

最低限記録する項目:

- 実装した Task
- 実行コマンド
- 成功 / 失敗結果
- validation failure のサンプル
- 残課題

## Rollback / Retry

### Rollback 条件

- 既存 adapter が job を受け取れなくなる
- `WorkerResult` 適用で既存成功ケースが失敗する
- state machine transition が変わる
- metrics / audit 追加で runtime error が出る

### Rollback 手順

1. 直近 PR の変更範囲を確認する
2. schema / type だけを残せるか判断する
3. runtime 接続を feature flag で無効化する
4. `npm run check` と `npm test` を再実行する

### Retry 方針

- parse / schema failure は retryable とする
- authority / policy failure は retry せず blocked にする
- retry 回数は既存 `retry_policy` を正本にする

## Definition of Done

- 仕様書、手順書、schema、TypeScript type が矛盾しない
- `npm run check` が通る
- `npm test` が通る
- `npm run build` が通る
- invalid result が success transition に進まない
- audit event で rejection reason を追える
- 低パラメータモデル経路を無効化しても既存 worker 経路が動く

