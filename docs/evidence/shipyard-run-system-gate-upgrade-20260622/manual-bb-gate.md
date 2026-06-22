# Shipyard Run System Gate Upgrade manual-bb gate

作成日: 2026-06-22
Profile: standard
対象: RunSystemGate、QEG/manual-bb接続、advisory/enforce mode、4OSS gate contract

## 1. 根拠付き観点

| ID | 観点 | 根拠 | 判定 |
| --- | --- | --- | --- |
| OBS-SY-GATE-001 | `RunSystemPacket` から gatefield/state-gate/QEG/manual-bb の判定を再現できる | `src/domain/run-system/run-system-gate.ts`, `test/run-system-gate.test.ts` | pass |
| OBS-SY-GATE-002 | advisory mode は既存 Run 遷移を止めず、監査イベントだけを残す | `docs/project/RUN_SYSTEM_GATE_UPGRADE.md`, `test/run-system-gate.test.ts` | pass |
| OBS-SY-GATE-003 | enforce mode は acceptance 未通過の applied `tool_plan` を `blocked` に倒す | `src/domain/result/result-orchestrator.ts`, `test/run-system-gate.test.ts` | pass |
| OBS-SY-GATE-004 | clean result は enforce mode でも従来通り dev 完了へ進める | `test/run-system-gate.test.ts` | pass |
| OBS-SY-GATE-005 | 4OSS境界は packet と gate report に分離され、外部CLI未接続であることが明記されている | `docs/project/RUN_SYSTEM_INTEGRATION.md`, `docs/project/RUN_SYSTEM_GATE_UPGRADE.md` | pass |

## 2. リスク

| ID | 優先度 | リスク | 現状 | Gate 影響 |
| --- | --- | --- | --- | --- |
| RISK-SY-GATE-001 | P1 | advisory の観測だけを enforce 済みと誤認する | docs と test で `advisory` は非停止、`enforce` は停止と分離 | mitigated |
| RISK-SY-GATE-002 | P1 | GLM適用済み成果物が acceptance 前に integration/publish へ進む | enforce mode で `acceptance_gate_required` を `blocked` へ変換 | mitigated |
| RISK-SY-GATE-003 | P2 | QEG/manual-bb判定が実装と乖離する | evidence test と QEG fixture で gate contract を検査 | mitigated |
| RISK-SY-GATE-004 | P2 | 外部4OSS CLI未接続を production-ready と誤読する | `RUN_SYSTEM_GATE_UPGRADE.md` に今回範囲外として明記 | monitored |

## 3. 優先度

P0:
- 既定の advisory mode が既存遷移を壊さないこと。
- enforce mode が gate NG を `blocked` へ変換できること。

P1:
- QEG/manual-bb の evidence package が拡張タスクとして分離されること。
- 4OSSの責務境界が文書と実装で一致すること。

P2:
- 外部CLI adapter 実装前でも、同じ判定入力を再利用できること。

## 4. 手動テストケース

| ID | 優先度 | 手順 | 期待結果 |
| --- | --- | --- | --- |
| TC-SY-GATE-MAN-001 | P0 | advisory mode で applied `tool_plan` の result を適用する | `run.systemGateEvaluated` が出るが、Run 遷移は止まらない |
| TC-SY-GATE-MAN-002 | P0 | enforce mode で acceptance 未通過の applied `tool_plan` を適用する | `blocked` へ遷移し、`run.systemGateBlocked` が出る |
| TC-SY-GATE-MAN-003 | P0 | enforce mode で test failure あり result を適用する | state-gate verdict が `revise` または `deny` になり停止する |
| TC-SY-GATE-MAN-004 | P1 | clean result を enforce mode へ渡す | 従来通り `dispatch_acceptance` へ進む |
| TC-SY-GATE-MAN-005 | P1 | QEG fixture を validate する | `go`、blocker 0、residual risk 0 |

## 5. 工数

| 作業 | 見積 |
| --- | --- |
| RunSystemGate pure evaluator | 完了 |
| ResultOrchestrator enforce mode接続 | 完了 |
| QEG/manual-bb evidence package | 完了 |
| 外部4OSS CLI adapter | 後続タスク |

## 6. Gate 判定

判定: go

理由:
- 拡張タスクは `RUN_SYSTEM_GATE_UPGRADE.md` として分離された。
- QEG/manual-bb の gate contract が evidence package と test で検証されている。
- `advisory` は既存動作を維持し、`enforce` は明示時だけ停止する。
- 外部CLI未接続は範囲外として明記され、残留P1 blocker はない。

## 7. Go/No-Go brief

Go:
- Shipyard-cp v0.3.0 として RunSystemGate の内部判定層を導入する。
- QEG/manual-bb を使った検証証跡を拡張タスク単位で残す。

No-Go:
- 外部4OSS CLI adapter なしに、外部正本へ同期済みと主張すること。
- advisory mode の判定だけで production publish を許可すること。
