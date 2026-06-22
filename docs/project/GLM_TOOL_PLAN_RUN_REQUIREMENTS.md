---
intent_id: INT-GLM-TOOL-PLAN-RUN-001
owner: shipyard-cp
status: draft
last_reviewed_at: 2026-06-22
---

# GLM tool_plan Run要件

## 目的

GLM5 dev stage の `tool_plan` を、軽量な実装workerとして安全にRunへ組み込む。
本要件は `shipyard-cp` の Run state machine、`RunSystemPacket`、および次の 4 OSS 連携へ接続する。

- `agent-protocols`: `tool_plan`、実行結果、diff、test summary を Evidence 候補へ入れる。
- `agent-taskstate`: Run、Task、ContextBundle、実行verdict、rework loop回数を typed_ref で追跡する。
- `agent-gatefield`: `tool_plan` 成果物、diff、制限違反、test failure summary を `pass | warn | hold | block` 判定へ渡す。
- `agent-state-gate`: gatefield DecisionPacket、Evidence、承認、stale状態を統合し、`allow | revise | needs_approval | require_human | stale_blocked | deny` を返す。

`shipyard-cp` は `tool_plan` の実行所有者であり、外部OSSは判定・証跡・状態同期の正本として扱う。
QEG/manual-bbを使ったバージョンアップ実装は [RUN_SYSTEM_GATE_UPGRADE.md](./RUN_SYSTEM_GATE_UPGRADE.md) に分離する。

## 用語

- `tool_plan`: GLM5 dev stage が返す、編集・検査・テストの構造化計画。
- `dry-run mode`: workspaceへ書き込まず、実行予定操作だけを記録するmode。
- `execution verdict`: `tool_plan` の実行結果を `executed | applied | skipped | failed | dry_run` で表す正規化結果。
- `diff artifact`: `git diff --stat` と対象diffを保存した成果物。
- `allowed path prefix`: taskまたはEnvelopeで許可されたrepo相対path prefix。
- `shipyard acceptance gate`: GLM編集結果を別workerまたはCodexが確認する受入門番。

## 機能要件

### GTP-REQ-001 dry-run mode

Control Plane は `tool_plan` を実行せず、どのtoolがどのpathへ何を行うかだけを出力できなければならない。

- dry-run は workspaceへ書き込んではならない。
- dry-run は `execution verdict = dry_run` を返す。
- dry-run の予定操作は `agent-gatefield` と `agent-state-gate` に渡せる `RunSystemPacket` に含める。
- high risk task、初回導入、許可pathが未設定のtaskでは dry-run を既定候補にできる。

### GTP-REQ-002 diff artifact生成

実行後、Control Plane は `git diff --stat` と対象diffを artifact として保存できなければならない。

- 保存先は `artifacts/jobs/<job_id>/diff-stat.txt` と `artifacts/jobs/<job_id>/diff.patch` を標準名とする。
- diff artifact は `WorkerResult.artifacts` と `RunSystemPacket.agent_protocols.evidence_candidate` に接続する。
- diffが空の場合も空diffであることを示す artifact または execution verdict を残す。
- `agent-gatefield` は diff artifact の有無、変更量、対象pathを判定入力に使う。

### GTP-REQ-003 最大変更ファイル数・最大書き込みサイズ制限

Control Plane は `tool_plan` 実行に対して最大変更ファイル数と最大書き込みサイズを強制できなければならない。

- 既定値は `max_changed_files = 5`、`max_write_bytes_per_file = 200 KiB` とする。
- 制限超過は実行前に `execution verdict = skipped` または `failed` として止める。
- enforce mode では制限超過を `agent-gatefield` の `hold` または `block` 候補にする。
- 制限値は task policy、InstructionEnvelope、Run設定の順に明示上書きできる。

### GTP-REQ-004 allowed path prefix

TaskまたはInstructionEnvelopeは `allowed_paths` を指定できなければならない。

- `allowed_paths` はrepo相対path prefixのみ許可する。
- 絶対パス、`..`、workspace外参照、空文字prefixは禁止する。
- `write_file` と `apply_patch_intent` は対象pathが `allowed_paths` のいずれかに入る場合だけ適用できる。
- `allowed_paths` 未設定時は、低リスクtaskを除き dry-run または approval gate を要求する。
- 例: `tools/`, `tests/`, `docs/evidence/`

### GTP-REQ-005 test failure summarizer

`run_test_suite` が失敗した場合、Control Plane はstdout/stderr全体ではなく、失敗箇所の要約を生成できなければならない。

