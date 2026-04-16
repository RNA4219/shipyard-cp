# Security Target

## 文書の役割

この文書は、`shipyard-cp` におけるセキュリティ活動の前提を固定する。
以後の脆弱性修正、設計変更、運用ルールは本書を基準に判断する。

## 最終目標

`shipyard-cp` を、上場企業の社内利用基盤として継続運用できる水準へ
引き上げる。

ここでいう継続運用可能とは、少なくとも次を満たすことを意味する。

- 重大な既知脆弱性が放置されていない
- 認証、認可、承認境界が明確である
- destructive / networked / external side effect が制御されている
- 実行証跡と判断証跡が監査可能である
- 日常運用と障害対応の標準手順が定義されている

## 想定利用形態

### In Scope

- 社内ネットワークまたはそれに準ずる制御環境での利用
- 開発者、運用担当者、限定された bot による利用
- GitHub、tracker、resolver、LLM provider と連携する control plane としての利用
- task / run / audit / publish gate を扱う中核運用基盤としての利用

### Out of Scope

- 不特定多数に直接公開される一般向け SaaS としての利用
- 匿名利用
- マルチテナントの強い分離保証
- 企業外ユーザーへ自己登録で提供する運用

## 保護対象

### 最優先保護対象

- API key / provider key / GitHub token / tracker token
- repository contents
- generated patches
- publish / integrate に関わる承認権限
- audit log
- task state / run state / approval history

### 次点保護対象

- worker transcript
- resolver で参照した文書
- tracker link 情報
- operational metadata

## 守るべき性質

### 機密性

- secret が repo やログに漏れない
- 権限のない主体が task / run / publish 情報を取得できない

### 完全性

- task state と audit log が改ざんされにくい
- 承認が必要な操作が未承認で実行されない
- worker backend の切替で権限境界が壊れない

### 可用性

- control plane が高頻度に停止しない
- 誤設定や一時障害で復旧不能になりにくい

### 追跡可能性

- 誰が、何を、どの権限で、どの結果になったかを追える

## セキュリティ前提

- 本番または共有環境では auth 必須
- API key による主体識別を最低ラインとする
- destructive operation は approval 境界の下に置く
- publish は repo 外副作用として別扱いにする
- main 更新は integrate 工程で統制する
- bot / service account は最小権限で運用する

## 非目標

- 全ての攻撃可能性をゼロにすること
- 高度な国家レベル攻撃への完全耐性
- 完全なゼロトラスト実装を短期で実現すること
- UI / API / worker / infra の全領域を一度に最高水準へ引き上げること

## 当面の優先順位

1. auth / authorization / approval boundary
2. secret handling
3. destructive endpoint protection
4. audit completeness
5. CI security checks
6. incident response and operations policy
