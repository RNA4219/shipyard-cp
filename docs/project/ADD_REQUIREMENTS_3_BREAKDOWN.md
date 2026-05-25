# ADD_REQUIREMENTS_3 実装分解

## 目的

`ADD_REQUIREMENTS_3.md` の要求は、低パラメータモデル向けに `shipyard-cp` の worker 指示チャネルを堅牢化することです。

実装方針は、既存の `Task -> WorkerJob -> WorkerResult -> state machine -> audit` を作り直さず、`WorkerJob` の生成前後と `WorkerResult` の適用前に、機械検証可能な protocol 層を追加する形に絞ります。

## 読み取り結果

- 主対象 repo: `shipyard-cp`
- 既存の強み: stage state machine、retry、lease、capability gate、audit、WorkerJob/WorkerResult schema がある
- 現在の弱点: `input_prompt` と柔軟な `context` に意味論的な責務が寄りすぎている
- 最初に避けるべきこと: orchestration framework の全面差し替え、巨大 schema の一括導入、低パラメータモデルに大きな diff を直接生成させる設計

## 実装エピック

| Epic | 目的 | 主な変更先 | 完了条件 |
|---|---|---|---|
| E0 契約整合化 | 既存 docs/schema/API のズレを低コストで消す | `README.md`, `docs/api-contract.md`, `docs/openapi.yaml`, `docs/schemas/*`, `src/types/*` | port、worker type、publish approve 導線の記述が実装と一致する |
| E1 InstructionEnvelopeV2 | 自由文 prompt を stage 別の検証可能な指示 envelope に落とす | `docs/schemas/`, `src/types/`, `src/domain/instruction/` | dispatch 時に `Task + DispatchRequest + WorkerPolicy` から envelope を生成できる |
| E2 Schema validation | 生成物を Result 適用前に構文検証する | `src/domain/validation/`, `src/domain/result/` | invalid JSON/schema mismatch が `failed` または `blocked` として分類される |
| E3 Stage semantic validation | stage ごとの意味破綻を state machine 前で止める | `src/domain/stage-validation/`, `src/domain/result/` | `plan/dev/acceptance` ごとの最低要件を満たさない結果が遷移しない |
| E4 Retry/repair/escalate | 小モデルの失敗を観測可能に回復する | `src/domain/result/`, `src/domain/retry/`, audit events | parse/schema/semantic failure が retry または manual gate に流れる |
| E5 Tool plan 化 | 小モデルには patch 本体ではなく tool/edit intent を出させる | `docs/schemas/`, `src/domain/worker/`, adapters | dev stage で `tool_plan` または `edit_intent` を扱える |
| E6 Drift regression | 低パラメータモデル向けの壊れ方を CI で検知する | `test/`, `.github/workflows/ci.yml` | schema・semantic・authority conflict の回帰テストが通る |

## P0: 先に潰す整合性タスク

### T0-1 API port の正本確認

背景:
`ADD_REQUIREMENTS_3.md` は 3100 と 3000 の混在を指摘しています。README は 3100 を案内していますが、OpenAPI や infra 側の実値も確認して揃える必要があります。

実装対象:
- `docs/openapi.yaml`
- `docs/DEPLOYMENT.md`
- `infra/docker-compose.yml`
- `infra/docker/docker-compose.yml`
- `README.md`

受け入れ条件:
- local API の既定 port が 1 つに決まっている
- docs と compose の公開 port が同じ説明になっている
- 互換目的で 3000 を残す場合は、理由と範囲が明記されている

### T0-2 `glm_5` の表現を logical worker / backend に分離

背景:
`src/types/base.ts` と `docs/schemas/worker-job.schema.json` の `WorkerType` は `codex` / `claude_code` / `google_antigravity` です。一方 README は public worker type に `glm_5` を含むと書いています。

実装対象:
- `README.md`
- `docs/api-contract.md`
- `docs/openapi.yaml`
- `docs/project/OPENCODE_SPECIFICATION.md`
- `src/types/base.ts`
- `docs/schemas/worker-job.schema.json`

受け入れ条件:
- GLM は `claude_code` logical worker の backend なのか、public worker type なのかが 1 つに決まっている
- 型、JSON Schema、OpenAPI、README が同じ分類を使う
- 後方互換が必要なら alias 変換場所が明記されている

### T0-3 `/publish/approve` の正本化

