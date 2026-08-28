import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'apps/web/e2e',
  timeout: 60_000,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    locale: 'zh-CN',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'pnpm --filter @aero/web dev',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: 'pnpm --filter @aero/server dev',
      url: 'http://localhost:3001/health',
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
})
