---
intent_id: INT-INSTRUCTION-PRECISION-001
owner: shipyard-cp
status: active
last_reviewed_at: 2026-06-11
next_review_due: 2026-07-11
---

# Worker指示精度 要件書

## 目的と背景

dispatch 時に生成した機械検証可能な指示を、全 worker 実行経路へ意味を欠落させず伝達する。
自由文 prompt だけに依存した場合に発生する objective、禁止事項、tool境界、出力契約の解釈差を抑止する。

## 正本と優先順位

本要件は [ADD_REQUIREMENTS_3_SPECIFICATION.md](./ADD_REQUIREMENTS_3_SPECIFICATION.md) の
`InstructionEnvelopeV2` 生成要件を、workerへの伝達と実行時解釈まで具体化する。

衝突時の優先順位:

1. [REQUIREMENTS.md](./REQUIREMENTS.md)
2. 本要件書
3. [INSTRUCTION_PRECISION_SPECIFICATION.md](./INSTRUCTION_PRECISION_SPECIFICATION.md)
4. [INSTRUCTION_PRECISION_DESIGN.md](./INSTRUCTION_PRECISION_DESIGN.md)
5. [ADD_REQUIREMENTS_3_SPECIFICATION.md](./ADD_REQUIREMENTS_3_SPECIFICATION.md)
6. [RUNBOOK.md](./RUNBOOK.md)

APIとschemaは [../api-contract.md](../api-contract.md)、[../openapi.yaml](../openapi.yaml)、
[../schemas](../schemas) を同時に正本として扱う。

## スコープ

### In

- `InstructionEnvelopeV2` 本体の `WorkerJob` 伝達
- 全 worker adapter / executor に共通する指示レンダリング
- version付きEnvelope欠落jobの実行前拒否
- 自由文 `input_prompt` の後方互換
- worker指示契約と運用文書の整合

### Out

- Public APIの破壊的変更
- `WorkerStage` / `WorkerType` の追加
- 実CLIバイナリの新設
- result validation、state machine、publish gateの再設計

## ユースケース

1. dispatchされたjobをどのworker backendで実行しても、同じauthorityと制約を解釈できる。
2. Envelopeを持たない既存jobは、従来の自由文promptで実行できる。
3. versionだけ宣言されEnvelope本体が欠落したjobは、曖昧なまま実行されず拒否される。

## 機能要件

### FR-1 Envelope本体の保持

`DispatchOrchestrator`は生成した`InstructionEnvelopeV2`本体を
`WorkerJob.instruction_envelope`へ格納し、追跡用`instruction_envelope_ref`も維持する。

### FR-2 Envelope優先

worker実行時は`instruction_envelope`を`input_prompt`より優先する。
Envelopeはauthority、objective、must、must_not、allowed_tools、required_outputを欠落なく伝達する。

### FR-3 共通解釈

Codex、Claude Code、Google Antigravity、GLM5、OpenCode CLI、OpenCode sessionの全経路は、
同一の共通rendererを使ってworker向けpromptを解決する。

### FR-4 欠落時拒否

`metadata.instruction_envelope_version === "2.0"`かつ
`instruction_envelope`が存在しないjobは、worker実行前に拒否する。

### FR-5 後方互換

Envelopeを持たない既存jobで`input_prompt`が存在する場合、その文字列を変更せず使用する。
`input_prompt`がなくcontextのみ存在する既存jobでは、contextからfallback promptを生成する。

### FR-6 正本同期

`WorkerJob`型、JSON Schema、API契約、OpenAPI、運用文書は同じ伝達規則を記載する。

## 非機能要件

- 型安全: `InstructionEnvelopeV2`を型付きフィールドとして保持する。
- セキュリティ: retrieved documentとtool outputを上位authorityへ昇格しない。
- 可観測性: envelope refとversionを維持し、jobと指示の相関を追跡できる。
- 互換性: Public APIと既存worker type、stage、`input_prompt`を維持する。

## 受入の目安

dispatchされたjobにEnvelope本体が含まれ、全worker経路の対象回帰、型チェック、ビルドが成功し、
version付きEnvelope欠落jobの拒否とlegacy promptの完全保持をテストで確認できること。

