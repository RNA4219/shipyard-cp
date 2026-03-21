import { test as base, expect, Page } from '@playwright/test';

// モックデータの型定義
interface MockTask {
  id: string;
  title: string;
  objective: string;
  state: string;
  risk_level: 'low' | 'medium' | 'high';
  repo_ref: {
    provider: string;
    owner: string;
    name: string;
    default_branch: string;
  };
  created_at: string;
  updated_at: string;
}

interface MockRun {
  id: string;
  task_id: string;
  sequence: number;
  current_stage: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'blocked' | 'cancelled';
  started_at: string;
  ended_at?: string;
}

// テスト用のモックデータ
export const mockTasks: MockTask[] = [
  {
    id: 'task-1',
    title: 'テストタスク1',
    objective: 'E2Eテスト用のタスクです',
    state: 'queued',
    risk_level: 'low',
    repo_ref: {
      provider: 'github',
      owner: 'test-org',
      name: 'test-repo',
      default_branch: 'main',
    },
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
  },
  {
    id: 'task-2',
    title: 'テストタスク2',
    objective: '開発中のタスクです',
    state: 'developing',
    risk_level: 'medium',
    repo_ref: {
      provider: 'github',
      owner: 'test-org',
      name: 'another-repo',
      default_branch: 'develop',
    },
    created_at: '2025-01-02T00:00:00Z',
    updated_at: '2025-01-02T00:00:00Z',
  },
  {
    id: 'task-3',
    title: '完了したタスク',
    objective: '既に公開されたタスクです',
    state: 'published',
    risk_level: 'high',
    repo_ref: {
      provider: 'github',
      owner: 'test-org',
      name: 'published-repo',
      default_branch: 'main',
    },
    created_at: '2025-01-03T00:00:00Z',
    updated_at: '2025-01-03T00:00:00Z',
  },
];

export const mockRuns: MockRun[] = [
  {
    id: 'run-1',
    task_id: 'task-1',
    sequence: 1,
    current_stage: 'planning',
    status: 'running',
    started_at: '2025-01-01T00:00:00Z',
  },
  {
    id: 'run-2',
    task_id: 'task-2',
    sequence: 1,
    current_stage: 'developing',
    status: 'running',
    started_at: '2025-01-02T00:00:00Z',
  },
  {
    id: 'run-3',
    task_id: 'task-3',
    sequence: 1,
    current_stage: 'published',
    status: 'succeeded',
    started_at: '2025-01-03T00:00:00Z',
    ended_at: '2025-01-03T01:00:00Z',
  },
];

// モックAPIのセットアップ関数
export async function setupMockApi(page: Page) {
  // タスク一覧APIのモック（Viteプロキシ経由と直接アクセスの両方をカバー）
  await page.route('**/v1/tasks**', async (route) => {
    const url = route.request().url();
    const urlObj = new URL(url);
    const state = urlObj.searchParams.get('state');

    let filteredTasks = mockTasks;
    if (state) {
      filteredTasks = mockTasks.filter(t => t.state === state);
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: filteredTasks,
        total: filteredTasks.length,
      }),
    });
  });

  // 単一タスクAPIのモック（IDパターン: /v1/tasks/task-1 など）
  await page.route('**/v1/tasks/*', async (route) => {
    const url = route.request().url();
    // URLの最後のパスセグメントを取得（クエリパラメータを除外）
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/');
    const taskId = pathParts[pathParts.length - 1];

    const task = mockTasks.find(t => t.id === taskId);
    if (task) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(task),
      });
    } else {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Task not found' }),
      });
    }
  });

  // タスク作成APIのモック
  await page.route('**/v1/tasks', async (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      const newTask: MockTask = {
        id: `task-${Date.now()}`,
        title: body.title,
        objective: body.objective,
        state: 'queued',
        risk_level: body.risk_level || 'low',
        repo_ref: body.repo_ref,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(newTask),
      });
    } else {
      // GETリクエストはタスク一覧として処理
      await route.continue();
    }
  });

  // Run一覧APIのモック
  await page.route('**/v1/runs**', async (route) => {
    const url = route.request().url();
    const urlObj = new URL(url);
    const status = urlObj.searchParams.get('status');

    let filteredRuns = mockRuns;
    if (status) {
      filteredRuns = mockRuns.filter(r => r.status === status);
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: filteredRuns,
        total: filteredRuns.length,
      }),
    });
  });

  // 単一Run APIのモック
  await page.route('**/v1/runs/*', async (route) => {
    const url = route.request().url();
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/');
    const runId = pathParts[pathParts.length - 1];

    const run = mockRuns.find(r => r.id === runId);
    if (run) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(run),
      });
    } else {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Run not found' }),
      });
    }
  });

  // タスクイベントAPIのモック
  await page.route('**/v1/tasks/*/events', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [] }),
    });
  });

  // RunタイムラインAPIのモック
  await page.route('**/v1/runs/*/timeline', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [] }),
    });
  });

  // Run audit summary APIのモック
  await page.route('**/v1/runs/*/audit-summary', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ total_events: 0 }),
    });
  });

  // Run checkpoints APIのモック
  await page.route('**/v1/runs/*/checkpoints', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ run_id: 'run-1', items: [] }),
    });
  });

  // ヘルスチェックAPIのモック
  await page.route('**/health', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'ok' }),
    });
  });
}

// テスト用のカスタムフィクスチャ（autoを無効化）
type MyFixtures = {
  mockedApi: void;
};

// テストフィクスチャの拡張（autoを無効化）
export const test = base.extend<MyFixtures>({
  mockedApi: [
    async ({ page }, use) => {
      await setupMockApi(page);
      await use();
    },
    { auto: false },
  ],
});

export { expect };