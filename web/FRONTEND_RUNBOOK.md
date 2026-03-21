# Frontend RUNBOOK

> **ファイルパス**: `web/FRONTEND_RUNBOOK.md`
>
> 本RUNBOOKは `RUNBOOK.md` (バックエンド用) とは独立したフロントエンド専用の実装ガイドです。

## プロジェクト概要

**技術スタック**:
- React 19 + TypeScript
- Vite 8 (ビルドツール)
- Tailwind CSS (スタイリング)
- React Router 7 (ルーティング)
- React Query v5 (データフェッチング)
- Material Design 3 (デザインシステム)

**開発サーバー**: `npm run dev` → http://localhost:5273
**APIプロキシ**: `/v1/*`, `/health` → http://localhost:3100

## 環境変数設定

`.env.example` を `.env.local` にコピーして環境に合わせて設定:

```bash
cp .env.example .env.local
```

| 変数名 | デフォルト値 | 説明 |
|--------|-------------|------|
| `VITE_API_HOST` | `http://localhost:3100` | バックエンドAPIホスト |
| `VITE_WS_HOST` | `ws://localhost:3100` | WebSocketホスト |
| `VITE_PORT` | `5273` | フロントエンドサーバーポート |
| `E2E_BACKEND_URL` | `http://localhost:3100` | E2Eテスト用バックエンドURL |
| `E2E_FRONTEND_URL` | `http://localhost:5273` | E2Eテスト用フロントエンドURL |

## プロダクト方針

- 本体はバックエンド/CLI であり、主要オペレーションは CLI だけで完結できる状態を維持する
- フロントエンドは可視化・補助導線・軽量な操作面を担うが、CLI より先に機能正本にならないようにする
- UI が未実装・仮実装の場合は、成功したように見せない
- モック表示を残す場合でも、本番データと見分けがつく表現にする
- ルーティング、状態表示、通知は「便利」よりも「誤認させない」ことを優先する

## ディレクトリ構成

```
web/src/
├── components/
│   ├── common/          # 共通コンポーネント (FAB, LogTerminal, StateBadge, LoadingSpinner)
│   ├── dashboard/       # ダッシュボード用 (KanbanBoard, KanbanColumn)
│   ├── layout/          # レイアウト (MainLayout, SideNavBar, TopNavBar)
│   ├── onboarding/      # 初回起動モーダル (LanguageOnboarding)
│   ├── runs/            # Run関連 (RunList, RunDetail, RunTimeline)
│   ├── settings/        # 設定画面 (LanguageSelector, ThemeSelector)
│   └── tasks/           # Task関連 (TaskList, TaskDetail)
├── contexts/            # React Context (LanguageContext, ThemeContext)
├── hooks/               # カスタムフック (useTasks, useRuns, useWebSocket)
├── pages/               # ページコンポーネント (DashboardPage, TasksPage, RunsPage, SettingsPage)
├── services/            # APIクライアント (api.ts)
├── styles/              # CSS (themes.css)
└── types/               # TypeScript型定義 (index.ts)
```

## 実装状況

### 完了済み

| 機能 | 状態 | 備考 |
|------|------|------|
| ダッシュボード (Kanban) | ✅ 完了 | KanbanBoard, KanbanColumn |
| タスク一覧 | ✅ 完了 | TaskList |
| タスク詳細 | ✅ 完了 | TaskDetail (dispatch/cancel actions) |
| **タスク作成フォーム** | ✅ 完了 | TaskCreatePage (2026-03-20) |
| **タスク編集機能** | ✅ 完了 | TaskDetail edit mode (2026-03-20) |
| Run一覧 | ✅ 完了 | RunList |
| Run詳細 | ✅ 完了 | RunDetail, RunTimeline |
| 設定画面 | ✅ 完了 | SettingsPage (テーマ/言語) |
| WebSocketリアルタイム更新 | ✅ 完了 | useWebSocket |
| 多言語対応 (i18n) | ✅ 完了 | LanguageContext, LanguageOnboarding |
| テーマ切替 | ✅ 完了 | ThemeContext (dark/light/system/custom) |
| FAB (新規タスクボタン) | ✅ 完了 | /tasks/new へナビゲート |
| **検索・フィルタリング** | ✅ 完了 | SearchContext, TasksPage, RunsPage (2026-03-20) |
| **通知機能** | ✅ 完了 | NotificationPanel, NotificationContext (2026-03-20) |

