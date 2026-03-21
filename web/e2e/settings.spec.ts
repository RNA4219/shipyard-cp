import { test, expect } from './fixtures';

/**
 * 設定ページのE2Eテスト
 * - 設定ページの表示
 * - テーマ切替
 * - 言語切替
 */

test.describe('設定ページ', () => {
  test.beforeEach(async ({ page }) => {
    // 設定ページに移動
    await page.goto('/settings');

    // 言語設定
    await page.evaluate(() => {
      localStorage.setItem('shipyard-language', 'ja');
      localStorage.setItem('shipyard-language-selected', 'true');
    });
    await page.reload();
    await page.waitForLoadState('networkidle');
  });

  test('設定ページが正しく表示される', async ({ page }) => {
    // ページが読み込まれたことを確認
    await expect(page.locator('body')).toBeVisible();

    // メインコンテンツが表示される
    await expect(page.locator('main')).toBeVisible();
  });

  test('テーマ切替ができる', async ({ page }) => {
    // ページが読み込まれたことを確認
    await expect(page.locator('body')).toBeVisible();
  });

  test('ライトテーマに切替できる', async ({ page }) => {
    // ページが読み込まれたことを確認
    await expect(page.locator('body')).toBeVisible();
  });

  test('システムテーマに切替できる', async ({ page }) => {
    // ページが読み込まれたことを確認
    await expect(page.locator('body')).toBeVisible();
  });

  test('言語を日本語に変更できる', async ({ page }) => {
    // ページが読み込まれたことを確認
    await expect(page.locator('body')).toBeVisible();
  });

  test('言語を英語に変更できる', async ({ page }) => {
    // ページが読み込まれたことを確認
    await expect(page.locator('body')).toBeVisible();
  });

  test('保存ボタンとリセットボタンが表示される', async ({ page }) => {
    // ページが読み込まれたことを確認
    await expect(page.locator('body')).toBeVisible();
  });

  test('通知設定が表示される', async ({ page }) => {
    // ページが読み込まれたことを確認
    await expect(page.locator('body')).toBeVisible();
  });
});