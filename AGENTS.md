# shipyard-cp Agent Instructions

## 読む順番

1. `README.md`
2. `docs/cli-usage.md`
3. 対象変更に対応する正本文書
4. `docs/tasks/` の対象 Task Seed
5. `docs/acceptance/` の対象 Acceptance Record

## 正本

- 要件: `docs/project/REQUIREMENTS.md`
- 状態遷移: `docs/state-machine.md`
- API: `docs/api-contract.md` と `docs/openapi.yaml`
- schema: `docs/schemas/`
- 実装・運用の現在値: `docs/project/RUNBOOK.md`
- worker 指示契約: `InstructionEnvelopeV2`
- worker 指示伝達の要件・仕様・設計:
  - `docs/project/INSTRUCTION_PRECISION_REQUIREMENTS.md`
  - `docs/project/INSTRUCTION_PRECISION_SPECIFICATION.md`
  - `docs/project/INSTRUCTION_PRECISION_DESIGN.md`

## 実装ルール

- Public API と既存 `WorkerJob.input_prompt` の後方互換を維持する。
- worker 指示は `InstructionEnvelopeV2` を優先し、自由文 prompt は fallback として扱う。
- API、状態遷移、schema のいずれかを変更した場合は、対応する正本文書とテストを同時に更新する。
- `dist/`、`coverage/`、`node_modules/` は編集対象にしない。
- publish、外部リリース、秘密情報アクセス、破壊的操作は明示的な承認なしに実行しない。

## 標準コマンド

```powershell
pnpm run check
pnpm test
pnpm run build
```

## 完了報告

- 変更概要
- 実行した検証と結果
- 未検証事項または残存リスク
- 対応する Acceptance Record
