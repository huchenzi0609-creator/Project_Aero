import { defineConfig } from '@playwright/test'

/**
 * 本机无 chromium-headless-shell 时，用已安装的完整 Chromium 二进制跑无头模式：
 * PLAYWRIGHT_CHROMIUM_EXECUTABLE=/Users/.../chromium-1234/chrome-mac-arm64/Google\ Chrome\ for\ Testing.app/Contents/MacOS/Google\ Chrome\ for\ Testing
 * （CI 上仍走标准 playwright install）
 */
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? undefined

export default defineConfig({
  testDir: 'apps/web/e2e',
  timeout: 60_000,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    locale: 'zh-CN',
    trace: 'retain-on-failure',
    launchOptions: executablePath ? { executablePath } : {},
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