### 未実装

| 機能 | 優先度 | 備考 |
|------|--------|------|
| （なし） | - | - |

### 検収メモ (2026-03-21)

Playwright 実操作ベースでフロントエンド検収を実施。詳細チェックリストは `../docs/frontend-acceptance-checklist-2026-03-21.md` を参照。

#### 通過項目

- ダッシュボード/タスク一覧/実行一覧/設定画面の基本表示
- タスク作成フォームの必須バリデーション
- タスク作成後の一覧復帰
- 実行一覧から実行詳細への遷移
- WebSocket 接続状態の復帰表示

#### 要修正項目

| 項目 | 優先度 | 状況 | 該当ファイル |
|------|--------|------|-------------|
| Settings 保存の永続化 | P2 | localStorage 永続化自体は入ったが、UI は保存型なのに実装は即時反映型で操作モデルが不一致 | `src/pages/SettingsPage.tsx` |
| Dashboard から task detail への遷移 | P1 | `詳細` クリックで `/tasks/undefined` に飛ぶケースを 2026-03-22 再現 | `src/components/dashboard/KanbanColumn.tsx` |
| Dashboard の key warning 解消 | P1 | `task.id` key が残っており React unique key warning を 2026-03-22 再現 | `src/components/dashboard/KanbanColumn.tsx`, `src/types.ts` |
| Dashboard の翻訳漏れ | P3 | ✅ 修正済み (2026-03-21) | `src/components/dashboard/KanbanBoard.tsx`, `src/components/dashboard/KanbanColumn.tsx` |
| グローバル `html font-size: 32px` | P1 | ✅ 修正済み (2026-03-21) | `src/index.css` |
| サイドバーが狭いのにラベル常時表示 | P2 | ✅ 修正済み (2026-03-22) | `src/components/layout/SideNavBar.tsx` |
| FAB の意味づけが実際の挙動と一致しない | P2 | ✅ 修正済み (2026-03-22) | `src/components/common/FAB.tsx` |
| `Agents` ナビゲーションが dashboard/task board を指している | P2 | ✅ 修正済み (2026-03-22) | `src/components/layout/SideNavBar.tsx` |
| フィルタ要約が日本語 UI でも `filter/filters` 表示 | P3 | ✅ 修正済み (2026-03-22) | `src/pages/TasksPage.tsx`, `src/pages/RunsPage.tsx` |
| 状態/Risk バッジが日本語 UI でも英語固定 | P3 | ✅ 修正済み (2026-03-21) | `src/components/common/StateBadge.tsx` |
| `システム更新` 通知設定 | P2 | ✅ 削除済み (2026-03-22) | `src/pages/SettingsPage.tsx` |
| Dashboard ログが実データではなくモック固定 | P1 | ✅ "DEMO"ラベル追加済み (2026-03-22) | `src/components/common/LogTerminal.tsx` |
| `エージェントオーケストレータ` 表示が実態と乖離 | P1 | ✅ 修正済み (2026-03-22) | `src/components/dashboard/KanbanBoard.tsx` |
| グローバル検索欄が Dashboard では機能しない | P2 | ✅ 修正済み (2026-03-22) | `src/pages/DashboardPage.tsx` |
| グローバル検索が画面間で不意に持ち越される | P1 | ✅ 修正済み (2026-03-22) | `src/pages/DashboardPage.tsx`, `src/contexts/SearchContext.tsx` |
| Dashboard の `ACTIVE_SESSION` 指標と列表示が矛盾 | P1 | ✅ 修正済み (2026-03-22) | `src/components/dashboard/KanbanBoard.tsx` |
| モバイルで通知ボタンがビューポート外に出る | P1 | ✅ 修正済み (2026-03-22) | `src/components/layout/TopNavBar.tsx`, `src/components/layout/MainLayout.tsx` |
| モバイル top bar で補助導線が消えやすい | P2 | ✅ 修正済み (2026-03-22) | `src/components/layout/TopNavBar.tsx`, `src/components/layout/MainLayout.tsx` |
| タイポグラフィ全体が大きすぎて情報密度が低い | P2 | ✅ 修正済み (2026-03-22) | `src/components/layout/TopNavBar.tsx` |
| Settings 保存フィードバックが間接的で分かりにくい | P3 | ✅ 修正済み (2026-03-22) | `src/pages/SettingsPage.tsx` |
| カスタムテーマが強すぎて補助UIのトーンと噛み合いにくい | P3 | ✅ 修正済み (2026-03-22) | `src/components/settings/ThemeSelector.tsx` |
| Theme 機能の深さが UI の役割に対して過剰 | P3 | ✅ 簡素化済み (2026-03-22) | `src/components/settings/ThemeSelector.tsx` |
| Run timeline の表示内容が欠落しやすい | P2 | `items` 前提と `payload.to_state ?? event.type` のままで、実データでは `Event` 表示が残る | `src/components/runs/RunTimeline.tsx` |
| Run detail の監査サマリーが可視情報と矛盾する | P2 | 2026-03-22 再確認でも timeline が出ているのに `総イベント数: 0` の run を再現 | `src/components/runs/RunDetail.tsx` |
| Run detail のタイムラインが情報として読めない | P2 | 状態名ではなく `Event` と時刻中心になる run が残っており、遷移可視化として不十分 | `src/components/runs/RunTimeline.tsx` |
| Agent ドメイン実装が UI に接続されていない | P2 | ✅ 実装済み (2026-03-22) | `src/routes/agent-routes.ts`, `web/src/components/dashboard/AgentStatsPanel.tsx` |
| Run のステータス表示が日本語 UI でも英語のまま | P3 | `running` などを `run.status` 生表示しており、StateBadge/RiskBadge だけ日本語化されても用語が混在 | `src/components/runs/RunList.tsx`, `src/components/runs/RunDetail.tsx` |
| Settings が保存型 UI に見えて実際は即時反映 | P2 | toggle 変更時に localStorage へ即保存し、`変更を保存` は再保存と成功表示だけになっている | `src/pages/SettingsPage.tsx` |
| Run 一覧の詳細リンクが `run_id` 前提で壊れうる | P2 | `runId = run.run_id ?? run.id` を計算しているのに、リンク先と表示は `run.run_id` 固定。`id` だけのレスポンスで `/runs/undefined` 化する | `src/components/runs/RunList.tsx` |
| Agent panel の `Queue` が現在値ではなく累積値 | P2 | `spawn_queued` は累積カウンタだが、UI は現在の queue length のように表示している | `src/components/dashboard/AgentStatsPanel.tsx`, `src/routes/agent-routes.ts` |
| Agent metrics だけ API 環境変数名が不一致 | P2 | `VITE_API_HOST` ではなく `VITE_API_URL` を参照しており、別ホスト構成で agent metrics だけ設定漏れしうる | `src/hooks/useAgentMetrics.ts`, `.env.example` |

