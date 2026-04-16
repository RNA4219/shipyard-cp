# Security Runbook

## 文書の役割

本書は、`shipyard-cp` のセキュリティ活動を仕様レベルで進めるための
標準手順を定義する。

ここで扱うのは、実装修正の詳細ではなく、次をどう進めるかである。

- 何を確認するか
- どの順で判断するか
- どの文書を正本とするか
- どの状態を完了とみなすか

## 適用範囲

- `shipyard-cp` backend / API / worker orchestration
- auth / authorization / approval boundary
- integrate / publish / destructive action policy
- secret handling policy
- audit / evidence / review readiness

## 正本文書

この RUNBOOK は、次の文書とセットで使う。

1. `SECURITY_TARGET.md`
2. `THREAT_MODEL.md`
3. `ACCEPTANCE_CRITERIA.md`
4. `SECURITY_ROADMAP.md`
5. `SECURITY_INVENTORY.md`
6. `SECURITY_VERIFICATION_CHECKLIST.md`
7. `RISK_REGISTER.md`
8. `SECURITY_REVIEW_REPORT.md`

使い分け:

- 目的と対象は `SECURITY_TARGET.md`
- 脅威と優先度は `THREAT_MODEL.md`
- 受け入れ判定は `ACCEPTANCE_CRITERIA.md`
- 全体の順番は `SECURITY_ROADMAP.md`
- 棚卸し結果は `SECURITY_INVENTORY.md`
- 実査観点は `SECURITY_VERIFICATION_CHECKLIST.md`
- 残リスク管理は `RISK_REGISTER.md`
- 最終判定記録は `SECURITY_REVIEW_REPORT.md`
- 日々の進め方は本書

## 現在の文書整備状況

本 RUNBOOK 更新時点では、仕様レベル文書として次が整備済みである。

- 目標、脅威、受け入れ基準
- セキュリティ棚卸し
- リスク台帳の初期登録
- 検証チェックリスト
- 最終 review report 雛形

重要:

- ここでいう「整備済み」は文書の整備を意味する
- 実装確認、設定確認、CI 確認、運用証跡確認の完了を意味しない
- 現時点の判定は `Go`
- ただし、運用証跡の follow-up は残っているため、
  限定導入では証跡回収を前提に運用する

現在地:

- `Critical`: 0件
- `High`: 0件
- `Fail`: 0件
- `Blocked`: 1件
  - `4-2 state boundary` の representative records 確認
- secret scan:
  - `.github/workflows/secret-scan.yml` で Gitleaks workflow 定義済み
  - `.gitleaks.toml` で test fixture の疑似 key を allowlist 化済み
  - `gitleaks-report.json` で local 初回実行 no leaks 確認済み

判定の正本:

- 最終判定は `SECURITY_REVIEW_REPORT.md`
- 残リスクと follow-up は `RISK_REGISTER.md`
- 実査項目の詳細は `SECURITY_VERIFICATION_CHECKLIST.md`

## 基本方針

### 1. 仕様先行

- 先に守る対象と判定基準を固定する
- 実装修正は、仕様と受け入れ条件に紐づけて判断する
- 「危なそう」ではなく、どの脅威に対する対策かを明示する

### 2. 高優先度集中

- Critical / High に直結する論点から扱う
- Medium 以下は、受容か後続計画かを必ず決める

### 3. 文書と実装を分離して考える

- 文書だけ先行して整えることは許容する
- ただし、未実装事項を「対応済み」とは書かない
- 常に「仕様済み」「実装済み」「検証済み」を分ける

### 4. 監査可能性重視

- 修正内容だけでなく、判断理由と残リスクを残す
- 後から説明できることを重視する

## フェーズ別の進め方

### Phase 0. 基準合わせ

目的:

- セキュリティ活動の前提を固定する

実施項目:

- 保護対象の確定
- 利用形態の確定
- 非目標の明記
- 脅威一覧の作成
- 受け入れ基準の定義

完了条件:

- `SECURITY_TARGET.md`
- `THREAT_MODEL.md`
- `ACCEPTANCE_CRITERIA.md`

が揃い、相互に矛盾しない

