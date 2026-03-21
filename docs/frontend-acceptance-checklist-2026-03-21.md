# Frontend Acceptance Checklist (2026-03-21)

対象: `web/`

実施者: Codex

実施方法:
- ローカル API を `http://127.0.0.1:3100` で起動
- Vite 開発サーバーを `http://localhost:5274` で起動
- Playwright で主要導線を実操作

検収時の補足:
- Vite の既定ポート `5273` は使用中だったため、実検証は `5274` で実施
- 検証中に作成したテストタスク: `task_6c4efe7685be466b859bbd551077588d`

## Checklist

- [x] 初期表示できる
  - コメント: 画面自体は表示可能。初回ロード後にダッシュボード、タスク一覧、実行一覧、設定へ遷移できた。

- [x] WebSocket 接続状態が復帰する
  - コメント: 初回ロード時は一時的に `Disconnected` / WebSocket warning が出るが、待機後は `接続中` に遷移した。

- [x] タスク一覧表示
  - コメント: 一覧取得は成功。既存タスク 13 件超が表示され、詳細へのリンクも機能した。

- [x] タスク作成フォームのバリデーション
  - コメント: 必須未入力時に `この項目は必須です` が表示され、バリデーションは期待通り。

- [x] タスク作成導線
  - コメント: フォーム送信後に `/tasks` へ戻り、新規タスクが先頭表示された。導線自体は問題なし。

- [x] 実行一覧表示
  - コメント: `/runs` で実行一覧が表示され、Run detail も開けた。

- [ ] ダッシュボードのカード key が安定している
  - コメント: React console error `Each child in a list should have a unique "key" prop.` を再現。API レスポンスは `task_id` を返しているが、ダッシュボードの Kanban では `task.id` を key に使っているため、`undefined` key が大量発生している可能性が高い。
  - 該当候補: `web/src/components/dashboard/KanbanColumn.tsx:127-128`, `web/src/types.ts:18-20`

- [ ] ダッシュボードのカード導線が完成している
  - コメント: カード右下 `View` をクリックしても画面遷移しなかった。カード全体も見た目はクリック可能だが、リンク実装が無く詳細に入れない。
  - 該当候補: `web/src/components/dashboard/KanbanColumn.tsx:47-101`

- [ ] ダッシュボードの Run 表示が実データに追従している
  - コメント: `/runs` には run が存在するのに、ダッシュボードカードは `No runs` を表示した。表示判定が `task.runId` 固定で、実 API の `active_job_id` や runs API を見ていないため、実態とズレている。
  - 該当候補: `web/src/components/dashboard/KanbanColumn.tsx:91-95`, `web/src/types.ts:39-40`

- [ ] 設定の保存が永続化される
  - コメント: `Save` は成功トーストのみで、実保存処理は未実装。リロードや再訪で保持される保証がなく、検収観点では未完了。
  - 該当候補: `web/src/pages/SettingsPage.tsx:22-29`

- [ ] ダッシュボード文言が翻訳されている
  - コメント: 日本語 UI でも `Integrating`, `Publishing`, `Total`, `Active`, `Done`, `No tasks`, `View` が英語のまま残っていた。局所的に翻訳漏れがある。
  - 該当候補: `web/src/components/dashboard/KanbanBoard.tsx:68-77`, `web/src/components/dashboard/KanbanBoard.tsx:126-136`, `web/src/components/dashboard/KanbanColumn.tsx:97-99`, `web/src/components/dashboard/KanbanColumn.tsx:131-134`

- [ ] グローバル検索の適用範囲が一貫している
  - コメント: dashboard では検索入力に文字を入れても盤面が変わらない一方、同じクエリが tasks / runs に持ち越されて即時フィルタとして効く。無効に見えた入力が別画面で突然一覧を絞るため、操作結果の予測がしづらい。
  - 該当候補: `web/src/components/layout/TopNavBar.tsx`, `web/src/pages/DashboardPage.tsx`, `web/src/pages/TasksPage.tsx`, `web/src/pages/RunsPage.tsx`, `web/src/contexts/SearchContext.tsx`

- [ ] モバイル幅でも top bar の補助導線が欠落しない
  - コメント: 390px 幅では top bar 上で検索欄・接続状態が見えなくなり、通知と設定だけが残る状態を再現した。画面によっては「隠した」のではなくレイアウト都合で押し出されているように見え、補助導線の発見性が落ちる。
  - 該当候補: `web/src/components/layout/TopNavBar.tsx`, `web/src/components/layout/MainLayout.tsx`

- [ ] Run detail のタイムラインが状態名を読める
  - コメント: `task_6c4efe7685be466b859bbd551077588d` の run detail で、タイムライン行がほぼ `(現在)` と時刻だけになり、イベント名・状態名の読み取りができなかった。可視化としての役割を果たしていない。
  - 該当候補: `web/src/components/runs/RunTimeline.tsx`

## Summary

総評:
- タスク一覧、実行一覧、作成フォームの基本導線は動作
- ただし dashboard / search / run detail は「見えるが信頼しづらい」状態で、検収観点では未完了

優先度高:
1. ダッシュボードの key 問題解消
2. ダッシュボードから詳細へ遷移できるようにする
3. ダッシュボードの run 表示を API 実態と一致させる
4. 設定保存を永続化する
5. グローバル検索の適用範囲を統一する