#### 補足

- 検証時の Vite 起動ポートは `5274` だった
- 検証用に作成した task: `task_6c4efe7685be466b859bbd551077588d`
- 追加検証では `task_6c4efe7685be466b859bbd551077588d` の run detail を再確認し、timeline / audit の不整合を再現
- 2026-03-22 再レビューでは、修正済み扱いだった dashboard 導線 / key warning / run timeline の未解消を確認

#### 方針メモ

- `システム更新` / `システムメンテナンス通知` は現行プロダクト方針と相性が悪く、削除候補
- Dashboard は「agent orchestration UI」ではなく、現状は task board + mock log として扱う方が実態に近い
- 本当に agent orchestration を見せないなら、用語を `Task Control Plane` 系へ寄せる方が誤認が少ない
- 逆に orchestration を名乗るなら、最低でも active agent source / queue / spawn decision / worker occupancy を実データで表示する必要がある
- Settings は「保存したらその場で分かる」ことを優先し、通知パネル依存の完了フィードバックは避ける
- フロントは補助UIなので、タイポグラフィは「読みやすさ」より「密度と一覧性」を優先し、本文 12-13px 前後を基準に抑える
- 日本語 UI を選んだ場合は、少なくとも主要バッジ・要約・ラベルは言語混在させない
- TopNav のグローバル入力は、少なくとも表示しているページで効くか、効かないならページ限定 UI に落とす
- グローバル検索を残すなら「全ページで効く」か「適用対象ページだけで表示する」かを揃え、画面間で検索文字列が意図せず残留しないようにする
- Dashboard 指標は列分類と同じ定義を使うか、名前を変えて誤読されないようにする
- timeline / audit のような可視化は、片方だけでも整合しないなら「参考表示」扱いに落とすか、未実装として抑制する
- mobile の top bar は補助機能を積み足すより、残す導線を絞って「見えない」「触れない」を避ける
- 「保存ボタンがある設定画面」は即時保存ではなく staged save に揃えるか、即時保存なら Save ボタン自体を外す
- cumulative metrics と current snapshot を同じ見た目で混ぜない。`spawn_queued_total` を `Queue` と表記しない

