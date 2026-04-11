# OpenCode Serve Phase 2B 実装指示書

## 目的

本書は、`opencode serve / session reuse` の Phase 2B 実装指示書である。

Phase 2A の前提は「same-stage reuse が安全に動くこと」だった。Phase 2B では「その session 内で何が起きたかを追跡し、異常終了後も掃除できること」を完成条件とする。

## 正本ドキュメント

- [OPENCODE_SERVE_REQUIREMENTS.md](./OPENCODE_SERVE_REQUIREMENTS.md)
- [OPENCODE_SERVE_SPECIFICATION.md](./OPENCODE_SERVE_SPECIFICATION.md)
- [OPENCODE_SERVE_PHASE2B_REQUIREMENTS.md](./OPENCODE_SERVE_PHASE2B_REQUIREMENTS.md)
- [OPENCODE_SERVE_IMPLEMENTATION_INSTRUCTIONS.md](./OPENCODE_SERVE_IMPLEMENTATION_INSTRUCTIONS.md)

## 最重要方針

1. event stream は捨てずに正規化する
2. transcript は artifact として保存する
3. orphan session は自動的に `draining -> dead` へ進める
4. fallback 理由は必ず監査可能にする
5. public API は変えない

## 実装スコープ

### A. event stream ingestion 強化

- `opencode-event-ingestor.ts` を拡張し、event stream を構造化して扱えるようにする

### B. transcript persistence

- transcript を artifact と raw output の両方に結び付けられるようにする

### C. escalation normalizer 強化

- permission request と tool use から `requested_escalations` を高精度生成する

### D. orphan recovery / cleanup

- session registry と cleanup 処理を拡張し、orphan session を回収する

### E. audit / observability 強化

- fallback 理由、cleanup 理由、event ingestion 失敗理由を残す

## 推奨変更対象

- `src/domain/worker/opencode-event-ingestor.ts`
- `src/domain/worker/opencode-session-registry.ts`
- `src/domain/worker/opencode-serve-adapter.ts`
- `src/infrastructure/opencode-session-executor.ts`
- `src/types/event.ts`
- 必要なら監査イベント出力箇所

## 実装タスク

### Task 1. event stream モデル整理

実装内容:

- event の最小内部表現を定義する
- transcript message / tool use / permission request / stdout / stderr / lifecycle を分類する

期待値:

- ingest 処理が switch / if の寄せ集めではなく、カテゴリで追える

### Task 2. transcript artifact 保存

実装内容:

- transcript を job 単位 artifact として保存
- `WorkerResult.raw_outputs` に `event_stream` を追加
- summary 用の短い transcript 要約を必要に応じて生成

期待値:

- 後から job 実行内容を追跡できる

### Task 3. escalation 正規化強化

実装内容:

- permission request event を `RequestedEscalation` へ変換
- tool use から side effect category を推定
- silent drop をなくす

期待値:

- `requested_escalations` の精度が上がる

### Task 4. fallback reason 記録

実装内容:

- `serve` 失敗時に `run` fallback する箇所で reason code を残す
- 監査イベントと logger の両方に出す

期待値:

- 「fallback した」は分かるだけでなく「なぜ fallback したか」まで追える

### Task 5. orphan detection 実装

実装内容:

- lease timeout
- server crash
- session executor disconnect

の各ケースで orphan session を検出

期待値:

- orphan を手動 cleanup 前提にしない

### Task 6. cleanup reason 分類

実装内容:

- cleanup reason enum または定数群を持つ
- `task completed`, `timeout`, `server crash`, `ttl expired`, `manual cleanup` などを区別する

期待値:

- cleanup が原因不明の dead session にならない

### Task 7. テスト追加

最低限の観点:

1. event stream が `event_stream` raw output へ入る
2. transcript artifact が保存される
3. permission request が `requested_escalations` へ変換される
4. orphan detection 後に session が `dead` になる
5. fallback reason が監査イベントへ残る

## 受け入れ条件

1. event stream を job 単位で保持できる
2. transcript artifact を保存できる
3. permission request から `requested_escalations` を組み立てられる
4. orphan session を回収できる
5. cleanup reason と fallback reason が監査ログに残る
6. `npm run check` が通る
7. `npm test` が通る

## 次フェーズへの申し送り

Phase 2B 完了後は次を進めること。

1. agent-aware session policy
2. warm pool
3. reuse 最適化
4. transcript の検索性向上

本フェーズの目的は、速さよりも「何が起きたかを追えること」と「壊れた session を残さないこと」を先に固めることである。
