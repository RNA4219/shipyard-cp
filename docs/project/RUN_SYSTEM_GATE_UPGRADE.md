---
intent_id: INT-RUN-SYSTEM-GATE-UPGRADE-001
owner: shipyard-cp
status: implemented
version: 0.4.0
last_reviewed_at: 2026-06-22
---

# Run System Gate バージョンアップ実装

## 目的

`GLM tool_plan Run要件` の初回導入で作った advisory packet を、QEG と manual-bb の判定に接続できる gate layer へ拡張する。

`0.3.0` では `shipyard-cp` 内部で再現可能な判定契約を対象にした。
`0.4.0` では [RUN_SYSTEM_EXTERNAL_CLI_ADAPTER_REQUIREMENTS.md](./RUN_SYSTEM_EXTERNAL_CLI_ADAPTER_REQUIREMENTS.md) に従い、外部4OSS CLI adapter の実呼び出しまで対象を拡張する。

## 拡張タスク

### EXT-GATE-001 RunSystemGate

`RunSystemPacket` を入力に、次の判定を正規化する。

- `agent-gatefield`: `pass | warn | hold | block`
- `agent-state-gate`: `allow | revise | needs_approval | require_human | stale_blocked | deny`
- `manual-bb`: 手動確認要否と理由
- `QEG`: `go | conditional_go | no_go`、blocker、residual risk

### EXT-GATE-002 advisory / enforce mode

既定は `advisory` とし、既存 Run 遷移を止めない。

`enforce` を明示した場合は、次のいずれかで Shipyard の状態遷移を止める。

- gatefield verdict が `hold` または `block`
- state-gate verdict が `allow` 以外
- tool_plan execution が `failed`
- test failure がある
- applied tool_plan に acceptance gate が必要

### EXT-GATE-003 QEG/manual-bb evidence package

拡張タスク専用の evidence package を作成する。

- manual-bb は必ず `根拠付き観点 -> リスク -> 優先度 -> 手動テストケース -> 工数 -> Gate 判定 -> Go/No-Go brief` の順で記録する。
- QEG は `standard` profile として、blocker と residual risk が 0 の場合だけ `go` とする。
- advisory での `conditional_go` は運用上の観測であり、enforce の停止条件とは分離する。

### EXT-GATE-004 外部4OSS CLI adapter

`RunSystemPacket` を入力に、`agent-protocols`、`agent-taskstate`、`agent-gatefield`、`agent-state-gate` のCLIを実行し、`ExternalRunSystemCliReport` を生成する。

- 実行結果は `run.externalCliGateEvaluated` audit event と artifact に残す。
- `agent-gatefield hold` は residual risk として扱う。
- `agent-state-gate allow` 以外は enforce mode で停止条件にできる。

## 実装契約

- `RunSystemGate` は純粋関数として実装し、外部 process や filesystem に依存しない。
- `ResultOrchestrator` は `runSystemMode` option を持ち、既定値は `advisory` とする。
- `advisory` では `run.systemGateEvaluated` audit event だけを残す。
- `enforce` では gate が block する場合、task を `blocked` に遷移し、`run.systemGateBlocked` audit event を残す。
- applied `tool_plan` は QEG 上 `conditional_go` とし、acceptance gate 通過前に publish 可能な `go` として扱わない。

## 4 OSS 接続

- `agent-protocols`: Evidence / Acceptance 候補の契約参照を受ける。
- `agent-taskstate`: Task / Run / ContextBundle / rework attempt を追跡する。
- `agent-gatefield`: worker status、test summary、tool_plan verdict、side effects から `pass | warn | hold | block` を判定する。
- `agent-state-gate`: gatefield 結果と manual-bb/QEG 証跡を統合し、Shipyard の状態遷移可否へ変換する。

## 受入条件

- `RunSystemPacket` から `RunSystemGateReport` を作れる。
- advisory mode は既存遷移を止めない。
- enforce mode は acceptance gate 未通過の applied `tool_plan` を `blocked` にできる。
- enforce mode は clean result を従来通り進められる。
- QEG/manual-bb evidence が拡張タスク用に分離されている。
- 外部4OSS CLI adapter が実行結果を `RunSystemGateReport` へ合成できる。
- `npm run check`、関連 unit tests、QEG validate が通る。
