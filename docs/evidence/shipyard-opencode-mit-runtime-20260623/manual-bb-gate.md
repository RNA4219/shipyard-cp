# Shipyard OpenCode MIT Runtime Contract manual-bb gate

作成日: 2026-06-23
Profile: standard
対象: OpenCode MIT由来の session / tool / event 契約を Shipyard WorkerRuntime へ移植した差分

## 1. 根拠付き観点

| ID | 観点 | 根拠 | 判定 |
| --- | --- | --- | --- |
| OBS-SY-OCMIT-001 | OpenCode MIT由来の採用範囲と非移植範囲が正本化されている | `docs/project/WORKER_RUNTIME_SESSION_REQUIREMENTS.md`, `docs/project/OPENCODE_MIT_PORTING_NOTES.md` | pass |
| OBS-SY-OCMIT-002 | durable input admission と turn promotion が分離されている | `src/domain/worker-runtime/worker-runtime.ts`, `test/worker-runtime-session.test.ts` | pass |
| OBS-SY-OCMIT-003 | scoped tool registration と stale registration 拒否が実装されている | `src/domain/worker-runtime/worker-runtime.ts`, `test/worker-runtime-session.test.ts` | pass |
| OBS-SY-OCMIT-004 | model-facing tool output は bounded preview と retained artifact ref に分離できる | `src/domain/worker-runtime/tool-result-normalizer.ts`, `test/worker-runtime-extensions.test.ts` | pass |
| OBS-SY-OCMIT-005 | OpenCode event bridge は source event count と replay cursor を返す | `src/domain/worker-runtime/opencode-runtime-event-bridge.ts`, `test/worker-runtime-adapter-bridge.test.ts` | pass |
| OBS-SY-OCMIT-006 | 全体回帰テストが通過している | `npm test`, `npm run check`, `npm run lint` | pass |

## 2. リスク

| ID | 優先度 | リスク | 現状 | Gate 影響 |
| --- | --- | --- | --- | --- |
| RISK-SY-OCMIT-001 | P1 | MIT由来コード・設計の出典が曖昧になる | porting notes にMIT noticeと採用範囲を記録 | mitigated |
| RISK-SY-OCMIT-002 | P1 | provider turnで広告したtoolと異なるhandlerをsettlement時に実行する | `registration_id` 不一致を stale registration として拒否 | mitigated |
| RISK-SY-OCMIT-003 | P1 | 大きなtool出力を要約だけで成功扱いして完全出力を失う | `bounded=true` と `retained_artifact_id` を保持 | mitigated |
| RISK-SY-OCMIT-004 | P2 | OpenCode本体のTUI/provider registryまでShipyardへ過剰移植する | 非スコープを明記し、control-plane contractだけ移植 | mitigated |

## 3. 優先度

P0:
- WorkerRuntime が durable input admission、tool registry、event cursor を壊さず扱えること。
- 既存 Shipyard 全体テストを壊さないこと。

P1:
- MIT出典と非移植範囲が追跡できること。
- output bounding が完全出力artifact参照を失わないこと。

P2:
- 次のOpenCode移植判断に使える採用記録があること。

## 4. 手動テストケース

| ID | 優先度 | 手順 | 期待結果 |
| --- | --- | --- | --- |
| TC-SY-OCMIT-MAN-001 | P0 | `test/worker-runtime-session.test.ts` を確認する | durable admission、exact retry、conflict拒否、promotion、event replayが検証されている |
| TC-SY-OCMIT-MAN-002 | P0 | 同テストで scoped tool registration を確認する | stale registration が拒否され、上位registration close後に下位registrationが再露出する |
| TC-SY-OCMIT-MAN-003 | P1 | `test/worker-runtime-extensions.test.ts` を確認する | bounded summary と retained artifact ref が検証されている |
| TC-SY-OCMIT-MAN-004 | P1 | `test/worker-runtime-adapter-bridge.test.ts` を確認する | replay cursor が deterministic に出る |
| TC-SY-OCMIT-MAN-005 | P0 | `npm test`, `npm run check`, `npm run lint` を実行する | すべて成功する |

## 5. 工数

| 作業 | 見積 |
| --- | --- |
| OpenCode source/spec確認 | 完了 |
| WorkerRuntime移植 | 完了 |
| テスト追加 | 完了 |
| QEG/manual-bb evidence | 完了 |
| 全体回帰 | 完了 |

## 6. Gate 判定

判定: go

理由:
- OpenCode MIT由来の移植範囲は `session / tool / event / output bounding` のcontrol-plane contractに限定されている。
- 主要リスクであるlicense provenance、stale tool execution、lossy output success はテストと文書で抑止済み。
- standard profile の blocker と残留P1リスクは0。

## 7. Go/No-Go brief

Go:
- Shipyard WorkerRuntime へOpenCode MIT由来のruntime contractを導入する。
- 今後OpenCode本体からさらに移植する場合も `OPENCODE_MIT_PORTING_NOTES.md` に採用範囲を追記する。

No-Go:
- TUI、provider/model registry、slash command runtimeをこの差分に混ぜること。
- retained artifact ref なしで大出力をbounded previewだけにすること。
