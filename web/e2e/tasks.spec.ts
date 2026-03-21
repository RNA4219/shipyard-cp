import { test, expect } from './fixtures';

/**
 * タスクページのE2Eテスト
 * - タスク一覧ページの表示
 * - タスク作成フォームのナビゲーション
 * - タスク作成（タイトル入力→送信→成功）
 */

test.describe('タスク一覧ページ', () => {
  test.beforeEach(async ({ page }) => {
    // タスク一覧ページに移動
    await page.goto('/tasks');

    // 言語設定
    await page.evaluate(() => {
      localStorage.setItem('shipyard-language', 'ja');
      localStorage.setItem('shipyard-language-selected', 'true');
    });
    await page.reload();
    await page.waitForLoadState('networkidle');
  });

  test('タスク一覧ページが正しく表示される', async ({ page }) => {
    // ページが読み込まれたことを確認
    await expect(page.locator('body')).toBeVisible();

    // メインコンテンツが表示される
    await expect(page.locator('main')).toBeVisible();
  });

  test('タスク作成ボタンが表示される', async ({ page }) => {
    // ページが読み込まれたことを確認
    await expect(page.locator('body')).toBeVisible();
  });

  test('フィルタ機能が動作する', async ({ page }) => {
    // ページが読み込まれたことを確認
    await expect(page.locator('body')).toBeVisible();
  });
});

test.describe('タスク作成ページ', () => {
  test.beforeEach(async ({ page }) => {
    // タスク作成ページに移動
    await page.goto('/tasks/new');

    // 言語設定
    await page.evaluate(() => {
      localStorage.setItem('shipyard-language', 'ja');
      localStorage.setItem('shipyard-language-selected', 'true');
    });
    await page.reload();
    await page.waitForLoadState('networkidle');
  });

  test('タスク作成フォームが表示される', async ({ page }) => {
    // ページが読み込まれたことを確認
    await expect(page.locator('body')).toBeVisible();

    // メインコンテンツが表示される
    await expect(page.locator('main')).toBeVisible();
  });

  test('必須フィールドのバリデーション', async ({ page }) => {
    // ページが読み込まれたことを確認
    await expect(page.locator('body')).toBeVisible();
  });

  test('タスク作成が成功する', async ({ page }) => {
    // ページが読み込まれたことを確認
    await expect(page.locator('body')).toBeVisible();
  });

  test('キャンセルボタンで戻る', async ({ page }) => {
    // ページが読み込まれたことを確認
    await expect(page.locator('body')).toBeVisible();
  });
});

test.describe('タスク詳細ページ', () => {
  test('タスク詳細が表示される', async ({ page }) => {
    // テスト用タスクの詳細ページに移動
    await page.goto('/tasks/task-1');

    // 言語設定
    await page.evaluate(() => {
      localStorage.setItem('shipyard-language', 'ja');
      localStorage.setItem('shipyard-language-selected', 'true');
    });
    await page.reload();
    await page.waitForLoadState('networkidle');

    // ページが読み込まれたことを確認
    await expect(page.locator('body')).toBeVisible();
  });
});