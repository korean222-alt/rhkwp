import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: '**/*.spec.ts', timeout: 90000, workers: 1,
  use: { baseURL: process.env.LENS_TEST_URL || 'http://127.0.0.1:5173', channel: 'chrome', viewport: { width: 1440, height: 1050 }, headless: true, screenshot: 'only-on-failure' },
  webServer: process.env.LENS_TEST_URL ? undefined : { command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173', url: 'http://127.0.0.1:5173', reuseExistingServer: true },
});