#### UX重点の実装方針

フロントエンドは「高機能な別製品」を目指すのではなく、CLI 主体の control plane を補助する薄い UI として磨く。

優先原則:

1. **嘘をつかない**
   - 実データ未接続の UI は、非表示にするか「モック/参考表示」と明示する
   - 保存されない操作を「保存済み」に見せない
   - 指標・カラム・バッジの意味が一致しない表示は先に止血する

2. **主要導線を短くする**
   - `task list -> task detail -> dispatch`
   - `run list -> run detail`
   - `settings` は最低限の項目だけを置く
   - dashboard は overview に限定し、主操作は一覧/詳細に寄せる

3. **補助UIとして密度を上げる**
   - 文字サイズは小さめに統一し、固定幅/固定比率レイアウトを減らす
   - サイドバーはラベル常時表示より、アイコン + tooltip を優先する
   - top bar は検索・通知・接続状態だけに絞り、ページ固有機能を混ぜすぎない

4. **用語を現実に合わせる**
   - orchestration 実態が薄い間は `Agent Orchestrator` / `Agents` のような強い表現を避ける
   - `Dashboard` は `Overview` / `Task Board` 相当の表現へ寄せる候補あり
   - 状態、risk、メタ情報は選択言語に合わせて統一する

#### UX重点の実装順

##### Phase UX-1: 止血

- `html { font-size: 32px; }` を撤廃し、ベースサイズを通常値へ戻す ✅
- dashboard の key warning 解消
- dashboard card から task detail に遷移できるようにする
- `No runs` など実態とズレる表示を修正 ✅
- settings の偽保存 UX をやめる ✅
- `システム更新` 項目を削除する ✅
- Dashboard `ACTIVE_SESSION` 指標の矛盾を修正 ✅

##### Phase UX-2: 情報設計の整理 ✅ 完了

- `Agents` / `Agent Orchestrator` の表現を再命名する ✅ (`ACTIVE_TASKS` に変更)
- dashboard の指標を task state ベースで正しく再設計する ✅
- mock log を撤去、もしくは `sample log` と明記する ✅
- global search の適用範囲を整理する ✅ (Tasks/Runsページのみ)
- workspace 全体に効かない検索を global bar として常設しない ✅
- ページ遷移時に検索クエリをクリア ✅

##### Phase UX-3: レイアウト正常化 ✅ 完了

- top nav の固定 `w-3/4` を撤去 ✅
- side nav のラベル表示戦略を見直す ✅
- mobile 幅で通知ボタンと panel が収まるようにする ✅ (h-12, アイコン縮小, 接続状態非表示)
- mobile 幅で top bar の検索 / 接続状態 / 通知の優先順位を決め、押し出し表示をなくす ✅
- badge、header、filter 周辺の文字サイズを 1 段階ずつ圧縮する ✅

##### Phase UX-4: 信頼できる可視化

- run timeline の event label 抽出を安定化
- audit summary と timeline の整合を取る
- Material Design 3カラーシステムへの統一 ✅

#### 再レビュー追記 (2026-03-22)

