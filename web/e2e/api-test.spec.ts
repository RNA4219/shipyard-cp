import { test, expect } from '@playwright/test';

test.describe('API接続テスト', () => {
  test.skip('バックエンドヘルスチェック', async ({ page }) => {
    // ネットワークリクエストを監視
    const responsePromise = page.waitForResponse(resp => 
      resp.url().includes('/healthz') || resp.url().includes('/health')
    );
    
    // ページを開く
    await page.goto('/');
    
    // レスポンスを待機
    const response = await responsePromise.catch(() => null);
    
    console.log('=== API Response ===');
    if (response) {
      console.log('URL:', response.url());
      console.log('Status:', response.status());
      const body = await response.text().catch(() => 'No body');
      console.log('Body:', body);
    } else {
      console.log('No health response received');
    }
    
    // スクリーンショット
    await page.screenshot({ path: 'test-results/homepage.png', fullPage: true });
  });

  test('タスク一覧API', async ({ request }) => {
    console.log('=== Testing /v1/tasks API ===');
    
    const response = await request.get('http://localhost:5273/v1/tasks');
    console.log('Status:', response.status());
    
    const body = await response.json();
    console.log('Response:', JSON.stringify(body, null, 2));
    
    expect(response.status()).toBe(200);
  });

  test('タスク作成API', async ({ request }) => {
    console.log('=== Testing POST /v1/tasks API ===');
    
    const response = await request.post('http://localhost:5273/v1/tasks', {
      data: {
        title: 'Playwright Test Task',
        objective: 'Test task creation via API',
        typed_ref: 'test:task:playwright:test-001',
        description: 'This is a test task from Playwright'
      }
    });
    
    console.log('Status:', response.status());
    const body = await response.json();
    console.log('Response:', JSON.stringify(body, null, 2));
    
    expect(response.status()).toBe(201);
    expect(body.task_id).toBeDefined();
  });

  test('ブラウザでタスクページを開く', async ({ page }) => {
    // コンソールログをキャプチャ
    page.on('console', msg => {
      console.log('Browser Console:', msg.type(), msg.text());
    });
    
    // エラーをキャプチャ
    page.on('pageerror', error => {
      console.log('Page Error:', error.message);
    });
    
    // ネットワークを監視
    page.on('response', response => {
      if (response.url().includes('/v1/')) {
        console.log('API Call:', response.request().method(), response.url(), '->', response.status());
      }
    });
    
    // タスクページを開く
    await page.goto('/tasks');
    await page.waitForLoadState('networkidle');
    
    // スクリーンショット
    await page.screenshot({ path: 'test-results/tasks-page.png', fullPage: true });
    console.log('Screenshot saved to test-results/tasks-page.png');
    
    // ページ内容を確認
    const content = await page.content();
    console.log('Page title:', await page.title());
    
    // エラーメッセージがないか確認
    const errorElements = await page.locator('[class*="error"], [class*="Error"]').count();
    console.log('Error elements found:', errorElements);
  });
});
