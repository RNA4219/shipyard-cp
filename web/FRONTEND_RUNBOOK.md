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

**開発サーバー**: `npm run dev` → http://localhost:5173
**APIプロキシ**: `/v1/*`, `/health` → http://localhost:3000

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