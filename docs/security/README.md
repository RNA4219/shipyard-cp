# Security Docs

`shipyard-cp` を「上場企業で常用できる水準」へ引き上げるための
セキュリティ計画と受け入れ基準の入口です。

## 読み順

1. `SECURITY_ROADMAP.md`
2. `SECURITY_TARGET.md`
3. `THREAT_MODEL.md`
4. `ACCEPTANCE_CRITERIA.md`
5. `SECURITY_RUNBOOK.md`
6. `SECURITY_INVENTORY.md`
7. `SECURITY_VERIFICATION_CHECKLIST.md`
8. `RISK_REGISTER.md`
9. `SECURITY_REVIEW_REPORT.md`
10. `SECURITY_EXECUTION_INSTRUCTIONS.md`
11. `TOKEN_SCOPE.md`
12. `CREDENTIAL_BOUNDARY.md`

## 目的

- 守る対象を固定する
- 脅威と前提を明文化する
- 「対応完了」の判定基準を揃える
- 実装修正、運用整備、監査証跡の優先順位を決める

## 文書一覧

- `SECURITY_ROADMAP.md`
  - フェーズ別の全体計画
- `SECURITY_TARGET.md`
  - 保護対象、利用前提、非目標
- `THREAT_MODEL.md`
  - 想定脅威、攻撃面、重点リスク
- `ACCEPTANCE_CRITERIA.md`
  - 常用可能と判断するための受け入れ条件
- `SECURITY_RUNBOOK.md`
  - セキュリティ活動の進め方、点検観点、判定の進行手順
- `SECURITY_INVENTORY.md`
  - 現時点の棚卸し、確認済み事項、未確認事項、次の確認対象
- `SECURITY_VERIFICATION_CHECKLIST.md`
  - 各論点をどう確認すれば「検証済み」と言えるかの観点一覧
- `RISK_REGISTER.md`
  - 残リスク、受容条件、期限、責任者を管理する台帳
- `SECURITY_REVIEW_REPORT.md`
  - 最終的な `Go / Conditional Go / No-Go` 判定を残すレポート雛形
- `SECURITY_EXECUTION_INSTRUCTIONS.md`
  - 次担当者が実査と判定更新へ進むための指示書
- `TOKEN_SCOPE.md`
  - GitHub token の最小権限と scope 定義
- `CREDENTIAL_BOUNDARY.md`
  - shipyard-cp / tracker / resolver / worker 間の credential 境界
