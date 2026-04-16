# Security Acceptance Criteria

## 文書の役割

この文書は、`shipyard-cp` を「常用可能」と判定するための
受け入れ基準を定義する。

本書を満たさない限り、「セキュリティ的に問題ない」とは表現しない。

## 判定区分

- `Go`
  - 常用開始可能
- `Conditional Go`
  - 条件付き運用開始。残リスクと制限条件を明示
- `No-Go`
  - 常用開始不可

## 必須条件

### 1. 脆弱性

- Critical: 0
- High: 0
- Medium は受容理由か対応計画が文書化されている

### 2. 認証・認可

- 本番 / 共有環境で auth が必須化されている
- 危険 endpoint に未保護経路がない
- admin / operator の境界がテストで固定化されている
- public route の一覧が説明可能である

### 3. 副作用統制

- publish / integrate / cancel / policy update に保護がある
- destructive action は approval 境界下にある
- worker capability と stage の整合が取れている

### 4. secret 管理

- repo に secret hardcode がない
- `.env` は配布対象から除外される
- CI / runtime での secret 供給方法が定義されている
- log / audit へ secret を出さない

### 5. 監査

- 誰が実行したか追える
- 何を実行したか追える
- 承認有無を追える
- 結果と失敗理由を追える

### 6. 継続検査

- CI に security checks がある
- auth / route protection の regression test がある
- dependency / secret / config の最低限チェックがある

### 7. 運用

- incident response 文書がある
- access control の運用方針がある
- secrets rotation / revoke の方針がある
- 緊急停止手順がある

## `Go` 判定条件

次をすべて満たすこと。

- 必須条件を全て満たす
- 重大残リスクがない
- 運用責任者が存在する
- セキュリティ review report がある

## `Conditional Go` 判定条件

次のような場合に限定する。

- Critical / High はゼロ
- Medium が一部残るが、回避策と期限がある
- 利用範囲が限定されている
- 本番ではなく限定運用である

必要条件:

- 制限条件を文書化
- 残リスクと期限を文書化
- 責任者を明記

## `No-Go` 判定条件

次のどれかに該当する場合。

- Critical が 1 件以上ある
- High が未解消で残っている
- auth / authorization に未解決欠陥がある
- destructive endpoint に未保護経路がある
- secret hardcode が残っている
- audit が不十分で追跡不能

## 判定時に必要な証跡

- security review report
- risk register
- test result
- CI result
- 主要設定の確認結果
- 運用文書一覧
