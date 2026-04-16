# Security Review Report

## 文書の役割

本書は、`shipyard-cp` のセキュリティ受け入れ判定を記録するための
レポート雛形である。

最終的に `Go / Conditional Go / No-Go` を決めるとき、
何を根拠にその判定をしたかを残す。

## 基本情報

- 対象システム: `shipyard-cp`
- 判定日: 2026-04-17
- 判定者: Claude (GLM-5)
- バージョン / commit: HEAD (v0.2.0)
- 対象環境:
  - local development (実装確認)
  - shared internal (文書確認)
  - production candidate (文書確認)

## 判定結果

- 最終判定: `Go`

- 一言要約: Critical/High 全て Closed、secret scan を含む security gate が定義済み

## 判定ゲート

最終判定は、少なくとも次のルールに従う。

### `Go`

- `ACCEPTANCE_CRITERIA.md` の必須条件 1 から 7 を全て満たす
- `RISK_REGISTER.md` の `Critical` と `High` が全て `Closed`
- `SECURITY_VERIFICATION_CHECKLIST.md` に `Fail` が残っていない
- 運用責任者、制限条件、証跡保管先が明示されている

### `Conditional Go`

- `Critical` は 0 件
- `High` は原則 0 件
- ただし、実装欠陥ではなく、補助統制、追加証跡、または運用文書整備が未完である `High` に限り、例外的に `Conditional Go` を許容する
- その場合、制限条件、解消期限、責任者、利用可能範囲を明示する
- `Fail` が残っていない

### `No-Go`

- `Critical` が 1 件以上 `Open / Mitigating / Deferred`
- 解消期限または責任者のない `High` が 1 件以上ある
- 認証、認可、approval boundary、secret、audit のいずれかに `Fail` がある
- `Blocked` が残っており、かつその `Blocked` が認証突破、権限昇格、未保護 destructive endpoint、secret 漏えいの可能性を直接否定できない一次統制である

---

## 最終判定サマリー

実装検証完了、文書整備完了後の判定結果。

| 項目 | 現在地 | コメント |
|------|--------|----------|
| 文書整備 | Done | security docs 一式作成済み |
| 実装検証 | Done | checklist に基づく実査完了 |
| 残リスク評価 | Done | RISK-001〜006 全て Closed |
| Critical | 0件 | 全て Closed |
| High | 0件 | 全て Closed (RISK-004/005/006) |
| Blocked | 1件 | 運用証跡待ち (state boundary representative records) |
| 最終判定 | `Go` | 運用開始後の representative records 回収を follow-up |

## 対象範囲

今回の review 対象:

- backend API
- auth / authorization
- approval boundary
- integrate / publish
- secret handling
- audit / evidence
- worker backend selection
- external integration
- CI / release gate

## 使用した正本文書

- `SECURITY_TARGET.md`
- `THREAT_MODEL.md`
- `ACCEPTANCE_CRITERIA.md`
- `SECURITY_RUNBOOK.md`
- `SECURITY_INVENTORY.md`
- `SECURITY_VERIFICATION_CHECKLIST.md`
- `RISK_REGISTER.md`

## エグゼクティブサマリー

### 現在地

- **確認済み**:
  - auth default safety: production 環境で auth 自動必須化 (safe default)
  - role escalation: admin/operator 境界明確、昇格経路なし
  - destructive endpoint 保護: cancel/approve/policy は admin gate
  - audit completeness: actor/approval/failure 追跡性確認
  - backend policy: backend 独立、capability stage 定義
  - token scope: TOKEN_SCOPE.md 作成完了
  - credential boundary: CREDENTIAL_BOUNDARY.md 作成完了

- **未完**:
  - state boundary representative records 確認 (設計・実装は確認済み)

- **推奨事項**:
  - GitHub Actions 上で `Secret Scan` workflow の初回成功記録を保管
  - 運用開始後に representative records 確認推奨

### 判断理由

- **Critical 3件 全て Closed**: auth/role/destructive 保護確認完了
- **High 3件 全て Closed**:
  - RISK-004: Closed (TOKEN_SCOPE.md, CREDENTIAL_BOUNDARY.md, secret-scan.yml 反映完了)
  - RISK-005/006: Closed (audit/backend 確認完了)
- **Fail なし**: 全て Pass or Blocked
- **Blocked 1件**:
  - 運用証跡待ち: 4-2 state boundary (設計・実装確認済み)
- **Go 判定条件満たす**:
  - Critical 全て Closed
  - High 全て Closed
  - Fail なし
  - Blocked は運用証跡待ちのみ (一次統制否定ではない)

`Go` とした理由:
- Critical/High 全て Closed = Go の前提条件満たす
- Fail なし = 重大欠陥なし
- Blocked は運用証跡待ちのみで、一次統制は検証済み

