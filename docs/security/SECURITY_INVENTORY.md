# Security Inventory

## 文書の役割

本書は、`shipyard-cp` のセキュリティ観点における
「現在地の棚卸し」をまとめるための文書である。

目的は次の 3 つ。

- 何を確認対象とするかを一覧化する
- 何が確認済みで、何が未確認かを分ける
- 次にどこを点検すべきかを明確にする

本書は仕様レベルの棚卸しであり、実装修正の完了報告ではない。

重要:

- 本書の状態は、論点の整理状況を示す
- 実装完了や検証完了を直接意味しない
- 実装確認や最終検証の結果は `SECURITY_VERIFICATION_CHECKLIST.md` と
  `SECURITY_REVIEW_REPORT.md` 側で扱う

## 使い方

棚卸し項目ごとに、最低限次を記録する。

- 区分
- 論点
- 関連脅威
- 現状認識
- 状態
- 次アクション

状態は次のいずれかを使う。

- `Framed`
  - 論点、脅威、次アクションが定義済み
- `Partially Confirmed`
  - 一部の事実関係は確認済みだが、全体整理は未完
- `Unknown`
  - まだ確認していない
- `Needs Review`
  - 既知論点として重点レビューが必要

補足:

- 実装が確認できたかどうかは本状態だけでは表さない
- 実装・検証の有無は `現状認識` と `次アクション` に明示する
- 最終的な `Pass / Fail` は `SECURITY_VERIFICATION_CHECKLIST.md` で扱う

## 棚卸しスコープ

本棚卸しでは、少なくとも次を対象にする。

1. 認証
2. 認可
3. 公開 endpoint
4. destructive / privileged endpoint
5. approval boundary
6. secret handling
7. audit / evidence
8. worker backend / substrate
9. external integration
10. CI / release gate

## 現時点の棚卸し

### 1. 認証

| 論点 | 関連脅威 | 現状認識 | 状態 | 次アクション |
|------|----------|----------|------|--------------|
| 本番 / 共有環境で auth 必須化 | R1 | `cli-usage` と `glm5-operation-instructions` では本番 / 共有環境で auth 必須方針が明記されている。実装強制は未確認 | Partially Confirmed | 実装と起動経路で強制されるか確認 |
| auth off 時の unsafe fallback | R1 | 過去に高優先で修正対象として扱われた。現行状態は未再確認 | Partially Confirmed | 現行コードとテストの再確認 |
| API key 比較の安全性 | R1 | 過去に修正済み認識あり。現行実装確認は未完 | Partially Confirmed | 実装と回帰テストの再確認 |
| auth 設定の既定値安全性 | R1 | 仕様上は共有 / 本番で必須とする | Unknown | env default と server 起動経路を確認 |

### 2. 認可

| 論点 | 関連脅威 | 現状認識 | 状態 | 次アクション |
|------|----------|----------|------|--------------|
| admin / operator 境界 | R2 | 重要論点として認識済み | Partially Confirmed | 主要 route の保護状況を一覧化 |
| role escalation 経路 | R2 | 既知の重点リスク | Needs Review | route ごとの preHandler / guard を確認 |
| conditional role hook の扱い | R2 | auth disabled と連動する設計 | Unknown | 設計意図と route 適用状況を確認 |

### 3. 公開 endpoint

| 論点 | 関連脅威 | 現状認識 | 状態 | 次アクション |
|------|----------|----------|------|--------------|
| public route の定義 | R1 | 過去に prefix collision が論点化 | Partially Confirmed | 現在の public route 一覧を固定化 |
| docs / metrics / health の公開範囲 | R1 | 運用上必要だが境界整理が必要 | Unknown | 公開理由と必要最小化を確認 |

### 4. destructive / privileged endpoint

| 論点 | 関連脅威 | 現状認識 | 状態 | 次アクション |
|------|----------|----------|------|--------------|
| cancel endpoint 保護 | R3 | 高リスク操作 | Unknown | route 保護と approval 方針を確認 |
| publish / approve / complete | R3 | 高リスク操作 | Partially Confirmed | route 保護と state 境界を確認 |
| repo policy update / delete | R3 | 管理者限定であるべき | Unknown | admin 専用保護の確認 |

### 5. approval boundary

| 論点 | 関連脅威 | 現状認識 | 状態 | 次アクション |
|------|----------|----------|------|--------------|
| integrate と publish の責務分離 | R3 | `REQUIREMENTS` / `state-machine` / `api-contract` で、main 更新は Integrate、外部副作用は Publish として分離済み。実装反映は未確認 | Framed | 実装と audit への反映確認 |
| destructive action の承認要否 | R3 | `REQUIREMENTS` と `state-machine` で、Publish Apply は approval gate 配下と定義済み。route ごとの実装反映は未確認 | Partially Confirmed | endpoint / workflow ごとに一覧化 |
| publish approval token の扱い | R3 | `api-contract` では `approval_token` optional、`publish_pending_approval` 遷移あり。実装上の厳密運用は未確認 | Partially Confirmed | 仕様差分整理と route 実装を確認 |

