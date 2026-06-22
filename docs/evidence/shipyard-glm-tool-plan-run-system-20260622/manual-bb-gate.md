# Shipyard GLM tool_plan Run System manual-bb gate

作成日: 2026-06-22
Profile: standard
対象: GLM tool_plan 実行、Run System packet、4OSS連携、QEG/manual-bb証跡

## 1. 根拠付き観点

| ID | 観点 | 根拠 | 判定 |
| --- | --- | --- | --- |
| OBS-SY-001 | GLM tool_plan は unsafe path を直接書き換えない | `docs/project/GLM_TOOL_PLAN_RUN_REQUIREMENTS.md`, `src/domain/worker/tool-plan-executor.ts` | pass |
| OBS-SY-002 | Run System packet は agent-protocols / agent-taskstate / agent-gatefield / agent-state-gate へ同じ run 文脈を渡せる | `docs/project/RUN_SYSTEM_INTEGRATION.md`, `src/domain/run-system/run-system-packet.ts` | pass |
| OBS-SY-003 | tool_plan 実行結果は execution verdict と acceptance gate 要否へ変換できる | `src/domain/run-system/run-system-packet.ts`, `test/run-system-packet.test.ts` | pass |
| OBS-SY-004 | dry-run、diff artifact、allowed path、制限、rework loop は要件化済み | `docs/project/GLM_TOOL_PLAN_RUN_REQUIREMENTS.md`, `test/glm-tool-plan-run-requirements.test.ts` | pass |
| OBS-SY-005 | dry-run、allowed path、変更量制限、diff artifact、artifact実体保存、execution verdict はexecutorへ実装済み | `src/domain/worker/tool-plan-executor.ts`, `test/tool-plan-executor.test.ts` | pass |
| OBS-SY-006 | test失敗要約、rework prompt context、bounded rework guard、tool_plan acceptance gate context、acceptance enforcement audit は実装済み | `src/domain/result/result-orchestrator.ts`, `src/domain/dispatch/dispatch-orchestrator.ts`, `test/result-orchestrator.test.ts` | pass |

## 2. リスク

| ID | 優先度 | リスク | 現状 | Gate 影響 |
| --- | --- | --- | --- | --- |
| RISK-SY-001 | P1 | dry-run / diff artifact / file limit なしで自動適用を広げる | executor実装と単体テストで軽減済み | mitigated |
| RISK-SY-002 | P1 | GLMの成果物を別ゲートで確認せずに成功扱いする | `tool_plan` 適用時に Task へ `acceptance_gate_context` を残し、acceptance stageで `run.acceptanceGateEnforced` を出す | mitigated |
| RISK-SY-003 | P2 | artifact URI が永続化されず、後追い監査できない | executorが `artifacts/jobs/<job_id>/` に `tool-plan.json`、`execution-verdict.json`、`diff-stat.txt`、`diff.patch`、`test-summary.json` を保存 | mitigated |
| RISK-SY-004 | P2 | apply_patch_intent の曖昧一致が再導入される | 要件とテストで完全一致のみを明文化 | monitored |
| RISK-SY-005 | P1 | test失敗要約からGLM再依頼するrework loopが未接続 | test failure summarizerを次dev promptへ渡し、`attempt/max_attempts` により2回を超える差し戻しを `blocked` に倒す | mitigated |

## 3. 優先度

P0:
- 既存の安全な local path 検証とテストが通ること。
- Run packet が4OSS向けの共通文脈を壊さないこと。

P1:
- bounded rework guard が差し戻し上限を超えた実行を止めること。
- 別workerまたはCodex確認の acceptance gate が実行パイプラインへ接続されること。

P2:
- Shipyard自身の acceptance gate 出力を QEG/manual-bb package へ自動接続すること。

## 4. 手動テストケース

| ID | 優先度 | 手順 | 期待結果 |
| --- | --- | --- | --- |
| TC-SY-MAN-001 | P0 | GLM tool_plan に repo 外パスを書かせる | 実行されず、result metadata に rejected operation が残る |
| TC-SY-MAN-002 | P0 | `apply_patch_intent` の locator が一致しない patch を渡す | patch は適用されず、failed/skipped verdict になる |
| TC-SY-MAN-003 | P1 | dry-run mode で `write_file` を含む tool_plan を渡す | ファイルは変わらず、tool-plan artifact だけが生成される |
| TC-SY-MAN-004 | P1 | 失敗する test suite を run_test_suite で実行する | 失敗箇所要約が rework payload に入る |
| TC-SY-MAN-005 | P1 | allowed path prefix 外の書き込みを含む plan を渡す | そのoperationは拒否され、acceptance gate が必要になる |
| TC-SY-MAN-006 | P2 | GLMが変更した後に QEG/manual-bb gate を実行する | evidence package と gate verdict が同一 run_id に接続される |

## 5. 工数

| 作業 | 見積 |
| --- | --- |
| dry-run / allowed path / limit 実装 | 0.5-1.0日 |
| diff artifact / artifact URI永続化 | 0.5日 |
| test failure summarizer / rework prompt context | 完了 |
| bounded rework guard | 完了 |
| acceptance gate接続 / QEG fixture更新 | 完了 |

## 6. Gate 判定

判定: go

理由:
- 要件、Run System packet、4OSS接続文書、契約テスト、dry-run、allowed path、変更量制限、diff artifact、artifact保存、execution verdictは整備済み。
- `tool_plan` 適用時の acceptance gate context と enforcement audit が実装され、acceptance stage なしに成功扱いしない証跡が残る。
- test失敗要約は rework prompt context へ渡り、bounded rework guard により上限超過時は `blocked` へ倒れる。
- standard profile の blocker と残留P1リスクは0。

## 7. Go/No-Go brief

Go:
- GLM `tool_plan` の bounded automatic execution を Shipyard Run に接続する。
- QEG/manual-bbを使った証跡付き検証を標準運用にする。

No-Go:
- GLM tool_plan の全面自動適用を production default にすること。
- 4OSS外部CLIの enforce mode を、別途 adapter 実装なしに有効化すること。
