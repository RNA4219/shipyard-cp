# 2026-06-23 OpenCode-Compatible Worker Runtime

## Summary

Shipyard は `opencode` を単なる外部CLI substrateとして呼ぶだけでなく、OpenCode V2 の session / tool / event 設計を Control Plane 側へ取り込み始めた。

このリリース節目では、MIT版 OpenCode から次の contract を Shipyard の `WorkerRuntimeSession` 層へ移植した。

- durable input admission
- session event cursor / replay
- scoped tool registry
- stale tool registration rejection
- tool output bounding
- OpenCode event stream normalization
- MIT provenance tracking

対応コミット:

- `5e4418a feat(runtime): adopt opencode-compatible worker runtime contracts`

## What Changed

### WorkerRuntimeSession

`WorkerJob` を単発で投げて終わるだけでなく、worker実行を session lifecycle として扱うための runtime domain を追加した。

主な追加:

- `start / send / interrupt / complete / fail / close / collect`
- durable input `admitInput()`
- admitted input の exact retry
- conflicting input reuse の拒否
- `promoteAdmittedInputs()` による安全境界でのturn昇格
- event `sequence` と `event_cursor`
- `collectEvents(afterSequence)` によるreplay

### RuntimeToolRegistry

OpenCode の scoped registration / stale call rejection の考え方を Shipyard に合わせて実装した。

主な追加:

- tool registration ごとの `registration_id`
- 同名toolのoverlay登録
- registration close による下位registration再露出
- provider turnで広告されたregistrationとsettlement時registrationが違う場合の拒否

### Tool Result Normalization

tool output をそのままmodel-facing summaryに流さず、bounded preview と retained artifact を分離できるようにした。

主な追加:

- `bounded`
- `retained_artifact_id`
- model-facing summary の上限
- full output artifact を失わないための明示的な参照

### OpenCode Event Bridge

既存の OpenCode event ingestor 出力を Shipyard runtime-neutral な形へ変換するbridgeを追加した。

主な追加:

- transcript → `WorkerRuntimeTurn`
- permission request → system turn
- tool use → `NormalizedToolResult`
- stdout / stderr tail
- `source_event_count`
- deterministic `replay_cursor`

### QEG / manual-bb Evidence

OpenCode MIT runtime contract adoption は QEG `standard` profile で `go` 判定済み。

証跡:

- `docs/evidence/shipyard-opencode-mit-runtime-20260623/manual-bb-artifacts.json`
- `docs/evidence/shipyard-opencode-mit-runtime-20260623/manual-bb-gate.md`
- `docs/evidence/shipyard-opencode-mit-runtime-20260623/qeg/gate-input.json`
- `docs/evidence/shipyard-opencode-mit-runtime-20260623/qeg/output-record.json`

## Compatibility

Public worker type は変更しない。

- `codex`
- `claude_code`
- `google_antigravity`

OpenCode は引き続き worker substrate / backend として扱う。Shipyard の上位契約は `WorkerJob` / `WorkerResult` / task state machine / RunSystemGate に残る。

## Explicit Non-Scope

今回の変更には次を含めない。

- OpenCode TUI
- provider / model registry
- slash command runtime
- prompt template runtime
- OpenCode の Effect/Bun runtime 丸ごと移植
- full post-crash provider dispatch recovery

## Validation

実行済み:

- `npm test`
  - 105 files passed
  - 2253 tests passed
  - 15 skipped
- `npm run check`
- `npm run lint`
- QEG `validate`
  - verdict: `go`
  - exit: `0`
- QEG `record`
  - `output-record.json` generated

## Operational Notes

この変更以降、Shipyard の OpenCode 連携は2層で考える。

1. `opencode` backend / serve / adapter 統合
2. Shipyard runtime 内部の OpenCode-compatible session / tool / event contract

1 は外部 worker substrate としての OpenCode。
2 は Shipyard が他 worker にも適用できる control-plane runtime contract。

この分離により、GLM / Claude CLI / Codex などを呼ぶ場合も、将来的には同じ `WorkerRuntimeSession` の統制下で扱える。

