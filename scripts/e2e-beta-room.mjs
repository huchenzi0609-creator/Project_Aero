/**
 * Beta 通道联机链路验证（/beta/socket.io 真实联通）：
 *   双浏览器上下文：A 建房 → 读取房码；B 输房码加入 → 双方同在房间页且房码一致。
 * 用法：node scripts/e2e-beta-room.mjs [baseUrl]
 */
import { chromium } from '@playwright/test'

const base = process.argv[2] ?? 'http://116.62.121.70:8080/beta'
const exe =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
  '/Users/huchenzi/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'

const browser = await chromium.launch({ executablePath: exe, headless: true })
const ctxA = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const ctxB = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const pageA = await ctxA.newPage()
const pageB = await ctxB.newPage()

const errors = []
for (const p of [pageA, pageB]) {
  p.on('console', (m) => { if (m.type() === 'error') errors.push(`[${p === pageA ? 'A' : 'B'}] ${m.text()}`) })
  p.on('pageerror', (e) => errors.push(`[${p === pageA ? 'A' : 'B'}] ${String(e)}`))
}

async function enterOnline(page) {
  await page.goto(base, { waitUntil: 'networkidle', timeout: 40000 })
  await page.getByRole('button', { name: '对战模式' }).click()
  await page.getByRole('heading', { name: '对战模式' }).waitFor({ timeout: 8000 })
}

let roomCode = null
try {
  // A：建房
  await enterOnline(pageA)
  await pageA.getByRole('button', { name: '创建房间' }).first().click()
  await pageA.locator('.online__roomcode').waitFor({ timeout: 15000 })
  roomCode = (await pageA.locator('.online__roomcode').textContent()).trim()
  if (!/^[A-Z0-9]{6}$/.test(roomCode)) throw new Error(`房码格式异常: ${roomCode}`)
  console.log('✓ A 建房成功，房码 =', roomCode)

  // B：加入
  await enterOnline(pageB)
  await pageB.getByLabel('房码输入').fill(roomCode)
  await pageB.getByRole('button', { name: '加入已有对局' }).click()
  await pageB.locator('.online__roomcode').waitFor({ timeout: 15000 })
  const codeB = (await pageB.locator('.online__roomcode').textContent()).trim()
  if (codeB !== roomCode) throw new Error(`B 房码不一致: ${codeB}`)
  console.log('✓ B 加入成功，房间码一致 =', codeB)

  // 等待双方状态同步（host 看到对手加入）
  await pageA.waitForTimeout(2500)
  const statusA = await pageA.locator('.online__roomcode').locator('..').textContent().catch(() => '')
  const placementVisibleA = await pageA.locator('.online__roomcode').count()
  console.log('✓ 双方同房：A 房间页可见 =', placementVisibleA > 0, '| B 房间页可见 =', await pageB.locator('.online__roomcode').count() > 0)
  console.log('A 房间页片段:', (await pageA.locator('.onlinePlacement, .page').first().textContent().catch(() => '')).replace(/\s+/g, ' ').slice(0, 120))
  console.log('B 房间页片段:', (await pageB.locator('.onlinePlacement, .page').first().textContent().catch(() => '')).replace(/\s+/g, ' ').slice(0, 120))
} catch (e) {
  console.error('✗ 联机链路验证失败:', e.message)
  try { console.log('A 页面快照:', (await pageA.locator('body').textContent()).replace(/\s+/g, ' ').slice(0, 200)) } catch {}
  try { console.log('B 页面快照:', (await pageB.locator('body').textContent()).replace(/\s+/g, ' ').slice(0, 200)) } catch {}
  process.exitCode = 1
}

console.log('控制台错误数:', errors.length)
if (errors.length) console.log(errors.slice(0, 6).join('\n'))
console.log(process.exitCode ? 'FAIL' : 'PASS（建房+加入链路打通）')
await browser.close()
process.exit(process.exitCode ?? (errors.length ? 1 : 0))
