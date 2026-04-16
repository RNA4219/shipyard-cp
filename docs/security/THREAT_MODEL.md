# Threat Model

## 文書の役割

この文書は、`shipyard-cp` に対する主要脅威を整理し、
優先的に対策すべきリスクを定義する。

## 対象システム

`shipyard-cp` は、複数 AI worker を orchestration し、
task / run / integrate / publish / audit を管理する control plane である。

主な構成要素:

- backend API
- CLI-first operational flow
- worker backend selection
- GitHub / tracker / resolver integration
- task / run / audit storage
- approval and publish gate

## 想定攻撃者

### A1. 誤設定・誤運用を行う内部利用者

例:

- auth を切ったまま共有環境へ出す
- 危険 endpoint を保護せず公開する
- 誤った backend に切り替える

### A2. 過剰権限を持つ内部利用者

例:

- operator が admin 相当操作を行う
- 承認を経ずに publish を進める

### A3. 秘密情報へアクセスした第三者

例:

- `.env`
- ログ
- CI 設定
- process 環境変数

### A4. 外部連携経路を悪用する相手

例:

- GitHub token の過剰権限利用
- tracker / resolver / provider API の誤設定悪用

## 主要攻撃面

### 1. 認証・認可

対象:

- auth enabled/disabled
- API key validation
- role-based route protection
- public path definitions

懸念:

- auth bypass
- role escalation
- public route 誤設定

### 2. 副作用境界

対象:

- integrate
- publish
- cancel
- repo policy update
- external API action

懸念:

- approval 無しで destructive action が実行される
- worker capability と stage が不整合

### 3. secret handling

対象:

- `.env`
- provider key
- GitHub token
- tracker token
- CI secrets

懸念:

- hardcode
- log 出力
- 意図しない環境伝播

### 4. 監査・証跡

対象:

- audit events
- state transition logs
- approval history
- publish records

懸念:

- 重要イベントが記録されない
- 後追い調査ができない

### 5. worker backend / substrate

対象:

- GLM
- opencode
- claude_cli
- simulation

懸念:

- backend 切替で権限モデルが壊れる
- 実行 substrate の差異が audit に残らない
- 危険 capability を持つ worker が誤選定される

## 優先リスク

### R1. 認証回避

影響:

- 不正操作
- task / run / policy / publish の改変

優先度:

- Critical

### R2. 権限昇格

影響:

- operator から admin 相当操作が可能になる

優先度:

- Critical

### R3. 未承認副作用

影響:

- 不要な main 更新
- 不要な publish
- repo 外変更

優先度:

- Critical

### R4. secret 流出

影響:

- provider / GitHub / tracker の不正利用

優先度:

- High

### R5. 監査不能

影響:

- 事故調査不能
- 社内説明困難

優先度:

- High

### R6. backend 切替による統制逸脱

影響:

- 想定しない実行権限
- 監査欠落

優先度:

- High

## 当面の対策順

1. auth / authorization 検証
2. destructive endpoint protection
3. approval boundary 明文化
4. secret scan と secret policy
5. audit completeness 検査
6. backend capability / policy 整合検証
