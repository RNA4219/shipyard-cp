# OpenCode Serve Phase 2C 完了メモ

## 文書の目的

本書は、`opencode serve / session reuse` の Phase 2C が完了した時点の到達点を記録する。

Phase 2A で server instance 管理、session registry、same-stage reuse、fallback を導入し、Phase 2B で event stream、transcript、orphan recovery、監査を強化した。Phase 2C では、その上に agent-aware session policy、warm pool、reuse ranking、transcript indexing を追加した。

## 完了した内容

### 1. agent-aware session policy

- `AgentProfile` を導入し、最低限 `planning-oriented`、`build-oriented`、`verification-oriented` を区別できるようにした
- session record に agent profile を保持し、不一致 session の reuse を禁止した
- reuse skip reason として `agent_profile_mismatch` を追跡できるようにした

### 2. warm pool

- idle / ready かつ安全条件を満たす session を warm pool として保持できるようにした
- warm pool から取得する際に task / workspace / policy / stage 条件を再検証するようにした
- warm pool サイズを観測可能にした

### 3. reuse ranking

- reuse 候補が複数ある場合に順位付けできるようにした
- `last_used_at`
- health score
- error history
- transcript size
- warm pool bonus

を scoring 要素として使うようにした

### 4. transcript indexing

- transcript に対する検索補助メタデータを保存できるようにした
- 最低限、`messageCount`、`toolCount`、`permissionRequestCount`、`summaryKeywords`、`lastToolNames`、`transcriptSizeBytes`、`lastUpdated` を保持する

### 5. health scoring

- session の健全性を数値として追跡できるようにした
- success / error の履歴から reuse 候補除外や順位付けへ反映できるようにした

## 受け入れ条件の達成状況

- agent-aware session policy が機能する
- warm pool から安全に session を取得できる
- reuse ranking が働く
- transcript indexing 情報を保存できる
- `dev -> acceptance` reuse 禁止が維持される
- `npm run check` 通過
- `npm test` 通過

## 判断メモ

Phase 2C は最適化フェーズだが、速度改善のために安全境界を壊さないことを優先した。特に、`dev -> acceptance` reuse 禁止、task / workspace / policy 越境禁止、public API 非変更は Phase 2A / 2B から継続して守っている。

## 次フェーズ候補

次に進める場合は、次を候補とする。

1. agent-aware session policy の詳細化
2. warm pool の最適化
3. transcript の検索性強化
4. reuse 戦略のチューニング
5. 監査イベントと metrics の整理
