# Worker Runtime / Session Control Requirements

Version: `0.2.0`

## 目的

Open Synaptic Code の会話履歴、tool registry、restricted mode、undo/restore point、sub-agent recursion guard の設計と、MIT License の `opencode` V2 session/tool/event 設計を参考にし、Shipyard の worker 実行面を `WorkerJob` 単発送信から `WorkerRuntimeSession` 制御へ拡張する。

Shipyard は OpenCode / Claude Code / GLM / Codex を直接置き換えるのではなく、各 worker を共通の session / policy / artifact / gate 契約で制御する control plane とする。

## 参照

- `../../open-synaptic-code/ARCHITECTURE.md`
- `../../open-synaptic-code/SYNAPTIC_SYSTEM.md`
- `../../opencode/LICENSE`
- `../../opencode/specs/v2/session.md`
- `../../opencode/specs/v2/tools.md`
- `../../opencode/specs/v2/provider-policy.md`
- `docs/project/GLM_TOOL_PLAN_RUN_REQUIREMENTS.md`
- `docs/project/RUN_SYSTEM_INTEGRATION.md`

## Requirements

### WR-REQ-001 WorkerRuntimeSession

Shipyard は worker 実行を `start / send / interrupt / collect / close` の session lifecycle として表現しなければならない。

- session は `session_id`、`job_id`、`worker_type`、`stage`、`state` を持つ。
- session は turn count、tool call count、admitted input count、artifact refs、restore point refs、event cursor を追跡する。
- session は `running / interrupted / completed / failed / closed` のいずれかへ遷移する。

### WR-REQ-001A Durable Input Admission

Shipyard は OpenCode V2 の `session_input` と同じく、prompt admission と実行・昇格を分離できなければならない。

- input は `input_id`、`session_id`、`content`、`delivery`、`state` を持つ。
- `delivery=steer` は次の安全境界で現在 activity へ昇格する。
- `delivery=queue` はFIFOの将来 activity として扱う。
- 同じ `input_id` の完全同一再投入は exact retry として扱う。
- 同じ `input_id` を異なる content / delivery で再利用した場合は契約違反として拒否する。
- `resume=false` は admit-only とし、即時実行を要求しない。

### WR-REQ-002 RuntimePolicy

session は実行前に `RuntimePolicy` を受け取り、以下を制御しなければならない。

- `allowed_paths`
- `max_turns`
- `max_tool_calls`
- `restricted_tools`
- `allow_subagents`
- `restore_points`

### WR-REQ-003 RuntimeToolRegistry

tool registry は tool 定義と invocation policy を分離しなければならない。

- tool 定義は `name`、`kind`、`side_effect`、`requires_write`、`allowed_in_restricted` を持つ。
- tool registration は `registration_id` を持ち、同名toolの重ね登録では最新registrationを有効とする。
- registration close は該当registrationだけを閉じ、下位registrationがあれば再露出する。
- provider turnで広告された `registration_id` と settlement時の最新registrationが一致しない場合、stale tool registration として拒否する。
- path を受ける tool は repo-relative path のみ許可する。
- absolute path と `..` path は拒否する。
- `allowed_paths` 外への write tool は拒否する。
- `allow_subagents=false` の session では sub-agent tool を拒否する。

### WR-REQ-004 RestorePoint

Shipyard は file write 前後の復元点を session artifact として扱える必要がある。

- restore point は `restore_point_id`、`session_id`、`created_at`、`files` を持つ。
- snapshot mode では対象fileの before content または missing state を保持する。
- restore point は `artifacts/jobs/<job_id>/` 配下へ保存可能でなければならない。

### WR-REQ-005 Conversation / Context

session は worker との入出力を turn 単位で保持し、将来の compaction / replay / rework loop に使える形で公開しなければならない。

- turn は `role`、`content`、`created_at`、`tool_calls` を持つ。
- conversation store は `session_id` ごとに turn history、compacted summary、artifact refs を保持する。
- compaction は古い turn を deterministic summary へ畳み込み、直近 turn を指定件数残す。
- conversation record は `artifacts/jobs/<job_id>/` 配下へ保存可能でなければならない。

### WR-REQ-006 Tool Result Normalization

worker runtime は file edit、shell、web、sub-agentなどの tool 実行結果を共通schemaへ正規化できなければならない。