### Phase 1. 棚卸し

目的:

- 現在の設計と実装に対し、どこにリスクがあるかを列挙する

点検対象:

- 認証
- 認可
- 公開 endpoint
- destructive endpoint
- approval boundary
- backend selection
- secret handling
- audit events

成果物:

- セキュリティ棚卸し一覧
- Critical / High / Medium の分類
- 対応要否の判定
- 初期リスク台帳

完了条件:

- 主要攻撃面ごとの論点が一覧化されている
- 優先順位が付いている
- `SECURITY_INVENTORY.md` と `RISK_REGISTER.md` が相互参照できる

### Phase 2. 対応方針化

目的:

- 各リスクに対して、どう直すかを仕様化する

実施項目:

- 対応対象を選ぶ
- 非対象は理由を明記する
- 回帰確認方法を決める
- 影響範囲を明記する

成果物:

- 対応方針メモ
- 受け入れ条件との対応表
- リスクごとの方針整理メモ

完了条件:

- 各 High リスクに対して、対応方針か受容理由が存在する
- `RISK_REGISTER.md` の各項目に方針が入っている

### Phase 3. 検証設計

目的:

- 仕様レベルで「どう確認すれば安全と言えるか」を定義する

実施項目:

- regression test 観点定義
- CI security check 観点定義
- 設定確認観点定義
- audit evidence 観点定義

成果物:

- security verification checklist
- CI 導入候補一覧
- リスクと検証観点の対応表

完了条件:

- 主要リスクごとに確認方法が紐づいている
- 各重要項目に `Pass / Fail / Blocked` 条件がある

### Phase 4. 最終判定準備

目的:

- `Go / Conditional Go / No-Go` を判定できる状態にする

実施項目:

- 残リスク整理
- 必須証跡の整理
- 受け入れ条件との照合

成果物:

- review report 雛形
- risk register 雛形
- acceptance criteria ごとの確認欄
- 暫定判定サマリー

完了条件:

- 最終判定に必要な入力が明確
- `Go / Conditional Go / No-Go` の判定ゲートが明記されている

### Phase 5. 実査と更新

目的:

- 文書上の論点を、実装、設定、CI、運用証跡へ結びつける

実施項目:

- `SECURITY_VERIFICATION_CHECKLIST.md` に沿って実査する
- 実査結果を `Pass / Fail / Blocked / Not Applicable` で記録する
- `RISK_REGISTER.md` の状態、期限、責任者を更新する
- `SECURITY_REVIEW_REPORT.md` に暫定判定または最終判定を記録する

成果物:

- 更新済み verification checklist
- 更新済み risk register
- 更新済み security review report

完了条件:

- `Critical` / `High` の扱いが説明できる
- `Blocked` の理由と不足証跡が明記されている
- 最終判定または再判定条件が明記されている

## 毎回の確認テンプレート

各セキュリティ論点を扱うときは、最低限次を埋める。

### A. 論点名

例:

- auth bypass
- public route misconfiguration
- publish without approval

### B. 該当する脅威

`THREAT_MODEL.md` のどのリスクに対応するかを明記する。

### C. 影響

- 何が壊れるか
- 誰に影響するか
- どの資産が危険になるか

### D. 現状

- 仕様済み / 未仕様
- 実装済み / 未実装
- 検証済み / 未検証

### E. 対応方針

- 修正
- 追加制約
- 運用で回避
- リスク受容

### F. 受け入れ条件

`ACCEPTANCE_CRITERIA.md` のどの項目を満たすかを書く。

### G. 対応 Risk ID

`RISK_REGISTER.md` のどの項目に影響するかを書く。

### H. 証跡保管先

実査ログ、CI 結果、設定確認メモ、運用記録の格納先を残す。

## 重点確認リスト

### 認証

- 本番 / 共有環境で auth が必須か
- auth off の unsafe fallback がないか
- API key 比較が安全か

### 認可

- admin / operator の境界が明確か
- 危険 route に未保護経路がないか
- public route が限定的か

### 副作用

- integrate / publish / cancel / policy update に保護があるか
- approval boundary が仕様で定義されているか
- destructive action が無承認で実行されないか

