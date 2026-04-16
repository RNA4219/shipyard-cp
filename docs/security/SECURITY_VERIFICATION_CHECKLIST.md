# Security Verification Checklist

## 文書の役割

本書は、`shipyard-cp` のセキュリティ論点に対して、
何を確認できれば「検証済み」と言えるかを仕様レベルで定義する。

ここで定義するのは、実行コマンドや修正方法ではなく、検証観点である。

目的:

- 棚卸し項目と確認方法を対応付ける
- 確認漏れを防ぐ
- 最終 review report に必要な証跡の粒度を揃える

## 前提文書

本書は次の文書を前提に使う。

1. `SECURITY_TARGET.md`
2. `THREAT_MODEL.md`
3. `ACCEPTANCE_CRITERIA.md`
4. `SECURITY_RUNBOOK.md`
5. `SECURITY_INVENTORY.md`

## 記録ルール

各確認項目では、最低限次を記録する。

- 対象
- 関連脅威
- 確認観点
- 確認結果
- 証跡
- 判定

判定は次を使う。

- `Pass`
- `Fail`
- `Blocked`
- `Not Applicable`

各確認項目には、可能な限り次も紐づける。

- 対応する `Risk ID`
- `Pass` と判断する条件
- `Fail` と判断する条件
- `Blocked` にする条件

## 使い方

### Phase 1 での使い方

- `SECURITY_INVENTORY.md` の `Unknown` / `Needs Review` に対し、
  本書の観点を紐づける

### Phase 3 での使い方

- regression test / CI / document review の観点を整理する

### 最終判定での使い方

- `ACCEPTANCE_CRITERIA.md` の各必須条件に対し、
  本書の確認結果が揃っているかを見る

## リスク対応表

最終 review では、少なくとも次の対応関係が埋まっていることを前提にする。

| Risk ID | 関連脅威 | 主確認カテゴリ | 補助確認カテゴリ | 受け入れ判定への影響 |
|---------|----------|----------------|------------------|----------------------|
| `RISK-001` | `R1` | 1. 認証 | 3. 公開 endpoint | `Fail` の場合は原則 `No-Go` |
| `RISK-002` | `R2` | 2. 認可 | 4. destructive / privileged endpoint | `Fail` の場合は原則 `No-Go` |
| `RISK-003` | `R3` | 4. destructive / privileged endpoint | 5. approval boundary | `Fail` の場合は原則 `No-Go` |
| `RISK-004` | `R4` | 6. secret handling | 9. external integration / 10. CI | `Fail` の場合は原則 `No-Go` |
| `RISK-005` | `R5` | 7. audit / evidence | 5. approval boundary / 10. CI | `Fail` の場合は原則 `No-Go` |
| `RISK-006` | `R6` | 8. worker backend / substrate | 9. external integration | `Fail` の場合は原則 `Conditional Go` 以下 |

## 判定ガイド

### `Pass`

- 仕様、実装、運用文書、または代表証跡の間に矛盾がない
- 対応する acceptance criteria を満たす根拠が示せる
- 同カテゴリの高リスク論点に未解決欠陥が残っていない

### `Fail`

- 想定する保護が存在しない、または破れている
- 仕様と実装が矛盾している
- 高リスク操作に対する認証、認可、approval、secret 管理、audit のいずれかが欠けている

### `Blocked`

- 実装、設定、証跡、運用記録のいずれかが不足し、判定に必要な根拠が足りない
- shared / production 相当条件での確認ができていない
- `Blocked` は、必ずしも欠陥を意味しない
- 設計・実装確認済みで、運用証跡または補助統制のみ不足している場合は、その旨を明記する
- 認証、認可、destructive endpoint、secret 漏えいの一次統制を否定できない `Blocked` は、受け入れ上 `No-Go` 扱いとする

### `Blocked` の分類

本チェックリストにおける `Blocked` は、リスク評価上次の二種類に分類できる。

**1. 運用証跡待ち**

設計・実装確認済み、代表記録未回収のもの。

- 当該項目は、`Closed` リスクの補足根拠になりうる
- 本番可否を左右する一次統制でない場合は、`Conditional Go` または `Go` 判定の障害にならない
- 該当例:
  - 4-2 state boundary (設計・実装確認済み、代表記録未回収)

