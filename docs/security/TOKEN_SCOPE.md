# Token Scope Definition

## 文書の役割

本書は、`shipyard-cp` で使用する GitHub token の scope と権限境界を定義する。

目的:

- GitHub token の最小権限原則を明文化する
- 過剰権限利用を防止する
- token 分類と用途を明確化する

## 前提

本書は `REQUIREMENTS.md` の以下の定義に基づく:

- main への push 権限はボット（GitHub App / bot user）のみに限定
- Projects v2 は GraphQL API で操作、`GITHUB_TOKEN` はリポジトリスコープで Projects にアクセスできない
- 組織 Project では GitHub App が推奨

## Token 分類

### 1. GITHUB_TOKEN (Actions 既定 token)

- **用途**: リポジトリ操作のみ
- **scope**: `repo` (リポジトリスコープ)
- **制限**: Projects v2 にはアクセス不可
- **運用**: Actions workflow 内で自動提供、永続保存禁止

### 2. GitHub App Installation Token

- **用途**: 組織 Project 操作、main push
- **必要 scope**:
  - `read:project` (Project 参照)
  - `project` (Project 更新)
  - `contents:write` (main push)
- **推奨**: 組織 Project 自動化には GitHub App を使用
- **運用**: Installation token を取得して使用、token は永続保存禁止

### 3. PAT (Personal Access Token)

- **用途**: ユーザー Project 操作 (組織 Project ではない)
- **必要 scope**:
  - `read:project` (Project 参照)
  - `project` (Project 更新)
- **制限**: classic PAT は使用禁止、fine-grained PAT を推奨
- **運用**: 限定用途のみ、永続保存禁止

### 4. Bot User Token

- **用途**: main push (GitHub App 代替)
- **必要 scope**:
  - `repo` (リポジトリ操作)
- **制限**: main への push は bot user 限定、人間アカウントの token で main push 禁止

## Token 供給経路

### shipyard-cp での供給

| 環境変数 | 用途 | Token 種別 |
|----------|------|------------|
| `GITHUB_TOKEN` | リポジトリ操作 (CI/Actions) | Actions 既定 |
| `GITHUB_APP_ID` | GitHub App 識別 | App 設定 |
| `GITHUB_APP_PRIVATE_KEY` | App 秘密鍵 | App 設定 |
| `GITHUB_APP_INSTALLATION_ID` | Installation 識別 | App 設定 |

### 供給ルール

- 環境変数または secure secret store から注入
- repo への token hardcode 禁止
- `.env` は `.gitignore` で除外
- token は log / audit に出力禁止

## 最小権限原則

### 必須遵守事項

1. **用途に必要な最小 scope のみ取得**
   - Projects 参照のみ → `read:project`
   - Projects 更新あり → `project`
   - main push あり → `contents:write`

2. **過剰 scope 禁止**
   - `admin:*` scope 禁止 (Organization admin 等)
   - `delete_repo` scope 禁止
   - 申請用途以外の scope 禁止

3. **token 期限**
   - fine-grained PAT: 最長 1 年、定期更新
   - GitHub App: 秘密鍵定期ローテーション

## 禁止事項

- 人間アカウントの PAT で main push
- `GITHUB_TOKEN` を Projects 操作に使用 (アクセス不可)
- repo へ token hardcode
- log / audit に token 値を出力
- token を DB / config ファイルに永続保存

## 運用責務

### Security Owner

- token scope 定義の更新
- 新 token 申請の審査
- 期限管理とローテーション監督

### Platform Owner

- token 供給経路の整備
- GitHub App / Installation の管理
- token 露出防止の実装確認

## 関連文書

- `REQUIREMENTS.md`: GitHub App / PAT 運用前提
- `CREDENTIAL_BOUNDARY.md`: tracker/resolver credential 境界
- `SECURITY_TARGET.md`: 保護対象
- `THREAT_MODEL.md`: R4 (secret exposure)

## 更新履歴

- 2026-04-17: 初版作成 (RISK-004 解消)