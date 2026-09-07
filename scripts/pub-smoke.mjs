/**
 * 公网部署冒烟（v0.3.11 流程）：
 *   1) 首页加载 + 版本角标校验（.home__version，期望版本可由第 3 参传入，默认 v0.3.11）
 *   2) 练习模式：四子模式卡片 → 经典 → 中型 15×15 → 开始摆阵 → 摆阵页 + 随机摆阵
 *   3) 对战模式：菜单（开始匹配 / 创建房间 / 加入已有对局）
 *   4) 新手教程：入口面板 → 开始教程 → 弹窗（含关闭按钮）
 *   全程统计 console/page 错误，任一关键步失败或出现错误则退出码 1。
 * 用法：pnpm exec node scripts/pub-smoke.mjs <baseUrl> [期望角标版本]
 */
import { chromium } from '@playwright/test'

const base = process.argv[2] ?? 'http://116.62.121.70:8080/beta'
const expectVersion = process.argv[3] ?? 'v0.3.11'
const exe =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
  '/Users/huchenzi/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'

const browser = await chromium.launch({ executablePath: exe, headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })

const errors = []
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})
page.on('pageerror', (e) => errors.push(String(e)))

const results = []
let shotIndex = 0

async function step(name, fn) {
  try {
    const extra = await fn()
    results.push({ name, ok: true, ...(extra ? { extra } : {}) })
    console.log(`✓ ${name}${extra ? ' — ' + extra : ''}`)
  } catch (e) {
    results.push({ name, ok: false, error: e.message })
    console.log(`✗ ${name} — ${e.message}`)
  }
}

const shot = async () => {
  shotIndex += 1
  const p = `/tmp/aero-live-${shotIndex}.png`
  await page.screenshot({ path: p })
  return `截图 ${p}`
}

await page.goto(base, { waitUntil: 'networkidle', timeout: 40000 })

await step('首页加载（标题）', async () => {
  const title = await page.title()
  const h1 = await page.locator('h1').first().textContent().catch(() => '')
  if (!/飞机杀/.test(h1 || '')) throw new Error(`h1 非「飞机杀」: ${h1}`)
  return `title=${title}`
})

await step(`版本角标 ${expectVersion}`, async () => {
  const v = await page.locator('.home__version').textContent().catch(() => null)
  if ((v || '').trim() !== expectVersion) throw new Error(`角标缺失/不符: ${v}`)
  return v.trim()
})

// ---------- 练习模式：四子模式 → 经典 → 15×15 → 摆阵 ----------
await step('练习模式入口', async () => {
  await page.getByRole('button', { name: '练习模式' }).click()
  await page.getByRole('heading', { name: '练习模式' }).waitFor({ timeout: 8000 })
})

await step('练习四子模式卡片', async () => {
  const labels = ['经典模式', '超快棋模式', '盲棋模式', '自定义模式']
  for (const l of labels) {
    if ((await page.getByRole('button', { name: new RegExp(l) }).count()) === 0) {
      throw new Error(`缺少子模式卡片: ${l}`)
    }
  }
  return labels.join(' / ')
})

await step('经典模式 → 尺寸选择', async () => {
  await page.getByRole('button', { name: /经典模式/ }).click()
  await page.getByRole('button', { name: /15×15/ }).waitFor({ timeout: 8000 })
})

await step('中型 15×15 → 开始摆阵', async () => {
  await page.getByRole('button', { name: /15×15/ }).click()
  await page.getByRole('button', { name: '开始摆阵' }).click()
  await page.locator('.placement').waitFor({ timeout: 10000 })
  const head = await page.locator('.placement h1').textContent().catch(() => '')
  return head?.trim()
})

await step('摆阵页随机摆阵', async () => {
  await page.locator('.placement .placement__controls').getByRole('button', { name: /随机摆阵/ }).click()
  await page.waitForTimeout(700)
  await shot()
})

// ---------- 对战模式菜单 ----------
await page.goto(base, { waitUntil: 'networkidle', timeout: 40000 })
await step('对战模式菜单', async () => {
  await page.getByRole('button', { name: '对战模式' }).click()
  await page.getByRole('heading', { name: '对战模式' }).waitFor({ timeout: 8000 })
  const btns = ['开始匹配', '创建房间', '加入已有对局']
  for (const b of btns) {
    if ((await page.getByRole('button', { name: new RegExp(b) }).count()) === 0) {
      throw new Error(`对战菜单缺按钮: ${b}`)
    }
  }
  await shot()
  return btns.join(' / ')
})

// ---------- 新手教程入口弹窗 ----------
await page.goto(base, { waitUntil: 'networkidle', timeout: 40000 })
await step('新手教程入口（进入即弹窗）', async () => {
  await page.getByRole('button', { name: '新手教程' }).click()
  await page.getByRole('button', { name: '关闭对话框' }).waitFor({ timeout: 8000 })
  await page.getByRole('heading', { name: '新手教程' }).first().waitFor({ timeout: 5000 })
})

await step('教程弹窗内容与关闭', async () => {
  const dialog = page.locator('[aria-labelledby="paper-modal-title"]')
  const modalText = await dialog.textContent().catch(() => '')
  if (!/新手教程/.test(modalText || '')) throw new Error(`弹窗内容异常: ${modalText}`)
  for (const b of ['我已了解', '还不了解']) {
    if ((await dialog.getByRole('button', { name: new RegExp(b) }).count()) === 0) {
      throw new Error(`弹窗缺按钮: ${b}`)
    }
  }
  await shot()
  await page.getByRole('button', { name: '关闭对话框' }).click()
  // 关闭后应露出「开始教程」入口按钮
  await page.getByRole('button', { name: '开始教程' }).waitFor({ timeout: 5000 })
})

// ---------- 汇总 ----------
const consoleErrors = errors.length
console.log('控制台错误数:', consoleErrors)
if (consoleErrors) console.log(errors.slice(0, 5).join('\n'))
const failed = results.filter((r) => !r.ok)
console.log(failed.length ? `FAIL（${failed.length} 项）` : 'PASS（全部关键路径通过）')
await browser.close()
process.exit(failed.length || consoleErrors ? 1 : 0)
