import { chromium } from '@playwright/test'
const exe = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
const b = await chromium.launch({ executablePath: exe, headless: true })
const p = await b.newPage({ viewport: { width: 1280, height: 800 } })
await p.goto('http://localhost:5173')
await p.getByRole('button', { name: '单人对局' }).click()
await p.getByRole('button', { name: /10×10/ }).click()
await p.getByRole('button', { name: /随机摆阵/ }).click()
await p.waitForTimeout(200)
await p.getByRole('button', { name: /确认/ }).click()
await p.waitForSelector('text=/轮到我方报点|等待对方报点/', { timeout: 20000 })
// 等到我方回合
await p.waitForFunction(() => document.body.innerText.includes('轮到我方报点'), null, { timeout: 20000 })
const input = p.locator('input[aria-label="报点坐标，如 A5"]')
await input.fill('A1')
await p.getByRole('button', { name: '确认报点' }).click()
await p.waitForTimeout(1200)
const centerStamps = await p.locator('[aria-label="对手棋盘"] .paper-grid__stamp').count()
const mineStamps = await p.locator('[aria-label="我方小网格"] .paper-grid__stamp').count()
console.log(`中央对手棋盘标记数=${centerStamps}（应≥1，含我报点 A1 的结果）`)
console.log(`我方小网格标记数=${mineStamps}（为对方报点，可能 0 或 ≥1）`)
await b.close()
if (centerStamps < 1) { console.error('FAIL: 中央棋盘没有我的报点标记'); process.exit(1) }
console.log('PASS: 报点标记正确显示在中央对手棋盘')
