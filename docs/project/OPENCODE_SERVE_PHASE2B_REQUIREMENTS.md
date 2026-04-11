# OpenCode Serve Phase 2B 要件定義書

## 文書の目的

本書は、`opencode serve / session reuse` の Phase 2B における要件を定義する。

Phase 2A では server instance 管理、session registry、same-stage reuse、fallback を導入した。Phase 2B では、その上で event stream 正規化、transcript 保存、cleanup / orphan recovery、監査強化を実装対象とする。

## 正本の位置づけ

参照順序は次のとおり。

1. [REQUIREMENTS.md](./REQUIREMENTS.md)
2. [OPENCODE_SERVE_REQUIREMENTS.md](./OPENCODE_SERVE_REQUIREMENTS.md)
3. [OPENCODE_SERVE_SPECIFICATION.md](./OPENCODE_SERVE_SPECIFICATION.md)
4. 本書

## 目的

Phase 2B の目的は次のとおり。

1. `serve` 実行中の event stream を `shipyard-cp` の監査・結果モデルへ正規化する
2. transcript を再現可能な artifact として保存する
3. crash / orphan / timeout 後の session cleanup を強化する
4. `run fallback` の判断理由を追跡可能にする

## 非目的

本フェーズでは次を扱わない。

- stage を跨ぐ reuse
- warm pool
- agent-aware session policy 最適化
- public API 変更
- `WorkerType` 追加

## 機能要件

### FR-B1 event stream 正規化

`opencode serve` から得られるイベントを、最低限次のカテゴリへ正規化できること。

- transcript message
- tool use
- permission request
- stdout chunk
- stderr chunk
- session lifecycle
- execution completion

### FR-B2 transcript 保存

各 job 実行について、最低限次の transcript artifact を保存できること。

- 逐次イベント列
- 正規化済み transcript 要約
- session metadata

### FR-B3 requested_escalations 精密化

permission request と tool use イベントから、`WorkerResult.requested_escalations` をより正確に組み立てられること。

最低限扱う分類:

- `network_access`
- `workspace_outside_write`
- `protected_path_write`
- `destructive_tool`
- `secret_access`
- `human_verdict`

### FR-B4 raw output 強化

`WorkerResult.raw_outputs` に `event_stream` を含められること。

### FR-B5 orphan recovery

server crash、process kill、lease timeout の各ケースで orphan session を検出し、`draining -> dead` まで遷移させられること。

### FR-B6 cleanup policy

cleanup は少なくとも次の理由を区別して実行できること。

- task completed
- task cancelled
- task failed
- timeout
- server crash
- policy mismatch
- ttl expired
- manual cleanup

### FR-B7 audit 強化

最低限、次の監査イベントを残すこと。

- event stream ingestion started
- event stream ingestion failed
- transcript persisted
- orphan detected
- orphan cleaned
- cleanup reason categorized
- fallback reason recorded

## セキュリティ要件

### SR-B1 transcript 秘密情報混入への配慮

- transcript 保存時に、そのまま public API へ露出しないこと
- 秘密情報が混ざる可能性を前提に artifact として扱うこと

### SR-B2 permission event の完全性

- permission request を silent に捨てないこと
- 少なくとも raw event と正規化イベントの両方で追跡可能にすること

## 運用要件

### OR-B1 cleanup 実行性

- 定期 cleanup または job 完了時 cleanup のどちらでも orphan session を回収できること

### OR-B2 fallback 可観測性

- fallback が発生した理由を人が後追いできること

## 受け入れ条件

### AC-B1 event stream

- event stream を artifact または raw output として保存できる

### AC-B2 transcript

- transcript が job ごとに追跡できる

### AC-B3 escalations

- permission request から `requested_escalations` を生成できる

### AC-B4 orphan recovery

- orphan session を検出して cleanup できる

### AC-B5 audit

- fallback reason と cleanup reason が監査ログに残る

### AC-B6 validation

- `npm run check` が通る
- `npm test` が通る
