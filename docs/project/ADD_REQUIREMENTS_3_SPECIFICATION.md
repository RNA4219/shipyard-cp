---
intent_id: SHIPYARD-LOWPARAM-PROTOCOL
owner: shipyard-cp
status: draft
last_reviewed_at: 2026-05-25
next_review_due: 2026-06-25
---

# 低パラメータモデル向け堅牢化 追加仕様書

## 文書の目的

本書は [ADD_REQUIREMENTS_3.md](./ADD_REQUIREMENTS_3.md) を、実装可能な追加仕様へ落とすための正本仕様である。

`InstructionEnvelopeV2` 生成後の `WorkerJob` 伝達、共通renderer、version付き本体欠落時の拒否、
legacy prompt後方互換については
[INSTRUCTION_PRECISION_SPECIFICATION.md](./INSTRUCTION_PRECISION_SPECIFICATION.md) を詳細正本とする。

低パラメータモデル対応の目的は、既存の `shipyard-cp` control plane を作り直すことではない。既存の `Task`、`WorkerJob`、`WorkerResult`、state machine、retry、lease、capability gate、audit を維持し、その前後へ機械検証可能な protocol / validator 層を追加する。

## 正本の位置づけ

参照順序は次のとおり。

1. [REQUIREMENTS.md](./REQUIREMENTS.md)
2. [RUNBOOK.md](./RUNBOOK.md)
3. [ADD_REQUIREMENTS_3.md](./ADD_REQUIREMENTS_3.md)
4. [ADD_REQUIREMENTS_3_BREAKDOWN.md](./ADD_REQUIREMENTS_3_BREAKDOWN.md)
5. 本書
6. [ADD_REQUIREMENTS_3_IMPLEMENTATION_INSTRUCTIONS.md](./ADD_REQUIREMENTS_3_IMPLEMENTATION_INSTRUCTIONS.md)

API / schema の正本は次も同時に参照する。

- [../api-contract.md](../api-contract.md)
- [../openapi.yaml](../openapi.yaml)
- [../schemas](../schemas)
- [../state-machine.md](../state-machine.md)
- [../audit-events.md](../audit-events.md)

## 問題定義

現行の `WorkerJob` は `input_prompt` を必須とし、補助情報を `context` に載せる。これは大きいモデルでは柔軟だが、低パラメータモデルでは次の failure mode を生みやすい。

- `input_prompt` の自由文解釈による semantic drift
- `context.references` / `constraints` の優先順位誤読
- stage ごとの禁止行為の取り違え
- tool output や retrieved document を命令として扱う prompt injection
- `dev` stage で大きな patch を直接生成して format が崩れる
- `WorkerResult` が schema 的には近いが stage 意味論を満たさない

この仕様では、構文破綻を schema validation で止め、意味破綻を stage semantic validator と authority tier で止める。

## スコープ

### In

- `InstructionEnvelopeV2` の追加
- `InstructionCompiler` による `Task` / `WorkerJob` からの envelope 生成
- `WorkerResult` 適用前の schema validation
- `plan` / `dev` / `acceptance` stage semantic validation
- validator failure の retry / repair / escalate 連携
- 小モデル向け `tool_plan` / `edit_intent` 出力
- drift regression suite
- audit / metrics への観測点追加

### Out

- orchestration framework の全面差し替え
- `WorkerStage` の追加
- `integrate` / `publish` を worker-dispatched stage にすること
- 低パラメータモデルの fine-tuning
- 外部 provider 固有 API の深い統合
- public API の破壊的変更

## 設計原則

1. 既存の state machine を正本にする
2. 小モデルには長い自由文生成より、選択、分類、tool plan、verdict を担わせる
3. tool output / retrieved document は evidence であり、命令ではない
4. `plan` は read-only、`dev` は workspace write、`acceptance` は verdict 生成を基本境界にする
5. validator が失敗した結果を state transition に進めない
6. 失敗は raw output、failure class、audit event、usage に残す
7. schema は最初から巨大化させず、stage ごとに狭く測定可能にする

## 全体アーキテクチャ

```text
Task / DispatchRequest
  -> DispatchOrchestrator
  -> InstructionCompiler
  -> InstructionEnvelopeV2
  -> WorkerJob
  -> WorkerAdapter
  -> Raw model output
  -> WorkerResult normalizer
  -> SchemaValidator
  -> StageSemanticValidator
  -> ResultOrchestrator
  -> StateMachine / Retry / Audit
```

