# OpenCode Serve Phase 2B 完了メモ

## 文書の目的

本書は、`opencode serve / session reuse` の Phase 2B が完了した時点の到達点を記録する。

Phase 2A で導入した server instance 管理、session registry、same-stage reuse、fallback の上に、Phase 2B では event stream 正規化、transcript 保存、orphan recovery、監査強化を追加した。

## 完了した内容

### 1. event stream モデル整理

- transcript message
- tool use
- permission request
- stdout chunk
- stderr chunk
- session lifecycle
- execution completion

をカテゴリとして扱えるようにした。

### 2. transcript persistence

- `event-stream.json`
- `transcript-summary.md`

を job 単位 artifact として保存できるようにした。

### 3. escalation 精密化

permission request と tool 情報から、`requested_escalations` をより正確に組み立てられるようにした。

### 4. orphan detection / cleanup

- lease timeout
- stale active session
- initializing timeout

を orphan 候補として扱い、cleanup できるようにした。

### 5. audit / observability

- fallback reason
- cleanup reason
- orphan detection / cleanup

を追跡できるようにした。

## 受け入れ条件の達成状況

- event stream を job 単位で保持できる
- transcript artifact を保存できる
- permission request から `requested_escalations` を生成できる
- orphan session を回収できる
- cleanup reason と fallback reason が監査ログに残る
- `npm run check` 通過
- `npm test` 通過

## 残している非スコープ

Phase 2B 完了時点でも、次は未実装のままとする。

- agent-aware session policy
- warm pool
- reuse 最適化
- stage を跨ぐ reuse

## 次フェーズ

次は Phase 2C として、次を扱う。

1. agent-aware session policy
2. warm pool
3. reuse 最適化
4. transcript の検索性向上

## 判断メモ

Phase 2B の目的は速度向上ではなく、`serve` ベース実行の可観測性と回復性を固めることだった。そのため、イベントを捨てない、orphan を残さない、fallback 理由を追える、という性質を優先している。