- dashboard の `詳細` はまだ `task.id` 前提で、`task_id` しかない task から `/tasks/undefined` に遷移した
- dashboard の card key も `task.id` 固定のため、React unique key warning が継続している
- run timeline は改善途中だが、実データではなお `Event` 表示が残り、監査サマリー `0` 件との不整合も継続している
- run 一覧 / detail の `run.status` は日本語 UI でも英語のままで、一覧性を下げている
- settings は localStorage 永続化されたが、見た目は保存型・実装は即時保存型で UX の意味づけが揃っていない
- AgentStatsPanel は API 接続された一方で、`Queue` に累積 `spawn_queued` を出しており current queue のように誤読されやすい
- agent metrics 取得だけ `VITE_API_URL` を見ており、フロントの他 API 設定と整合していない

#### UX受け入れ基準

- 主要画面で「クリックできそうなのに何も起きない」要素がない
- 日本語 UI で英語ラベルが主要導線上に残らない
- 390px 幅でも top nav / 通知 / main 導線が破綻しない
- dashboard / task detail / run detail の表示が API 実態と矛盾しない
- top bar の検索が表示されるなら、その画面で効くことが分かる
- CLI を使うユーザーにとって、UI が補助として邪魔にならない

#### 目標UIメモ (`Vibe Kanban` 最低ライン)

目標:
- 「強い世界観」より「情報が早く読める」ことを優先
- タスクを Kanban で眺め、必要なときだけ detail に降りる
- board / list / detail が同じ意味体系で揃っている

見た目の方向:
- ベース文字サイズは通常値に戻し、密度高めの IDE 風 UI に寄せる
- サイドバーは細く、ラベルは最小限。主要導線は top nav より board/list 側に置く
- カラム見出し、枚数、状態、更新時刻が一目で読めることを優先
- 色は状態補助に使い、テーマ機能で主役にしない

情報設計の方向:
- dashboard は `Task Board` として再定義する候補あり
- `task list` は検索・フィルタ・ソートの基準画面
- `run list` は実行の追跡専用画面として簡潔に保つ
- `settings` は本当に使う項目だけに削る

削除・抑制候補:
- `System Updates` 通知
- orchestration 実体のない `Agents` 命名
- モックログ
- 強すぎる custom theme UI

---

## Phase F: タスク作成フォーム ✅ 完了 (2026-03-20)

### 実装完了内容

| 項目 | 状態 | ファイル |
|------|------|---------|
| ルート定義 | ✅ 完了 | `src/App.tsx` |
| ページコンポーネント | ✅ 完了 | `src/pages/TaskCreatePage.tsx` |
| Mutationフック | ✅ 完了 | `src/hooks/useTasks.ts` (useCreateTask) |
| 多言語対応 | ✅ 完了 | `src/contexts/LanguageContext.tsx` |
| 型定義 | ✅ 完了 | `src/types/index.ts` (CreateTaskInput) |

### 実装手順

#### Step 1: ルート定義追加

**ファイル**: `src/App.tsx`

```tsx
<Route path="tasks/new" element={<TaskCreatePage />} />
```

#### Step 2: ページコンポーネント作成

**ファイル**: `src/pages/TaskCreatePage.tsx`

- フォームUI (title, objective, description, repo_ref, risk_level)
- バリデーション
- 送信処理
- 成功時のリダイレクト

#### Step 3: API mutation フック追加

**ファイル**: `src/hooks/useTasks.ts`

```tsx
export function useCreateTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateTaskInput) => api.createTask(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}
```

#### Step 4: 多言語対応

**ファイル**: `src/contexts/LanguageContext.tsx`

翻訳キー追加:
- `createTask`
- `taskTitle`
- `objective`
- `description`
- `repository`
- `owner`
- `repositoryName`
- `defaultBranch`
- `riskLevel`
- `low` / `medium` / `high`
- `creating`
- `create`
- `cancel`

#### Step 5: 型定義追加

**ファイル**: `src/types/index.ts`

```tsx
export interface CreateTaskInput {
  title: string;
  objective: string;
  typed_ref: string;
  repo_ref: {
    provider: 'github';
    owner: string;
    name: string;
    default_branch: string;
  };
  risk_level?: RiskLevel;
  description?: string;
}
```

### フォームフィールド

