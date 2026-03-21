import { createContext, useContext, useState, useEffect } from 'react';

export type Language = 'en' | 'ja';

interface LanguageContextValue {
  language: Language;
  setLanguage: (lang: Language) => void;
  hasSelectedLanguage: boolean;
  markLanguageSelected: () => void;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

const LANGUAGE_KEY = 'shipyard-language';
const LANGUAGE_SELECTED_KEY = 'shipyard-language-selected';

const translations: Record<Language, Record<string, string>> = {
  en: {
    // Navigation
    dashboard: 'Dashboard',
    tasks: 'Tasks',
    runs: 'Runs',
    settings: 'Settings',

    // General
    search: 'Search...',
    connected: 'Connected',
    disconnected: 'Disconnected',
    loading: 'Loading...',

    // Dashboard
    welcomeTitle: 'Task Board',
    welcomeSubtitle: 'Manage and monitor your autonomous agents',
    activeAgents: 'Active Agents',
    queueDepth: 'Queue Depth',
    successRate: 'Success Rate',
    avgDuration: 'Avg. Duration',

    // Kanban columns
    queued: 'Queued',
    planning: 'Planning',
    planned: 'Planned',
    inProgress: 'In Progress',
    developing: 'Developing',
    devCompleted: 'Dev Completed',
    devDone: 'Dev Done',
    acceptance: 'Acceptance',
    accepting: 'Accepting',
    accepted: 'Accepted',
    rework: 'Rework',
    integrating: 'Integrating',
    integrated: 'Integrated',
    publishing: 'Publishing',
    publishPendingApproval: 'Awaiting Approval',
    published: 'Published',
    failed: 'Failed',
    blocked: 'Blocked',
    cancelled: 'Cancelled',

    // Dashboard stats
    total: 'Total',
    active: 'Active',
    done: 'Done',
    noTasks: 'No tasks',
    view: 'View',

    // Task
    taskId: 'Task ID',
    task: 'Task',
    objective: 'Objective',
    repo: 'Repository',
    branch: 'Branch',
    version: 'Version',
    created: 'Created',
    updated: 'Updated',
    state: 'State',
    riskLevel: 'Risk Level',
    filesChanged: 'Files Changed',
    linesAdded: 'Lines Added',
    linesDeleted: 'Lines Deleted',
    noTasksFound: 'No tasks found',
    createTaskHint: 'Create a task via the API to get started',
    taskNotFound: 'Task not found',
    backToTasks: 'Back to tasks',
    taskInfo: 'Task Info',
    changes: 'Changes',
    actions: 'Actions',
    dispatch: 'Dispatch',
    stagePlan: 'Plan',
    stageDev: 'Development',
    stageAcceptance: 'Acceptance',
    completeAcceptance: 'Complete Acceptance',
    completingAcceptance: 'Completing acceptance...',
    cancel: 'Cancel',
    cancelConfirm: 'Are you sure you want to cancel this task?',
    timeline: 'Timeline',
    noEvents: 'No events yet',

    // Run
    runId: 'Run ID',
    run: 'Run',
    sequence: 'Sequence',
    currentStage: 'Current Stage',
    started: 'Started',
    ended: 'Ended',
    status: 'Status',
    noRunsFound: 'No runs found',
    runsHint: 'Runs are created when tasks are dispatched',
    runNotFound: 'Run not found',
    backToRuns: 'Back to runs',
    runInfo: 'Run Info',
    auditSummary: 'Audit Summary',
    totalEvents: 'Total events',
    noTimelineEvents: 'No timeline events',
    current: 'current',

    // Risk levels
    low: 'Low',
    medium: 'Medium',
    high: 'High',

    // Settings
    settingsTitle: 'Settings',
    settingsSubtitle: 'Configure your workspace preferences.',
    appearance: 'Appearance',
    appearanceDesc: 'Customize the look and feel of your workspace.',
    language: 'Language',
    languageDesc: 'Choose your preferred language.',
    interfaceTheme: 'Interface Theme',
    editor: 'Editor',
    editorDesc: 'Configure editor behavior and formatting.',
    fontSize: 'Font Size',
    tabSize: 'Tab Size',

    // Language selector
    selectLanguage: 'Select Language',
    selectLanguageDesc: 'Choose your preferred language for the interface.',
    english: 'English',
    japanese: '日本語',
    continue: 'Continue',

    // Theme
    dark: 'Dark',
    light: 'Light',
    system: 'System',
    custom: 'Custom',
    presets: 'Presets',

    // Notifications
    notifications: 'Notifications',
    notificationsDesc: 'Configure how you receive alerts.',
    agentCompletion: 'Agent Completion',
    agentCompletionDesc: 'Notify when agents finish tasks',
    errorAlerts: 'Error Alerts',
    errorAlertsDesc: 'Get notified on task failures',
    systemUpdates: 'System Updates',
    systemUpdatesDesc: 'Receive system maintenance alerts',

    // Actions
    saveChanges: 'Save Changes',
    resetToDefaults: 'Reset to Defaults',
    settingsSaved: 'Settings saved successfully',

    // Time
    justNow: 'just now',
    minAgo: 'm ago',
    hrAgo: 'h ago',
    dayAgo: 'd ago',

    // System Log
    systemLog: 'System Log',
    live: 'LIVE',

    // Task Creation
    createTask: 'Create Task',
    cleanupTestTasks: 'Clean Test Tasks',
    cleaningUp: 'Cleaning...',
    cleanedUpTasks: 'Cleaned up test tasks',
    noTestTasks: 'No test tasks found',
    cleanupFailed: 'Failed to clean up test tasks',
    createTaskTitle: 'Create New Task',
    taskTitle: 'Title',
    titlePlaceholder: 'Enter task title',
    objectivePlaceholder: 'Describe what you want to achieve',
    description: 'Description',
    descriptionPlaceholder: 'Additional details (optional)',
    repository: 'Repository',
    repositoryDefaults: 'Saved Repository',
    repositoryDefaultsDesc: 'Tasks will use the saved repository unless you change it.',
    changeRepository: 'Change Repository',
    hideRepository: 'Hide Repository',
    repositoryRequiredHint: 'Set this once and it will be reused next time.',
    owner: 'Owner',
    ownerPlaceholder: 'e.g., my-org',
    repositoryName: 'Repository Name',
    repoNamePlaceholder: 'e.g., my-project',
    defaultBranch: 'Default Branch',
    branchPlaceholder: 'e.g., main',
    creating: 'Creating...',
    create: 'Create',
    required: 'Required',
    fieldRequired: 'This field is required',
    invalidTypedRef: 'Invalid typed reference format',
    taskCreated: 'Task created successfully',
    createError: 'Failed to create task',

    // Task Edit
    editTask: 'Edit Task',
    edit: 'Edit',
    save: 'Save',
    saving: 'Saving...',
    cancelEdit: 'Cancel',
    editSuccess: 'Task updated successfully',
    editError: 'Failed to update task',
    title: 'Title',
    apiNotAvailable: 'API not available - update saved locally (mock)',

    // Filtering
    all: 'All',
    filterByState: 'Filter by state',
    filterByStatus: 'Filter by status',
    searchTasks: 'Search tasks...',
    searchRuns: 'Search runs...',
    noResults: 'No results found',
    clearFilters: 'Clear filters',

    // Notification Panel
    noNotifications: 'No notifications yet',
    markAllRead: 'Mark all read',
    clearAll: 'Clear all',
    close: 'Close',
    clear: 'Clear',

    // Notification Messages
    notificationTaskCompleted: 'Task completed successfully',
    notificationTaskFailed: 'Task failed',
    notificationTaskBlocked: 'Task is blocked',
    notificationStateTransition: 'Task state changed',

    // Agent Stats
    agentsTitle: 'Agents',
    rateLimit: 'Rate',
    spawnStats: 'Spawns',
    queue: 'Queue',
    queuedTotal: 'Queued Total',
    allowed: 'Allowed',
    rejected: 'Rejected',
    agentMetricsUnavailable: 'Agent metrics not available',

    // Run Status
    statusPending: 'Pending',
    statusRunning: 'Running',
    statusSucceeded: 'Succeeded',
    statusFailed: 'Failed',
    statusBlocked: 'Blocked',
    statusCancelled: 'Cancelled',

    // Timeline reasons
    reasonTaskCreated: 'Task Created',
    reasonStateTransition: 'State Transition',
    reasonRetry: 'Retry',
    reasonCancellation: 'Cancelled',
    reasonError: 'Error',
  },
  ja: {
    // Navigation
    dashboard: 'ダッシュボード',
    tasks: 'タスク',
    runs: '実行',
    settings: '設定',

    // General
    search: '検索...',
    connected: '接続中',
    disconnected: '切断',
    loading: '読み込み中...',

    // Dashboard
    welcomeTitle: 'タスクボード',
    welcomeSubtitle: '自律エージェントの管理と監視',
    activeAgents: '稼働エージェント',
    queueDepth: 'キュー深度',
    successRate: '成功率',
    avgDuration: '平均所要時間',

    // Kanban columns
    queued: '待機中',
    planning: '計画中',
    planned: '計画済み',
    inProgress: '進行中',
    developing: '開発中',
    devCompleted: '開発完了',
    devDone: '開発完了',
    acceptance: '検収中',
    accepting: '検収中',
    accepted: '検収済み',
    rework: '要修正',
    integrating: '統合中',
    integrated: '統合済み',
    publishing: '公開中',
    publishPendingApproval: '承認待ち',
    published: '公開済み',
    failed: '失敗',
    blocked: 'ブロック中',
    cancelled: 'キャンセル済み',

    // Dashboard stats
    total: '合計',
    active: '稼働中',
    done: '完了',
    noTasks: 'タスクなし',
    view: '詳細',

    // Task
    taskId: 'タスクID',
    task: 'タスク',
    objective: '目的',
    repo: 'リポジトリ',
    branch: 'ブランチ',
    version: 'バージョン',
    created: '作成日時',
    updated: '更新日時',
    state: '状態',
    riskLevel: 'リスクレベル',
    filesChanged: '変更ファイル数',
    linesAdded: '追加行数',
    linesDeleted: '削除行数',
    noTasksFound: 'タスクが見つかりません',
    createTaskHint: 'API経由でタスクを作成してください',
    taskNotFound: 'タスクが見つかりません',
    backToTasks: 'タスク一覧に戻る',
    taskInfo: 'タスク情報',
    changes: '変更内容',
    actions: 'アクション',
    dispatch: 'ディスパッチ',
    stagePlan: '計画',
    stageDev: '開発',
    stageAcceptance: '検収',
    completeAcceptance: '受け入れ完了',
    completingAcceptance: '受け入れ完了中...',
    cancel: 'キャンセル',
    cancelConfirm: 'このタスクをキャンセルしてもよろしいですか？',
    timeline: 'タイムライン',
    noEvents: 'イベントはありません',

    // Run
    runId: '実行ID',
    run: '実行',
    sequence: 'シーケンス',
    currentStage: '現在のステージ',
    started: '開始日時',
    ended: '終了日時',
    status: 'ステータス',
    noRunsFound: '実行が見つかりません',
    runsHint: 'タスクがディスパッチされると実行が作成されます',
    runNotFound: '実行が見つかりません',
    backToRuns: '実行一覧に戻る',
    runInfo: '実行情報',
    auditSummary: '監査サマリー',
    totalEvents: '総イベント数',
    noTimelineEvents: 'タイムラインイベントはありません',
    current: '現在',

    // Risk levels
    low: '低',
    medium: '中',
    high: '高',

    // Settings
    settingsTitle: '設定',
    settingsSubtitle: 'ワークスペースの設定を構成します。',
    appearance: '外観',
    appearanceDesc: 'ワークスペースのルックアンドフィールをカスタマイズします。',
    language: '言語',
    languageDesc: '優先する言語を選択してください。',
    interfaceTheme: 'インターフェーステーマ',
    editor: 'エディタ',
    editorDesc: 'エディタの動作とフォーマットを設定します。',
    fontSize: 'フォントサイズ',
    tabSize: 'タブサイズ',

    // Language selector
    selectLanguage: '言語を選択',
    selectLanguageDesc: 'インターフェースの言語を選択してください。',
    english: 'English',
    japanese: '日本語',
    continue: '続行',

    // Theme
    dark: 'ダーク',
    light: 'ライト',
    system: 'システム',
    custom: 'カスタム',
    presets: 'プリセット',

    // Notifications
    notifications: '通知',
    notificationsDesc: 'アラートの受信方法を設定します。',
    agentCompletion: 'エージェント完了',
    agentCompletionDesc: 'エージェントがタスクを完了した時に通知',
    errorAlerts: 'エラーアラート',
    errorAlertsDesc: 'タスク失敗時に通知を受け取る',
    systemUpdates: 'システム更新',
    systemUpdatesDesc: 'システムメンテナンスのアラートを受け取る',

    // Actions
    saveChanges: '変更を保存',
    resetToDefaults: 'デフォルトに戻す',
    settingsSaved: '設定を保存しました',

    // Time
    justNow: 'たった今',
    minAgo: '分前',
    hrAgo: '時間前',
    dayAgo: '日前',

    // System Log
    systemLog: 'システムログ',
    live: 'ライブ',

    // Task Creation
    createTask: 'タスク作成',
    cleanupTestTasks: 'テスト整理',
    cleaningUp: '整理中...',
    cleanedUpTasks: 'テストタスクを整理しました',
    noTestTasks: '整理対象のテストタスクはありません',
    cleanupFailed: 'テストタスクの整理に失敗しました',
    createTaskTitle: '新しいタスクを作成',
    taskTitle: 'タイトル',
    titlePlaceholder: 'タスクのタイトルを入力',
    objectivePlaceholder: '達成したいことを記述してください',
    description: '説明',
    descriptionPlaceholder: '追加の詳細（任意）',
    repository: 'リポジトリ',
    repositoryDefaults: '保存済みリポジトリ',
    repositoryDefaultsDesc: '変更しない限り、このリポジトリ設定を次のタスクでも使います。',
    changeRepository: 'リポジトリを変更',
    hideRepository: 'リポジトリ入力を閉じる',
    repositoryRequiredHint: '一度設定すると、次回以降はこの値を再利用します。',
    owner: 'オーナー',
    ownerPlaceholder: '例: my-org',
    repositoryName: 'リポジトリ名',
    repoNamePlaceholder: '例: my-project',
    defaultBranch: 'デフォルトブランチ',
    branchPlaceholder: '例: main',
    creating: '作成中...',
    create: '作成',
    required: '必須',
    fieldRequired: 'この項目は必須です',
    invalidTypedRef: 'typed_refの形式が無効です',
    taskCreated: 'タスクを作成しました',
    createError: 'タスクの作成に失敗しました',

    // Task Edit
    editTask: 'タスク編集',
    edit: '編集',
    save: '保存',
    saving: '保存中...',
    cancelEdit: 'キャンセル',
    editSuccess: 'タスクを更新しました',
    editError: 'タスクの更新に失敗しました',
    title: 'タイトル',
    apiNotAvailable: 'APIが利用できません - ローカルで保存しました（モック）',

    // Filtering
    all: 'すべて',
    filterByState: '状態でフィルタ',
    filterByStatus: 'ステータスでフィルタ',
    searchTasks: 'タスクを検索...',
    searchRuns: '実行を検索...',
    noResults: '結果が見つかりません',
    clearFilters: 'フィルタをクリア',

    // Notification Panel
    noNotifications: '通知はありません',
    markAllRead: 'すべて既読',
    clearAll: 'すべて削除',
    close: '閉じる',
    clear: '削除',

    // Notification Messages
    notificationTaskCompleted: 'タスクが完了しました',
    notificationTaskFailed: 'タスクが失敗しました',
    notificationTaskBlocked: 'タスクがブロックされました',
    notificationStateTransition: 'タスクの状態が変更されました',

    // Agent Stats
    agentsTitle: 'エージェント',
    rateLimit: 'レート',
    spawnStats: 'スポーン',
    queue: 'キュー',
    queuedTotal: '累積キュー',
    allowed: '許可',
    rejected: '拒否',
    agentMetricsUnavailable: 'エージェントメトリクスを取得できません',

    // Run Status
    statusPending: '保留中',
    statusRunning: '実行中',
    statusSucceeded: '成功',
    statusFailed: '失敗',
    statusBlocked: 'ブロック中',
    statusCancelled: 'キャンセル済み',

    // Timeline reasons
    reasonTaskCreated: 'タスク作成',
    reasonStateTransition: '状態遷移',
    reasonRetry: '再試行',
    reasonCancellation: 'キャンセル',
    reasonError: 'エラー',
  },
};

export function getTranslations(lang: Language) {
  return translations[lang];
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => {
    if (typeof window === 'undefined') return 'en';
    const stored = localStorage.getItem(LANGUAGE_KEY) as Language | null;
    return stored || 'en';
  });

  const [hasSelectedLanguage, setHasSelectedLanguage] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(LANGUAGE_SELECTED_KEY) === 'true';
  });

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem(LANGUAGE_KEY, lang);
  };

  const markLanguageSelected = () => {
    setHasSelectedLanguage(true);
    localStorage.setItem(LANGUAGE_SELECTED_KEY, 'true');
  };

  // Update HTML lang attribute
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  return (
    <LanguageContext.Provider value={{ language, setLanguage, hasSelectedLanguage, markLanguageSelected }}>
      {children}
    </LanguageContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTranslation() {
  const { language } = useLanguage();
  return translations[language];
}