### 6. secret handling

| 論点 | 関連脅威 | 現状認識 | 状態 | 次アクション |
|------|----------|----------|------|--------------|
| repo 内 secret hardcode | R4 | 最優先確認対象 | Needs Review | repo 横断の secret 棚卸しを行う |
| `.env` の取り扱い | R4 | `cli-usage` / `glm5-quickstart` / `glm5-operation-instructions` で `.env` または環境変数による供給前提は明記。配布除外と運用ルールは未確認 | Partially Confirmed | 配布対象除外と運用ルールを確認 |
| log / audit への secret 出力 | R4 | 未確認 | Unknown | logging policy と実装を確認 |

### 7. audit / evidence

| 論点 | 関連脅威 | 現状認識 | 状態 | 次アクション |
|------|----------|----------|------|--------------|
| 誰が実行したか追えるか | R5 | `audit-events` と `state-machine` で `actor_type` / `actor_id` は必須定義。実データ記録は未確認 | Partially Confirmed | user / role / actor 記録を確認 |
| approval 有無を追えるか | R5 | `audit-events` に `run.approval_required` があり、`state-machine` でも `publish_pending_approval` を独立状態として定義。実データ記録は未確認 | Partially Confirmed | audit event 種別と実装を確認 |
| publish / failure reason の記録 | R5 | `audit-events` で retry / failure / policy / lock 系イベントを定義し、`REQUIREMENTS` でも publish や verdict 提出の記録を必須化。実データ記録は未確認 | Partially Confirmed | 実装と event schema を確認 |

### 8. worker backend / substrate

| 論点 | 関連脅威 | 現状認識 | 状態 | 次アクション |
|------|----------|----------|------|--------------|
| GLM / opencode / claude_cli 切替 | R6 | `REQUIREMENTS` で backend 分離と切替要件を定義済み。`glm5` 文書でも GLM 主線方針を明示。実装整合は未確認 | Partially Confirmed | backend ごとの権限境界を整理 |
| capability と stage の整合 | R6 | `REQUIREMENTS` と `state-machine` で capability と stage の整合要件を定義済み。実装確認は未着手 | Partially Confirmed | capability check の現在地を確認 |
| substrate 差分の audit 記録 | R6 | `REQUIREMENTS` では substrate を `WorkerResult.metadata` へ残す方針がある。audit 反映は未確認 | Partially Confirmed | metadata / audit へ残るか確認 |

### 9. external integration

| 論点 | 関連脅威 | 現状認識 | 状態 | 次アクション |
|------|----------|----------|------|--------------|
| GitHub token 権限 | R4 | `REQUIREMENTS` では bot push actor と GitHub App / bot 運用を前提化。具体的 scope と現運用は未確認 | Partially Confirmed | token scope と bot 運用方針を確認 |
| tracker / resolver credential 扱い | R4 | `REQUIREMENTS` では secrets 注入と `memx-resolver` への secret 永続保存禁止方針を定義。実運用は未確認 | Partially Confirmed | secret 供給経路を確認 |
| provider API endpoint の固定 | R4 / R6 | `glm5-quickstart` / `glm5-operation-instructions` で GLM endpoint と env 優先設定を文書化済み。許容範囲の統制は未確認 | Partially Confirmed | env 優先順位と許容範囲を確認 |

### 10. CI / release gate

| 論点 | 関連脅威 | 現状認識 | 状態 | 次アクション |
|------|----------|----------|------|--------------|
| dependency scan | R4 | 要件として必要 | Unknown | 現行 CI の有無を確認 |
| secret scan | R4 | 要件として必要 | Unknown | 現行 CI の有無を確認 |
| route protection regression test | R1 / R2 / R3 | 一部存在する認識 | Partially Confirmed | coverage を整理 |

## 初期優先度

現時点で最優先に棚卸しを進める順番は次のとおり。

1. 認証
2. 認可
3. destructive / privileged endpoint
4. secret handling
5. audit / evidence
6. worker backend / substrate

## この文書の完了条件

本書が Phase 1 の成果物として成立する条件は次のとおり。

- 主要攻撃面が一覧化されている
- 各項目に状態が付いている
- `Unknown` と `Needs Review` に次アクションがある
- `THREAT_MODEL.md` の優先リスクと対応付いている

## 次に更新すべき文書

本棚卸しの次段階では、少なくとも次を更新対象として扱う。

- `SECURITY_VERIFICATION_CHECKLIST.md`
  - 何をどう確認するかの観点の具体化
- `RISK_REGISTER.md`
  - 実リスクの登録
- `SECURITY_REVIEW_REPORT.md`
  - 最終受け入れ判定の下書き
