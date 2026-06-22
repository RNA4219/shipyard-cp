# Shipyard External 4OSS CLI Adapter manual-bb gate

作成日: 2026-06-22
Profile: standard
対象: agent-protocols / agent-taskstate / agent-gatefield / agent-state-gate CLI adapter

## 1. 根拠付き観点

| ID | 観点 | 根拠 | 判定 |
| --- | --- | --- | --- |
| OBS-SY-EXT-001 | 外部4OSS CLI adapter の要件が正本化されている | `docs/project/RUN_SYSTEM_EXTERNAL_CLI_ADAPTER_REQUIREMENTS.md` | pass |
| OBS-SY-EXT-002 | adapter は4OSSコマンドを組み立て、実行結果を `ExternalRunSystemCliReport` に保存できる | `src/domain/run-system/run-system-cli-adapter.ts`, `test/run-system-cli-adapter.test.ts` | pass |
| OBS-SY-EXT-003 | `agent-gatefield hold` の非0終了をCLI故障ではなくJSON decisionとして扱える | `test/run-system-cli-adapter.test.ts`, `docs/evidence/shipyard-external-cli-adapter-20260622/external-cli-smoke.json` | pass |
| OBS-SY-EXT-004 | 外部CLI結果は `RunSystemGateReport` に合成され、enforce mode で停止条件になる | `src/domain/run-system/run-system-gate.ts`, `src/domain/result/result-orchestrator.ts`, `test/run-system-gate.test.ts` | pass |
| OBS-SY-EXT-005 | 実CLI smokeで4OSSの入口を確認した | `external-cli-smoke.json` | pass |

## 2. リスク

| ID | 優先度 | リスク | 現状 | Gate 影響 |
| --- | --- | --- | --- | --- |
| RISK-SY-EXT-001 | P1 | 外部CLIの非0終了を一律failure扱いし、`hold` decisionを失う | `agent-gatefield` はJSON decisionを優先して読む | mitigated |
| RISK-SY-EXT-002 | P1 | 外部CLIが落ちてもadvisoryで見逃される | advisoryは残留リスク記録、enforceは合成gateで停止可能 | mitigated |
| RISK-SY-EXT-003 | P2 | 外部repoの正本DBに副作用を出す | 今回の既定コマンドは validate / help / dry-run / evaluate のみ | mitigated |
| RISK-SY-EXT-004 | P2 | production blockingを既定有効化して既存Runを壊す | adapterは明示optionでのみ起動し、既定は無効 | mitigated |

## 3. 優先度

P0:
- 4OSS CLI adapter が実コマンドを呼べること。
- `agent-gatefield` と `agent-state-gate` の判定が Shipyard の gate に戻ること。

P1:
- QEG/manual-bb の証跡が外部CLI adapter 専用に分離されること。
- 既定挙動を壊さないこと。

P2:
- 実CLI結果を artifact として後追いできること。

## 4. 手動テストケース

| ID | 優先度 | 手順 | 期待結果 |
| --- | --- | --- | --- |
| TC-SY-EXT-MAN-001 | P0 | `agent-protocols` validate を実行する | exit 0 で schema tests が通る |
| TC-SY-EXT-MAN-002 | P0 | `agent-taskstate` CLI help を実行する | exit 0 で CLI command group が表示される |
| TC-SY-EXT-MAN-003 | P0 | `agent-gatefield dry-run --json` を実行する | exit 1 でも JSON decision `hold` を読める |
| TC-SY-EXT-MAN-004 | P0 | `agent-state-gate gate evaluate --output json` を実行する | JSON応答を読める |
| TC-SY-EXT-MAN-005 | P1 | fake external adapter が `deny` を返す | enforce mode で `blocked` になる |

## 5. 工数

| 作業 | 見積 |
| --- | --- |
| 要件定義 | 完了 |
| LocalRunSystemCliAdapter 実装 | 完了 |
| ResultOrchestrator 接続 | 完了 |
| QEG/manual-bb evidence | 完了 |
| 実CLI smoke | 完了 |

## 6. Gate 判定

判定: go

理由:
- 外部4OSS CLI adapter は実装済みで、4OSSコマンドを実際に呼び出せる。
- `agent-gatefield hold` のような非0だが意味のある判定をJSONとして処理できる。
- `agent-state-gate deny` は enforce mode で Shipyard を `blocked` にできる。
- standard profile の blocker と残留P1リスクは0。

## 7. Go/No-Go brief

Go:
- Shipyard-cp v0.4.0 として外部4OSS CLI adapter を導入する。
- QEG/manual-bb 証跡付きで外部CLI adapter を検証済み扱いにする。

No-Go:
- 外部4OSSの正本DB mutationをこのadapterで実施すること。
- production blocking mode を既定有効にすること。
