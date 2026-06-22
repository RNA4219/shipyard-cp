# Run System Integration

## 目的

`shipyard-cp` の Run を中心に、次の 4 repo を疎結合で接続する。

- `agent-protocols`: IntentContract / TaskSeed / Acceptance / PublishGate / Evidence の契約正本
- `agent-taskstate`: Task / Run / ContextBundle / typed_ref の状態正本
- `agent-gatefield`: AI 成果物の DecisionPacket、`pass | warn | hold | block` 判定
- `agent-state-gate`: DecisionPacket、証跡、承認、stale 状態を統合した最終 Assessment

`shipyard-cp` は Run state machine の所有者であり続ける。外部 repo の正本データを複製せず、Run ごとに渡すべき入力を `RunSystemPacket` として監査ログへ残す。
GLM5 `tool_plan` をRunで使う場合の安全要件は [GLM_TOOL_PLAN_RUN_REQUIREMENTS.md](./GLM_TOOL_PLAN_RUN_REQUIREMENTS.md) を正本とする。
QEG/manual-bbを使った gate 判定と enforce mode のバージョンアップ実装は [RUN_SYSTEM_GATE_UPGRADE.md](./RUN_SYSTEM_GATE_UPGRADE.md) を正本とする。

## 現在の接続段階

既定は `advisory` 段階とする。

- `ResultOrchestrator.applyResult()` が有効な `WorkerResult` を受け取った時点で `RunSystemPacket` を生成する。
- packet は `run.systemPacketPrepared` audit event として保存する。
- advisory mode の packet / gate 生成は Run の状態遷移を止めない。
- `RunSystemGate` は同じ packet から gatefield / state-gate / manual-bb / QEG の判定入力を作り、`run.systemGateEvaluated` audit event として保存する。
- `enforce` mode を明示した場合、gatefield `hold|block` または state-gate `allow` 以外は `blocked` に遷移し、`run.systemGateBlocked` audit event を保存する。
- `agent-gatefield` / `agent-state-gate` の実 CLI 呼び出しはまだ行わない。

この段階の目的は、各 Run に対して同じ形の入力証跡を作り、後から外部 gate へ流しても再現できる状態にすること。

## RunSystemPacket の責務境界

### `agent_protocols`

`Evidence` 候補を作る。

- `kind = Evidence`
- `state = Published`
- `taskSeedId`
- `inputHash`
- `outputHash`
- `runtimeMs`
- `exitCode`
- `tool_plan`、execution verdict、diff artifact、test failure summary

ここでは候補を作るだけで、`agent-protocols` の永続化正本にはしない。

### `agent_taskstate`

Task / Run / ContextBundle の参照を集約する。

- `task_ref`
- `run_ref`
- `current_state`
- `context_bundle_ref`
- `resolver_refs`
- `external_refs`
- `tool_plan` rework loop回数
- execution verdict linked ref

Assessment 本体や DecisionPacket 本体は保持しない。

### `agent_gatefield`

DecisionPacket 入力の最小要約を作る。

- artifact count
- test summary
- requested escalation count
- side effects
- patch / branch presence
- worker status
- dry-run mode
- allowed path prefix違反
- 最大変更ファイル数・最大書き込みサイズ違反
- diff artifact
- test failure summarizer
- apply_patch_intent曖昧一致
- execution verdict

`standard` profile を既定とする。

### `agent_state_gate`

最終 Assessment 入力を作る。

- `run_ref`
- `task_ref`
- `evidence_refs`
- `context_bundle_ref`
- expected verdict enum
- gatefield DecisionPacket ref
- shipyard自身のacceptance gate要求

`agent-state-gate` は `allow | revise | needs_approval | require_human | stale_blocked | deny` の最終判定を返す想定。

## Enforce 昇格条件

`advisory` から `enforce` へ移るには、最低限次を満たす。

1. `agent-protocols` の Evidence 候補が schema / semantic validation に通る。
2. `agent-taskstate` へ Run / Task 参照を冪等同期できる。
3. `agent-gatefield` の DecisionPacket が同じ packet 入力から再現可能に生成できる。
4. `agent-state-gate` が DecisionPacket と Evidence 参照から Assessment を生成できる。
5. `hold | block | deny | stale_blocked | needs_approval` を `shipyard-cp` の `blocked` または承認待ち状態へ変換するルールがテスト済み。
6. 外部 repo 不通時の failure policy が `advisory` と `enforce` で分かれている。
7. `tool_plan` の dry-run、diff artifact、allowed path prefix、execution verdict、acceptance gate が `RunSystemPacket` に入り、gatefield/state-gateへ伝播する。

## 失敗時方針

`advisory` では packet 生成失敗を Run 失敗にしない。ただし現実装の packet builder は純粋関数で、通常は失敗しない。

`enforce` では次を fail closed とする。

- DecisionPacket 生成不能
- Assessment 生成不能
- Evidence validation 失敗
- stale docs 未解消
- required approval 不足
- gate verdict が `block` または final verdict が `deny`

## 実装位置

- packet builder: `src/domain/run-system/run-system-packet.ts`
- gate evaluator: `src/domain/run-system/run-system-gate.ts`
- audit hook: `src/domain/result/result-orchestrator.ts`
- audit event type: `src/types/event.ts`
- tests: `test/run-system-packet.test.ts`, `test/run-system-gate.test.ts`

## 次の実装候補

1. `RunSystemConnector` interface を追加し、advisory no-op 実装と local CLI 実装を分離する。
2. `agent-protocols` schema validation を packet test に追加する。
3. `agent-gatefield` dry-run 入力 JSON を生成し、DecisionPacket ref を packet へ戻す。
4. `agent-state-gate` assessment ref を `agent-taskstate` linked ref として同期する。
5. `enforce` mode を設定で明示的に有効化し、既定は advisory のまま維持する。
