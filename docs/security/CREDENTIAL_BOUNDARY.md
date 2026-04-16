# Credential Boundary Definition

## 文書の役割

本書は、`shipyard-cp` および関連 OSS (`tracker-bridge-materials`, `memx-resolver`) における credential 境界と取り扱いルールを定義する。

目的:

- credential の保存禁止境界を明文化する
- 供給経路と責務境界を明確化する
- credential 露出を防止する

## 前提

本書は `REQUIREMENTS.md` の以下の定義に基づく:

- `tracker-bridge-materials` は helper layer であり、認証情報を DB 保存しない前提
- `memx-resolver` では `secret` 保存拒否の前提に合わせ、resolver/memory 層へ秘密情報を永続保存しない
- secrets 注入は shipyard-cp 側で管理

## Credential 分類

### 1. API Keys (Provider)

| 種別 | 用途 | 供給元 |
|------|------|--------|
| `OPENAI_API_KEY` | LiteLLM / OpenAI 推論 | 環境変数 |
| `ANTHROPIC_API_KEY` | LiteLLM / Anthropic 推論 | 環境変数 |
| `GOOGLE_API_KEY` | LiteLLM / Google 推論 | 環境変数 |
| `GEMINI_API_KEY` | LiteLLM / Gemini 推論 | 環境変数 |
| `GLM_API_KEY` | LiteLLM / GLM 推論 | 環境変数 |

### 2. GitHub Credentials

| 種別 | 用途 | 供給元 |
|------|------|--------|
| `GITHUB_TOKEN` | リポジトリ操作 | Actions 既定 / 環境変数 |
| `GITHUB_APP_*` | 組織 Project / main push | 環境変数 |

### 3. Tracker Credentials

| 種別 | 用途 | 供給元 |
|------|------|--------|
| Tracker API token | Issue / Project 同期 | 環境変数 |

## 境界定義

### shipyard-cp (Control Plane)

- **許可**: 環境変数から credential 取得、runtime で使用
- **禁止**: credential を DB / Redis / config ファイルに永続保存
- **禁止**: credential を log / audit / API response に出力
- **責務**: credential 供給、worker への注入、露出防止

### tracker-bridge-materials (Helper Layer)

- **許可**: shipyard-cp から注入された credential を runtime で使用
- **禁止**: credential を自身の DB / cache に永続保存
- **禁止**: credential を external tracker へ送信 (auth header 以外)
- **責務**: tracker 連携、issue cache / entity link 管理 (credential 不保存)

### memx-resolver (Resolver 基盤)

- **許可**: shipyard-cp から注入された credential を runtime で使用
- **禁止**: `secret` を resolver / memory 層へ永続保存
- **禁止**: credential を docs / chunks / contracts に埋め込む
- **責務**: docs resolve / ack / stale / contract resolve (credential 不保存)

## 供給経路

```
Environment Variables / Secret Store
              ↓
        shipyard-cp (Control Plane)
              ↓
    ┌─────────┴─────────┐
    ↓                   ↓
tracker-bridge    memx-resolver
(helper layer)    (resolver 基盤)
    ↓                   ↓
external tracker    docs/memory store
```

### 供給ルール

1. **注入元**: 環境変数または secure secret store
2. **注入先**: shipyard-cp runtime memory only
3. **禁止**: OSS connector 層で credential 永続化
4. **禁止**: external service へ credential を data payload で送信

## 露出防止

### 必須措置

1. **response 非露出**
   - API response に credential を含めない
   - approval_token は response に含まない設計 (`src/routes/task-routes.ts:245-256`)

2. **log 非露出**
   - credential を log に出力しない
   - error message に key 値を含まない (`src/auth/auth-plugin.ts:105-113`)

3. **audit 非露出**
   - audit event payload に credential を含めない

4. **hardcode 禁止**
   - repo ほの credential hardcode 禁止
   - `.env` は `.gitignore` で除外

## Worker Credential Injection

### WorkerJob での供給

- `WorkerJob` の `context.secrets` には credential 名のみ指定 (値は含めない)
- Worker 実行時に shipyard-cp から環境変数経由で注入
- Worker 終了時に credential は memory 上で破棄

### WorkspaceManager

- `secrets` は注入対象名のリスト
- 実際の credential 値は環境変数から取得
- workspace 環境には credential 名のみ設定、値は注入時に取得

## 禁止事項

- OSS connector (tracker-bridge / memx-resolver) で credential 永続保存
- credential を external tracker / docs store の data payload で送信
- credential を log / audit / response に出力
- repo へ credential hardcode

## 運用責務

### Security Owner

- credential 境界定義の更新
- 新 credential 申請の審査
- 露出防止措置の監督

### Platform Owner

- 供給経路の整備
- OSS connector の credential 不保存確認
- Worker injection 実装の管理

## 関連文書

- `REQUIREMENTS.md`: tracker-bridge / memx-resolver credential 不保存前提
- `TOKEN_SCOPE.md`: GitHub token scope 定義
- `SECURITY_TARGET.md`: 保護対象
- `THREAT_MODEL.md`: R4 (secret exposure)
- `src/domain/workspace/workspace-manager.ts`: secrets injection

## 更新履歴

- 2026-04-17: 初版作成 (RISK-004 解消)