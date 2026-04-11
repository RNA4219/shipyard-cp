# OpenCode Serve Phase 2C 実装指示書

## 目的

本書は、`opencode serve / session reuse` の Phase 2C 実装指示書である。

Phase 2C は最適化フェーズだが、速度だけを追わず、Phase 2A / 2B で固めた安全境界を維持したまま、agent-aware session policy、warm pool、reuse ranking、transcript indexing を追加する。

## 正本ドキュメント

- [OPENCODE_SERVE_REQUIREMENTS.md](./OPENCODE_SERVE_REQUIREMENTS.md)
- [OPENCODE_SERVE_SPECIFICATION.md](./OPENCODE_SERVE_SPECIFICATION.md)
- [OPENCODE_SERVE_PHASE2C_REQUIREMENTS.md](./OPENCODE_SERVE_PHASE2C_REQUIREMENTS.md)
- [OPENCODE_SERVE_PHASE2B_COMPLETION.md](./OPENCODE_SERVE_PHASE2B_COMPLETION.md)

## 最重要方針

1. 最適化しても permission 境界を崩さない
2. `dev -> acceptance` reuse 禁止を維持する
3. warm pool を入れても task / workspace / policy 越境を起こさない
4. public API は変えない

## 実装スコープ

### A. agent-aware session policy

- session record に agent profile を持たせる
- profile 不一致 session の reuse を禁止する

### B. warm pool

- 安全条件を満たす session を warm pool として保持する

### C. reuse ranking

- reuse 候補に順位付けを入れる

### D. transcript indexing

- transcript artifact に検索補助メタデータを付与する

## 推奨変更対象

- `src/domain/worker/opencode-session-registry.ts`
- `src/domain/worker/opencode-serve-adapter.ts`
- `src/infrastructure/opencode-session-executor.ts`
- transcript 保存周辺
- metrics / logger

## 実装タスク

### Task 1. agent profile 追加

実装内容:

- session record に agent profile を追加
- reuse 判定に agent profile 一致条件を追加

期待値:

- planning-oriented と build-oriented が混線しない

### Task 2. warm pool 実装

実装内容:

- idle session のうち安全に再利用可能なものを warm pool として管理
- warm pool からの取得ロジックを追加

期待値:

- 新 session 作成を減らせる

### Task 3. reuse ranking 実装

実装内容:

- `last_used_at`
- error history
- transcript size
- health score

で reuse 候補を順位付けする

期待値:

- 使い回すなら状態の良い session を選べる

### Task 4. transcript indexing

実装内容:

- message count
- tool count
- permission request count
- summary keywords
- last tool names

を transcript metadata として保存

期待値:

- 後から transcript を見つけやすくなる

### Task 5. metrics / logs 強化

実装内容:

- warm pool 数
- reuse ranking 理由
- reuse skip 理由

を観測できるようにする

### Task 6. テスト追加

最低限の観点:

1. agent profile 不一致で reuse されない
2. warm pool から session を取得できる
3. `dev -> acceptance` reuse 禁止が維持される
4. transcript indexing 情報が保存される
5. ranking が低品質 session を後回しにする

## 受け入れ条件

1. agent-aware session policy が機能する
2. warm pool から安全に session を取得できる
3. reuse ranking が働く
4. transcript indexing 情報を保存できる
5. `npm run check` が通る
6. `npm test` が通る

## 実装上の注意

1. warm pool を入れても、task / workspace / policy 越境 reuse を許可しないこと
2. low-latency のために verification 系 session へ edit 権限を混ぜないこと
3. transcript indexing は public API に露出しないこと

本フェーズの目的は、Phase 2A / 2B で作った安全な `serve` 基盤を、運用しやすく、速く、追いやすくすることである。
