---
task_id: 20260611-01
intent_id: INT-INSTRUCTION-PRECISION-001
owner: shipyard-cp
status: done
last_reviewed_at: 2026-06-11
next_review_due: 2026-07-11
---

# Task Seed: Instruction Precision Hardening

## Objective

dispatch 時に生成した `InstructionEnvelopeV2` を全 worker 実行経路へ欠落なく渡し、
repo 内の運用指示を現在の実装と整合させる。

## Scope

- In:
  - `WorkerJob` の後方互換な instruction envelope 伝達契約
  - 全 worker 経路で共有する prompt renderer
  - fallback prompt の objective / constraints / required output 強化
  - repo 入口の `AGENTS.md`
  - API port、package manager、acceptance 運用の主要文書整合
  - instruction 伝達と文書整合の回帰テスト
  - 専用要件・仕様・設計文書とBirdseye同期
- Out:
  - Public API の破壊的変更
  - 実 CLI バイナリの新規実装
  - RUNBOOK の全面分割
  - release tag / GitHub Release 作成

## Requirements

- `InstructionEnvelopeV2` 本体を `WorkerJob` に保持する。
- envelope version が指定されているのに本体がない job は worker 実行前に拒否する。
- renderer は authority、objective、must、must_not、allowed_tools、required_output を出力する。
- envelope を持たない既存 job は自由文 prompt へ後方互換フォールバックする。
- 標準 API port は `3100`、標準 package manager は `pnpm` とする。
- acceptance worker が `accept` verdict を返した場合は自動的に `accepted` へ進む現在仕様を文書化する。

## Constraints

- `WorkerJob.input_prompt` を削除しない。
- worker type と public API の既存 enum を変更しない。
- publish gate と高リスク task の手動確認を弱めない。
- 変更は既存 TypeScript / Vitest の構成に従う。

## Acceptance

- [AC-20260611-01](../acceptance/AC-20260611-01.md)

## Specifications

- [INSTRUCTION_PRECISION_REQUIREMENTS.md](../project/INSTRUCTION_PRECISION_REQUIREMENTS.md)
- [INSTRUCTION_PRECISION_SPECIFICATION.md](../project/INSTRUCTION_PRECISION_SPECIFICATION.md)
- [INSTRUCTION_PRECISION_DESIGN.md](../project/INSTRUCTION_PRECISION_DESIGN.md)

## Commands

```powershell
pnpm run check
pnpm test
pnpm run build
```

## Notes

- workflow-cookbook の Task Seed / Acceptance Record 様式を使用する。
- 実装完了後、status を `done` に更新する。
