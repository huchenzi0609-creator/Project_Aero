/**
 * 公网部署冒烟：加载线上页面、检查控制台错误、进入单人对局摆阵页。
 * 用法：pnpm exec node scripts/pub-smoke.mjs <baseUrl>
 */
import { chromium } from '@playwright/test'

const base = process.argv[2] ?? 'http://116.62.121.70:8080'
const exe =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
  '/Users/huchenzi/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'

const browser = await chromium.launch({ executablePath: exe, headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const errors = []
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})
page.on('pageerror', (e) => errors.push(String(e)))

await page.goto(base, { waitUntil: 'networkidle', timeout: 30000 })
const title = await page.title()
console.log('标题:', title)
await page.getByRole('button', { name: '单人对局' }).click()
await page.getByRole('button', { name: /10×10/ }).first().click()
await page.waitForSelector('.placement__board', { timeout: 20000 })
await page.getByRole('button', { name: /随机摆阵/ }).click()
await page.waitForTimeout(600)
await page.screenshot({ path: '/tmp/aero-live.png' })
console.log('摆阵页渲染 OK，截图 /tmp/aero-live.png')
console.log('控制台错误数:', errors.length)
if (errors.length) console.log(errors.slice(0, 5).join('\n'))
await browser.close()
console.log(errors.length === 0 ? 'PASS' : 'FAIL(有控制台错误)')
process.exit(errors.length === 0 ? 0 : 1)