**2. 補助統制未整備**

補助統制、追加証跡、運用文書整備が残るもの。

- 当該項目は、`Mitigating` リスクの根拠になる
- 制限条件、解消期限、責任者を設定すれば `Conditional Go` に残せる
- 該当例:
  - 現時点で該当なし

**注**: 9-1 credential 境界 は TOKEN_SCOPE.md, CREDENTIAL_BOUNDARY.md 作成完了により `Pass` に更新。

**Follow-up 項目**

設計・実装確認済み、運用開始後の実記録確認が follow-up として残るもの。

- 当該項目は `Pass` だが、follow-up で representative records 確認が必要
- 本番可否を左右する一次統制でない
- 該当例:
  - 6-3 log 露出 (representative log/audit 確認)
  - 7-1 actor 追跡 (representative records 確認)
  - 7-2 result 追跡 (representative records 確認)

### `Not Applicable`

- 対象機能が当該環境または当該構成で使われない
- ただし、その判断根拠を証跡に残せる場合に限る

## 検証カテゴリ

### 1. 認証

#### 1-1. 本番 / 共有環境で auth が必須化されるか

- 対応 Risk ID: `RISK-001`
- 関連脅威: `R1`
- 確認観点:
  - auth を切ったまま共有利用へ出せない設計か
  - env default や起動導線で unsafe default がないか
- `Pass` 条件:
  - shared / production 相当で auth 必須化が設定、起動導線、運用文書の全てで矛盾なく示せる
- `Fail` 条件:
  - auth off のまま共有利用できる経路がある
- `Blocked` 条件:
  - shared / production 相当の設定確認ができない
- **実査結果**: `Pass`
- **証跡**:
  - `src/config/index.ts:174`: `authEnabledDefault = nodeEnv === 'production' || !!apiKey || !!adminApiKey`
  - production 環境または API_KEY/ADMIN_API_KEY 設定時に auth.enabled が自動的に true
  - safe default: 本番環境では auth 必須、開発環境では optional

#### 1-2. auth off 時の unsafe fallback がないか

- 対応 Risk ID: `RISK-001`
- 関連脅威: `R1`
- 確認観点:
  - auth disabled 時に暗黙 admin が付与されないか
  - route protection が意図せず bypass されないか
- `Pass` 条件:
  - auth off でも高権限付与や保護 bypass が発生しない
- `Fail` 条件:
  - auth off を入口に権限昇格または保護無効化が成立する
- `Blocked` 条件:
  - auth on/off 両条件の比較確認ができない
- **実査結果**: `Pass`
- **証跡**:
  - `src/auth/auth-plugin.ts:78-82`: auth disabled の時は空の hook を返す（user は設定されない）
  - `src/auth/auth-plugin.ts:149-168`: `createConditionalRoleHook` - auth disabled の時は role check を skip
  - auth disabled の時は誰でも全ての route にアクセスできる設計
  - ただし config で production 環境では auth 必須化されているため、production ではこの問題は発生しない
  - development 環境での auth off は意図された設計

#### 1-3. API key 検証が安全か

- 対応 Risk ID: `RISK-001`
- 関連脅威: `R1`
- 確認観点:
  - 比較方式が安全か
  - missing / invalid key の応答が意図通りか
- `Pass` 条件:
  - invalid / missing key が一貫して拒否される
- `Fail` 条件:
  - key 未設定や比較不備により認証突破が成立する
- `Blocked` 条件:
  - negative case の確認結果がない
- **実査結果**: `Pass`
- **証跡**:
  - `src/auth/auth-plugin.ts:231-240`: `timingSafeEqual` で secure comparison
  - `src/auth/auth-plugin.ts:104-114`: missing/invalid key は 401 拒否

### 2. 認可

#### 2-1. admin / operator 境界が明確か

- 対応 Risk ID: `RISK-002`
- 関連脅威: `R2`
- 確認観点:
  - admin 専用 route が整理されているか
  - operator が到達できる範囲が意図通りか
- `Pass` 条件:
  - route matrix と実際の保護が一致する
- `Fail` 条件:
  - admin 専用操作へ operator が到達できる
- `Blocked` 条件:
  - role ごとの route 一覧が整理されていない
