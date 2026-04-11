# OpenCode Serve Phase 2C 要件定義書

## 文書の目的

本書は、`opencode serve / session reuse` の Phase 2C 要件を定義する。

Phase 2A で same-stage reuse と fallback を導入し、Phase 2B で event stream と recovery を強化した。Phase 2C では、`agent-aware session policy`、`warm pool`、`reuse 最適化`、`transcript の検索性向上` を実装対象とする。

## 正本の位置づけ

参照順序は次のとおり。

1. [REQUIREMENTS.md](./REQUIREMENTS.md)
2. [OPENCODE_SERVE_REQUIREMENTS.md](./OPENCODE_SERVE_REQUIREMENTS.md)
3. [OPENCODE_SERVE_SPECIFICATION.md](./OPENCODE_SERVE_SPECIFICATION.md)
4. 本書

## 目的

Phase 2C の目的は次のとおり。

1. stage bucket 内で agent-aware な session policy を持てるようにする
2. warm pool により新 session 作成コストを下げる
3. reuse 判定を最適化しつつ安全性を維持する
4. transcript を後追い検索しやすくする

## 非目的

本フェーズでも次は行わない。

- public API 変更
- `WorkerType` 追加
- task を跨ぐ session reuse
- `dev -> acceptance` reuse 許可

## 機能要件

### FR-C1 agent-aware session policy

session record に、最低限 agent profile または agent class 相当の概念を持てること。

最低限の区別:

- planning-oriented
- build-oriented
- verification-oriented

### FR-C2 agent policy reuse 境界

agent profile が異なる session は reuse してはならない。

### FR-C3 warm pool

same-stage / same-policy 条件の新規 session 作成コストを下げるため、warm pool を持てること。

ただし warm pool は task-local を原則とせず、workspace / policy / stage 条件に一致するものだけを安全に割り当てること。

### FR-C4 reuse ranking

reuse 候補が複数ある場合、最低限次で優先順位を付けられること。

- last_used_at が新しい
- transcript size が適正
- error history が少ない
- warm だが未汚染

### FR-C5 transcript indexing

transcript artifact に対し、最低限次の検索補助情報を保存できること。

- message count
- tool count
- permission request count
- summary keywords
- last tool names

### FR-C6 session health scoring

reuse 候補 session に対して health score を持ち、低品質 session を reuse から除外できること。

### FR-C7 bounded optimization

最適化の結果としても、次を破ってはならない。

- `dev -> acceptance` reuse 禁止
- task 越境禁止
- workspace 越境禁止
- policy fingerprint 不一致 reuse 禁止

## セキュリティ要件

### SR-C1 warm pool の越境防止

- warm pool を導入しても task / workspace / policy 越境 reuse を発生させてはならない

### SR-C2 agent profile 混線防止

- planning-oriented session を build-oriented 実行へ流用しない
- verification-oriented session に edit 権限を持ち込まない

## 運用要件

### OR-C1 pool 可視化

- active sessions とは別に warm pool 数を観測できること

### OR-C2 optimization 可視化

- reuse hit 理由と reuse skip 理由を追跡できること

## 受け入れ条件

### AC-C1 agent-aware

- agent profile 不一致 session が reuse されない

### AC-C2 warm pool

- warm pool 経由で session 取得ができる

### AC-C3 safety

- `dev -> acceptance` reuse 禁止が維持される

### AC-C4 indexing

- transcript の検索補助情報を保存できる

### AC-C5 validation

- `npm run check` が通る
- `npm test` が通る
