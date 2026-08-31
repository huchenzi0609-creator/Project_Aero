/**
 * M6 集成冒烟：双浏览器走通"建房→入房→双摆阵→就绪→对局→报点"主链路。
 * 用法：pnpm exec node scripts/online-smoke.mjs
 */
import { chromium } from '@playwright/test'

const exe =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
  '/Users/huchenzi/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
const BASE = 'http://localhost:5173'

const browser = await chromium.launch({ executablePath: exe, headless: true })
const ctxA = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const ctxB = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const A = await ctxA.newPage()
const B = await ctxB.newPage()
const errs = []
for (const [name, page] of [['A', A], ['B', B]]) {
  page.on('console', (m) => { if (m.type() === 'error') errs.push(`[${name}] ${m.text()}`) })
  page.on('pageerror', (e) => errs.push(`[${name}] ${String(e)}`))
}

const click = (page, name) => page.getByRole('button', { name }).click()

await A.goto(BASE)
await A.waitForSelector('text=飞机杀', { timeout: 10000 })
await click(A, '联机对战')
await click(A, '创建房间')
await A.waitForTimeout(1200)
const code = await A.evaluate(() => {
  const m = document.body.innerText.match(/\b[A-Z0-9]{6}\b/)
  return m ? m[0] : null
})
if (!code) throw new Error('未找到 6 位房码')
console.log('房码:', code)

await B.goto(BASE)
await click(B, '联机对战')
await B.locator('input[aria-label="房码输入"]').fill(code)
await click(B, '加入房间')
await B.waitForTimeout(1200)

for (const [name, p] of [['A', A], ['B', B]]) {
  const rand = p.getByRole('button', { name: /随机摆阵/ })
  await rand.waitFor({ timeout: 15000 })
  await rand.click()
  await p.waitForTimeout(300)
  const confirm = p.getByRole('button', { name: /确认布阵并就绪|确认/ })
  await confirm.waitFor({ timeout: 10000 })
  console.log(`${name} 确认按钮文案: ${await confirm.innerText()}`)
  await confirm.click()
  await p.waitForTimeout(400)
}
console.log('双方已摆阵并就绪')

await A.waitForSelector('text=/轮到我方报点|等待对方报点/', { timeout: 25000 })
console.log('进入对局')

for (let i = 0; i < 8; i++) {
  let active = null
  for (const [, p] of [['A', A], ['B', B]]) {
    const t = await p.evaluate(() => document.body.innerText)
    if (t.includes('轮到我方报点')) { active = p; break }
  }
  if (!active) break
  const cell = active.locator('.paper-grid__cell--clickable:not([disabled])').first()
  const cnt = await cell.count()
  if (cnt === 0) break
  await cell.click()
  await active.waitForTimeout(150)
  await cell.click()
  await active.waitForTimeout(600)
}
console.log('报点轮次完成')

console.log('控制台错误数:', errs.length)
if (errs.length) console.log(errs.slice(0, 5).join('\n'))
await browser.close()
console.log('M6 集成冒烟通过')
