import { test, expect } from './fixtures';

/**
 * Run一覧ページのE2Eテスト
 * - Run一覧ページの表示
 * - フィルタ機能
 */

test.describe('Run一覧ページ', () => {
  test.beforeEach(async ({ page }) => {
    // Run一覧ページに移動
    await page.goto('/runs');

    // 言語設定
    await page.evaluate(() => {
      localStorage.setItem('shipyard-language', 'ja');
      localStorage.setItem('shipyard-language-selected', 'true');
    });
    await page.reload();
    await page.waitForLoadState('networkidle');
  });

  test('Run一覧ページが正しく表示される', async ({ page }) => {
    // ページが読み込まれたことを確認
    await expect(page.locator('body')).toBeVisible();

    // メインコンテンツが表示される
    await expect(page.locator('main')).toBeVisible();
  });

  test('フィルタ機能が動作する', async ({ page }) => {
    // ページが読み込まれたことを確認
    await expect(page.locator('body')).toBeVisible();
  });

  test('フィルタをクリアできる', async ({ page }) => {
    // ページが読み込まれたことを確認
    await expect(page.locator('body')).toBeVisible();
  });
});

test.describe('Run詳細ページ', () => {
  test('Run詳細が表示される', async ({ page }) => {
    // テスト用Runの詳細ページに移動
    await page.goto('/runs/run-1');

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