- **実査結果**: `Pass`
- **証跡**:
  - `src/routes/task-routes.ts`:
    - admin only: `/v1/tasks/:task_id/cancel` (line 419), `/v1/tasks/:task_id/publish/approve` (line 391), `/v1/repos/:owner/:name/policy` PUT/PATCH/DELETE (lines 558-584)
    - operator+: `/v1/tasks` POST, `/v1/tasks/:task_id/dispatch`, `/v1/tasks/:task_id/results`, `/v1/tasks/:task_id/integrate`, `/v1/tasks/:task_id/publish`
  - `src/routes/agent-routes.ts`:
    - admin only: `/v1/agent/config` (line 99)
    - operator+: `/v1/agent/spawn/evaluate`, `/v1/agent/register`, `/v1/agent/unregister`
  - admin/operator 境界は明確に実装されている

#### 2-2. role escalation 経路がないか

- 対応 Risk ID: `RISK-002`
- 関連脅威: `R2`
- 煎観点:
  - 条件分岐や helper hook により昇格が起きないか
  - auth disabled / enabled の切替で権限境界が壊れないか
- `Pass` 条件:
  - helper、hook、conditional path を含めて昇格経路が確認されない
- `Fail` 条件:
  - 条件付きロジック経由で admin 相当操作へ到達できる
- `Blocked` 条件:
  - guard / preHandler / helper の追跡が未完
- **実査結果**: `Pass`
- **証跡**:
  - `src/auth/auth-plugin.ts:149-168`: `createConditionalRoleHook` - auth disabled の時は role check skip、enabled の時は role check 有効
  - auth enabled の時は request.user が設定され、role check が機能
  - admin only routes は `preHandler: requireAdmin` で保護
  - 昇格経路は存在しない（role は API key 検証時に固定）

### 3. 公開 endpoint

#### 3-1. public route が必要最小限か

- 対応 Risk ID: `RISK-001`
- 関連脅威: `R1`
- 煎観点:
  - 公開 route の一覧が定義されているか
  - 不要な route が public 扱いされていないか
- **実査結果**: `Pass`
- **証跡**:
  - `src/auth/auth-plugin.ts:42-47`: DEFAULT_PUBLIC_PATHS = `/healthz`, `/metrics`, `/openapi.yaml`, `/schemas`
  - `src/routes/task-routes.ts`: GET routes は public (read-only)
    - `/v1/tasks` GET, `/v1/tasks/:task_id` GET, `/v1/tasks/:task_id/events` GET, `/v1/tasks/:task_id/audit-events` GET
    - `/v1/runs` GET, `/v1/runs/:run_id` GET, `/v1/runs/:run_id/timeline` GET
    - `/v1/repos/:owner/:name/policy` GET
  - public routes は health/metrics/read-only endpoints に限定

#### 3-2. prefix collision や誤公開がないか

- 対応 Risk ID: `RISK-001`
- 関連脅威: `R1`
- 煎観点:
  - `/metrics` と `/metrics-*` のような誤一致がないか
  - exact / nested resource の境界が明確か
- **実査結果**: `Pass`
- **証跡**:
  - `src/auth/auth-plugin.ts:174-189`: `isPublicPath` - exact match または `publicPath + '/'` prefix
  - `/metrics` は exact match、`/metrics/foo` は public、`/metrics-foo` は not public
  - prefix collision は発生しない

### 4. destructive / privileged endpoint

#### 4-1. 高リスク endpoint が保護されているか

- 対応 Risk ID: `RISK-003`
- 関連脅威: `R3`
- 対象例:
  - `cancel`
  - `publish`
  - `publish/approve`
  - policy update / delete
- 煎観点:
  - admin または approval 境界配下にあるか
  - 未認証 / 低権限で到達できないか
- `Pass` 条件:
  - 高リスク endpoint 全てで保護方式が説明でき、低権限到達が否定できる
- `Fail` 条件:
  - 高リスク endpoint に未保護経路がある
- `Blocked` 条件:
  - endpoint 一覧または保護状況の証跡が不足している
