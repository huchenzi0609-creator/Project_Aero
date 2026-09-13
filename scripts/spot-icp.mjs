/**
 * ICP 备案合规页面断言（双通道 × 双协议）：
 *   - https://feijisha.online/       期望角标 v0.2.10
 *   - https://feijisha.online/beta   期望角标 v0.3.17-beta5
 *   - http://116.62.121.70:8080/     期望角标 v0.2.10（备用通道也须含备案号）
 *   - http://116.62.121.70:8080/beta/ 期望角标 v0.3.17-beta5
 * 断言：角标文案、备案号文本（浙ICP备2026073891号）、a[href*=beian.miit.gov.cn]、target=_blank。
 * 用法：node scripts/spot-icp.mjs
 */
import { chromium } from '@playwright/test'

const exe =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
  '/Users/huchenzi/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'

const CASES = [
  { url: 'https://feijisha.online/', badge: 'v0.2.10' },
  { url: 'https://feijisha.online/beta', badge: 'v0.3.17-beta5' },
  { url: 'http://116.62.121.70:8080/', badge: 'v0.2.10' },
  { url: 'http://116.62.121.70:8080/beta/', badge: 'v0.3.17-beta5' },
]
const ICP = '浙ICP备2026073891号'

const browser = await chromium.launch({ executablePath: exe, headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push(String(e)))

const bad = []
for (const c of CASES) {
  const label = `${c.badge} @ ${c.url}`
  try {
    await page.goto(c.url, { waitUntil: 'networkidle', timeout: 40000 })
    const badge = (await page.locator('.home__version').textContent().catch(() => null))?.trim()
    if (badge !== c.badge) throw new Error(`角标=${badge}`)
    const link = page.locator('a[href*="beian.miit.gov.cn"]')
    await link.waitFor({ timeout: 6000 })
    const text = (await link.textContent()).trim()
    const target = await link.getAttribute('target')
    const href = await link.getAttribute('href')
    if (!text.includes(ICP)) throw new Error(`备案文案=${text}`)
    if (target !== '_blank') throw new Error(`target=${target}`)
    if (!href || !href.includes('beian.miit.gov.cn')) throw new Error(`href=${href}`)
    console.log(`✓ ${label} — 角标=${badge} 备案=「${text}」 href=${href} target=${target}`)
  } catch (e) {
    bad.push(label)
    console.log(`✗ ${label} — ${e.message}`)
  }
}
console.log('控制台错误数:', errors.length)
if (errors.length) console.log(errors.slice(0, 5).join('\n'))
console.log(bad.length ? `FAIL（${bad.length} 项）` : 'PASS（ICP 合规断言全部通过）')
await browser.close()
process.exit(bad.length || errors.length ? 1 : 0)