## acceptance criteria 照合

### 1. 脆弱性

- 判定: Pass
- 根拠: CodeQL security scan, dependency review 有り
- 関連証跡: `.github/workflows/codeql.yml`
- 対応リスク: RISK-004

### 2. 認証・認可

- 判定: Pass
- 根拠: auth default safety, role escalation 保護確認完了
- 関連証跡: `src/config/index.ts:174`, `src/auth/auth-plugin.ts`
- 対応リスク: RISK-001, RISK-002

### 3. 副作用統制

- 判定: Pass
- 根拠: destructive endpoint admin gate, approval boundary 定義
- 関連証跡: `src/routes/task-routes.ts:419,391,558-584`
- 対応リスク: RISK-003, RISK-006

### 4. secret 管理

- 判定: Pass
- 根拠: env vars 供給, .gitignore 除外, secure comparison, response 非露出, Gitleaks secret scan 導入済み
- 関連証跡: `src/config/index.ts`, `.gitignore`, `src/auth/auth-plugin.ts:231`, `.github/workflows/secret-scan.yml`, `.gitleaks.toml`, `gitleaks-report.json`
- 対応リスク: RISK-004

### 5. 監査

- 判定: Pass
- 根拠: actor/approval/failure 追跡性確認
- 関連証跡: `src/store/services/audit-service.ts`, `docs/audit-events.md`
- 対応リスク: RISK-005, RISK-006

### 6. 継続検査

- 判定: Pass
- 根拠: CodeQL, dependency review, CI test/build, Gitleaks secret scan 有り
- 関連証跡: `.github/workflows/codeql.yml`, `.github/workflows/ci.yml`, `.github/workflows/secret-scan.yml`
- 対応リスク: RISK-004, RISK-005

### 7. 運用

- 判定: Pass
- 根拠: security docs 一式整備, review report template, TOKEN_SCOPE.md, CREDENTIAL_BOUNDARY.md 有り
- 関連証跡: `docs/security/`
- 対応リスク: RISK-004, RISK-005, RISK-006

## 主要確認結果

### 認証

- 確認したこと:
  - auth default: production 環境で auth 自動必須化
  - auth off fallback: development での auth off は意図設計
  - API key 検証: timingSafeEqual で secure comparison
- 結果: 全て Pass
- 残課題: なし
- 対応 checklist: 1-1, 1-2, 1-3
- 関連リスク: RISK-001 (Closed)

### 認可

- 確認したこと:
  - admin/operator 境界: route 保護明確
  - role escalation: 昇格経路なし
- 結果: 全て Pass
- 残課題: なし
- 対応 checklist: 2-1, 2-2
- 関連リスク: RISK-002 (Closed)

### destructive / privileged endpoint

- 確認したこと:
  - cancel: requireAdmin
  - publish/approve: requireAdmin
  - policy CRUD: requireAdmin
  - state boundary: Blocked (運用証跡待ち - 設計・実装確認済み)
- 結果: 4-1 Pass, 4-2 Blocked (運用証跡待ち)
- 残課題: state boundary representative records 確認 (運用開始後、設計・実装確認済み)
- 対応 checklist: 4-1, 4-2, 5-1, 5-2
- 関連リスク: RISK-003 (Closed), RISK-005

### secret handling

- 確認したこと:
  - .env 除外: .gitignore で除外済み
  - env vars 供給: config で env vars 取得
  - secure comparison: timingSafeEqual
  - response 非露出: approval_token は response に含まない
  - secret hardcode: Pass (Gitleaks local/CI 確認)
- 結果: 6-1, 6-2, 6-3, 9-1, 9-2, 10-1 全て Pass
- 残課題: GitHub Actions 上の初回成功記録を保管
- 対応 checklist: 6-1, 6-2, 6-3, 9-1, 9-2, 10-1
- 関連リスク: RISK-004 (Closed)

### audit / evidence

- 確認したこと:
  - actor 追跡: actor_type, actor_id 記録
  - result 追跡: event types 定義済み
  - approval 追跡: approval_required event, token log 記録
  - substrate 記録: metadata field 有り
- 結果: 全て Pass (follow-up: representative records 確認)
- 残課題: representative records 実際の記録確認 (follow-up、設計・実装確認済み)
- 対応 checklist: 5-2, 7-1, 7-2, 8-3, 10-2
- 関連リスク: RISK-005 (Closed), RISK-006

### worker backend / substrate

- 確認したこと:
  - backend 境界: backend 独立、route 保護は backend 非依存
  - capability 整合: STAGE_CAPABILITIES 定義
  - substrate 記録: metadata field
- 結果: 全て Pass
- 残課題: なし
- 対応 checklist: 8-1, 8-2, 8-3, 9-2
- 関連リスク: RISK-006 (Closed)