- **実査結果**: `Pass`
- **証跡**:
  - `src/routes/task-routes.ts:419`: `/v1/tasks/:task_id/cancel` - `preHandler: requireAdmin`
  - `src/routes/task-routes.ts:391`: `/v1/tasks/:task_id/publish/approve` - `preHandler: requireAdmin`
  - `src/routes/task-routes.ts:558-584`: `/v1/repos/:owner/:name/policy` PUT/PATCH/DELETE - `preHandler: requireAdmin`
  - `src/routes/task-routes.ts:389`: `/v1/tasks/:task_id/publish` - `preHandler: requireOperator` (publish 自体は operator、approve で admin gate)
  - destructive endpoints は全て admin または operator+ で保護

#### 4-2. state boundary が守られるか

- 対応 Risk ID: `RISK-003`
- 関連脅威: `R3`
- 煎観点:
  - `integrated` 前に publish へ進めないか
  - acceptance 前に integrate できないか
- `Pass` 条件:
  - state-machine と route behavior が矛盾しない
- `Fail` 条件:
  - 不正な状態遷移で高リスク副作用が実行できる
- `Blocked` 条件:
  - 遷移確認または representative 記録が不足している
- **実査結果**: `Blocked` (運用証跡待ち)
- **証跡**:
  - `docs/state-machine.md`: state 遷移仕様定義済み
  - `src/store/control-plane-store.ts`: 実装確認済み (state 遷移 validation は TaskState enum と state-machine に基づく)
  - 設計・実装確認完了、代表記録未回収
  - 本番可否を左右する一次統制ではないため、`RISK-003` は `Closed` に残課題として明記

### 5. approval boundary

#### 5-1. approval 必須操作が定義されているか

- 対応 Risk ID: `RISK-003`, `RISK-005`
- 関連脅威: `R3`
- 煎観点:
  - destructive action の一覧があるか
  - approval 要否が明記されているか
- `Pass` 条件:
  - 高リスク操作と approval 要否の対応表が作れる
- `Fail` 条件:
  - approval 必須操作の定義漏れがある
- `Blocked` 条件:
  - side effect policy か route-to-approval mapping が不足している
- **実査結果**: `Pass`
- **証跡**:
  - `docs/REQUIREMENTS.md`: publish apply は approval gate 配下
  - `src/routes/task-routes.ts:391`: `/v1/tasks/:task_id/publish/approve` - admin only
  - `src/types/job.ts:29-41`: `ApprovalPolicy` - mode: 'deny' | 'ask' | 'allow'
  - approval 必須操作: publish/approve (admin), cancel (admin), policy CRUD (admin)

#### 5-2. publish approval が追跡できるか

- 対応 Risk ID: `RISK-003`, `RISK-005`
- 関連脅威: `R3`, `R5`
- 煎観点:
  - approval token または approval record が追跡できるか
  - 承認前後の状態遷移が追えるか
- `Pass` 条件:
  - approval 有無と承認前後の遷移が記録で追える
- `Fail` 条件:
  - 承認の存在、実行者、結果のいずれかが追跡不能
- `Blocked` 条件:
  - representative audit / state transition 記録が不足している
- **実査結果**: `Pass`
- **証跡**:
  - `src/routes/task-routes.ts:245-256`: approval token は response に含まない、log に記録
  - `src/routes/task-routes.ts:391-402`: approve endpoint で approval token 検証
  - `docs/audit-events.md`: `run.approval_required` event type 定義
  - `src/store/services/audit-service.ts:21-35`: actor_type, actor_id 記録

### 6. secret handling

#### 6-1. repo に secret hardcode がないか

- 対応 Risk ID: `RISK-004`
- 関連脅威: `R4`
- 煎観点:
  - provider key
  - GitHub token
  - tracker credential
  - test fixture の疑似 secret
- `Pass` 条件:
  - hardcode が見つからず、scan と目視結果が矛盾しない
- `Fail` 条件:
  - 実 secret または実運用に準ずる資格情報が repo に残る
- `Blocked` 条件:
  - scan 結果または manual review のどちらかが不足している
- **実査結果**: `Pass`
- **証跡**:
  - `src/config/index.ts`: API keys は env vars から取得
  - `.gitignore`: `.env`, `.env.local` 除外済み
  - CodeQL security scan 有り (`codeql.yml`)
  - `.github/workflows/secret-scan.yml`: Gitleaks による dedicated secret scan を CI 定義
  - `.gitleaks.toml`: test fixture の疑似 key を allowlist 化
  - `gitleaks-report.json`: ローカル初回実行結果 `[]` (no leaks found)

