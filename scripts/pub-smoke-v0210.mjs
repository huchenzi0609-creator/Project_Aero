/**
 * 公网冒烟 —— 根路径通道（v0.2.10-alpha，双通道部署的根版本）：
 *   1) 首页加载 + 版本角标 v0.2.10
 *   2) 主菜单（单人对局 / 联机对战）入口可见
 *   3) 单人对局 → 10×10 → 摆阵页（.placement__board）→ 随机摆阵
 *   全程统计 console/page 错误，任一失败退出码 1。
 * 用法：pnpm exec node scripts/pub-smoke-v0210.mjs <baseUrl>
 */
import { chromium } from '@playwright/test'

const base = process.argv[2] ?? 'http://116.62.121.70:8080'
const exe =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
  '/Users/huchenzi/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'

const browser = await chromium.launch({ executablePath: exe, headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push(String(e)))

const results = []
async function step(name, fn) {
  try {
    const extra = await fn()
    results.push({ name, ok: true })
    console.log(`✓ ${name}${extra ? ' — ' + extra : ''}`)
  } catch (e) {
    results.push({ name, ok: false, error: e.message })
    console.log(`✗ ${name} — ${e.message}`)
  }
}

await page.goto(base, { waitUntil: 'networkidle', timeout: 40000 })

await step('首页加载（标题）', async () => {
  const h1 = await page.locator('h1').first().textContent().catch(() => '')
  if (!/飞机杀/.test(h1 || '')) throw new Error(`h1 非「飞机杀」: ${h1}`)
  return `title=${await page.title()}`
})

await step('版本角标 v0.2.10', async () => {
  const v = await page.locator('.home__version').textContent().catch(() => null)
  if ((v || '').trim() !== 'v0.2.10') throw new Error(`角标缺失/不符: ${v}`)
  return v.trim()
})

await step('主菜单入口（单人对局/联机对战）', async () => {
  for (const b of ['单人对局', '联机对战']) {
    if ((await page.getByRole('button', { name: new RegExp(b) }).count()) === 0) throw new Error(`缺菜单按钮: ${b}`)
  }
  return '单人对局 / 联机对战'
})

await step('单人对局 → 10×10 → 摆阵页', async () => {
  await page.getByRole('button', { name: '单人对局' }).click()
  await page.getByRole('button', { name: /10×10/ }).first().click()
  await page.waitForSelector('.placement__board', { timeout: 15000 })
  return 'board OK'
})

await step('随机摆阵', async () => {
  await page.getByRole('button', { name: /随机摆阵/ }).click()
  await page.waitForTimeout(700)
  await page.screenshot({ path: '/tmp/aero-root-live.png' })
})

const consoleErrors = errors.length
console.log('控制台错误数:', consoleErrors)
if (consoleErrors) console.log(errors.slice(0, 5).join('\n'))
const failed = results.filter((r) => !r.ok)
console.log(failed.length ? `FAIL（${failed.length} 项）` : 'PASS（全部关键路径通过）')
await browser.close()
process.exit(failed.length || consoleErrors ? 1 : 0)
