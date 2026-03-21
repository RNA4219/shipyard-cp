# Frontend Review Spec (2026-03-22)

対象: `web/`

目的:
- 2026-03-22 再レビューで再現した未解消 UX / 実装不整合を、次の修正担当がそのまま実装に落とせる形で残す
- 「見た目の改善」ではなく「誤認しない UI」に戻すための最低仕様を固定する

## 1. Dashboard Kanban

### 1-1. Task ID の扱い

現状:
- dashboard card は `task.id` を遷移先と React key の両方に使っている
- 実 API では `task_id` 側が入る task があり、Playwright で `/tasks/undefined` を再現した

期待仕様:
- dashboard 上の task 識別子は `task.task_id ?? task.id` を単一の `taskId` 変数に正規化して使う
- 以下の用途はすべて同じ正規化済み `taskId` を使う
  - React key
  - 詳細画面への遷移
  - fallback title の `Task xxxx`

実装メモ:
- `TaskList` 側の扱いに揃える
- `task.id.slice(...)` のような直接参照を残さない

## 2. Run 可視化

### 2-1. Timeline ラベル

現状:
- `RunTimeline` は `data?.items` しか見ない
- ラベルは `payload.to_state ?? event.type` だけなので、実データでは `Event` が並ぶケースが残る

期待仕様:
- timeline event の取得は `items` と `events` の両方に対応する
- ラベル抽出は少なくとも以下の順で fallback する
  1. `payload.to_state`
  2. `payload.state`
  3. `event.event_type`
  4. `event.type`
  5. `Unknown Event`

実装メモ:
- `payload.reason` だけでなく、理由欄が空でもラベルで意味が取れることを優先する
- `from_state -> to_state` が両方ある時だけ補助表示を出す

### 2-2. Audit Summary の扱い

現状:
- timeline にイベントが出ていても `総イベント数: 0` が表示される run がある

期待仕様:
- timeline と audit summary が一致しない場合は、summary を断定表示しない
- 最低ラインとして、`0` を出す条件は API が明示的に 0 を返した時だけにする
- 整合しない場合は `監査サマリー未同期` などの弱い表現に落とす

### 2-3. Run status 表示

現状:
- Runs 一覧 / Run detail とも `run.status` を生表示しているため、日本語 UI でも `running` が残る

期待仕様:
- run status は表示用ラベルを翻訳テーブルで引く
- 一覧、詳細、フィルタボタンで同じラベル体系を使う

## 3. Settings

### 3-1. 保存モデル

現状:
- toggle 変更時点で localStorage に即保存している
- それにもかかわらず `変更を保存` ボタンと保存成功表示が残っている

期待仕様:
- 次のどちらかに統一する
  - staged save:
    - toggle 変更では state だけ更新
    - `変更を保存` で永続化
  - instant save:
    - toggle 変更で即保存
    - `変更を保存` ボタンを削除

実装デフォルト:
- 既存 UI を崩しにくいので staged save を推奨する

## 4. Agent Metrics Panel

### 4-1. Queue 表示の意味

現状:
- UI の `Queue` は `spawn_queued` を表示している
- backend の `/v1/agent/metrics` で返している `spawn_queued` は累積カウンタであり、現在キュー長ではない

期待仕様:
- 現在キュー長を出すなら current queue length を別フィールドで返す
- 累積値しかない間は UI 文言を `Queued Total` 相当に弱める

実装メモ:
- `src/routes/agent-routes.ts` のレスポンスに current queue length を追加するか、UI 側の見出しを変更する

### 4-2. API 設定

現状:
- `useAgentMetrics` だけ `VITE_API_URL` を参照している
- RUNBOOK / `.env.example` / 他 API 利用箇所は `VITE_API_HOST` 前提

期待仕様:
- agent metrics 取得も他の API クライアントと同じ設定キーに揃える
- 少なくとも `VITE_API_HOST` を優先し、相対パス依存を避ける

## 5. Acceptance Criteria

- dashboard の card click / `詳細` で `/tasks/undefined` に遷移しない
- dashboard の console に unique key warning が出ない
- run timeline が `Event` 連発ではなく、状態またはイベント種別を読める
- run summary が timeline と矛盾して `0` 件を断定しない
- 日本語 UI で `running` などの英語ステータスが主要導線に残らない
- settings が staged save か instant save のどちらかに統一されている
- agent panel の `Queue` が現在値なのか累積値なのか、見出しだけで誤解なく伝わる