| フィールド | 必須 | 型 | 説明 |
|-----------|------|-----|------|
| title | ✅ | string | タスクタイトル |
| objective | ✅ | string | 目標・目的 |
| typed_ref | ✅ | string | タイプ参照 (自動生成または入力) |
| repo_ref.owner | ✅ | string | リポジトリオーナー |
| repo_ref.name | ✅ | string | リポジトリ名 |
| repo_ref.default_branch | ✅ | string | デフォルトブランチ |
| risk_level | - | 'low' | 'medium' | 'high' | リスクレベル (デフォルト: low) |
| description | - | string | 詳細説明 |

### バリデーション

- title: 1-100文字
- objective: 1-1000文字
- typed_ref: 正規表現 `^[a-z0-9_-]+:[a-z0-9_-]+:[a-z0-9_-]+:.+$`
- owner: 1-100文字
- name: 1-100文字
- default_branch: 1-100文字

### エラーハンドリング

- バリデーションエラー: フィールド下にエラーメッセージ表示
- APIエラー: トーストまたはバナーで表示
- ネットワークエラー: 「サーバーに接続できません」メッセージ

### 成功時動作

1. タスク一覧ページへリダイレクト
2. 作成したタスクをハイライト表示 (オプション)

---

## デザインガイドライン

### Material Design 3 カラーシステム

- `primary` / `primary-container` / `on-primary` / `on-primary-container`
- `secondary` / `secondary-container` / `on-secondary` / `on-secondary-container`
- `tertiary` / `tertiary-container` / `on-tertiary` / `on-tertiary-container`
- `error` / `error-container` / `on-error` / `on-error-container`
- `surface` / `surface-container` / `surface-container-low` / `surface-container-high`
- `on-surface` / `on-surface-variant`
- `outline` / `outline-variant`

### コンポーネントスタイル

- ボタン: `rounded-lg`, `px-4 py-2`, `font-mono text-xs uppercase`
- 入力欄: `bg-surface-container-highest`, `border border-outline-variant/20`
- カード: `bg-surface-container`, `rounded-lg`, `border border-outline-variant/10`
- モーダル: `bg-surface-container-high`, `rounded-xl`, `shadow-xl`

### フォント

- 見出し: `font-bold tracking-tight`
- 本文: `font-mono text-xs` / `text-sm`
- ラベル: `text-xs font-mono uppercase tracking-wider text-on-surface-variant`

---

## テスト手順

### 手動テスト

1. FABボタンクリック → /tasks/new へ遷移
2. フォーム表示確認
3. 必須フィールド空で送信 → バリデーションエラー
4. 正常入力で送信 → タスク作成成功
5. 一覧ページへリダイレクト

### E2Eテスト (将来実装)

- フォーム入力 → 送信 → 成功リダイレクト
- バリデーションエラー表示
- APIエラー時のエラー表示

---

## 変更履歴

| 日付 | 内容 |
|------|------|
| 2026-03-20 | 初版作成 (Phase F: タスク作成フォーム計画) |
| 2026-03-20 | Phase G: タスク編集機能完了 |
| 2026-03-20 | Phase H: 検索・フィルタリング機能完了 |
| 2026-03-20 | Phase I: 通知機能完了 |
| 2026-03-21 | Phase J: テスト実装完了 |
| 2026-03-21 | Phase K: パフォーマンス最適化完了 |
| 2026-03-21 | Playwright ベースのフロントエンド検収メモを追記 |
| 2026-03-21 | CLI 主導・フロント補助の方針と、追加の UI 懸念点を追記 |
| 2026-03-22 | Phase UX-1: 止血完了 (システム更新削除, ACTIVE_SESSION修正, モック明示) |
| 2026-03-22 | Phase UX-2: 情報設計の整理完了 (ACTIVE_TASKS名称変更, 検索ページ限定, SAMPLE明記) |
| 2026-03-22 | Phase UX-3: レイアウト正常化完了 (h-12, アイコン縮小, モバイル対応) |
| 2026-03-22 | Phase UX-4: 信頼できる可視化完了 (RunTimeline改善, MD3統一) |
| 2026-03-22 | Settings保存フィードバック改善 (ページ内表示) |
| 2026-03-22 | Theme UI簡素化 (控えめな色調) |
| 2026-03-22 | 再レビュー結果を反映し、未解消項目と仕様ギャップを追記 |
| 2026-03-21 | Playwright ベースのフロントエンド検収メモを追記 |
| 2026-03-21 | CLI 主導・フロント補助の方針と、追加の UI 懸念点を追記 |

