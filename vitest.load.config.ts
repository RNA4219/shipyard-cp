import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/load.test.ts'],
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 60_000,
    hookTimeout: 30_000,
    globalSetup: ['./test/setup.ts'],
    setupFiles: ['./test/setup.ts'],
  },
});
