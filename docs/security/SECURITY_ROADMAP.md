# shipyard-cp Security Roadmap

## 目的

本ロードマップは、`shipyard-cp` を「上場企業で扱っても
セキュリティ的に問題がなく、常用可能」と説明できる水準まで
引き上げるための段階計画を定義する。

ここでいう完了は、単に既知の脆弱性を潰すことではなく、次を満たす状態を指す。

- 重大な実装脆弱性が解消されている
- 権限境界と副作用境界が明確である
- 誤運用しにくい構成になっている
- 継続的な検査が自動化されている
- 監査と説明に耐える文書と証跡がある

## 完了像

最終的な受け入れ状態は次のとおり。

- Critical / High の既知脆弱性が解消済み
- auth / authorization の既知欠陥が残っていない
- publish / integrate / destructive action に明示承認境界がある
- secrets が repo に直書きされず、安全に供給される
- security regression test が主要経路をカバーしている
- CI に security gate があり、劣化を自動で止められる
- 監査ログから実行主体、対象、権限、結果を追跡できる
- 運用手順とインシデント対応手順があり、引き継ぎ可能である

## フェーズ構成

### Phase 0. 基準合わせ

目的:

- 「何を守るか」と「何をもって安全とするか」を固定する

成果物:

- `SECURITY_TARGET.md`
- `THREAT_MODEL.md`
- `ACCEPTANCE_CRITERIA.md`

完了条件:

- 保護対象、前提、非目標、受け入れ条件が文書で定義されている

### Phase 1. 即時リスク封じ込め

目的:

- 事故につながりやすい高優先度リスクをまず潰す

重点項目:

- 認証
- 認可
- 公開 endpoint
- secret 露出
- destructive operation
- worker backend 切替による権限逸脱

成果物:

- 高優先度リスク一覧
- 修正実装
- 回帰テスト

完了条件:

- Critical / High の既知問題に対処済み
- 再現テストが存在する

### Phase 2. アーキテクチャ安全化

目的:

- 個別修正ではなく、危険な経路を設計上起きにくくする

重点項目:

- approval boundary
- worker capability gate
- side effect policy
- workspace / container boundary
- audit completeness

成果物:

- authorization model
- side effect policy
- execution boundary 文書

完了条件:

- 危険操作が「人の注意」ではなく仕組みで統制される

### Phase 3. 継続検査の自動化

目的:

- セキュリティ劣化を継続的に検知する

重点項目:

- dependency scanning
- SAST
- secret scan
- config safety check
- route protection test
- approval boundary test
- audit completeness test

成果物:

- CI security workflow
- security checks 文書

完了条件:

- 破壊的な変更が自動検知される

### Phase 4. 運用・統制整備

目的:

- 継続利用できる運用ルールを整える

重点項目:

- access control
- secrets rotation
- incident response
- audit log retention
- bot / service account 運用
- emergency stop

成果物:

- 運用ポリシー
- secrets policy
- incident response runbook
- access control matrix

完了条件:

- 担当者が変わっても安全運用を再現できる

### Phase 5. 最終検収

目的:

- 自己評価ではなく、説明可能な受け入れ判定を行う

重点項目:

- 残リスク棚卸し
- 実装と文書の整合
- high risk path walkthrough
- evidence 確認

成果物:

- security review report
- risk register
- go / conditional go / no-go 判定

完了条件:

- 常用可否を理由付きで説明できる

## 直近 4 週間の推奨順序

### Week 1

- Phase 0 完了
- auth / authorization / public route 棚卸し開始

### Week 2

- High 優先修正
- security regression test 追加

### Week 3

- CI security checks 導入
- secret / config / route protection の自動検査追加

### Week 4

- 運用文書整備
- 中間 review と残リスク整理

## 成功判定の最低条件

- Critical: 0
- High: 0
- auth bypass: 0
- unprotected destructive endpoint: 0
- secret hardcode: 0
- regression tests: 主要経路あり
- CI security gate: あり
- incident response document: あり
- acceptance criteria に対する判定記録: あり
