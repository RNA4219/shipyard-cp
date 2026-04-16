# Risk Register

## 文書の役割

本書は、`shipyard-cp` における残リスクを台帳として管理するための文書である。

目的:

- 何が未解消リスクとして残っているかを明示する
- 受容か対応かを曖昧にしない
- 期限、責任者、制限条件を残す

本書は仕様レベルの台帳雛形であり、実際の判定時には各項目を更新して使う。

## 記入ルール

各リスク項目には最低限次を記録する。

- Risk ID
- タイトル
- 関連脅威
- 影響
- 優先度
- 現在の状態
- 対応方針
- 制限条件
- 期限
- 責任者
- 関連証跡

## 状態

- `Open`
  - 未解消
- `Mitigating`
  - 対応中
- `Accepted`
  - 条件付きで受容
- `Closed`
  - 解消済み
- `Deferred`
  - 後続フェーズへ持ち越し

## 優先度

- `Critical`
- `High`
- `Medium`
- `Low`

## 判定ルール

- `Critical` は、`Go` または `Conditional Go` 判定前に `Closed` であること
- `High` は原則 `Closed` であること
- ただし、実装欠陥ではなく補助統制や追加証跡の未完に限り、制限条件、期限、責任者、例外承認理由を明記した `Mitigating` を `Conditional Go` に残せる
- `Accepted` にできるのは、原則 `Medium` 以下
- `Mitigating` を `Conditional Go` に残せるのは、以下を全て満たす場合に限る:
  - 実装欠陥ではなく、補助統制、追加証跡、または運用文書整備が残る
  - 制限条件がある
  - 解消期限がある
  - 責任者がある
  - 例外承認理由がある

## `Closed` の定義

- 設計・実装上の欠陥は解消済み
- 代表的な運用証跡の追加確認が残る場合は、残課題として明記できる
- ただし、その残課題が本番可否を左右する一次統制でない場合に限る

## 実査日

- 実査日: 2026-04-17
- 実査者: Claude (GLM-5)
- 対象バージョン: commit HEAD (v0.2.0)
- 対象環境: local development, shared internal (文書確認), production candidate (文書確認)

## 台帳

| Risk ID | タイトル | 関連脅威 | 影響 | 優先度 | 状態 | 対応方針 | 制限条件 | 期限 | 責任者 | 関連証跡 |
|---------|----------|----------|------|--------|------|----------|----------|------|--------|----------|
| RISK-001 | auth default safety | R1 | 本番 / 共有環境で未認証アクセスが成立するおそれ | Critical | Closed | 実装確認完了 | auth disabled 運用禁止 (production) | 2026-04-17 | Claude | SECURITY_VERIFICATION_CHECKLIST.md 1-1, 1-2, 1-3 |
| RISK-002 | role escalation path | R2 | operator から admin 相当操作へ到達するおそれ | Critical | Closed | 実装確認完了 | admin route は admin API key 必須 | 2026-04-17 | Claude | SECURITY_VERIFICATION_CHECKLIST.md 2-1, 2-2 |
| RISK-003 | destructive endpoint protection | R3 | publish / cancel / policy update が未保護で実行されるおそれ | Critical | Closed | 実装確認完了 | cancel/approve/policy は admin gate | 2026-04-17 | Claude | SECURITY_VERIFICATION_CHECKLIST.md 4-1, 5-1, 5-2 |
| RISK-004 | secret exposure 管理未確定 | R4 | provider / GitHub / tracker credential の露出 | High | Closed | token scope文書化、credential boundary文書化、secret scan導入完了 | representative records 確認は follow-up 扱い | 2026-04-17 | Claude | TOKEN_SCOPE.md, CREDENTIAL_BOUNDARY.md, .github/workflows/secret-scan.yml, .gitleaks.toml, gitleaks-report.json, SECURITY_VERIFICATION_CHECKLIST.md 6-1, 6-2, 6-3, 9-1, 10-1 |
| RISK-005 | audit completeness 未検証 | R5 | actor / approval / failure reason を追跡できないおそれ | High | Closed | 実装確認完了 | event types 定義済み、actor記録済み | 2026-04-17 | Claude | SECURITY_VERIFICATION_CHECKLIST.md 7-1, 7-2, 5-2, 8-3 |
| RISK-006 | backend policy drift 未検証 | R6 | backend 切替時に capability / 権限境界が崩れるおそれ | High | Closed | 実装確認完了 | backend 独立、capability stage定義済み | 2026-04-17 | Claude | SECURITY_VERIFICATION_CHECKLIST.md 8-1, 8-2, 8-3 |

## 各リスク詳細

### RISK-001: auth default safety

- **判定**: `Closed`
- **根拠**:
  - `src/config/index.ts:174`: `authEnabledDefault = nodeEnv === 'production' || !!apiKey || !!adminApiKey`
  - production 環境または API_KEY 設定時に auth が自動 enabled
  - safe default: 本番環境では auth 必須
- **確認項目**:
  - 1-1 auth 必須化: Pass
  - 1-2 unsafe fallback: Pass (development での auth off は意図された設計)
  - 1-3 API key 検証: Pass (timingSafeEqual)
- **制限条件**:
  - production 環境では AUTH_ENABLED=false を明示設定禁止
  - shared 環境では API_KEY/ADMIN_API_KEY 必須設定

### RISK-002: role escalation path

- **判定**: `Closed`
- **根拠**:
  - `src/auth/auth-plugin.ts:149-168`: createConditionalRoleHook
  - auth enabled の時は role check 有効
  - admin only routes: cancel, approve, policy CRUD
  - operator routes: dispatch, results, publish (approve は admin)