### secret

- repo へ直書きされていないか
- `.env` の扱いが定義されているか
- log に secret を残さない方針か

### audit

- 誰が実行したか分かるか
- 承認有無が追えるか
- 結果と失敗理由が追えるか

### backend / worker

- backend 切替で権限境界が壊れないか
- worker capability と stage が整合しているか
- substrate 差分が audit で追えるか

## 判定ルール

### Go

- 必須条件を満たす
- 重大残リスクなし
- 常用開始可

### Conditional Go

- Critical / High はゼロ
- 制限条件付きで許容
- 制限条件と期限を明記

### No-Go

- Critical / High が残る
- auth / authorization / destructive endpoint / secret handling の
  根本問題が未解消

補足:

- 実装未確認で `Blocked` が多い場合も、shared / production 判断は
  原則 `No-Go` 相当として扱う
- `Conditional Go` は `Medium` 以下のみ残る場合に限定する

## 現時点の推奨運用順

文書整備後に次担当者が着手する順番は次のとおり。

1. `SECURITY_REVIEW_REPORT.md` を読み、現時点の判定が `Go` であることを確認する
2. `RISK_REGISTER.md` で残タスクと follow-up を確認する
3. `SECURITY_VERIFICATION_CHECKLIST.md` で残件の確認観点と証跡粒度を確認する
4. GitHub Actions 上で `Secret Scan` の初回成功記録を保管する
5. 限定導入で `state boundary` と `audit` の representative records を回収する
6. 回収した証跡を `RISK_REGISTER.md` と `SECURITY_REVIEW_REPORT.md` に反映する

## 次担当者への受け渡し条件

次担当者へ引き継ぐときは、最低限次を明記する。

- どの Risk ID を対象にしたか
- 何が `Pass / Fail / Blocked` だったか
- 不足している証跡は何か
- shared / production 判定に進めるか
- 次に更新すべき文書はどれか

## 残タスク

現時点で残っている作業は、実装修正ではなく運用証跡の回収と記録である。

### 1. Secret Scan 初回成功記録の保管

- 目的:
  - secret scan が GitHub Actions 上でも継続運用できることを証跡化する
- 実施内容:
  - `Secret Scan` workflow の初回成功 run URL / 実行日時 / 実行ブランチを保存する
- 更新先:
  - `RISK_REGISTER.md`
  - `SECURITY_REVIEW_REPORT.md`
- 関連証跡:
  - `.github/workflows/secret-scan.yml`
  - `.gitleaks.toml`
  - `gitleaks-report.json`

### 2. state boundary representative records 回収

- 目的:
  - `4-2 state boundary` の運用証跡待ちを解消する
- 実施内容:
  - `acceptance -> integrate -> publish` の代表ケースで状態遷移記録を回収する
  - 不正遷移が拒否される representative records も可能なら含める
- 更新先:
  - `SECURITY_VERIFICATION_CHECKLIST.md`
  - `RISK_REGISTER.md`
  - `SECURITY_REVIEW_REPORT.md`
- 関連項目:
  - checklist `4-2`
  - risk `RISK-003`

### 3. audit representative records 回収

- 目的:
  - 監査証跡が実運用でも期待通り残ることを確認する
- 実施内容:
  - actor、approval、result、failure reason が含まれる representative records を保管する
- 更新先:
  - `SECURITY_REVIEW_REPORT.md`
  - 必要に応じて `RISK_REGISTER.md`
- 関連項目:
  - checklist `7-1`, `7-2`, `5-2`, `10-2`
  - risk `RISK-005`

## 禁止事項

- 未実装事項を完了扱いにしない
- 検証前に安全宣言しない
- Critical / High を曖昧なまま先送りしない
- 仕様と実装の状態を混同しない

## 次に更新すべき文書

本 RUNBOOK の次段階では、少なくとも次を更新対象として扱う。

- `SECURITY_VERIFICATION_CHECKLIST.md`
  - representative records の追記
- `RISK_REGISTER.md`
  - follow-up 状態と evidence 保管先の更新
- `SECURITY_REVIEW_REPORT.md`
  - 限定導入後の証跡反映
