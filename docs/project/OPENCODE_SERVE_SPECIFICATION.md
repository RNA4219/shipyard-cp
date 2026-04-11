# OpenCode Serve / Session Reuse 詳細仕様書

## 文書の位置づけ

本書は [OPENCODE_SERVE_REQUIREMENTS.md](./OPENCODE_SERVE_REQUIREMENTS.md) を実装へ落とすための詳細仕様である。

優先順位は次のとおり。

1. [REQUIREMENTS.md](./REQUIREMENTS.md)
2. [OPENCODE_SPECIFICATION.md](./OPENCODE_SPECIFICATION.md)
3. [OPENCODE_SERVE_REQUIREMENTS.md](./OPENCODE_SERVE_REQUIREMENTS.md)
4. 本書

## 対象

本書は `opencode serve` を使う Phase 2 の仕様を定める。既存の `opencode run` ベース実装は fallback として残す。

## 非対象

- `google_antigravity` の server 化
- public API 変更
- `WorkerType` の追加
- stage を跨いだ無条件 reuse

## 全体アーキテクチャ

```text
DispatchOrchestrator
  -> JobService
     -> WorkerExecutor
        -> OpenCodeServeAdapter
           -> OpenCodeServerManager
           -> OpenCodeSessionRegistry
           -> OpenCodeSessionExecutor
           -> OpenCodeEventIngestor
           -> fallback: OpenCodeExecutor(run mode)
```

## コンポーネント仕様

### OpenCodeServerManager

責務:

- `opencode serve` の起動
- ヘルスチェック
- 停止
- 再起動
- server instance 情報管理

最低限の interface:

```ts
interface OpenCodeServerManager {
  ensureServerReady(): Promise<ServerHandle>;
  stopServer(serverInstanceId: string): Promise<void>;
  healthCheck(serverInstanceId: string): Promise<'ready' | 'starting' | 'failed'>;
}
```

### OpenCodeSessionRegistry

責務:

- session record の保存
- reuse 判定
- lease 管理
- orphan 回収

最低限の interface:

```ts
interface OpenCodeSessionRegistry {
  findReusableSession(input: SessionLookupInput): Promise<SessionRecord | null>;
  createSessionRecord(input: CreateSessionRecordInput): Promise<SessionRecord>;
  leaseSession(sessionId: string, jobId: string): Promise<boolean>;
  releaseSession(sessionId: string, jobId: string): Promise<void>;
  markSessionDead(sessionId: string, reason: string): Promise<void>;
}
```

### OpenCodeSessionExecutor

責務:

- session 作成
- session 接続
- prompt 投入
- 実行完了待ち
- cancel
- transcript / artifact 回収

### OpenCodeEventIngestor

責務:

- `serve` から得られるイベントを内部イベントへ正規化
- permission request / tool use / transcript / stdout / stderr の仕分け
- `WorkerResult` と監査イベントへの反映

## データモデル

### SessionRecord

最低限保持するフィールド:

```ts
interface SessionRecord {
  session_id: string;
  server_instance_id: string;
  task_id: string;
  workspace_id: string;
  workspace_kind: 'container' | 'volume' | 'host_path';
  logical_worker: 'codex' | 'claude_code';
  stage_bucket: 'plan' | 'dev' | 'acceptance';
  policy_fingerprint: string;
  status: 'starting' | 'ready' | 'leased' | 'idle' | 'draining' | 'dead';
  created_at: string;
  last_used_at: string;
  leased_by_job_id?: string;
  lease_expires_at?: string;
  expires_at?: string;
  metadata?: Record<string, string | number | boolean | null>;
}
```

### ServerHandle

```ts
interface ServerHandle {
  server_instance_id: string;
  base_url?: string;
  process_id?: number;
  status: 'starting' | 'ready' | 'failed';
  started_at: string;
}
```

### SessionLookupInput

```ts
interface SessionLookupInput {
  task_id: string;
  workspace_id: string;
  logical_worker: 'codex' | 'claude_code';
  stage_bucket: 'plan' | 'dev' | 'acceptance';
  policy_fingerprint: string;
}
```

## 設定仕様

### 追加設定候補

`Config.worker` に次を追加する前提で設計する。

- `opencodeMode: 'run' | 'serve'`
- `opencodeServePath: string`
- `opencodeServeBaseUrl?: string`
- `opencodeSessionReuse: 'disabled' | 'same_stage'`
- `opencodeSessionTtlMs: number`
- `opencodeServerStartupTimeoutMs: number`
- `opencodeReuseLeaseTtlMs: number`

### デフォルト

- `opencodeMode = run`
- `opencodeSessionReuse = disabled`

初期導入時は明示設定でのみ `serve` を有効化する。

## session key / policy fingerprint 仕様

### stage bucket

`WorkerJob.stage` をそのまま bucket として使う。

| WorkerJob.stage | stage_bucket |
| --- | --- |
| `plan` | `plan` |
| `dev` | `dev` |
| `acceptance` | `acceptance` |

### policy fingerprint

最低限、次を連結してハッシュ化した値を使う。

```text
logical_worker
stage_bucket
approval_policy.mode
approval_policy.allowed_side_effect_categories (sorted)
approval_policy.sandbox_profile
workspace_ref.kind
workspace_ref.workspace_id
```

目的:

- 権限の異なる session の誤 reuse を防ぐ
- workspace の異なる session の誤 reuse を防ぐ

