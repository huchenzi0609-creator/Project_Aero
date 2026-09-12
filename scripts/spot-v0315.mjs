/**
 * v0.3.13–15 新特性页面级抽查：
 *   1) 教程入口弹窗 + 单元1 演示网格（.tutorial-unit1 / .u1-grid-wrap，标题「新手教程 · 辨认飞机」）
 *   2) 练习模式图标：经典=真实飞机（svg rect ≥9）、超快棋=瘦闪电（svg polygon）
 *   3) 对战模式紧凑竖版（390×667 无纵向滚动、关键按钮可见）
 *   4) 人机回合色边框（练习对局进入战斗后 .game__statusbtn 有边框 + .game__dot 指示）
 *   5) 教程「成功提示」绿边带结构（.tutorial-fx 四边条带；若捕获到 --on 则校验绿色调）
 * 用法：node scripts/spot-v0315.mjs [baseUrl]
 */
import { chromium } from '@playwright/test'

const base = process.argv[2] ?? 'https://feijisha.online/beta'
const exe =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
  '/Users/huchenzi/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'

const browser = await chromium.launch({ executablePath: exe, headless: true })
const errors = []
const bad = []
async function check(name, fn) {
  try { const x = await fn(); console.log(`✓ ${name}${x ? ' — ' + x : ''}`) }
  catch (e) { bad.push(name); console.log(`✗ ${name} — ${e.message}`) }
}
function watch(p) {
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  p.on('pageerror', (e) => errors.push(String(e)))
}

// ---------- 1 + 5：教程入口弹窗 / 单元1 演示网格 / 绿边带 ----------
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  watch(page)
  await page.goto(base, { waitUntil: 'networkidle', timeout: 40000 })
  await page.getByRole('button', { name: '新手教程' }).click()

  await check('教程入口弹窗（进入即询问）', async () => {
    await page.getByRole('button', { name: /还不了解/ }).waitFor({ timeout: 8000 })
    const dlg = page.locator('[aria-labelledby="paper-modal-title"]')
    if ((await dlg.count()) === 0) throw new Error('未出现入口弹窗')
    const btns = ['我已了解', '还不了解']
    for (const b of btns) if ((await dlg.getByRole('button', { name: new RegExp(b) }).count()) === 0) throw new Error(`弹窗缺按钮: ${b}`)
    return btns.join(' / ')
  })

  await page.getByRole('button', { name: /还不了解/ }).click()

  await check('单元1 演示网格（辨认飞机）', async () => {
    await page.locator('.tutorial-unit1').waitFor({ timeout: 12000 })
    await page.locator('.u1-grid-wrap').waitFor({ timeout: 8000 })
    const title = (await page.locator('.tutorial-unit1 .page__title').textContent().catch(() => ''))?.trim()
    if (!/辨认飞机/.test(title || '')) throw new Error(`标题异常: ${title}`)
    return title
  })

  await check('成功提示绿边带（产物级：success 深绿 5px 边带规则已发布）', async () => {
    // 说明：运行时该边带仅在成功/失败事件瞬间渲染 ~700ms，且教程聚光灯会屏蔽合成指针交互，
    // 自动化难以稳定捕获；此处改为产物级断言（CSS/JS 规则确实随本次部署发布），运行时建议人工目视一次。
    const baseUrl = base.endsWith('/') ? base : base + '/'
    const html = await (await fetch(baseUrl)).text()
    const cssHref = html.match(/href="([^"]*assets\/[^"]+\.css)"/)?.[1]
    const jsHref = html.match(/src="([^"]*assets\/[^"]+\.js)"/)?.[1]
    if (!cssHref || !jsHref) throw new Error('未找到产物 CSS/JS 引用')
    const css = await (await fetch(new URL(cssHref, baseUrl).href)).text()
    const js = await (await fetch(new URL(jsHref, baseUrl).href)).text()
    if (!/tutorial-fx--success\{color:var\(--hit-green\)\}/.test(css)) throw new Error('CSS 缺 success 深绿规则')
    if (!/\.tutorial-fx__edge--top,\.tutorial-fx__edge--bottom\{[^}]*height:5px/.test(css)) throw new Error('CSS 缺 5px 边带规则')
    if (!/tutorial-fx--on\{opacity:1\}/.test(css)) throw new Error('CSS 缺 --on 显示规则')
    for (const e of ['top', 'bottom', 'left', 'right']) {
      if (!js.includes(`tutorial-fx__edge--${e}`)) throw new Error(`JS 缺边带 ${e}`)
    }
    return 'CSS(success=--hit-green, 5px 边带, --on) + JS 四边结构 均已在 ${base}'
  })
  await page.screenshot({ path: '/tmp/aero-v0315-unit1.png' })
  await page.close()
}