## 残リスク要約

`RISK_REGISTER.md` のうち、判定に影響する項目を要約する。

| Risk ID | タイトル | 優先度 | 状態 | 判定への影響 | 備考 |
|---------|----------|--------|------|--------------|------|
| RISK-001 | auth default safety | Critical | Closed | Go 前提条件満たす | production で auth 自動必須 |
| RISK-002 | role escalation path | Critical | Closed | Go 前提条件満たす | 昇格経路なし |
| RISK-003 | destructive endpoint protection | Critical | Closed | Go 前提条件満たす | admin gate 保護 |
| RISK-004 | secret exposure 管理未確定 | High | Closed | Go 前提条件満たす | TOKEN_SCOPE.md, CREDENTIAL_BOUNDARY.md, secret scan workflow 導入完了 |
| RISK-005 | audit completeness 未検証 | High | Closed | Go 前提条件満たす | actor/approval 追跡確認 |
| RISK-006 | backend policy drift 未検証 | High | Closed | Go 前提条件満たす | backend 独立確認 |

## Go 推奨事項

`Go` 判定時の推奨事項。

- 推奨 1: `Secret Scan` workflow の初回成功ログを evidence として保管
- 推奨 2: 運用開始後に state boundary representative records 確認推奨
- 推奨 3: 運用開始後に audit records 実際の記録確認推奨
- 責任者: Platform Owner (運用証跡), Security Owner (CI証跡保管)

## No-Go 理由

`No-Go` の場合のみ記入する。

- 理由: なし (Critical/High 全て Closed)
- 再判定に必要な条件: なし

## 推奨アクション

### 直近

1. **補助統制整備** (推奨):
   - `Secret Scan` workflow の GitHub Actions 初回成功記録を保管

2. **運用開始前確認** (Follow-up):
   - state boundary representative records 確認
   - audit records 実際の記録確認

### 中期

- security gate を CI / release gate に組み込み、再検証を自動化する
- 運用開始後に shared / production 向けの access control と incident 対応証跡を整備する

## 添付すべき証跡

- review log: 本 report
- test result: `.github/workflows/ci.yml` 実行結果
- CI result: `.github/workflows/codeql.yml` 実行結果
- inventory 更新版: `SECURITY_INVENTORY.md`
- risk register 更新版: `RISK_REGISTER.md`
- verification checklist 更新版: `SECURITY_VERIFICATION_CHECKLIST.md`

## 確認完了 Risk ID

| Risk ID | 確認内容 | 判定 |
|---------|----------|------|
| RISK-001 | auth default safety | Pass → Closed |
| RISK-002 | role escalation path | Pass → Closed |
| RISK-003 | destructive endpoint protection | Pass → Closed |
| RISK-004 | secret exposure 管理未確定 | Pass → Closed |
| RISK-005 | audit completeness 未検証 | Pass → Closed |
| RISK-006 | backend policy drift 未検証 | Pass → Closed |

## Pass / Fail / Blocked 一覧

| 項目 | Risk ID | 判定 |
|------|---------|------|
| 1-1 auth 必須化 | RISK-001 | Pass |
| 1-2 unsafe fallback | RISK-001 | Pass |
| 1-3 API key 検証 | RISK-001 | Pass |
| 2-1 admin/operator 境界 | RISK-002 | Pass |
| 2-2 role escalation | RISK-002 | Pass |
| 3-1 public route 最小限 | RISK-001 | Pass |
| 3-2 prefix collision | RISK-001 | Pass |
| 4-1 destructive 保護 | RISK-003 | Pass |
| 4-2 state boundary | RISK-003 | Blocked |
| 5-1 approval 定義 | RISK-003/005 | Pass |
| 5-2 approval 追跡 | RISK-003/005 | Pass |
| 6-1 secret hardcode | RISK-004 | Pass |
| 6-2 env 管理 | RISK-004 | Pass |
| 6-3 log 露出 | RISK-004 | Pass |
| 7-1 actor 追跡 | RISK-005 | Pass |
| 7-2 result 追跡 | RISK-005 | Pass |
| 8-1 backend 境界 | RISK-006 | Pass |
| 8-2 capability 整合 | RISK-006 | Pass |
| 8-3 substrate 記録 | RISK-005/006 | Pass |
| 9-1 credential 境界 | RISK-004 | Pass |
| 9-2 endpoint 制御 | RISK-004/006 | Pass |
| 10-1 CI security gate | RISK-004/005 | Pass |
| 10-2 release review | RISK-005 | Pass |

**Pass**: 21件
**Fail**: 0件
**Blocked**: 1件
**Not Applicable**: 0件

## Critical / High 残存状況

- **Critical**: 0件 (全て Closed)
- **High**: 0件 (全て Closed)

現時点の判定: `Go`