## reuse 判定アルゴリズム

### `findReusableSession(job)`

擬似コード:

```text
1. build lookup input from job
2. query registry by:
   - same task_id
   - same workspace_id
   - same logical_worker
   - same stage_bucket
   - same policy_fingerprint
   - status in ['ready', 'idle']
3. exclude leased sessions
4. newest last_used_at first
5. return first match or null
```

### reuse 禁止条件

次のいずれかに当たる場合は必ず新 session を作る。

1. stage bucket 不一致
2. policy fingerprint 不一致
3. workspace 不一致
4. task 不一致
5. session が `dead` / `draining` / `starting`
6. lease 中
7. TTL 超過

## session lifecycle 仕様

### 状態

| status | 意味 |
| --- | --- |
| `starting` | session 作成直後、まだ利用不可 |
| `ready` | 利用可能、未 lease |
| `leased` | job が利用中 |
| `idle` | 利用後に再利用可能 |
| `draining` | cleanup 対象、再利用不可 |
| `dead` | 異常終了または明示破棄済み |

### 遷移

```text
starting -> ready
ready -> leased
leased -> idle
idle -> leased
idle -> draining
draining -> dead
leased -> dead
ready -> dead
```

## 実行フロー

### submitJob(job)

```text
1. validate job
2. ensure server ready
3. compute stage bucket and policy fingerprint
4. find reusable session
5. if found:
   - lease session
   - mark reuse hit
6. if not found:
   - create session
   - store session record
   - lease session
   - mark reuse miss
7. attach prompt to session execution
8. stream / collect events
9. normalize WorkerResult
10. release session
11. if session reusable: idle
12. else: draining -> dead
13. on failure and if configured: fallback to run mode
```

## stage 別セッション方針

### plan

- 毎 task で独立 session
- reuse は `plan -> plan` 再実行時のみ許可
- `plan -> dev` への継続は禁止

### dev

- task-local な mutable session
- `dev` 再試行や再実行時のみ reuse 可能
- `dev -> acceptance` 継続は禁止

### acceptance

- 検証専用 session
- `edit=deny`
- `acceptance` 再実行時のみ reuse 可能

## permission 適用仕様

### 原則

permission は session 作成時に固定し、より弱い権限の stage に流用しない。

### session 作成時

| stage_bucket | edit | bash | webfetch |
| --- | --- | --- | --- |
| `plan` | deny | deny | deny |
| `dev` | allow | allow | 条件付き |
| `acceptance` | deny | allow | 条件付き |

### session 再利用時

- 同一 policy fingerprint のみ再利用可能
- permission 差分がある場合は再利用禁止

## artifact / transcript 仕様

### 最低限回収するもの

- prompt
- transcript
- stdout
- stderr
- session metadata
- permission request event
- tool use event

### WorkerResult への反映

| source | destination |
| --- | --- |
| transcript | artifact または raw output |
| stdout | artifact / summary / patch 判定 |
| stderr | artifact / failure summary |
| permission request | requested_escalations |
| runtime | usage.runtime_ms |

## failure / recovery 仕様

### server 起動失敗

- `serve` 実行を諦め、設定で許可される場合のみ `run` へ fallback
- fallback したことを監査イベントへ記録

### session 作成失敗

- job は失敗または retryable_transient として扱う
- reuse は行わない

### leased session crash

- session を `dead` にする
- job を失敗扱いにする
- retry policy に従って再試行判定する

### orphan session

- registry 上で lease 切れを検知したら `draining`
- cleanup 完了後に `dead`

## cancel 仕様

### job cancel

1. lease 中 session を特定する
2. server 経由で実行停止を試みる
3. job を cancelled 相当にする
4. session は原則 `draining`
5. 安全に継続可能と判断できるまで reuse しない

## observability 仕様

### metrics

最低限次を出す。

- `opencode_server_instances`
- `opencode_sessions_active`
- `opencode_sessions_reused_total`
- `opencode_sessions_reuse_miss_total`
- `opencode_sessions_dead_total`
- `opencode_serve_fallback_total`
- `opencode_session_lease_conflicts_total`

### logs

最低限次の structured log を残す。

- server start / stop
- session create / lease / release / cleanup
- reuse hit / miss
- fallback reason
- crash reason

## API 契約への影響

### 影響しないもの

- `WorkerType`
- `DispatchRequest`
- `WorkerJob.worker_type`
- `WorkerResult` の基本契約

### 内部 metadata として追加してよいもの

`WorkerResult.metadata` に次を入れてよい。

- `substrate = opencode`
- `execution_mode = serve`
- `logical_worker = codex | claude_code`
- `session_reused = true | false`

ただし public API の必須契約にはしない。

## 受け入れテスト観点

### 正常系

1. `serve` 起動成功
2. `plan` session 作成成功
3. `dev` same-stage 再実行で reuse hit
4. `acceptance` same-stage 再実行で reuse hit

### 異常系

1. `dev -> acceptance` で reuse されない
2. workspace 不一致で reuse されない
3. policy fingerprint 不一致で reuse されない
4. server crash で `run` へ fallback できる

### 監査

1. session create / reuse / cleanup がイベントとして残る
2. fallback がイベントとして残る

## 実装上の注意

1. まず same-stage reuse だけを実装する
2. stage 跨ぎ reuse の最適化は初期スコープに入れない
3. `dev` session を acceptance 判定に流用しない
4. public API へ backend や session の概念を漏らさない