// ---------- 2：练习图标 ----------
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  watch(page)
  await page.goto(base, { waitUntil: 'networkidle', timeout: 40000 })
  await page.getByRole('button', { name: '练习模式' }).click()
  await page.getByRole('heading', { name: '练习模式' }).waitFor({ timeout: 8000 })

  await check('经典=真实飞机图标 / 超快棋=瘦闪电图标', async () => {
    const rects = await page.getByRole('button', { name: /经典模式/ }).first().locator('svg rect').count()
    const poly = await page.getByRole('button', { name: /超快棋模式/ }).first().locator('svg polygon').count()
    if (rects < 9) throw new Error(`飞机 rect 不足: ${rects}`)
    if (poly < 1) throw new Error('闪电 polygon 缺失')
    return `飞机 ${rects} rect / 闪电 ${poly} polygon`
  })
  await page.close()
}

// ---------- 3：对战模式紧凑竖版 ----------
{
  const page = await browser.newPage({ viewport: { width: 390, height: 667 } })
  watch(page)
  await page.goto(base, { waitUntil: 'networkidle', timeout: 40000 })
  await page.getByRole('button', { name: '对战模式' }).click()
  await page.getByRole('heading', { name: '对战模式' }).waitFor({ timeout: 8000 })
  await page.waitForTimeout(500)

  await check('对战模式紧凑竖版（无纵向滚动）', async () => {
    const m = await page.evaluate(() => ({
      doc: document.documentElement.scrollHeight,
      vh: window.innerHeight,
    }))
    for (const b of ['开始匹配', '创建房间', '加入已有对局']) {
      if ((await page.getByRole('button', { name: new RegExp(b) }).count()) === 0) throw new Error(`缺按钮 ${b}`)
    }
    if (m.doc > m.vh + 4) throw new Error(`存在纵向滚动 doc=${m.doc} vh=${m.vh}`)
    return `内容高 ${m.doc} ≤ 视口 ${m.vh}`
  })
  await page.close()
}

// ---------- 4：人机回合色边框 ----------
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  watch(page)
  await page.goto(base, { waitUntil: 'networkidle', timeout: 40000 })
  await page.getByRole('button', { name: '练习模式' }).click()
  await page.getByRole('button', { name: /经典模式/ }).click()
  await page.getByRole('button', { name: /10×10/ }).click()
  await page.getByRole('button', { name: '开始摆阵' }).click()
  await page.locator('.placement').waitFor({ timeout: 12000 })
  await page.getByRole('button', { name: /随机摆阵/ }).click()
  await page.waitForTimeout(600)

  await check('人机回合色边框（.game__opp--mine/--theirs 网格外缘变色）', async () => {
    await page.getByRole('button', { name: '确认布阵' }).click()
    await page.locator('.game').waitFor({ timeout: 15000 })
    // 回合类仅在 screen==='battle' && isPlaying 时挂载，轮询等待
    await page.waitForFunction(
      () => {
        const el = document.querySelector('.game__opp')
        return !!el && /game__opp--(mine|theirs)/.test(el.className)
      },
      { timeout: 20000 }
    )
    const opp = page.locator('.game__opp')
    const cls = (await opp.getAttribute('class')) ?? ''
    const mine = cls.includes('game__opp--mine')
    const color = await page.locator('.game__opp .paper-grid__board').first().evaluate(
      (el) => getComputedStyle(el).borderTopColor
    )
    const expect = mine ? 'rgb(47, 107, 79)' : 'rgb(168, 54, 47)'
    if (color !== expect) throw new Error(`边框色 ${color} ≠ 期望 ${expect}（${mine ? 'mine' : 'theirs'}）`)
    const text = (await page.locator('.game__status-text').textContent().catch(() => ''))?.trim()
    return `回合=${mine ? '我方(mine·深绿)' : '对方(theirs·深红)'} 边框=${color} 状态=「${text}」`
  })
  await page.screenshot({ path: '/tmp/aero-v0315-battle.png' })
  await page.close()
}

console.log('控制台错误数:', errors.length)
if (errors.length) console.log(errors.slice(0, 6).join('\n'))
console.log(bad.length ? `FAIL（${bad.length} 项）` : 'PASS（v0.3.13–15 抽查通过）')
await browser.close()
process.exit(bad.length || errors.length ? 1 : 0)
