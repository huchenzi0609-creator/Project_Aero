/**
 * v0.3.9 新改动页面级抽查：
 *   1) 练习模式卡片图标：经典=真实飞机（≥9 个 rect 十格）、超快棋=闪电（polygon）
 *   2) 教程气泡 .tutorial-bubble 出现后位置稳定（两次采样 box 位移 < 3px，观察无闪烁）
 * 用法：node scripts/spot-v039.mjs [baseUrl]
 */
import { chromium } from '@playwright/test'

const base = process.argv[2] ?? 'http://116.62.121.70:8080/beta'
const exe =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
  '/Users/huchenzi/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'

const browser = await chromium.launch({ executablePath: exe, headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push(String(e)))

const ok = []
const bad = []
async function check(name, fn) {
  try { const extra = await fn(); ok.push(name); console.log(`✓ ${name}${extra ? ' — ' + extra : ''}`) }
  catch (e) { bad.push(name); console.log(`✗ ${name} — ${e.message}`) }
}

await page.goto(base, { waitUntil: 'networkidle', timeout: 40000 })

// ---------- 1. 练习卡片图标 ----------
await page.getByRole('button', { name: '练习模式' }).click()
await page.getByRole('heading', { name: '练习模式' }).waitFor({ timeout: 8000 })

await check('经典模式=真实飞机图标（十格 rect）', async () => {
  const card = page.getByRole('button', { name: /经典模式/ }).first()
  const rects = await card.locator('svg rect').count()
  if (rects < 9) throw new Error(`rect 数不足: ${rects}`)
  return `${rects} 个 rect`
})
await check('超快棋模式=闪电图标（polygon）', async () => {
  const card = page.getByRole('button', { name: /超快棋模式/ }).first()
  const polys = await card.locator('svg polygon').count()
  if (polys < 1) throw new Error('无 polygon')
  return `${polys} 个 polygon`
})

// ---------- 2. 教程气泡位置稳定 ----------
await page.goto(base, { waitUntil: 'networkidle', timeout: 40000 })
await page.getByRole('button', { name: '新手教程' }).click()
// 入口弹窗（进入即开）→ 还不了解 → 基础摆阵教程，气泡出现
await page.getByRole('button', { name: /还不了解/ }).waitFor({ timeout: 8000 })
await page.getByRole('button', { name: /还不了解/ }).click()

await check('教程气泡出现且位置稳定（无闪烁）', async () => {
  await page.locator('.tutorial-bubble').first().waitFor({ timeout: 15000 })
  await page.waitForTimeout(900) // 等入场动画结束
  const box1 = await page.locator('.tutorial-bubble').first().boundingBox()
  await page.waitForTimeout(500)
  const box2 = await page.locator('.tutorial-bubble').first().boundingBox()
  if (!box1 || !box2) throw new Error('气泡 box 获取失败')
  const dx = Math.abs(box1.x - box2.x)
  const dy = Math.abs(box1.y - box2.y)
  if (dx > 3 || dy > 3) throw new Error(`气泡位移异常 dx=${dx.toFixed(1)} dy=${dy.toFixed(1)}`)
  const visible = await page.locator('.tutorial-bubble').first().isVisible()
  return `dx=${dx.toFixed(1)} dy=${dy.toFixed(1)} 可见=${visible}`
})
await page.screenshot({ path: '/tmp/aero-v039-bubble.png' })

console.log('控制台错误数:', errors.length)
if (errors.length) console.log(errors.slice(0, 5).join('\n'))
console.log(bad.length ? `FAIL（${bad.length} 项）` : 'PASS（v0.3.9 抽查通过）')
await browser.close()
process.exit(bad.length || errors.length ? 1 : 0)
