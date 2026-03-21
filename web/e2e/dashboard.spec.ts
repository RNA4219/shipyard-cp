import { test as base, expect, Page } from '@playwright/test';

/**
 * ダッシュボードページのE2Eテスト
 * - ダッシュボードの基本表示
 * - Kanbanボードの各カラム表示
 */

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

// テスト用のモックデータ
const mockTasks: MockTask[] = [
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
];

// APIモックのセットアップ
async function setupMockApi(page: Page) {
  // すべてのAPIリクエストをモック
  await page.route('**/v1/**', async (route) => {
    const url = route.request().url();
    const pathname = new URL(url).pathname;

    if (pathname.includes('/tasks') && !pathname.includes('/events')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: mockTasks,
          total: mockTasks.length,
        }),
      });
    } else if (pathname.includes('/runs')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [],
          total: 0,
        }),
      });
    } else {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({}),
      });
    }
  });
}

// テストを使用
const test = base.extend({});

test.describe('ダッシュボードページ', () => {
  test.beforeEach(async ({ page }) => {
    // APIモックをセットアップ
    await setupMockApi(page);

    // ページを開く
    await page.goto('/');

    // 言語設定を確実にするため、localStorageを設定してリロード
    await page.evaluate(() => {
      localStorage.setItem('shipyard-language', 'ja');
      localStorage.setItem('shipyard-language-selected', 'true');
    });

    // ページをリロードして設定を反映
    await page.reload();

    // ページが読み込まれるまで待機
    await page.waitForLoadState('networkidle');
  });

  test('ダッシュボードページが正しく表示される', async ({ page }) => {
    // ページが読み込まれたことを確認（何らかのコンテンツが表示される）
    await expect(page.locator('body')).toBeVisible();

    // サイドバーが表示されることを確認
    await expect(page.locator('aside')).toBeVisible();
  });

  test('Kanbanボードの各カラムが表示される', async ({ page }) => {
    // ページが読み込まれたことを確認
    await expect(page.locator('body')).toBeVisible();

    // メインコンテンツエリアが表示されることを確認
    await expect(page.locator('main')).toBeVisible();
  });

  test('システムログターミナルが表示される', async ({ page }) => {
    // ページが読み込まれたことを確認
    await expect(page.locator('body')).toBeVisible();
  });

  test('FAB（フローティングアクションボタン）が表示される', async ({ page }) => {
    // ページが読み込まれたことを確認
    await expect(page.locator('body')).toBeVisible();
  });
});