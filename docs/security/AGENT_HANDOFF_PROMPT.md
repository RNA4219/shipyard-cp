# Agent Handoff Prompt

以下を、そのまま次のエージェントへの依頼文として使用すること。

---

`shipyard-cp` のセキュリティ確認作業を進めてください。

前提:

- 対象リポジトリは `C:\Users\ryo-n\Codex_dev\shipyard-cp`
- 既存のセキュリティ文書は `docs/security/` 配下にある
- 今回は、文書整備フェーズではなく、文書に基づく実査と判定更新フェーズを進める
- ただし、いきなり大規模実装変更へ入るのではなく、まず確認、証跡整理、判定更新を優先する

最初に読む文書:

1. `docs/security/README.md`
2. `docs/security/SECURITY_RUNBOOK.md`
3. `docs/security/SECURITY_INVENTORY.md`
4. `docs/security/SECURITY_VERIFICATION_CHECKLIST.md`
5. `docs/security/RISK_REGISTER.md`
6. `docs/security/SECURITY_REVIEW_REPORT.md`
7. `docs/security/SECURITY_EXECUTION_INSTRUCTIONS.md`

今回の最優先対象:

1. `RISK-001` auth default safety 未検証
2. `RISK-002` role escalation path 未検証
3. `RISK-003` destructive endpoint protection 未検証
4. `RISK-004` secret exposure 管理未確定
5. `RISK-005` audit completeness 未検証
6. `RISK-006` backend policy drift 未検証

やってほしいこと:

1. `SECURITY_VERIFICATION_CHECKLIST.md` に沿って、実装、設定、CI、監査記録の観点を確認する
2. 各項目について `Pass / Fail / Blocked / Not Applicable` を判断する
3. 判断根拠を記録する
4. `RISK_REGISTER.md` の状態、期限、責任者、制限条件を更新する
5. `SECURITY_REVIEW_REPORT.md` に暫定判定または最終判定を記録する

必須ルール:

- 実装未確認の項目を `Closed` にしない
- 証跡なしで `Pass` にしない
- `Critical` / `High` が残る場合は `Go` にしない
- `Fail` または重要な `Blocked` が残る場合は、`No-Go` または再判定条件を明記する
- 仕様上そうなっていることと、実装上そう動くことを混同しない

期待する成果物:

- 更新済み `docs/security/SECURITY_VERIFICATION_CHECKLIST.md`
- 更新済み `docs/security/RISK_REGISTER.md`
- 更新済み `docs/security/SECURITY_REVIEW_REPORT.md`

作業完了時に必ず報告してほしいこと:

1. どの `Risk ID` を確認したか
2. 何が `Pass / Fail / Blocked` だったか
3. `Critical` / `High` が残っているか
4. 現時点の判定が `Go / Conditional Go / No-Go` のどれか
5. 次に必要な作業は何か

補足:

- 現時点では文書整備は済んでいるが、実査は未完のため、暫定的には `No-Go` 相当の前提で進めること
- shared / production 相当での運用可否を意識して判断すること

---