背景:
実装には `/v1/tasks/:task_id/publish/approve` があります。API 正本側にも同じ扱いが必要です。

実装対象:
- `docs/api-contract.md`
- `docs/openapi.yaml`
- `src/routes/route-schemas.ts`
- `test/routes.test.ts`

受け入れ条件:
- publish approval の API が OpenAPI に載る
- admin 権限が必要なことが文書化される
- route test が正本契約と一致する

## P1: Protocol-first の最小実装

### T1-1 `InstructionEnvelopeV2` schema を追加

追加ファイル候補:
- `docs/schemas/instruction-envelope-v2.schema.json`
- `src/types/instruction.ts`
- `src/domain/instruction/index.ts`

最小フィールド:
- `protocol_version`
- `job_id`
- `task_id`
- `typed_ref`
- `stage`
- `authority`
- `objective`
- `must`
- `must_not`
- `allowed_tools`
- `required_output`

受け入れ条件:
- `additionalProperties: false`
- `stage` は `plan` / `dev` / `acceptance`
- `authority.source` は `system` / `policy` / `task` / `developer` / `user` / `tool` / `retrieved_doc`
- `required_output.kind` は stage ごとの enum で制限される

### T1-2 `InstructionCompiler` を作る

追加ファイル候補:
- `src/domain/instruction/instruction-compiler.ts`
- `test/instruction-compiler.test.ts`

入力:
- `Task`
- `WorkerJob`
- `DispatchRequest`
- `WorkerPolicy`

出力:
- `InstructionEnvelopeV2`

受け入れ条件:
- `DispatchOrchestrator` の `buildPrompt()` 由来の自由文を `objective/must/must_not/required_output` に分解する
- `approval_policy` から `must_not` と authority tier を作る
- `requested_outputs` から `required_output.kind` を決める
- 既存 `WorkerJob.input_prompt` は互換用に残し、envelope は `context.instruction_envelope_ref` または `metadata` から参照できる

### T1-3 小さな schema validator を追加

追加ファイル候補:
- `src/domain/validation/schema-validator.ts`
- `test/schema-validator.test.ts`

注意:
現時点の `package.json` に Ajv はありません。最初は依存追加を避け、既存 Fastify schema validation と最小手書き validator で始めるか、Ajv 導入を別タスクにします。

受け入れ条件:
- `WorkerResult` に必須配列がない場合は rejected
- `status=succeeded` なのに `patch_ref` / `branch_ref` / `verdict` / artifact のいずれもない場合は rejected
- error code が `parse_error` / `schema_error` / `semantic_error` に分類される

## P2: Stage semantic validator

### T2-1 `plan` validator

合格条件:
- `status=succeeded` なら `summary` または plan artifact がある
- `requested_escalations` に side effect 系が出ていない
- `patch_ref` を含まない

主なテスト:
- plan stage で patch を返す結果は semantic error
- plan stage で artifact も verdict も summary もない結果は semantic error

### T2-2 `dev` validator

合格条件:
- `patch_ref`、`branch_ref`、または `edit_intent/tool_plan` artifact のいずれかがある
- `test_results` は `not_run` でもよいが、理由 artifact または summary がある
- 許可外 side effect は `requested_escalations` に載る

主なテスト:
- dev stage の直接 publish / external_release は blocked
- high risk で approval policy を無視した結果は blocked

### T2-3 `acceptance` validator

合格条件:
- `verdict.outcome` が必須
- `accept` の場合、最低 1 件の test evidence または acceptance artifact がある
- stale docs がある場合は `needs_manual_review` または block に寄せる

主なテスト:
- verdict なし acceptance は semantic error
- accept だが evidence なしは manual gate

## P3: 小モデル向け tool-first 化

### T3-1 `required_output.kind=tool_plan` を dev stage に導入

schema 案:
- `summary`
- `calls[]`
- `evidence[]`

`calls[].tool` の初期候補:
- `read_file`
- `search_repo`
- `apply_patch_intent`
- `run_test_suite`

受け入れ条件:
- allowed tools 以外の call は semantic error
- args は tool ごとの schema で検証される
- 大きな unified diff は任意で、最初は `apply_patch_intent` を正とする

### T3-2 adapter の出力正規化

対象候補:
- `src/domain/worker/glm5-adapter.ts`
- `src/domain/worker/opencode-serve-adapter.ts`
- `src/domain/worker/production-claude-code-adapter.ts`