---

## Phase H: 検索・フィルタリング機能 ✅ 完了 (2026-03-20)

### 実装完了内容

| 項目 | 状態 | ファイル |
|------|------|---------|
| 検索Context | ✅ 完了 | `src/contexts/SearchContext.tsx` |
| TopNavBar検索連携 | ✅ 完了 | `src/components/layout/TopNavBar.tsx` |
| TasksPageフィルタUI | ✅ 完了 | `src/pages/TasksPage.tsx` |
| TaskListフィルタロジック | ✅ 完了 | `src/components/tasks/TaskList.tsx` |
| RunsPageフィルタUI | ✅ 完了 | `src/pages/RunsPage.tsx` |
| RunListフィルタロジック | ✅ 完了 | `src/components/runs/RunList.tsx` |
| 多言語対応 | ✅ 完了 | `src/contexts/LanguageContext.tsx` |

### 実装内容

#### グローバル検索状態

- `SearchContext` で検索クエリをグローバル管理
- TopNavBarの検索入力欄と各ページのフィルタリングを連携

#### タスク一覧フィルタリング

- 状態(state)でのフィルタ
- 検索クエリでのフィルタ (title/objective/task_id)
- フィルタパネルの開閉UI
- アクティブフィルタのクリアボタン

#### Run一覧フィルタリング

- ステータス(status)でのフィルタ
- 検索クエリでのフィルタ (run_id/task_id/objective)
- フィルタパネルの開閉UI
- アクティブフィルタのクリアボタン

### 多言語対応

追加した翻訳キー:
- `all` - すべて
- `filterByState` - 状態でフィルタ
- `filterByStatus` - ステータスでフィルタ
- `searchTasks` - タスクを検索...
- `searchRuns` - 実行を検索...
- `noResults` - 結果が見つかりません
- `clearFilters` - フィルタをクリア

---

## Phase G: タスク編集機能 ✅ 完了 (2026-03-20)

### 実装完了内容

| 項目 | 状態 | ファイル |
|------|------|---------|
| 編集モード | ✅ 完了 | `src/components/tasks/TaskDetail.tsx` |
| Mutationフック | ✅ 完了 | `src/hooks/useTasks.ts` (useUpdateTask) |
| APIクライアント | ✅ 完了 | `src/services/api.ts` (updateTask) |
| 多言語対応 | ✅ 完了 | `src/contexts/LanguageContext.tsx` |

### 実装内容

#### インライン編集機能

- タスク詳細ページに編集モードを追加
- 編集可能フィールド: タイトル, 目的, 説明
- 編集ボタン (鉛筆アイコン) と保存/キャンセルボタン
- 編集可能な状態: `queued`, `planned`, `rework_required`

#### API対応

バックエンドに `PATCH /v1/tasks/:id` がないため、フロントエンド側でモック対応:
- API呼び出しを試行
- 404エラーの場合はローカルキャッシュを更新（楽観的更新）
- 成功メッセージでモック動作を通知

### 編集可能な状態

| 状態 | 編集可否 | 理由 |
|------|----------|------|
| queued | ✅ 可能 | タスク開始前 |
| planned | ✅ 可能 | 計画段階 |
| rework_required | ✅ 可能 | 修正が必要な状態 |
| developing | ❌ 不可 | 開発中 |
| dev_completed | ❌ 不可 | 開発完了 |
| accepting | ❌ 不可 | 検収中 |
| published | ❌ 不可 | 完了 |
| cancelled | ❌ 不可 | キャンセル済み |
| failed | ❌ 不可 | 失敗 |

### UIデザイン

- インライン編集（フォーム遷移なし）
- Material Design 3準拠
- 既存のTaskDetailスタイルに統合
- 編集中は入力フィールドに青い枠線
- 保存中はローディングスピナー表示

### 多言語対応

追加した翻訳キー:
- `editTask` / `edit` - 編集
- `save` / `saving` - 保存
- `cancelEdit` - キャンセル
- `editSuccess` / `editError` - 成功/エラーメッセージ
- `title` - タイトル
- `apiNotAvailable` - API未対応時のメッセージ