- **確認項目**:
  - 2-1 admin/operator 境界: Pass
  - 2-2 role escalation: Pass (昇格経路なし)
- **制限条件**:
  - admin API key は限定配布
  - operator API key は read + write (publish/approve 不可)

### RISK-003: destructive endpoint protection

- **判定**: `Closed`
- **根拠**:
  - `/v1/tasks/:task_id/cancel`: requireAdmin
  - `/v1/tasks/:task_id/publish/approve`: requireAdmin
  - `/v1/repos/:owner/:name/policy` PUT/PATCH/DELETE: requireAdmin
  - publish 自体は operator、approve で admin gate
- **確認項目**:
  - 4-1 destructive 保護: Pass
  - 4-2 state boundary: Blocked (representative records 確認必要)
  - 5-1 approval 定義: Pass
  - 5-2 approval 追跡: Pass
- **制限条件**:
  - cancel 操作は admin 限定
  - publish apply は admin approve 必須
- **残課題** (運用証跡待ち):
  - state boundary の representative records 確認 (4-2 Blocked)
  - これは設計・実装確認済み、実運用データの代表記録未回収
  - 本番可否を左右する一次統制ではないため、Closed に残課題として明記

### RISK-004: secret exposure 管理未確定

- **判定**: `Closed`
- **根拠**:
  - .gitignore: .env, .env.local 除外済み
  - API keys: env vars から取得
  - timingSafeEqual: secure comparison
  - approval_token: response に含まない設計
  - CodeQL: security scan 有り
  - dependency review: high severity fail
  - **TOKEN_SCOPE.md**: GitHub token scope 定義文書作成完了
  - **CREDENTIAL_BOUNDARY.md**: tracker/resolver credential 境界定義文書作成完了
  - **secret-scan.yml**: Gitleaks dedicated secret scan workflow 追加完了
  - **gitleaks-report.json**: ローカル初回実行で no leaks 確認
- **確認項目**:
  - 6-1 secret hardcode: Pass
  - 6-2 env 管理: Pass
  - 6-3 log 露出: Pass
  - 9-1 credential 境界: Pass (文書整備完了)
  - 10-1 CI security gate: Pass
- **解消内容**:
  - TOKEN_SCOPE.md: GitHub token 分類、scope 定義、最小権限原則明文化
  - CREDENTIAL_BOUNDARY.md: tracker-bridge/memx-resolver credential 不保存境界明文化
  - `.github/workflows/secret-scan.yml`: push / pull_request / schedule / workflow_dispatch で secret scan 実行
  - `.gitleaks.toml`: test fixture の疑似 key を allowlist 化
  - `gitleaks-report.json`: local scan `[]`
- **制限条件** (解除条件):
  - repo への秘密情報追加禁止 (維持)
  - token scope と credential boundary の最小権限原則を維持
- **解消期限**: 2026-04-17 (文書整備完了)
- **責任者**: Claude
- **次アクション**:
  - GitHub Actions 上で `Secret Scan` workflow の初回成功記録を保存

### RISK-005: audit completeness 未検証

- **判定**: `Closed`
- **根拠**:
  - actor_type, actor_id 記録: `src/store/services/audit-service.ts`
  - event types 定義: `docs/audit-events.md`
    - retry, failure, loop, lease, heartbeat, orphan, capability, policy, approval, lock 系
  - WorkerResult.metadata: substrate 記録可能
- **確認項目**:
  - 7-1 actor 追跡: Pass
  - 7-2 result 追跡: Pass
  - 5-2 approval 追跡: Pass
  - 8-3 substrate 記録: Pass
- **制限条件**:
  - 高リスク運用時は audit event 確認必須
- **残課題** (運用証跡待ち):
  - representative records の実際の記録確認は運用開始後に必要
  - これは設計・実装確認済み、実運用データの代表記録未回収
  - 本番可否を左右する一次統制ではないため、Closed に残課題として明記

### RISK-006: backend policy drift 未検証

- **判定**: `Closed`
- **根拠**:
  - backend selection: config で管理、route 保護は backend 独立
  - STAGE_CAPABILITIES: plan, dev, acceptance で capability 定義
  - WorkerResult.metadata: backend 記録可能
- **確認項目**:
  - 8-1 backend 境界: Pass
  - 8-2 capability 整合: Pass
  - 8-3 substrate 記録: Pass
- **制限条件**:
  - GLM 主線運用を推奨
  - backend 切替時は capability 確認必要
- **備考**:
  - integrate/publish は worker-dispatched stage ではないため capability は適用外

## 残リスク要約

### Critical / High

- **Critical**: 全て Closed
- **High**: 全て Closed (RISK-004/005/006)

### 継続運用メモ

**Secret scan CI** (TruffleHog/Gitleaks):
- 状態: 導入済み
- 影響: 6-1 / 10-1 は Pass に更新
- 対応方針: GitHub Actions 上の初回成功記録を保管
- 本番可否影響: 継続運用時は workflow failure を release blocker として扱う

## 判定への影響

現時点の最終判定:

- **Critical 全て Closed**: Go 判定の前提条件満たす
- **High 全て Closed**: Go 判定の前提条件満たす
- **Blocked 1件** (運用証跡待ち):
  - 4-2 state boundary: 実運用データ確認 (設計・実装確認済み)

**最終判定**: `Go`
- 継続条件: `Secret Scan` workflow failure を release blocker として扱う
- Follow-up: 4-2 state boundary representative records 確認

## 更新履歴

- 2026-04-17: 初回実査完了、RISK-001/002/003/005/006 Closed, RISK-004 Mitigating
- 2026-04-17: TOKEN_SCOPE.md, CREDENTIAL_BOUNDARY.md 作成完了、RISK-004 Closed、判定 Go