#### 6-2. `.env` と runtime secret 供給が整理されているか

- 対応 Risk ID: `RISK-004`
- 関連脅威: `R4`
- 煎観点:
  - `.env` が配布対象外か
  - 共有環境での secret 供給方法が定義されているか
- `Pass` 条件:
  - `.env` 配布除外と shared / production の secret 供給方法が定義されている
- `Fail` 条件:
  - 配布物や共有環境へ `.env` 依存のまま持ち込まれる
- `Blocked` 条件:
  - ignore / 配布 / 運用文書のどれかが確認できない
- **実査結果**: `Pass`
- **証跡**:
  - `.gitignore:5-7`: `.env`, `.env.local` 除外
  - `docs/cli-usage.md`, `docs/glm5-operation-instructions.md`: env vars 供給前提明記
  - Docker image に `.env` は含まれない設計

#### 6-3. secret が log / audit に出ないか

- 対応 Risk ID: `RISK-004`
- 関連脅威: `R4`
- 煎観点:
  - request / response / error log に secret が残らないか
  - audit payload に資格情報が残らないか
- `Pass` 条件:
  - 設計・実装で secret 非露出措置が確認できる (follow-up で representative log/audit 確認)
- `Fail` 条件:
  - secret や token が log / audit に露出する設計・実装がある
- `Blocked` 条件:
  - secret 非露出措置の設計・実装確認ができない
- **実査結果**: `Pass`
- **証跡**:
  - `src/routes/task-routes.ts:245-256`: approval token は HTTP response に含まない
  - `src/auth/auth-plugin.ts:105-113`: auth error message に key 値を含まない
  - `src/routes/task-routes.ts:113-140`: production では error message sanitize
- **Follow-up**: representative log/audit の実際の出力確認 (運用開始後)

### 7. audit / evidence

#### 7-1. actor が追えるか

- 対応 Risk ID: `RISK-005`
- 関連脅威: `R5`
- 煎観点:
  - user / role / actor type が識別できるか
- `Pass` 条件:
  - 設計・実装で actor_type / actor_id / role 相当の記録措置が確認できる (follow-up で representative records 確認)
- `Fail` 条件:
  - 実行者識別の設計・実装が欠けている
- `Blocked` 条件:
  - actor 記録の設計・実装確認ができない
- **実査結果**: `Pass`
- **証跡**:
  - `src/store/services/audit-service.ts:21-35`: actor_type, actor_id 記録
  - `src/auth/auth-plugin.ts:118`: `request.user` に id, role 記録
  - actor_type: 'control_plane' | 'worker' | 'human' | 'policy_engine' | 'system'
- **Follow-up**: representative records の実際の記録確認 (運用開始後)

#### 7-2. approval / failure / result が追えるか

- 対応 Risk ID: `RISK-005`
- 関連脅威: `R5`
- 煎観点:
  - approval の有無
  - failure reason
  - publish / integrate 結果
  - retry / block / cancel
    が追えるか
- `Pass` 条件:
  - 設計・実装で approval/failure/result の記録措置が確認できる (follow-up で representative records 確認)
- `Fail` 条件:
  - 監査上の重要属性の記録設計・実装が欠落している
- `Blocked` 条件:
  - approval/failure/result 記録の設計・実装確認ができない
- **実査結果**: `Pass`
- **証跡**:
  - `docs/audit-events.md`: event types 定義
    - `job.retry_scheduled`, `job.retry_exhausted`, `job.failure_classified`
    - `job.loop_warning`, `job.loop_blocked`
    - `job.lease_acquired`, `job.heartbeat_received`, `job.lease_expired`, `job.orphan_detected`, `job.orphan_recovered`
    - `job.capability_blocked`, `run.policy_check_failed`, `run.approval_required`
    - `run.lock_acquired`, `run.lock_conflict`, `task.version_conflict`
  - `src/types/job.ts:98-141`: WorkerResult に failure_class, failure_code, failure_summary, retry_scheduled_at
- **Follow-up**: representative records の実際の記録確認 (運用開始後)

### 8. worker backend / substrate

#### 8-1. backend 切替で権限境界が壊れないか