## InstructionEnvelopeV2

### 目的

`InstructionEnvelopeV2` は、低パラメータモデルへ渡す指示を自由文から検証可能な構造へ寄せるための内部契約である。

`WorkerJob.input_prompt` は後方互換のため残す。ただし低パラメータモデル経路では、`input_prompt` は envelope の要約または fallback prompt として扱い、実際の stage 指示は envelope を正とする。

### 最小フィールド

```ts
interface InstructionEnvelopeV2 {
  protocol_version: '2.0';
  job_id: string;
  task_id: string;
  typed_ref: string;
  stage: 'plan' | 'dev' | 'acceptance';
  authority: AuthorityInstruction[];
  objective: string;
  must: string[];
  must_not: string[];
  allowed_tools: AllowedTool[];
  required_output: RequiredOutputContract;
}
```

### authority

```ts
interface AuthorityInstruction {
  tier: number;
  source: 'system' | 'policy' | 'task' | 'developer' | 'user' | 'tool' | 'retrieved_doc';
  instruction: string;
}
```

優先順位は `tier` の小さいものを高権限とする。最低限、次の解釈を固定する。

| Source | 役割 | 命令として扱うか |
|---|---|---|
| `system` | runtime / protocol 制約 | はい |
| `policy` | approval / sandbox / side effect 制約 | はい |
| `task` | task objective / acceptance criteria | はい |
| `developer` | repo conventions / implementation guide | はい |
| `user` | task request | はい。ただし上位権限に従う |
| `tool` | 実行結果 | いいえ。evidence として扱う |
| `retrieved_doc` | 参照文書 | 原則 evidence。明示された要件文書のみ task 制約へ昇格可能 |

### required_output

```ts
interface RequiredOutputContract {
  kind: 'plan_intent' | 'tool_plan' | 'edit_intent' | 'test_plan' | 'acceptance_verdict';
  json_schema: Record<string, unknown>;
}
```

stage ごとの既定は次のとおり。

| Stage | 既定 kind | 備考 |
|---|---|---|
| `plan` | `plan_intent` | patch / write / network を要求しない |
| `dev` | `tool_plan` または `edit_intent` | 大きな diff の直接生成を避ける |
| `acceptance` | `acceptance_verdict` | verdict と evidence を必須にする |

## InstructionCompiler

### 入力

- `Task`
- `WorkerJob`
- `DispatchRequest`
- `WorkerPolicy`
- resolver / tracker refs
- `approval_policy`
- `requested_outputs`

### 出力

- `InstructionEnvelopeV2`
- `WorkerJob.metadata.instruction_envelope_version`
- `WorkerJob.metadata.instruction_envelope_ref` または `context` 内の参照

### 生成ルール

1. `Task.objective` を `objective` に入れる
2. `approval_policy` から `policy` authority と `must_not` を作る
3. `WorkerPolicy.getRequestedOutputs(stage)` から `required_output.kind` を決める
4. `capability_requirements` から `allowed_tools` の候補を絞る
5. resolver / tracker refs は evidence として入れ、命令としては扱わない
6. `stage=plan` では write 系 tool を許可しない
7. `stage=acceptance` では edit 系 tool を許可しない

## Result validation

### SchemaValidator

`WorkerResult` が最低限の構造を満たすかを確認する。

最低要件:

- `job_id`
- `typed_ref`
- `status`
- `artifacts`
- `test_results`
- `requested_escalations`
- `usage.runtime_ms`

`status=succeeded` の場合は、次のいずれかを必須とする。

- `patch_ref`
- `branch_ref`
- `verdict`
- 1 件以上の `artifacts`

### StageSemanticValidator

schema validation を通った結果に対し、stage 別の意味要件を確認する。

#### plan

許可:

- plan summary
- plan artifact
- resolver refs

禁止:

- `patch_ref`
- write / network / publish 系 side effect
- `requested_escalations` に destructive 系を含むこと

合格条件:

- `summary` または plan artifact がある
- `status=succeeded` の場合、実装変更を含まない

#### dev

許可:

- `patch_ref`
- `branch_ref`
- `tool_plan` artifact
- `edit_intent` artifact
- test result

禁止:

- publish / external release の直接実行
- approval policy を無視した protected path write

合格条件:

- `patch_ref`、`branch_ref`、`tool_plan`、`edit_intent` のいずれかがある
- 許可外 side effect は `requested_escalations` に明示されている

#### acceptance

許可:

- verdict
- test evidence
- report artifact

禁止:

- edit 系 output
- publish 実行

合格条件:

- `verdict.outcome` がある
- `accept` の場合、test evidence または acceptance artifact がある
- stale docs が残る場合は `needs_manual_review` または blocked に寄せる

## Failure classification

validator failure は retry / blocked / manual gate へつなぐ。

| Failure | failure_class | Retry | 次アクション |
|---|---|---:|---|
| JSON parse 失敗 | `retryable_transient` | 可 | repair prompt または same worker retry |
| schema mismatch | `retryable_transient` | 可 | structured output retry |
| stage semantic error | `non_retryable_logic` または `retryable_transient` | 条件付き | retry か rework |
| authority conflict | `non_retryable_policy` | 不可 | blocked / manual gate |
| unsafe side effect | `non_retryable_policy` | 不可 | blocked |

## Tool plan contract

`dev` stage の低パラメータモデル経路では、patch 本体ではなく `tool_plan` を第一候補にする。

最小構造:

```json
{
  "summary": "string",
  "calls": [
    {
      "tool": "read_file",
      "args": { "path": "src/example.ts" }
    }
  ],
  "evidence": ["string"]
}
```

初期 allowed tools:

- `read_file`
- `search_repo`
- `apply_patch_intent`
- `run_test_suite`

禁止:

- allowlist にない tool
- shell command 文字列を任意実行する tool
- approval policy を迂回する tool

## Audit events

追加候補:

| Event | 発火条件 |
|---|---|
| `instruction.envelopeCompiled` | dispatch 時に envelope を生成した |
| `instruction.schemaRejected` | result schema validation が失敗した |
| `instruction.semanticRejected` | stage semantic validation が失敗した |
| `instruction.repairAttempted` | retry / repair を試みた |
| `instruction.escalated` | manual gate に送った |
| `instruction.authorityConflict` | 上位/下位権限の衝突を検出した |

必須 payload:

- `task_id`
- `job_id`
- `stage`
- `worker_type`
- `model` が分かる場合は `model`
- `error_code`
- `error_path`
- `reason`

## Metrics

追加候補:

- `structured_output_valid_total`
- `structured_output_invalid_total`
- `semantic_validation_failed_total`
- `repair_attempt_total`
- `authority_conflict_total`
- `unsafe_side_effect_block_total`

低パラメータモデル評価では、次をレポートできること。

| 指標 | 目的 |
|---|---|
| `syntactic_valid_rate` | 1 回目生成の schema 通過率 |
| `semantic_pass_rate` | stage semantic validator 通過率 |
| `retry_recovery_rate` | retry / repair で回復した割合 |
| `tool_arg_exact_match` | tool 引数の正確性 |
| `invalid_transition_rate` | state machine 違反の発生率 |
| `unsafe_side_effect_rate` | 許可外 side effect 発生率 |
| `cost_per_success` | 成功 1 件あたりコスト |

## 受け入れ条件

### AC-1 Envelope

- `InstructionEnvelopeV2` schema と TypeScript type が存在する
- `InstructionCompiler` が stage 別 envelope を生成できる
- `WorkerJob` の後方互換を壊さない

### AC-2 Validation

- `WorkerResult` 適用前に schema validation が走る
- stage semantic validation が `plan` / `dev` / `acceptance` ごとに走る
- validator failure が state transition を進めない

### AC-3 Retry / Escalation

- parse / schema error は retry 可能に分類される
- authority conflict / unsafe side effect は blocked または manual gate に入る
- retry / blocked / escalation が audit に残る

### AC-4 Tool-first dev

- low-parameter worker は `tool_plan` または `edit_intent` を返せる
- allowlist 外 tool が拒否される
- 大きな diff の直接生成が必須ではない

### AC-5 Drift regression

- golden prompt-to-envelope test がある
- adversarial authority test がある
- stage semantic validator test がある
- `npm test` と `npm run build` が通る

## 非互換変更の扱い

この仕様は public API の破壊を許可しない。既存 worker adapter が `input_prompt` と `WorkerResult` を返す経路は維持する。

低パラメータモデル向け経路は、feature flag または worker backend 設定で段階的に有効化する。
