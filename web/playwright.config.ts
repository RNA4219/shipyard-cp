import { defineConfig, devices } from '@playwright/test';

/**
 * PlaywrightのE2Eテスト設定
 * フロントエンドのテスト用に設定されています
 */
export default defineConfig({
  // テストファイルの場所
  testDir: './e2e',

  // 並列実行を有効化
  fullyParallel: true,

  // CIでは失敗時にテストを中止
  forbidOnly: !!process.env.CI,

  // CIではリトライを有効化
  retries: process.env.CI ? 2 : 0,

  // CIではワーカーを1つに制限
  workers: process.env.CI ? 1 : undefined,

  // レポーター設定
  reporter: 'list',

  // 共通設定
  use: {
    // ベースURL
    baseURL: 'http://localhost:5273',

    // テスト実行時のトレース収集（失敗時のみ）
    trace: 'on-first-retry',

    // スクリーンショット（失敗時のみ）
    screenshot: 'only-on-failure',

    // ビデオ録画（オフ）
    video: 'off',
  },

  // テスト実行前に開発サーバーを起動する設定
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5273',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
    // テスト用の環境変数を設定（API URLを相対パスにしてプロキシを使用）
    env: {
      VITE_API_URL: '',
    },
  },

  // ブラウザ設定
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],
});