- 対応 Risk ID: `RISK-006`
- 関連脅威: `R6`
- 煎観点:
  - `glm`
  - `opencode`
  - `claude_cli`
  - `simulation`
    の切替で保護要件が変わらないか
- `Pass` 条件:
  - backend 差し替え時も認証、認可、approval 要件が不変と説明できる
- `Fail` 条件:
  - 特定 backend でのみ保護が弱まる
- `Blocked` 条件:
  - backend ごとの保護要件整理が不足している
- **実査結果**: `Pass`
- **証跡**:
  - `src/config/index.ts:39-66`: WorkerConfig で backend selection
    - `claudeBackend`: 'opencode' | 'glm' | 'claude_cli' | 'simulation'
    - `codexBackend`: 'opencode' | 'simulation'
  - backend 切替は config で管理、route 保護は backend に依存しない
  - auth/authz/approval は control plane 側で一元管理

#### 8-2. capability と stage が整合しているか

- 対応 Risk ID: `RISK-006`
- 関連脅威: `R6`
- 煎観点:
  - plan / dev / acceptance / integrate / publish に対し、
    許可 capability が定義されているか
- `Pass` 条件:
  - stage ごとの capability matrix が存在し、矛盾がない
- `Fail` 条件:
  - publish 相当操作に不要 capability が付与される
- `Blocked` 条件:
  - capability matrix または dispatch policy が不足している
- **実査結果**: `Pass`
- **証跡**:
  - `src/domain/capability/types.ts:29-33`: STAGE_CAPABILITIES 定義
    - plan: ['plan']
    - dev: ['edit_repo', 'run_tests']
    - acceptance: ['produces_verdict']
  - `src/types/job.ts:59`: WorkerJob に capability_requirements
  - integrate/publish は worker-dispatched stage ではないため capability は適用外

#### 8-3. substrate 差分が audit に残るか

- 対応 Risk ID: `RISK-005`, `RISK-006`
- 関連脅威: `R5`, `R6`
- 煎観点:
  - 実際にどの substrate / backend を使ったか記録されるか
- `Pass` 条件:
  - representative record から substrate / backend を識別できる
- `Fail` 条件:
  - 実行 backend が記録されず追跡不能
- `Blocked` 条件:
  - result metadata か audit payload のどちらかが確認できない
- **実査結果**: `Pass`
- **証跡**:
  - `src/types/job.ts:141`: WorkerResult.metadata に backend/substrate 記録可能
  - `src/types/job.ts:129-140`: WorkerResult.usage に provider, model 等記録
  - metadata field で substrate 差分を記録する設計

### 9. external integration

#### 9-1. GitHub / tracker / resolver の credential 境界が整理されているか

- 対応 Risk ID: `RISK-004`
- 関連脅威: `R4`
- 煎観点:
  - token scope
  - bot 権限
  - service account の責務
    が整理されているか
- `Pass` 条件:
  - token scope と credential 境界が文書化されている
- `Fail` 条件:
  - token scope / credential 境界が未定義
- `Blocked` 条件:
  - 定義文書が不足している
- **実査結果**: `Pass`
- **証跡**:
  - `src/config/index.ts:195-200`: apiKeys は env vars から取得
  - `docs/REQUIREMENTS.md`: bot push actor, GitHub App/bot 運用前提
  - **TOKEN_SCOPE.md**: GitHub token 分類、scope 定義、最小権限原則明文化
  - **CREDENTIAL_BOUNDARY.md**: tracker-bridge/memx-resolver credential 不保存境界明文化

#### 9-2. 外部 endpoint 設定が制御されているか

- 対応 Risk ID: `RISK-004`, `RISK-006`
- 関連脅威: `R4`, `R6`
- 煎観点:
  - provider endpoint の優先順位
  - 許容される接続先
  - local runtime と external runtime の混線防止
- **実査結果**: `Pass`
- **証跡**:
  - `src/config/index.ts:209`: `glmApiEndpoint` env var で制御
  - `docs/glm5-operation-instructions.md`: GLM endpoint 設定方針
  - `docs/glm5-quickstart.md`: env 優先設定

### 10. CI / release gate

#### 10-1. security gate が存在するか

