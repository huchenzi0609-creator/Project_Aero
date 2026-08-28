/**
 * 冒烟脚本：无头 Chromium 截图（本机无 headless-shell 时的验证通道，M7 调试用）。
 * 用法：pnpm exec node scripts/pw-smoke.mjs <url> <out.png>
 */
import { chromium } from '@playwright/test'

const exe =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
  '/Users/huchenzi/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
const url = process.argv[2] ?? 'http://localhost:5173'
const out = process.argv[3] ?? '/tmp/aero-shot.png'

const browser = await chromium.launch({ executablePath: exe, headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
await page.goto(url, { waitUntil: 'networkidle' })
await page.screenshot({ path: out })
console.log(`OK title=${await page.title()} -> ${out}`)
await browser.close()
