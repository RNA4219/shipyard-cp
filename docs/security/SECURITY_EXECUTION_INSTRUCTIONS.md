# Security Execution Instructions

## 文書の役割

本書は、`shipyard-cp` のセキュリティ文書群を前提に、
次担当者が実査と判定更新へ進むための指示書である。

ここで指示するのは、実装修正そのものではなく、次をどう進めるかである。

- 何から着手するか
- どの文書を更新するか
- どの粒度で証跡を残すか
- どの条件で判定を変えるか

## 前提

着手前に次の文書が揃っていることを確認する。

1. `SECURITY_TARGET.md`
2. `THREAT_MODEL.md`
3. `ACCEPTANCE_CRITERIA.md`
4. `SECURITY_RUNBOOK.md`
5. `SECURITY_INVENTORY.md`
6. `SECURITY_VERIFICATION_CHECKLIST.md`
7. `RISK_REGISTER.md`
8. `SECURITY_REVIEW_REPORT.md`

## 現時点の前提認識

- セキュリティ文書群は仕様レベルで整備済み
- `RISK-001` から `RISK-006` は初期登録済み
- ただし実装、設定、CI、運用証跡の実査は未完
- そのため、現時点の暫定判定は `No-Go` 相当である

## 目的

今回の指示で到達したい状態は次のとおり。

- 各重要リスクに対して実査結果が残っている
- `RISK_REGISTER.md` の `Open / Mitigating / Closed / Deferred / Accepted`
  が根拠付きで更新されている
- `SECURITY_REVIEW_REPORT.md` に暫定判定または最終判定が記録されている

## 対象リスク

最優先で扱うのは次の 6 件とする。

1. `RISK-001` auth default safety 未検証
2. `RISK-002` role escalation path 未検証
3. `RISK-003` destructive endpoint protection 未検証
4. `RISK-004` secret exposure 管理未確定
5. `RISK-005` audit completeness 未検証
6. `RISK-006` backend policy drift 未検証

## 実施順

### Step 1. 棚卸しとリスクの対応確認

実施内容:

- `SECURITY_INVENTORY.md` を確認する
- 各論点がどの `Risk ID` に対応するかを確認する
- 実査対象から漏れている high priority 論点がないか確認する

更新対象:

- 必要があれば `SECURITY_INVENTORY.md`
- 必要があれば `RISK_REGISTER.md`

### Step 2. 検証チェックリスト実査

実施内容:

- `SECURITY_VERIFICATION_CHECKLIST.md` の対象項目を順に確認する
- 各項目に対して `Pass / Fail / Blocked / Not Applicable` を決める
- 根拠となる証跡を記録する

最低限埋めるべき項目:

- 対象
- 確認結果
- 証跡
- 判定
- 対応する `Risk ID`

### Step 3. リスク台帳更新

実施内容:

- 実査結果を `RISK_REGISTER.md` に反映する
- 状態を `Open` のままにする場合は理由を書く
- `Mitigating`、`Accepted`、`Deferred` にする場合は
  制限条件、期限、責任者を必ず入れる

更新ルール:

- `Critical` / `High` は原則 `Closed` でない限り `Go` にしない
- `Accepted` は原則 `Medium` 以下に限定する

### Step 4. review report 更新

実施内容:

- `SECURITY_REVIEW_REPORT.md` に今回確認した範囲を書く
- acceptance criteria ごとの判定を書く
- 残リスク要約を更新する
- 暫定判定または最終判定を記録する

### Step 5. 再判定条件の整理

実施内容:

- `Fail` または `Blocked` が残る場合は、何が不足しているかを書く
- 再判定に必要な条件を列挙する
- shared / production へ進めるかどうかを明示する

## 判定ルール

### `Go`

- `Critical` / `High` が全て `Closed`
- `SECURITY_VERIFICATION_CHECKLIST.md` に重大 `Fail` がない
- `ACCEPTANCE_CRITERIA.md` の必須条件を満たす

### `Conditional Go`

- `Critical` / `High` がない
- `Medium` 以下のみ残る
- 制限条件、期限、責任者が明記されている

### `No-Go`

- `Critical` / `High` が残る
- 認証、認可、approval、secret、audit のいずれかに
  `Fail` または重要 `Blocked` がある

## 証跡の残し方

最低限、次の証跡を残す。

- 実査メモ
- テスト結果
- CI 結果
- 主要設定確認メモ
- 監査記録の代表例
- 更新済み `RISK_REGISTER.md`
- 更新済み `SECURITY_REVIEW_REPORT.md`

## 禁止事項

- 実装未確認の項目を `Closed` にしない
- 証跡なしで `Pass` としない
- `Critical` / `High` を期限なしで `Deferred` にしない
- 暫定判定と最終判定を混同しない

## 完了条件

この指示に基づく作業が完了したと言える条件は次のとおり。

- `RISK-001` から `RISK-006` の状態が根拠付きで更新されている
- `SECURITY_VERIFICATION_CHECKLIST.md` に実査結果が入っている
- `SECURITY_REVIEW_REPORT.md` に暫定判定または最終判定が入っている
- 次の担当者が、残件と再判定条件を読んで理解できる

## 次に見る文書

1. `SECURITY_RUNBOOK.md`
2. `SECURITY_INVENTORY.md`
3. `SECURITY_VERIFICATION_CHECKLIST.md`
4. `RISK_REGISTER.md`
5. `SECURITY_REVIEW_REPORT.md`