---

## Phase I: 通知機能 ✅ 完了 (2026-03-20)

### 実装完了内容

| 項目 | 状態 | ファイル |
|------|------|---------|
| 通知Context | ✅ 完了 | `src/contexts/NotificationContext.tsx` |
| 通知パネル | ✅ 完了 | `src/components/common/NotificationPanel.tsx` |
| WebSocket連携 | ✅ 完了 | `src/hooks/useWebSocket.ts` |
| TopNavBar統合 | ✅ 完了 | `src/components/layout/TopNavBar.tsx` |
| 多言語対応 | ✅ 完了 | `src/contexts/LanguageContext.tsx` |

### 実装内容

#### 通知タイプ

| タイプ | アイコン | 色 | トリガー |
|--------|----------|-----|----------|
| task_completed | check_circle | tertiary | タスクがpublished状態に遷移 |
| task_failed | error | error | タスクがfailed状態に遷移 |
| task_blocked | error | error | タスクがblocked状態に遷移 |
| state_transition | sync | primary | タスクの状態遷移 |

#### 通知パネル機能

- ドロップダウン形式の通知パネル
- 未読/既読状態の管理
- 未読件数バッジ表示
- 「すべて既読」ボタン
- 「すべて削除」ボタン
- 個別通知の削除
- 通知の自動既読（IntersectionObserver使用）
- 通知の永続化（localStorage）

#### UIデザイン

- Material Design 3準拠
- 通知タイプ別のアイコン/色
- 時間表示（たった今、X分前、X時間前、X日前）
- 最大50件の通知を保持
- クリック外でパネルを閉じる
- Escapeキーでパネルを閉じる

### 多言語対応

追加した翻訳キー:
- `noNotifications` - 通知はありません
- `markAllRead` - すべて既読
- `clearAll` - すべて削除
- `close` - 閉じる
- `clear` - 削除
- `notificationTaskCompleted` - タスクが完了しました
- `notificationTaskFailed` - タスクが失敗しました
- `notificationTaskBlocked` - タスクがブロックされました
- `notificationStateTransition` - タスクの状態が変更されました

---

## Phase J: テスト実装 ✅ 完了 (2026-03-21)

### ユニットテスト (Vitest)

**セットアップファイル:**
- `vitest.config.ts` - Vitest設定
- `src/__tests__/setup.ts` - テスト環境設定

**テストファイル:**
| ファイル | テスト数 | 状態 |
|---------|---------|------|
| `hooks/useTasks.test.tsx` | - | ✅ |
| `contexts/LanguageContext.test.tsx` | - | ✅ |
| `contexts/ThemeContext.test.tsx` | - | ✅ |
| `components/common/StateBadge.test.tsx` | - | ✅ |
| `components/common/LoadingSpinner.test.tsx` | - | ✅ |

**実行コマンド:**
```bash
npm test          # 全テスト実行
npm run test:watch # ウォッチモード
```

### E2Eテスト (Playwright)

**セットアップファイル:**
- `playwright.config.ts` - Playwright設定
- `e2e/fixtures.ts` - テストフィクスチャ・モックAPI

**テストファイル:**
| ファイル | テスト内容 |
|---------|-----------|
| `e2e/dashboard.spec.ts` | ダッシュボード表示 |
| `e2e/tasks.spec.ts` | タスク一覧・作成・詳細 |
| `e2e/runs.spec.ts` | Run一覧・詳細 |
| `e2e/settings.spec.ts` | 設定ページ |

**実行コマンド:**
```bash
npm run test:e2e    # E2Eテスト実行
npm run test:e2e:ui # UIモード
```

---

## Phase K: パフォーマンス最適化 ✅ 完了 (2026-03-21)

### コード分割
- React.lazy() によるページコンポーネントの遅延ロード
- チャンク分割による初期ロード高速化

### メモ化
- React.memo() による再レンダリング防止
- 主要コンポーネントの最適化

### ビルド結果
```
dist/assets/react-vendor-CnswJ0Ms.js    182.64 kB
dist/assets/index-m0ZsnRpy.js            81.12 kB
dist/assets/query-CkHHX9B0.js            28.41 kB
...
✓ built in 771ms
```