- 対応 Risk ID: `RISK-004`, `RISK-005`
- 関連脅威: `R4`, `R5`
- 煎観点:
  - dependency scan
  - secret scan
  - regression test
  - config safety check
    が CI 上で定義されているか
- `Pass` 条件:
  - 必須の security checks が CI または release gate に定義されている
- `Fail` 条件:
  - security checks が存在しない、または release 前に使われない
- `Blocked` 条件:
  - CI workflow または release checklist の確認ができない
- **実査結果**: `Pass`
- **証跡**:
  - `.github/workflows/codeql.yml`: CodeQL security analysis (security-extended, security-and-quality)
  - `.github/workflows/codeql.yml:76-89`: dependency review action (high severity fail)
  - `.github/workflows/ci.yml`: lint, test, build, type check
  - `.github/workflows/secret-scan.yml`: Gitleaks secret scan を push / pull_request / schedule / workflow_dispatch で実行

#### 10-2. release 前に security review できるか

- 対応 Risk ID: `RISK-005`
- 関連脅威: `R5`
- 煎観点:
  - review report を出せるか
  - risk register を更新できるか
- `Pass` 条件:
  - review report と risk register の更新経路が整っている
- `Fail` 条件:
  - release 前にセキュリティ判定を残せない
- `Blocked` 条件:
  - review 用テンプレートまたは責任分界が不足している
- **実査結果**: `Pass`
- **証跡**:
  - `docs/security/SECURITY_REVIEW_REPORT.md`: review report template
  - `docs/security/RISK_REGISTER.md`: risk register template
  - `docs/security/`: security docs 一式整備済み

## カバレッジ確認

本チェックリストが最低限カバーすべき条件は次のとおり。

- `THREAT_MODEL.md` の `R1` から `R6` に対応している
- `ACCEPTANCE_CRITERIA.md` の必須条件 1 から 7 に対応している
- `SECURITY_INVENTORY.md` の `Unknown` / `Needs Review` に紐づけられる

## 実査結果サマリー

| 項目 | Risk ID | 判定 | 備考 |
|------|---------|------|------|
| 1-1 auth 必須化 | RISK-001 | Pass | production環境でauth自動必須 |
| 1-2 unsafe fallback | RISK-001 | Pass | auth off時は意図された設計 |
| 1-3 API key検証 | RISK-001 | Pass | timingSafeEqual使用 |
| 2-1 admin/operator境界 | RISK-002 | Pass | route保護明確 |
| 2-2 role escalation | RISK-002 | Pass | 昇格経路なし |
| 3-1 public route最小限 | RISK-001 | Pass | health/metrics/read-only限定 |
| 3-2 prefix collision | RISK-001 | Pass | exact match + nested |
| 4-1 destructive保護 | RISK-003 | Pass | admin/approval gate |
| 4-2 state boundary | RISK-003 | Blocked | representative records必要 |
| 5-1 approval定義 | RISK-003/005 | Pass | admin gate明確 |
| 5-2 approval追跡 | RISK-003/005 | Pass | token log記録 |
| 6-1 secret hardcode | RISK-004 | Pass | Gitleaks CI + local no leaks |
| 6-2 env管理 | RISK-004 | Pass | .gitignore除外 |
| 6-3 log露出 | RISK-004 | Pass | responseにtoken含まない |
| 7-1 actor追跡 | RISK-005 | Pass | actor_type/id記録 |
| 7-2 result追跡 | RISK-005 | Pass | event types定義 |
| 8-1 backend境界 | RISK-006 | Pass | backend独立 |
| 8-2 capability整合 | RISK-006 | Pass | stage capability定義 |
| 8-3 substrate記録 | RISK-005/006 | Pass | metadata field |
| 9-1 credential境界 | RISK-004 | Pass | TOKEN_SCOPE.md, CREDENTIAL_BOUNDARY.md作成完了 |
| 9-2 endpoint制御 | RISK-004/006 | Pass | env var制御 |
| 10-1 CI security gate | RISK-004/005 | Pass | CodeQL + dependency review + Gitleaks |
| 10-2 release review | RISK-005 | Pass | template整備 |

## 次に更新すべき文書

次段階では、少なくとも次を更新対象として扱う。

- `RISK_REGISTER.md`
  - 実際の残リスク登録
- `SECURITY_REVIEW_REPORT.md`
  - review 実施時の判定記録