受け入れ条件:
- GLM/local small model 経路は JSON-only prompt を使える
- 失敗時は生出力を artifact に残し、`WorkerResult.status=failed` に正規化する
- `usage.litellm.model/provider/tokens/cost` が残る

## P4: retry / repair / escalate

### T4-1 validator failure を retry policy に接続

実装対象:
- `src/domain/result/result-orchestrator.ts`
- `src/domain/retry/`
- audit event 定義

受け入れ条件:
- `schema_error` は retryable logic として扱う
- `authority_conflict` / policy violation は non-retryable policy として扱う
- retry 後も失敗する場合は `blocked` で manual gate に入る

### T4-2 audit と metrics

追加 event 候補:
- `instruction.envelopeCompiled`
- `instruction.schemaRejected`
- `instruction.semanticRejected`
- `instruction.repairAttempted`
- `instruction.escalated`

追加 metric 候補:
- `structured_output_valid_total`
- `semantic_validation_failed_total`
- `repair_attempt_total`
- `authority_conflict_total`

受け入れ条件:
- job_id / task_id / stage / worker_type / model が追える
- raw output artifact と rejection reason が紐づく

## P5: Drift regression suite

### T5-1 golden prompt-to-envelope tests

受け入れ条件:
- low / medium / high risk task の envelope snapshot がある
- resolver/tracker refs が authority tier と evidence に分かれる
- tool output は command ではなく evidence として扱われる

### T5-2 adversarial authority tests

ケース:
- retrieved doc が policy に反する指示を含む
- tool output が「次のコマンドを実行せよ」と言う
- user instruction が approval policy を下げようとする

受け入れ条件:
- 高権限 instruction が勝つ
- 低権限側は evidence として残るが action にならない

### T5-3 model comparison metrics

比較軸:
- syntactic_valid_rate
- semantic_pass_rate
- retry_recovery_rate
- tool_arg_exact_match
- invalid_transition_rate
- unsafe_side_effect_rate
- p50/p95 latency
- cost_per_success

受け入れ条件:
- 低パラメータモデル経路と既存大モデル経路を同じ task set で比較できる
- nightly または手動コマンドで計測できる

## 推奨着手順

1. T0-1 から T0-3 で契約整合性を直す
2. T1-1 と T1-2 で envelope を schema/type/compiler まで入れる
3. T1-3 と T2-1 から T2-3 で Result 適用前 validation を入れる
4. T4-1 で retry / blocked / audit に接続する
5. T3-1 と T3-2 で dev stage を tool_plan 化する
6. T5 系で drift regression を CI または手動検証に載せる

## 最初の PR に切る範囲

最初の PR は次に絞るのが安全です。

- `instruction-envelope-v2.schema.json` 追加
- `src/types/instruction.ts` 追加
- `InstructionCompiler` 追加
- `DispatchOrchestrator` から envelope を生成し、`WorkerJob.metadata.instruction_envelope_version = "2.0"` を保存
- `test/instruction-compiler.test.ts` 追加

この PR では既存 adapter の挙動を変えません。まず envelope を観測可能にしてから、validator と tool_plan に進みます。

## 詳細仕様と実装手順

- 仕様正本: [ADD_REQUIREMENTS_3_SPECIFICATION.md](./ADD_REQUIREMENTS_3_SPECIFICATION.md)
- 実装手順: [ADD_REQUIREMENTS_3_IMPLEMENTATION_INSTRUCTIONS.md](./ADD_REQUIREMENTS_3_IMPLEMENTATION_INSTRUCTIONS.md)
- エージェント実装指示: [ADD_REQUIREMENTS_3_AGENT_INSTRUCTIONS.md](./ADD_REQUIREMENTS_3_AGENT_INSTRUCTIONS.md)
- 検収後修正プラン: [ADD_REQUIREMENTS_3_REMEDIATION_PLAN.md](./ADD_REQUIREMENTS_3_REMEDIATION_PLAN.md)

## Definition of Done

- schema、TypeScript type、OpenAPI/docs の差分が残らない
- `npm test` と `npm run build` が通る
- 既存 `WorkerJob` / `WorkerResult` の後方互換を壊さない
- 低パラメータモデル経路の失敗が raw output、failure class、audit event に残る
- 不正 state transition と許可外 side effect は 0 件を維持する