- 正規化結果は `tool`、`status`、`side_effect`、`channel`、`artifact_id`、`exit_code`、`summary` を持つ。
- policyで拒否されたtool invocationは `blocked` として扱い、違反コードを保持する。
- stdout / stderr / json / event stream は `WorkerResult.raw_outputs` へ接続できる形にする。
- model-facing summary は上限文字数でbounded previewにでき、完全出力はartifact refとして保持できなければならない。
- bounded preview は成功結果を装って完全出力を失ってはならず、`bounded=true` と `retained_artifact_id` を残す。

### WR-REQ-007 Background Process Management

worker runtime は long-running command を background process として追跡できなければならない。

- process は `process_id`、`command`、`args`、`cwd`、`pid`、`state` を持つ。
- stdout / stderr は tail として保持する。
- `stop` と `stopAll` により明示停止できる。
- timeout 到達時は停止処理を行う。

### WR-REQ-008 Adapter Parity

WorkerRuntime は OpenCode / Claude Code / GLM / Codex の違いを直接露出させず、共通 session interface で制御できなければならない。

- 既存 `WorkerAdapter` は維持する。
- runtime session は既存 adapter の上位制御層として段階的に接続する。
- 既存 public worker type は変更しない。

### WR-REQ-009 Runtime Adapter Bridge

Shipyard は既存 `WorkerAdapter` を `WorkerRuntimeSession` に接続する薄い bridge を持たなければならない。

- bridge は `WorkerAdapter.submitJob()` を呼び、`external_job_id` を session に紐付ける。
- bridge は `WorkerAdapter.pollJob()` の結果を session state へ反映する。
- `succeeded` は session `completed`、`failed` は session `failed`、`cancelled` は session `interrupted` として扱う。
- bridge は既存 adapter の public contract を変更してはならない。

### WR-REQ-010 OpenCode Event Stream Bridge

Shipyard は OpenCode の event stream / transcript ingestor 出力を runtime-neutral な turn / tool result へ変換できなければならない。

- transcript message は `WorkerRuntimeTurn` へ変換する。
- permission request は system turn として保持し、silent dropしてはならない。
- tool use は `ToolResultNormalizer` を通じて共通schemaへ変換する。
- stdout / stderr は tail として保持する。
- source event count と replay cursor を保持し、再接続・再読込時にどこまで処理したかを追跡できる。

### WR-REQ-011 OpenCode MIT Source Adoption

Shipyard は `opencode` のMITライセンスを尊重し、移植・参考実装を行う場合は採用範囲とライセンス出典を追跡しなければならない。

- OpenCode の実装をそのまま、または実質的に移植する場合、MIT notice を保持する。
- Shipyard へ移す対象は `session / tool / event / permission` の control-plane contract を優先する。
- OpenCode の TUI、provider/model registry、slash command、prompt template、live approval UX は本変更の既定スコープに含めない。
- Effect / Bun 依存をShipyardへ丸ごと持ち込まず、Shipyard の Node/Vitest/既存 domain model に合わせて再実装する。

## Acceptance

- `RuntimeToolRegistry` が restricted mode、sub-agent禁止、path escape、allowed path違反を拒否する。
- `RuntimeToolRegistry` が scoped registration replacement と stale registration 拒否を扱える。
- `WorkerRuntimeSession` が durable input admission、exact retry、conflicting reuse拒否、promotionを扱える。
- `WorkerRuntimeSession` が event cursor 以後のevent replayを返せる。
- `WorkerRuntimeSession` が max turns と interrupt/close を制御する。
- `RestorePointManager` が temp workspace で snapshot と restore を再現できる。
- `ConversationStore` がturn履歴保存、compaction、artifact保存を行える。
- `ToolResultNormalizer` がblocked/failed/succeededを共通schemaへ変換できる。
- `ToolResultNormalizer` がmodel-facing output boundingとretained artifact参照を扱える。
- `BackgroundProcessManager` が開始、tail取得、停止を制御できる。
- `WorkerRuntimeAdapterBridge` が既存 `WorkerAdapter` の submit/poll/cancel を runtime session に反映できる。
- `OpenCodeRuntimeEventBridge` が OpenCode event ingestor 出力を turn / tool result へ変換できる。
- `OpenCodeRuntimeEventBridge` が source event count と replay cursor を返せる。
- 既存 worker adapter / run-system / tool-plan tests を壊さない。

## 明示的な非スコープ

- slash command / prompt template機構は本変更へ含めない。
- provider / model registryは本変更へ含めない。
- project context自動注入は本変更へ含めない。
- live approval UX は親 CLI の責務とし、本変更へ含めない。
- restore point の本格的な `/undo` UX と state rollback 統合は後続検討とする。
