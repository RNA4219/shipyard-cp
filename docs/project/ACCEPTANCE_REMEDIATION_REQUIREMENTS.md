---
intent_id: SHIPYARD-ACCEPTANCE-REMEDIATION
owner: shipyard-cp
status: draft
last_reviewed_at: 2026-05-25
next_review_due: 2026-06-25
---

# 検収 No-Go 解消 要件定義

## 文書の目的

本書は、2026-05-25 に実施した `manual-bb-test-harness` 検収と `code-to-gate` 解析で得た No-Go 要因を、別エージェントが実装へ進められる要件へ正規化する。

workflow-cookbook の運用に従い、要求は小さな Task Seed 相当へ分割し、各要求に根拠、対象範囲、受け入れ条件、検証コマンドを持たせる。

## 背景

`shipyard-cp` は backend / worker / CLI-first の control plane として、自動テストとビルドの大部分は通過している。一方で、検収時点では次の理由により Go 判定には至らなかった。

- CLI-first 導線である `.claude/commands` の task 作成例が、API 契約上必須の 4 セグメント `typed_ref` に違反している。
- Web 補助 UI の lint が 2 件で失敗している。
- `code-to-gate` scoped 解析で `src` が `blocked_input` になった。ただし critical 3 件は実コード確認上、SQL injection ではなく template literal 誤検知の可能性が高い。
- `/v1/agent/register` と `/v1/agent/unregister` に rate limit 不足の実リスク候補がある。
- OpenCode / 外部 provider 実ランタイムの smoke 証跡が不足している。
- `code-to-gate` の repo root full scan がタイムアウトし、分割解析で代替した。

## 正本参照

優先参照順序:

1. [REQUIREMENTS.md](./REQUIREMENTS.md)
2. [RUNBOOK.md](./RUNBOOK.md)
3. [../api-contract.md](../api-contract.md)
4. [../state-machine.md](../state-machine.md)
5. [../cli-usage.md](../cli-usage.md)
6. 本書
7. [ACCEPTANCE_REMEDIATION_SPECIFICATION.md](./ACCEPTANCE_REMEDIATION_SPECIFICATION.md)
8. [ACCEPTANCE_REMEDIATION_IMPLEMENTATION_INSTRUCTIONS.md](./ACCEPTANCE_REMEDIATION_IMPLEMENTATION_INSTRUCTIONS.md)

検収根拠:

- `manual-bb-test-harness` 検収結果: No-Go
- `code-to-gate` scoped readiness:
  - `src`: `blocked_input`
  - `packages`: `passed`
  - `web/src`: `passed`
- 自動テスト証跡:
  - backend `npm test`: 89 files / 2084 passed / 15 skipped
  - backend `npm run build`: passed
  - backend `npm run lint`: passed
  - web `npm test`: 6 files / 95 passed
  - web `npm run build`: passed
  - web `npm run lint`: failed

## スコープ

### In

- CLI 運用コマンド文書の `typed_ref` サンプル修正
- Web lint 失敗の修正
- agent route の rate limit / abuse 防御確認と必要な実装
- `code-to-gate` critical false positive の整理と suppression または rule 改善の方針化
- `code-to-gate` 分割解析手順の明文化
- OpenCode または GLM / OpenAI-compatible runtime の最小 smoke 検証導線
- Go / No-Go 再判定に必要な検証コマンドの固定

### Out

- `shipyard-cp` の worker orchestration 全面再設計
- provider 全種の live test 完全網羅
- 大型モジュールの大規模分割
- public API の破壊的変更
- `code-to-gate` 本体の恒久修正。ただし必要な改善要求は記録する。

## 要件

### FR-001 CLI task 作成例の canonical typed_ref 化

`.claude/commands/run.md`、`.claude/commands/pipeline.md`、`.claude/commands/batch.md` の task 作成例は、`agent-taskstate` と整合する 4 セグメント `typed_ref` を使わなければならない。

受け入れ条件:

- `"task_001"`、`"pipeline_001"`、`"batch_001"` のような 4 セグメント未満の成功例が残っていない。
- 成功例は `agent-taskstate:task:local:<id>` または同等の `<domain>:<entity_type>:<provider>:<entity_id>` 形式である。
- 不正例を残す場合は、明示的に validation failure の例として説明する。

### FR-002 Web lint ゼロエラー化

Web 補助 UI は `npm run lint` をゼロエラーで通過しなければならない。

受け入れ条件:

- `web/e2e/api-test.spec.ts` の未使用変数が解消されている。
- `web/src/contexts/LanguageContext.tsx` の Fast Refresh 警告が解消されている。
- `cd web && npm run lint` が成功する。

### FR-003 agent registration route の abuse 防御

`/v1/agent/register` と `/v1/agent/unregister` は、認証・認可・rate limit のいずれかで abuse に耐える境界を持たなければならない。

受け入れ条件:

- 既存の global rate limit が当該 route に効く場合は、その証跡となるテストまたは文書がある。
- global rate limit が効かない場合は、route 単位の rate limit を追加する。
- auth 有効時に API key / admin key の要否が route test で確認される。
- rate limit 超過時の expected status がテストで固定される。

### FR-004 code-to-gate false positive の整理

`MISSING_INPUT_SANITIZATION` critical 3 件は、実コード確認に基づき、実リスクか false positive かを明確化しなければならない。

対象:

- `src/infrastructure/opencode-session-executor.ts`
- `src/infrastructure/session-executor/execute.ts`
- `src/store/control-plane-store.ts`

受け入れ条件:

- 実リスクでない場合は `.ctg/suppressions.yaml` に path / rule / reason / expiry を持つ suppression を追加する。
- suppression は broad pattern にしない。
- 実リスクの場合は、入力の sanitize / escape / allowlist / redaction などの修正とテストを追加する。

### FR-005 code-to-gate 検収手順の再現性

repo root full scan が完走しない現状でも、検収時に再実行可能な分割解析手順を提供しなければならない。

受け入れ条件:

- `src`、`packages`、`web/src` の scoped analyze / readiness コマンドが文書化されている。
- 出力先が固定されている。
- `src` の readiness が、false positive 整理後に `blocked_input` ではない状態へ遷移する。
- root full scan の timeout は既知制約として記録され、`code-to-gate` 側の改善候補へ分離されている。

### FR-006 runtime smoke 証跡

少なくとも 1 経路で worker runtime の smoke を通し、task 作成から状態遷移まで確認できなければならない。

受け入れ条件:

- mock ではなく OpenCode、GLM、または local OpenAI-compatible runtime のいずれかを使う。
- task 作成、dispatch、result 反映、state 遷移の観測点が記録される。
- 外部 API key がない環境では skip 条件を明示し、degraded path と live path を分ける。

## 非機能要件

### NFR-001 後方互換

既存の API、state machine、WorkerJob / WorkerResult 契約を破壊しない。

### NFR-002 検証可能性

各修正は lint / test / build / code-to-gate readiness のいずれかで確認可能にする。

### NFR-003 監査性

false positive、suppression、live smoke skip は理由と期限を文書に残す。

### NFR-004 小粒度実装

別エージェントは Phase ごとに小さな PR を作れること。1 PR で unrelated refactor を混ぜない。

## 優先度

| Priority | 要件 | 理由 |
|---|---|---|
| P0 | FR-001, FR-002 | 主導線と品質ゲートの直接 No-Go 要因 |
| P1 | FR-003, FR-004, FR-005 | security / release readiness 判定に影響 |
| P2 | FR-006 | release confidence を高める live 証跡 |

## Gate 条件

Go 判定には最低限、次を満たすこと。

- backend `npm run lint`, `npm test`, `npm run build` が成功する。
- web `npm run lint`, `npm test`, `npm run build` が成功する。
- `.claude/commands` の task 作成成功例が canonical `typed_ref` に統一される。
- `code-to-gate` scoped readiness で `src` が `blocked_input` ではない。
- agent route rate limit 指摘が実装または根拠付き waiver で解消される。

