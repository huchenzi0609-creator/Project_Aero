/**
 * v0.3.11 新改动页面级抽查：
 *   1) 教程单元内无「跳过」按钮（右上角无 .tutorial-bubble__skip、无 跳过 文案按钮）
 *   2) 横屏教程气泡：水平居中、偏下（bottom-center）
 *   3) 竖屏 390×667 下 10×10 摆阵 cell 明显加大（≈33px）
 * 用法：node scripts/spot-v0311.mjs [baseUrl]
 */
import { chromium } from '@playwright/test'

const base = process.argv[2] ?? 'http://116.62.121.70:8080/beta'
const exe =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
  '/Users/huchenzi/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'

const browser = await chromium.launch({ executablePath: exe, headless: true })
const errors = []
const ok = []
const bad = []

async function check(name, fn) {
  try { const extra = await fn(); ok.push(name); console.log(`✓ ${name}${extra ? ' — ' + extra : ''}`) }
  catch (e) { bad.push(name); console.log(`✗ ${name} — ${e.message}`) }
}

async function enterTutorial(page) {
  await page.goto(base, { waitUntil: 'networkidle', timeout: 40000 })
  await page.getByRole('button', { name: '新手教程' }).click()
  await page.getByRole('button', { name: /还不了解/ }).waitFor({ timeout: 8000 })
  await page.getByRole('button', { name: /还不了解/ }).click()
  await page.locator('.tutorial-bubble').first().waitFor({ timeout: 15000 })
  await page.waitForTimeout(1000)
}

// ---------- 1 & 2：横屏 1280×720 教程 ----------
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(String(e)))

  await enterTutorial(page)

  await check('教程单元内无「跳过」按钮', async () => {
    const skipTxt = await page.getByRole('button', { name: /跳过/ }).count()
    const skipCls = await page.locator('.tutorial-bubble__skip').count()
    if (skipTxt + skipCls !== 0) throw new Error(`发现跳过按钮 text=${skipTxt} class=${skipCls}`)
    return '0 个跳过按钮'
  })

  await check('横屏气泡水平居中偏下', async () => {
    const vp = page.viewportSize()
    const box = await page.locator('.tutorial-bubble').first().boundingBox()
    if (!box) throw new Error('气泡不可见')
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    const dx = Math.abs(cx - vp.width / 2)
    const low = cy > vp.height * 0.45
    if (dx > 80) throw new Error(`水平偏移过大 dx=${dx.toFixed(0)}px`)
    if (!low) throw new Error(`气泡不在下半屏 cy=${cy.toFixed(0)}/h=${vp.height}`)
    return `cx偏移=${dx.toFixed(0)}px cy=${cy.toFixed(0)}px(${vp.height}) 偏下=${low}`
  })
  await page.screenshot({ path: '/tmp/aero-v0311-landscape.png' })
  await page.close()
}

// ---------- 3：竖屏 390×667 摆阵 cell 尺寸 ----------
{
  const page = await browser.newPage({ viewport: { width: 390, height: 667 } })
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(String(e)))

  await page.goto(base, { waitUntil: 'networkidle', timeout: 40000 })
  await page.getByRole('button', { name: '练习模式' }).click()
  await page.getByRole('button', { name: /经典模式/ }).click()
  await page.getByRole('button', { name: /10×10/ }).click()
  await page.getByRole('button', { name: '开始摆阵' }).click()
  await page.locator('.placement').waitFor({ timeout: 15000 })
  await page.waitForTimeout(600)

  await check('竖屏 10×10 cell ≈33px（明显加大）', async () => {
    const cell = page.locator('.paper-grid__cell').first()
    await cell.waitFor({ timeout: 8000 })
    const box = await cell.boundingBox()
    if (!box) throw new Error('cell box 获取失败')
    const w = box.width
    if (w < 26 || w > 40) throw new Error(`cell 宽异常: ${w.toFixed(1)}px`)
    return `cell=${w.toFixed(1)}px（v0.3.9 时代 ~22px，明显加大）`
  })
  await page.screenshot({ path: '/tmp/aero-v0311-portrait.png' })
  await page.close()
}

console.log('控制台错误数:', errors.length)
if (errors.length) console.log(errors.slice(0, 6).join('\n'))
console.log(bad.length ? `FAIL（${bad.length} 项）` : 'PASS（v0.3.11 抽查通过）')
await browser.close()
process.exit(bad.length || errors.length ? 1 : 0)