- 要約には失敗suite、失敗test名、最初のassertion/error、関連path、終了codeを含める。
- 要約は次のGLM rework入力、`agent-protocols` Evidence、`agent-gatefield` 判定入力に接続する。
- raw stdout/stderrは artifact として保持してよいが、promptへ丸ごと戻してはならない。

### GTP-REQ-006 rework loop

Control Plane は `tool_plan実行 -> test失敗 -> failure summary -> GLM再依頼` のrework loopを実行できなければならない。

- 既定の最大rework回数は `1`、上限は `2` とする。
- 同じfailure summaryまたは同じdiff fingerprintが繰り返された場合はdoom loopとして停止する。
- rework回数は `agent-taskstate` のRun状態へ同期できる。
- rework後の成果物も新しい Evidence として追跡する。

### GTP-REQ-007 artifact URIの実体保存

Control Plane は `data:` や仮想 `artifact://` だけに依存せず、job単位の実体artifactを保存できなければならない。

- 標準保存先は `artifacts/jobs/<job_id>/` とする。
- 最低限 `tool-plan.json`、`execution-verdict.json`、`diff-stat.txt`、`diff.patch`、`test-summary.json` を保存対象にする。
- artifact URIは再読込可能なpathまたは永続store refでなければならない。
- `RunSystemPacket` は artifact URI と hash を Evidence 候補へ接続する。

### GTP-REQ-008 apply_patch_intent曖昧一致禁止

`apply_patch_intent` は対象file内で `locator` が完全一致かつ一意に見つかった場合だけ適用してよい。

- 部分一致、関数名だけの推測、自然言語説明からの推測、複数一致の先頭採用は禁止する。
- 一致数が0または2以上の場合は `execution verdict = failed` とする。
- 失敗理由は `test failure summarizer` と同様に次のrework入力へ渡せる形式で保存する。

### GTP-REQ-009 execution verdict

Control Plane は `tool_plan` 実行結果を `WorkerResult.metadata` だけでなく、Run-system判定入力として正規化しなければならない。

- verdict enum は `executed | applied | skipped | failed | dry_run` とする。
- `executed`: 実行されたがworkspace変更はない。
- `applied`: workspace変更またはtest実行結果が反映された。
- `skipped`: policy、sandbox、workspace未解決、未対応toolにより実行されなかった。
- `failed`: 実行または検証で失敗した。
- `dry_run`: 実行予定のみ記録した。
- verdict は `RunSystemPacket.agent_gatefield.decision_input` と `agent_state_gate.assessment_input` へ接続する。

### GTP-REQ-010 shipyard自身のacceptance gate

GLMがworkspaceへ編集を適用した場合、shipyard-cp は別workerまたはCodexによる acceptance gate を要求できなければならない。

- 自動適用されたdev結果は、原則として `dev_completed -> accepting` を通る。
- acceptance gate は diff artifact、execution verdict、test summary、allowed path結果を確認対象にする。
- high risk task、制限超過、test failure rework後、または gatefield `hold/block` では自動acceptしてはならない。
- acceptance結果は `agent-protocols` Acceptance と Evidence 候補へ接続する。

## RunSystemPacket 追加要件

`RunSystemPacket` は次の情報を保持できなければならない。

- `tool_plan.execution_verdict`
- `tool_plan.dry_run`
- `tool_plan.allowed_paths`
- `tool_plan.changed_files`
- `tool_plan.write_bytes`
- `tool_plan.diff_artifact_refs`
- `tool_plan.test_failure_summary_ref`
- `tool_plan.rework_attempt`
- `tool_plan.acceptance_gate_required`

これらは advisory mode では監査証跡に留め、enforce mode では `agent-gatefield` と `agent-state-gate` の判定結果に従って状態遷移を止められるようにする。

## 受入条件

- `dry-run mode`、`diff artifact生成`、`最大変更ファイル数`、`allowed path prefix`、`test failure summarizer`、`rework loop`、`artifact URIの実体保存`、`apply_patch_intent曖昧一致禁止`、`execution verdict`、`shipyard自身のacceptance gate` が文書化されている。
- 4 OSSの責務境界が本書と `RUN_SYSTEM_INTEGRATION.md` で一致している。
- advisory modeでは既存Run遷移を止めない。
- enforce modeへの昇格条件が明記されている。
- 実装時は `tool_plan` のpolicy違反が `agent-gatefield` / `agent-state-gate` へ伝播する。
- `RunSystemGate` が QEG/manual-bb の期待判定を生成し、advisory modeでは監査証跡、enforce modeでは状態遷移停止に使える。

## 検証

```powershell
npm run check
npx vitest run test/glm-tool-plan-run-requirements.test.ts test/run-system-packet.test.ts test/glm5-adapter.test.ts
npm run lint
npm run build
```
