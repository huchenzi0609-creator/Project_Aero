/**
 * tutorial.spec —— 新手教程 e2e（v0.3.14 十四项修复验收）。
 *
 * 覆盖：
 * 1) 单元1（本次全练习）：
 *    - 三场景网格居中（`.u1-grid` 中心 ≈ `.tutorial-unit1__body` 中心）；
 *    - 场景2 预置报点显式结果（D7/G8/F9 = ✗、C6/D6/E6/F8/G6/E8 = ◯）、错点落 ✗、E5 命中 ★ + 幽灵；
 *    - 场景3 预置（H6 = ✗、其余 ◯）、J7 试错落 ✗、F7 命中 ★，且【同一网格】真实位置渲染幽灵（页面仅 1 个网格）；
 * 2) 单元2：开场 4 段（逐字首行）→ 待选栏 → 拖 3 架 → 旋转引导气泡出现即突显网格（无需点击）→
 *    旋转 → thanks「压暗但不阻断」→ 合法 → 确认布阵；
 * 3) 单元3：
 *    - 开场 i1 为纯整屏压暗（无挖洞、覆盖全屏、气泡与 `.tutorial-escape` 可点）；i4 不可点击推进；
 *    - 混合模式 k1/k3/p1（整屏压暗 + 空网格开洞 + 气泡豁免）几何/命中断言；
 *    - 幽灵标记三态：位置不符=无提示、机头对朝向错=失败提示、完全正确=成功（拖动中持续检测）；
 *    - k4 进入着色教学时空网格已取消突显（该处点击命中阻断带）；
 *    - 首杀支线与预报点支线【并行且顺序无关】：kill-first（用例2）与 prefire-first（用例3）；
 *    - 对局自然结束 → 完成提示仅「返回主页」（无「继续对局」）→ 主页；
 * 4) 突显为模态（v0.3.13 弹窗纵深防护回归）：非突显区不可点、气泡/退出可点、弹窗打开时阻断带为 0。
 *
 * 全程 console 零 error。
 */
import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { allCoords, oppCell, watchErrors } from './helpers'


/* ================= 通用定位/断言 ================= */

function modal(page: Page) {
  return page.locator('.paper-modal__dialog')
}
function bubble(page: Page) {
  return page.locator('.tutorial-bubble__text')
}
function spotlight(page: Page) {
  return page.locator('.tutorial-spotlight')
}
/** 安全读取气泡文本：气泡可能不存在（等待步）→ 先 count 再带短超时读取 */
async function bubbleTextSafe(page: Page): Promise<string> {
  if ((await bubble(page).count()) === 0) return ''
  return (await bubble(page).textContent({ timeout: 1000 }).catch(() => '')) ?? ''
}
async function clickBubble(page: Page, timeout = 10_000): Promise<void> {
  await expect(bubble(page)).toBeVisible({ timeout })
  await bubble(page).click({ timeout: 3000 })
}
/** 单层 svg 的挖洞数（path d 中 ' M' 子路径计数） */
async function spotlightHoles(page: Page): Promise<number> {
  const d = await page.locator('.tutorial-spotlight path').getAttribute('d').catch(() => null)
  if (!d) return 0
  return (d.match(/ M/g) ?? []).length
}
function blockCount(page: Page) {
  return page.locator('.tutorial-block').count()
}
/** 纯气泡突显（pure dim）：mode=dim、无 svg/path、阻断带存在、暗层覆盖全屏 */
async function expectPureDim(page: Page): Promise<void> {
  await expect(page.locator('.tutorial-spotlight[data-spotlight-mode="dim"]')).toHaveCount(1)
  await expect(page.locator('.tutorial-spotlight path')).toHaveCount(0)
  await expect(page.locator('.tutorial-block')).not.toHaveCount(0)
  const dim = await page.locator('.tutorial-spotlight--dim').boundingBox()
  const vp = page.viewportSize()
  if (dim && vp) {
    expect(Math.abs(dim.x)).toBeLessThanOrEqual(1)
    expect(Math.abs(dim.y)).toBeLessThanOrEqual(1)
    expect(Math.abs(dim.width - vp.width)).toBeLessThanOrEqual(1)
    expect(Math.abs(dim.height - vp.height)).toBeLessThanOrEqual(1)
  }
}
/** 混合模式（整屏压暗 + 目标开洞） */
async function expectHybrid(page: Page): Promise<void> {
  await expect(page.locator('.tutorial-spotlight[data-spotlight-mode="hybrid"]')).toHaveCount(1)
  expect(await spotlightHoles(page)).toBeGreaterThanOrEqual(1)
  await expect(page.locator('.tutorial-block')).not.toHaveCount(0)
}
/** 目标中心点“命中信息”：topmost 元素是否落在阻断带 / 气泡 / 退出豁免里 */
async function hitInfo(page: Page, selector: string) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const r = el.getBoundingClientRect()
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return {
      blocked: Boolean(top && top.closest('.tutorial-block')),
      inBubble: Boolean(top && top.closest('.tutorial-bubble')),
      inEscape: Boolean(top && top.closest('.tutorial-escape')),
      tag: top ? top.tagName : 'NONE',
    }
  }, selector)
}
/** 命中断言（轮询：突显换目标后阻断带/开洞有一帧~400ms 的重测窗口） */
async function expectHit(
  page: Page,
  selector: string,
  field: 'blocked' | 'inBubble' | 'inEscape',
  value: boolean,
  timeout = 4000,
): Promise<void> {
  await expect
    .poll(async () => (await hitInfo(page, selector))?.[field] ?? null, {
      timeout,
      message: `${selector} ${field} 应为 ${value}`,
    })
    .toBe(value)
}
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 14 })
  await page.mouse.up()
}
/** 按住拖拽（不松手），返回后由调用方检查/松手 */
async function dragHoldFromRef(page: Page, target: { x: number; y: number }) {
  const rb = await page.locator('.game__ref .paper-grid__plane').boundingBox()
  if (!rb) throw new Error('参考飞机不可见')
  await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2)
  await page.mouse.down()
  await page.mouse.move(target.x, target.y, { steps: 12 })
  await page.waitForTimeout(120)
}
async function releaseOverRef(page: Page) {
  const r = await page.locator('.game__ref').boundingBox()
  if (r) await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2, { steps: 6 })
  await page.mouse.up()
  await page.waitForTimeout(180)
}
/** 同格两次点击（<600ms）= 教程练习网格的「双击」语义 */
async function dblclickCell(page: Page, loc: Locator) {
  await loc.click({ timeout: 2500 })
  await page.waitForTimeout(90)
  await loc.click({ timeout: 2500 })
}
/** 点击被 .tutorial-block 阻断的区域（取最大阻断带靠上位置，避开气泡与退出按钮） */
async function clickBlockedArea(page: Page): Promise<void> {
  const blocks = page.locator('.tutorial-block')
  const n = await blocks.count()
  if (n === 0) throw new Error('没有 .tutorial-block（当前无突显阻断）')
  let best = { x: 0, y: 0, w: 0, h: 0, area: -1 }
  for (let i = 0; i < n; i++) {
    const b = await blocks.nth(i).boundingBox()
    if (!b) continue
    const area = b.width * b.height
    if (area > best.area) best = { x: b.x, y: b.y, w: b.width, h: b.height, area }
  }
  await page.mouse.click(best.x + best.w / 2, best.y + 8)
}
async function openTutorial(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '飞机杀' })).toBeVisible()
  await page.getByRole('button', { name: '新手教程' }).click()
  await expect(modal(page)).toContainText('您是否了解本游戏的基本规则？')
}

/* ================= 坐标 / 形状几何 ================= */

const LETTERS = 'ABCDEFGHIJ'
function coordToCell(coord: string) {
  return { r: Number(coord.slice(1)) - 1, c: LETTERS.indexOf(coord[0]!) }
}
function cellToCoord(c: { r: number; c: number }) {
  return `${LETTERS[c.c]}${c.r + 1}`
}
/** 对角序（r+c 升序，r 降序）：保证任一朝向的飞机在机头之前至少被扫到一个【无歧义机身格】 */
function diagCoords(): string[] {
  return allCoords(10, 10).sort((a, b) => {
    const ca = coordToCell(a)
    const cb = coordToCell(b)
    const da = ca.r + ca.c
    const db = cb.r + cb.c
    if (da !== db) return da - db
    return cb.r - ca.r
  })
}
/** 默认形状格（未旋转）与机头 */
const SHAPE_CELLS: Array<[number, number]> = [
  [0, 2],
  [1, 0],
  [1, 1],
  [1, 2],
  [1, 3],
  [1, 4],
  [2, 2],
  [3, 1],
  [3, 2],
  [3, 3],
]
function rotCell(r: number, c: number, times: number) {
  let cur = { r, c }
  for (let i = 0; i < times; i++) cur = { r: cur.c, c: 4 - cur.r }
  return cur
}
function rotCells(rot: number) {
  return SHAPE_CELLS.map(([r, c]) => rotCell(r, c, rot))
}
function headRelOf(rot: number) {
  return rotCell(0, 2, rot)
}
function shapeBBox(rot: number) {
  const cs = rotCells(rot)
  const minR = Math.min(...cs.map((c) => c.r))
  const maxR = Math.max(...cs.map((c) => c.r))
  const minC = Math.min(...cs.map((c) => c.c))
  const maxC = Math.max(...cs.map((c) => c.c))
  return { minR, minC, h: maxR - minR + 1, w: maxC - minC + 1 }
}
/** 机身格相对机头的偏移（不含机头） */
function bodyOffsets(rot: number) {
  const h = headRelOf(rot)
  return rotCells(rot)
    .map((c) => ({ r: c.r - h.r, c: c.c - h.c }))
    .filter((o) => o.r !== 0 || o.c !== 0)
}
/** 若 `coord` 是某飞机任一格，可能的机头格（所有朝向/格位的并集） */
const HEAD_DELTAS: Array<{ r: number; c: number }> = (() => {
  const set = new Map<string, { r: number; c: number }>()
  for (const rot of [0, 1, 2, 3]) {
    const h = headRelOf(rot)
    for (const c of rotCells(rot)) {
      const d = { r: h.r - c.r, c: h.c - c.c }
      if (d.r === 0 && d.c === 0) continue
      set.set(`${d.r},${d.c}`, d)
    }
  }
  return [...set.values()]
})()
function headCandidates(coord: string): string[] {
  const cell = coordToCell(coord)
  const out: string[] = []
  for (const d of HEAD_DELTAS) {
    const h = { r: cell.r + d.r, c: cell.c + d.c }
    if (h.r < 0 || h.r > 9 || h.c < 0 || h.c > 9) continue
    out.push(cellToCoord(h))
  }
  return out
}
/** 幽灵「机头落在 head」时该朝向对应的可视左上角（= origin + min） */
function headMatchVis(head: { r: number; c: number }, rot: number) {
  const h = headRelOf(rot)
  const b = shapeBBox(rot)
  return { r: head.r - h.r + b.minR, c: head.c - h.c + b.minC }
}
/** 落点格 → 可视左上角 的吸附偏移（v0.3.13 实测标定：参考网格与对手棋盘格宽不同） */
function dropCell(vis: { r: number; c: number }, rot: number) {
  const b = shapeBBox(rot)
  return { r: vis.r + Math.ceil(b.h / 2) - 1, c: vis.c + Math.ceil(b.w / 2) - 1 }
}
/** 最后一只幽灵（含拖拽预览 data-plane-id=-1）的可视左上角格位 */
async function lastGhostVis(page: Page): Promise<{ r: number; c: number } | null> {
  const board = await page.locator('.game__opp .paper-grid__board').boundingBox()
  const el = page.locator('.game__opp .paper-grid__plane[data-plane-id]').last()
  if (!board || (await el.count()) === 0) return null
  const style = (await el.getAttribute('style')) ?? ''
  const left = Number(/left:\s*([\d.]+)px/.exec(style)?.[1] ?? 'NaN')
  const top = Number(/top:\s*([\d.]+)px/.exec(style)?.[1] ?? 'NaN')
  if (!Number.isFinite(left) || !Number.isFinite(top)) return null
  const cell = board.width / 10
  return { r: Math.round(top / cell), c: Math.round(left / cell) }
}
/** 参考飞机当前朝向（由渲染几何反推：min 偏移 + 宽高类别四态唯一） */
async function refRotation(page: Page): Promise<number> {
  const el = page.locator('.game__ref .paper-grid__plane')
  if ((await el.count()) === 0) return -1
  const style = (await el.getAttribute('style')) ?? ''
  const left = Number(/left:\s*([\d.]+)px/.exec(style)?.[1] ?? 'NaN')
  const top = Number(/top:\s*([\d.]+)px/.exec(style)?.[1] ?? 'NaN')
  const box = await el.boundingBox()
  if (!box) return -1
  const wide = box.width >= box.height
  if (top === 0 && left === 0) return wide ? 0 : 3
  if (top === 0 && left > 0) return 1
  return 2
}
async function setRefRotation(page: Page, target: number): Promise<void> {
  for (let i = 0; i < 5; i++) {
    if ((await refRotation(page)) === target) return
    const b = await page.locator('.game__ref .paper-grid__plane').boundingBox()
    if (!b) throw new Error('参考飞机不可见')
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2)
    await page.waitForTimeout(140)
  }
  throw new Error(`参考飞机朝向设置失败（目标 ${target}）`)
}
/**
 * 从参考网格拖一只幽灵到「可视左上角 = vis」（读回纠偏 ≤3 次）。
 * release=false 时保持按住（供拖动中持续检测/无反馈场景使用）。
 */
async function placeGhostAt(
  page: Page,
  vis: { r: number; c: number },
  rot: number,
  opts: { release?: boolean } = {},
): Promise<void> {
  const board = page.locator('.game__opp .paper-grid__board')
  let drop = dropCell(vis, rot)
  for (let attempt = 0; attempt < 3; attempt++) {
    const bb = await board.boundingBox()
    if (!bb) throw new Error('对手棋盘不可见')
    const cell = bb.width / 10
    await dragHoldFromRef(page, { x: bb.x + (drop.c + 0.5) * cell, y: bb.y + (drop.r + 0.5) * cell })
    const act = await lastGhostVis(page)
    if (act && act.r === vis.r && act.c === vis.c) break
    if (act) drop = { r: drop.r + (vis.r - act.r), c: drop.c + (vis.c - act.c) }
  }
  if (opts.release !== false) {
    await page.mouse.up()
    await page.waitForTimeout(320)
  }
}

/* ================= 单元1 ================= */

/** 练习网格当前所有报点标记：coord → miss(✗) / hit(◯) / kill(★) */
async function u1Marks(page: Page, size: number): Promise<Record<string, string>> {
  return page.evaluate((n) => {
    const board = document.querySelector('.u1-grid .paper-grid__board')
    if (!board) return {}
    const rect = board.getBoundingClientRect()
    const cell = rect.width / n
    const out: Record<string, string> = {}
    const letters = 'ABCDEFGHIJ'
    for (const stamp of Array.from(document.querySelectorAll('.u1-grid .paper-grid__stamp'))) {
      const el = stamp as HTMLElement
      const left = parseFloat(el.style.left || '0')
      const top = parseFloat(el.style.top || '0')
      const r = Math.round(top / cell)
      const c = Math.round(left / cell)
      const mark = el.querySelector('.stamp--miss, .stamp--hit, .stamp--kill')
      // SVG 元素的 className 是 SVGAnimatedString，须用 getAttribute('class')
      const cls = mark ? (mark.getAttribute('class') ?? '') : ''
      const kind = cls.includes('stamp--miss')
        ? 'miss'
        : cls.includes('stamp--hit')
          ? 'hit'
          : cls.includes('stamp--kill')
            ? 'kill'
            : '?'
      out[`${letters[c]}${r + 1}`] = kind
    }
    return out
  }, size)
}
async function expectCentered(page: Page, inner: string, outer: string): Promise<void> {
  const a = await page.locator(inner).boundingBox()
  const b = await page.locator(outer).boundingBox()
  if (!a || !b) throw new Error(`居中测量失败：${inner}/${outer}`)
  expect(Math.abs(a.x + a.width / 2 - (b.x + b.width / 2))).toBeLessThanOrEqual(3)
  expect(Math.abs(a.y + a.height / 2 - (b.y + b.height / 2))).toBeLessThanOrEqual(3)
}

/** 单元1 全练习：s1a/s1b → 场景2（预置标记 + 错点 + E5）→ 场景3（J7 试错 + F7 命中 + 同网格幽灵） */
async function runUnit1(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: '新手教程 · 辨认飞机' })).toBeVisible({ timeout: 10_000 })
  // s1a：5×5 演示（整屏压暗突出气泡）+ 网格居中
  await expect(bubble(page)).toContainText('欢迎来到《飞机杀》！', { timeout: 10_000 })
  await expectPureDim(page)
  await expectCentered(page, '.u1-grid', '.tutorial-unit1__body')
  await clickBubble(page)
  await expect(bubble(page)).toContainText('在正式开始游戏之前，我们先来做几个练习吧！')
  await clickBubble(page) // → s1b
  // s1b：突显 5×5 演示网格，仍居中
  await expect(bubble(page)).toContainText('请记住图上飞机的样式')
  await expect(spotlight(page)).toHaveCount(1)
  expect(await spotlightHoles(page)).toBeGreaterThanOrEqual(1)
  await expectCentered(page, '.u1-grid', '.tutorial-unit1__body')
  await clickBubble(page)
  await expect(bubble(page)).toContainText('记住了吗？')
  await clickBubble(page) // → 场景2（10×10 居中）
  // 场景2：预置显式报点
  await expect(bubble(page)).toContainText('试着双击可能的')
  await expectCentered(page, '.u1-grid', '.tutorial-unit1__body')
  const m2 = await u1Marks(page, 10)
  for (const c of ['D7', 'G8', 'F9']) expect(m2[c], `场景2 ${c} 应为击空`).toBe('miss')
  for (const c of ['C6', 'D6', 'E6', 'F8', 'G6', 'E8']) expect(m2[c], `场景2 ${c} 应为击中`).toBe('hit')
  expect(Object.values(m2).filter((v) => v === 'kill')).toHaveLength(0)
  // 故意点错 A1 → 落 ✗ + 失败提示
  const grid = page.locator('.u1-grid')
  await dblclickCell(page, grid.locator('button[aria-label="A1"]'))
  await expect(bubble(page)).toContainText('机头不在这里，想想飞机的形状！', { timeout: 8000 })
  await expect(page.locator('.tutorial-fx--failure')).toHaveCount(1)
  expect((await u1Marks(page, 10))['A1'], '玩家错点应留下 ✗').toBe('miss')
  // 双击 E5（机头）→ ★ + 幽灵飞机（同网格）
  await dblclickCell(page, grid.locator('button[aria-label="E5"]'))
  await expect(bubble(page)).toContainText('致命打击！干得漂亮！', { timeout: 8000 })
  await expect(page.locator('.tutorial-fx--success')).toHaveCount(1)
  expect((await u1Marks(page, 10))['E5'], '机头命中应为 ★').toBe('kill')
  await expect(page.locator('.u1-grid .paper-grid__plane--ghost')).toHaveCount(1)
  await clickBubble(page) // → 场景3 s3a（纯压暗）
  // 场景3 歧义讲解 → J7 试错 → F7 命中
  await expect(bubble(page)).toContainText('在这种情况下，我们不能完全确定机头位置呢。')
  await expectPureDim(page)
  await clickBubble(page)
  await expect(bubble(page)).toContainText('机头可能在F7，也可能在J7。')
  await clickBubble(page) // → s3j7（突显 J7 格）
  await expect(bubble(page)).toContainText('我们需要更多的信息。试着双击J7！')
  const m3 = await u1Marks(page, 10)
  expect(m3['H6'], '场景3 H6 应为击空').toBe('miss')
  for (const c of ['G6', 'G8', 'I6', 'I8', 'H7']) expect(m3[c], `场景3 ${c} 应为击中`).toBe('hit')
  await dblclickCell(page, grid.locator('button[aria-label="J7"]'))
  await expect(bubble(page)).toContainText('看来机头不在这里，试试另一个吧！', { timeout: 8000 })
  expect((await u1Marks(page, 10))['J7'], 'J7 试错应留下 ✗').toBe('miss')
  await clickBubble(page) // → s3f7
  await expect(bubble(page)).toContainText('试试双击F7！')
  await dblclickCell(page, grid.locator('button[aria-label="F7"]'))
  await expect(bubble(page)).toContainText('恭喜！你成功锁定了机头的位置！', { timeout: 8000 })
  expect((await u1Marks(page, 10))['F7'], 'F7 命中应为 ★').toBe('kill')
  // 同一网格真实位置渲染幽灵（页面只有 1 个网格）
  await expect(page.locator('.u1-grid')).toHaveCount(1)
  await expect(page.locator('.u1-grid .paper-grid__plane--ghost')).toHaveCount(1)
  await clickBubble(page) // → 单元2
}

/* ================= 单元2 ================= */

async function dragDeckCardTo(page: Page, r: number, c: number) {
  const card = page.locator('.placement__deck-card').first()
  const board = page.locator('.placement__board')
  const cb = await card.boundingBox()
  const bb = await board.boundingBox()
  if (!cb || !bb) throw new Error('待选牌/棋盘不可见')
  const cell = bb.width / 10
  await drag(
    page,
    { x: cb.x + cb.width / 2, y: cb.y + cb.height / 2 },
    { x: bb.x + (c + 0.25) * cell, y: bb.y + (r + 0.25) * cell },
  )
  await page.waitForTimeout(180)
}
async function clickPlaneCenter(page: Page) {
  const p = page.locator('.placement__plane').first()
  const b = await p.boundingBox()
  if (!b) throw new Error('已摆飞机不可见')
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2)
  await page.waitForTimeout(220)
}

/** 单元2：从开场推进到 thanks（v0.3.14：旋转引导气泡出现即突显网格，无需点击） */
async function advanceUnit2ToThanks(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: '新手教程 · 摆阵' })).toBeVisible({ timeout: 10_000 })
  for (let k = 0; k < 8; k++) {
    if ((await bubbleTextSafe(page)).includes('这是飞机待选栏')) break
    await clickBubble(page)
    await page.waitForTimeout(80)
  }
  await expect(bubble(page)).toContainText('这是飞机待选栏，可以从这里把飞机拖到网格中。')
  await expect(spotlight(page)).toHaveCount(1)
  await clickBubble(page) // → drag
  await expect(bubble(page)).toContainText('现在就试试看吧！把飞机拖到网格里！')
  await dragDeckCardTo(page, 2, 0)
  await expect(bubble(page)).toContainText('好极了！现在尝试把剩余的飞机全部拖到网格里！', { timeout: 8000 })
  await expect(page.locator('.tutorial-fx--success')).toHaveCount(1)
  await dragDeckCardTo(page, 2, 5)
  await dragDeckCardTo(page, 6, 5)
  await expect(page.locator('.placement__plane')).toHaveCount(3, { timeout: 8000 })
  // v0.3.14 item 5：旋转引导气泡出现时【已突显待选栏 + 网格】（无需先点击气泡）
  await expect(bubble(page)).toContainText('单击飞机可以使飞机旋转90度，试试看！', { timeout: 8000 })
  expect(await spotlightHoles(page)).toBeGreaterThanOrEqual(1)
  await expectHit(page, '.placement__board', 'blocked', false)
  await expectHit(page, '.placement__tray', 'blocked', false)
  // 旋转 → thanks（bubble-soft：压暗但不阻断，玩家仍需操作飞机）
  await clickPlaneCenter(page)
  await expect(bubble(page)).toContainText('太棒了！确保你的飞机不重叠不越界之后，就可以开始游戏了！', {
    timeout: 8000,
  })
  await expect(page.locator('.tutorial-spotlight--dim')).toHaveCount(1)
  expect(await blockCount(page), 'thanks 应压暗但不阻断').toBe(0)
  await expectHit(page, '.placement__board', 'blocked', false)
}

/** 单元2 完整摆阵 → 确认布阵进入单元3 */
async function runUnit2(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: '新手教程 · 摆阵' })).toBeVisible({ timeout: 10_000 })
  await expect(bubble(page)).toContainText('很好！接下来我们即将进入实战！', { timeout: 10_000 })
  await expectPureDim(page)
  await clickBubble(page)
  await expect(bubble(page)).toContainText('首先要做的一件事是')
  await clickBubble(page)
  await expect(bubble(page)).toContainText('对手将尝试破解我方阵型')
  await clickBubble(page)
  await expect(bubble(page)).toContainText('在真实对局中，一个好的阵型可以充分地迷惑对手，为我方取得优势！')
  await advanceUnit2ToThanks(page)
  // 再次变化 → 合法性检测（合法 → 突显确认按钮）→ 确认布阵
  await clickPlaneCenter(page)
  await expect(bubble(page)).toContainText('点击“确认布阵”开始游戏', { timeout: 8000 })
  await expect(page.getByRole('button', { name: '确认布阵' })).toBeEnabled()
  await expectHit(page, '.tutorial-confirm', 'blocked', false)
  await page.getByRole('button', { name: '确认布阵' }).click()
}

/* ================= 单元3 ================= */

type Outcome = 'miss' | 'hit' | 'kill'
type ShotLog = Map<string, Outcome>

function isMyTurnStatus(st: string): boolean {
  const t = st.trim()
  return t.includes('轮到我方报点') || t.includes('绝地反击') || /^对方报点/.test(t)
}
async function gameEnded(page: Page): Promise<boolean> {
  return (await modal(page).count()) > 0
}
async function waitMyTurn(page: Page, timeoutMs = 25_000): Promise<void> {
  const status = page.locator('.game__status-text')
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await gameEnded(page)) return
    const st = (await status.textContent().catch(() => '')) ?? ''
    if (isMyTurnStatus(st)) return
    await page.waitForTimeout(120)
  }
  throw new Error('等待我方回合超时')
}
/** 我方回合报一个坐标（坐标输入一步）；接受任意「我方报点 X：结果」（含预报点自动上报） */
async function fireCoord(
  page: Page,
  coord: string,
): Promise<{ coord: string; outcome: Outcome } | null> {
  const input = page.getByLabel('报点坐标，如 A5')
  const status = page.locator('.game__status-text')
  await waitMyTurn(page)
  if (await gameEnded(page)) return null
  await input.fill(coord, { timeout: 3000 }).catch(() => {})
  await input.press('Enter', { timeout: 3000 }).catch(() => {})
  const toasts = await page.locator('.toast').allTextContents().catch(() => [])
  if (toasts.some((t) => t.includes('该格已经报过点了'))) return { coord, outcome: 'miss' as Outcome }
  for (let k = 0; k < 14; k++) {
    const st = (await status.textContent().catch(() => '')) ?? ''
    const m = /我方报点\s*([A-J]\d+)：(击空|击中|击毁)/.exec(st)
    if (m) {
      const outcome: Outcome = m[2] === '击空' ? 'miss' : m[2] === '击中' ? 'hit' : 'kill'
      return { coord: m[1]!, outcome }
    }
    if (await gameEnded(page)) return null
    await page.waitForTimeout(100)
  }
  return null
}
/**
 * 循环报点直至击杀数达标：对角扫描 + 「机身命中→机头候选猎杀」加速。
 * 对角序保证被击毁飞机在机头之前至少被扫到一个无歧义机身格 → 朝向可确定性推断。
 * 预报点队列非空时回合开始会自动上报（手动报点被禁），此处按实际上报坐标记账。
 */
async function shootUntil(page: Page, log: ShotLog, minKills: number, deadlineMs = 360_000): Promise<void> {
  const deadline = Date.now() + deadlineMs
  const order = diagCoords()
  const pending: string[] = []
  let idx = 0
  let guard = 0
  const kills = () => [...log.values()].filter((v) => v === 'kill').length
  while (Date.now() < deadline && kills() < minKills && guard++ < 400) {
    if (await gameEnded(page)) return
    let coord: string | undefined
    while (pending.length > 0) {
      const c = pending.shift()!
      if (!log.has(c)) {
        coord = c
        break
      }
    }
    if (!coord) {
      while (idx < order.length && log.has(order[idx]!)) idx += 1
      if (idx >= order.length) return
      coord = order[idx]!
    }
    const res = await fireCoord(page, coord)
    if (!res) {
      if (await gameEnded(page)) return
      await page.waitForTimeout(200)
      continue // 未出枪（预报点自动上报/回合未到）→ 重试
    }
    log.set(res.coord, res.outcome)
    if (res.outcome === 'hit') {
      for (const c of headCandidates(res.coord)) if (!log.has(c)) pending.push(c)
    }
  }
}
/** 判定真朝向候选集（真朝向必在其中；命中越多越可信） */
function inferRotations(head: { r: number; c: number }, hits: Array<{ r: number; c: number }>): number[] {
  const scores = [0, 1, 2, 3].map(
    (rot) =>
      hits.filter((h) => bodyOffsets(rot).some((o) => head.r + o.r === h.r && head.c + o.c === h.c)).length,
  )
  const max = Math.max(...scores)
  return scores.map((s, i) => (s === max ? i : -1)).filter((i) => i >= 0)
}
/** 混合模式断言：空网格可交互、参考网格/顶部面板被阻断、气泡与退出按钮可点 */
async function expectMixedModeInteractive(page: Page): Promise<void> {
  await expectHybrid(page)
  await expectHit(page, '.game__opp .paper-grid__board', 'blocked', false)
  await expectHit(page, '.game__ref', 'blocked', true)
  await expectHit(page, '.game__statusbar', 'blocked', true)
  await expectHit(page, '.tutorial-bubble', 'inBubble', true)
  await expectHit(page, '.tutorial-escape', 'inEscape', true)
}

/**
 * 单元3 开场链：断言 i1（纯整屏压暗）→ 可选 atI1 回调 → i2/i3 → i4（不可点击推进）→ 首个真实报点 → i6。
 * 返回时停在 i6（未点击读毕）。
 */
async function runUnit3Intro(
  page: Page,
  opts: { atI1?: () => Promise<void>; log?: ShotLog } = {},
): Promise<void> {
  await expect(bubble(page)).toContainText('现在，我们正式进入实战！', { timeout: 20_000 })
  await expectPureDim(page)
  await expectHit(page, '.tutorial-bubble', 'inBubble', true)
  await expectHit(page, '.tutorial-escape', 'inEscape', true)
  if (opts.atI1) await opts.atI1()
  await clickBubble(page) // → i2（突显我方网格）
  await expect(bubble(page)).toContainText('这是你刚才摆的阵型')
  await expectHit(page, '.game__mine', 'blocked', false)
  await clickBubble(page) // → i3（突显参考网格）
  await expect(bubble(page)).toContainText('这是参考网格')
  await expectHit(page, '.game__ref', 'blocked', false)
  await clickBubble(page) // → i4（等真实报点，不可点击推进）
  await expect(bubble(page)).toContainText('这是空网格，你需要通过双击报点来获得对方飞机的信息。试试看！')
  await expect(page.locator('.tutorial-bubble__hint')).toHaveCount(0)
  const t4 = await bubbleTextSafe(page)
  await bubble(page).click({ timeout: 3000 })
  await page.waitForTimeout(180)
  expect(await bubbleTextSafe(page), 'i4 点击不应推进节点').toBe(t4)
  await expect(page.locator('.game-banner')).toBeHidden({ timeout: 8000 })
  await expectHit(page, '.game__opp .paper-grid__board', 'blocked', false)
  // 首个真实报点（首杀可在此或之后触发支线）；结果计入报点账本
  const status = page.locator('.game__status-text')
  await dblclickCell(page, oppCell(page, 'A1'))
  for (let k = 0; k < 14; k++) {
    const st = (await status.textContent().catch(() => '')) ?? ''
    const m = /我方报点\s*([A-J]\d+)：(击空|击中|击毁)/.exec(st)
    if (m) {
      opts.log?.set(m[1]!, m[2] === '击空' ? 'miss' : m[2] === '击中' ? 'hit' : 'kill')
      break
    }
    await page.waitForTimeout(100)
  }
  await expect(bubble(page)).toContainText('好极了！运用你刚才学到的所有技巧', { timeout: 12_000 })
}

/** k1..k6 击毁支线（含 k2 幽灵三态与 k4 取消空网格突显） */
async function runUnit3KillBranch(page: Page, log: ShotLog): Promise<void> {
  // k1（混合模式）
  await expect(bubble(page)).toContainText('你成功摧毁了对方的飞机！', { timeout: 20_000 })
  await expectMixedModeInteractive(page)
  await clickBubble(page)
  // k2（等在空网格拖入幽灵；两段教学、不可点击推进）
  await expect(bubble(page)).toContainText('被击毁的飞机')
  await expect(page.locator('.tutorial-bubble__hint')).toHaveCount(0)
  await bubble(page).click({ timeout: 3000 })
  await page.waitForTimeout(150)
  const k2Now = await bubbleTextSafe(page)
  expect(k2Now.includes('尝试从参考网格处拖动飞机'), 'k2 点击只翻段、不推进节点').toBe(true)
  expect(k2Now.includes('飞机就在这里'), 'k2 不应跳到成功节点').toBe(false)

  const killCoords = [...log.entries()].filter(([, o]) => o === 'kill').map(([c]) => c)
  const head = coordToCell(killCoords[0]!)
  const hits = [...log.entries()]
    .filter(([, o]) => o === 'hit')
    .map(([c]) => coordToCell(c))
  const candidates = inferRotations(head, hits)
  const wrongRot = [0, 1, 2, 3].find((r) => !candidates.includes(r)) ?? (candidates[0]! + 1) % 4

  // ① 位置不符（none）：按住拖到机头不对的位置 → 既不成功也不提示；松手于参考区（不落子）
  // 宽幽灵可被判读为 rot0 或 rot2 两种朝向，两者推出的机头都必须 ≠ 真机头，才是纯「位置不符」
  const impliedHead = (vis: { r: number; c: number }, rot: number) => {
    const b = shapeBBox(rot)
    const h = headRelOf(rot)
    return { r: vis.r - b.minR + h.r, c: vis.c - b.minC + h.c }
  }
  await setRefRotation(page, 0)
  let noneVis: { r: number; c: number } | null = null
  for (let r = 0; r <= 5 && !noneVis; r++) {
    for (let c = 0; c <= 5 && !noneVis; c++) {
      const v = { r, c }
      const collides = [0, 2].some((rot) => {
        const h = impliedHead(v, rot)
        return h.r === head.r && h.c === head.c
      })
      if (!collides) noneVis = v
    }
  }
  if (!noneVis) throw new Error('找不到「机头不符」的演示落点')
  await placeGhostAt(page, noneVis, 0, { release: false })
  await page.waitForTimeout(320)
  const during = await bubbleTextSafe(page)
  expect(during.includes('飞机就在这里'), '位置不符不应成功').toBe(false)
  expect(during.includes('好像不太对'), '位置不符不应给失败提示').toBe(false)
  await releaseOverRef(page)
  expect((await bubbleTextSafe(page)).includes('好像不太对'), '松手于参考区不应落子提示').toBe(false)

  // ② 机头正确、朝向错（headOnly）→ 失败提示（按住期间持续检测不通过 → 松手给提示）
  await setRefRotation(page, wrongRot)
  await placeGhostAt(page, headMatchVis(head, wrongRot), wrongRot, { release: false })
  await page.waitForTimeout(320)
  const advancedByWrong = (await bubbleTextSafe(page)).includes('飞机就在这里')
  // 对角扫描保证被毁飞机在机头前有无歧义机身命中：候选集 <4 时 wrongRot 必非真解 → 失败分支必然覆盖
  if (candidates.length < 4) {
    expect(advancedByWrong, '候选集已知时首猜（错朝向）不应直接成功').toBe(false)
  }
  if (!advancedByWrong) {
    await page.mouse.up()
    await page.waitForTimeout(350)
    await expect(bubble(page)).toContainText('好像不太对，试试换个朝向吧。', { timeout: 8000 })
    await expect(page.locator('.tutorial-fx--failure')).toHaveCount(1)
  }

  // ③ 完全正确（exact）：依次尝试候选朝向 → 拖动中持续检测通过 → k3
  let exact = advancedByWrong
  for (const rot of [...candidates, 0, 1, 2, 3].filter((v, i, a) => a.indexOf(v) === i)) {
    if (exact) break
    if ((await bubbleTextSafe(page)).includes('飞机就在这里')) {
      exact = true
      break
    }
    await setRefRotation(page, rot)
    await placeGhostAt(page, headMatchVis(head, rot), rot, { release: true })
    await page.waitForTimeout(320)
    if ((await bubbleTextSafe(page)).includes('飞机就在这里')) exact = true
  }
  expect(exact, '幽灵应最终判定为完全正确').toBe(true)
  await expect(bubble(page)).toContainText('飞机就在这里！', { timeout: 8000 })
  await expect(page.locator('.tutorial-fx--success')).toHaveCount(1)
  await clickBubble(page) // k3 → k4

  // k4：进入着色教学时空网格已取消突显（仅突显着色按钮）
  await expect(bubble(page)).toContainText('接下来，试试点击着色工具按钮！', { timeout: 8000 })
  await expectHit(page, '.game__opp .paper-grid__board', 'blocked', true)
  const colorBtn = page.locator('.coloring-stage__btn .coloring-btn')
  await expect(colorBtn).toBeVisible()
  await expectHit(page, '.coloring-stage__btn .coloring-btn', 'blocked', false)
  await colorBtn.click()
  await expect(colorBtn).toHaveAttribute('aria-pressed', 'true')

  // k5：着色模式下点击幽灵 → 整机批染 + 回收
  await expect(bubble(page)).toContainText('现在，试试点击你刚才摆放的飞机！', { timeout: 8000 })
  const ghost = page.locator('.game__opp .paper-grid__plane[data-plane-id]').last()
  const gb = await ghost.boundingBox()
  if (!gb) throw new Error('幽灵不可见')
  await page.mouse.click(gb.x + gb.width / 2, gb.y + gb.height / 2)
  await expect(bubble(page)).toContainText('现在，你学会了如何标记被击毁的飞机。继续寻找剩下的所有飞机吧！', {
    timeout: 8000,
  })
  await expect(colorBtn).toHaveAttribute('aria-pressed', 'false')
  await clickBubble(page) // k6 读毕 → 本支线结束
}

/* ================= 用例 ================= */

test.describe('新手教程', () => {
  test('主链：还不了解 → 单元1 全练习（居中/预置标记/幽灵）→ 单元2 摆阵 → 单元3 开场与退出', async ({
    page,
  }) => {
    test.setTimeout(300_000)
    const errs = watchErrors(page)

    await openTutorial(page)
    await modal(page).getByRole('button', { name: '还不了解' }).click()
    await runUnit1(page)
    await runUnit2(page)

    // 单元3 开场：i1 突显期「← 退出」真实可点（M4）→ 弹窗（阻断带 0）→ 继续对局 → 阻断带恢复
    await runUnit3Intro(page, {
      atI1: async () => {
        await page.getByRole('button', { name: '← 退出' }).click()
        await expect(modal(page)).toContainText('确认退出对局？')
        expect(await blockCount(page), '弹窗打开时阻断带应为 0').toBe(0)
        await modal(page).getByRole('button', { name: '继续对局' }).click()
        await expect(modal(page)).toHaveCount(0)
        await expect(page.locator('.tutorial-block')).not.toHaveCount(0)
        await expect(bubble(page)).toContainText('现在，我们正式进入实战！')
      },
    })

    // i6 纯压暗：对局内「← 退出」→ 确认退出 → 主页
    await expect(bubble(page)).toContainText('好极了！运用你刚才学到的所有技巧')
    await expectPureDim(page)
    await page.getByRole('button', { name: '← 退出' }).click()
    await expect(modal(page)).toContainText('确认退出对局？')
    expect(await blockCount(page)).toBe(0)
    await modal(page).getByRole('button', { name: '确认退出' }).click()
    await expect(page.getByRole('heading', { name: '飞机杀' })).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('.tutorial-bubble')).toHaveCount(0)

    expect(errs()).toEqual([])
  })

  test('我已了解 → 单元2 → 单元3：首杀支线（幽灵三态/着色）+ 自然结束完成提示返回主页', async ({ page }) => {
    test.setTimeout(600_000)
    const errs = watchErrors(page)
    const log: ShotLog = new Map()

    await openTutorial(page)
    await modal(page).getByRole('button', { name: '我已了解' }).click()
    await runUnit2(page)
    await runUnit3Intro(page, { log })
    await clickBubble(page) // i6 读毕 → 自由对局（首杀支线若已排队则立即开播）

    // 首杀 → k1..k6
    await shootUntil(page, log, 1)
    await runUnit3KillBranch(page, log)

    // 继续清剿直至自然结束（教程对局 AI 避机头，只能由我方全歼结束）
    await shootUntil(page, log, 3)
    await expect(modal(page)).toContainText('教程完成', { timeout: 60_000 })
    await expect(modal(page)).toContainText('本局对局已结束，恭喜完成新手教程！')
    // 完成提示仅提供「返回主页」（不再有「继续对局」/「完成教程」）
    await expect(modal(page).getByRole('button', { name: '返回主页' })).toHaveCount(1)
    await expect(modal(page).getByRole('button', { name: '继续对局' })).toHaveCount(0)
    await expect(modal(page).getByRole('button', { name: '完成教程' })).toHaveCount(0)
    await modal(page).getByRole('button', { name: '返回主页' }).click()
    await expect(page.getByRole('heading', { name: '飞机杀' })).toBeVisible({ timeout: 10_000 })

    expect(errs()).toEqual([])
  })

  test('我已了解 → 单元3：预报点支线先播（p1 混合模式）→ 首杀支线后播（顺序无关）→ 退出主页', async ({
    page,
  }) => {
    test.setTimeout(420_000)
    const errs = watchErrors(page)
    const log: ShotLog = new Map()

    await openTutorial(page)
    await modal(page).getByRole('button', { name: '我已了解' }).click()
    await runUnit2(page)
    await runUnit3Intro(page, { log })
    await clickBubble(page) // i6 → 自由对局

    // 对手回合内创建预报点（`--theirs` 回合色边框为回合信号）→ p1 先播
    const input = page.getByLabel('报点坐标，如 A5')
    const prefire = page.locator('.game__opp .paper-grid__stamp .prefire-mark')
    const n16Text = '你刚才看见的红色'
    let created = false
    for (let attempt = 0; attempt < 10 && !created; attempt++) {
      if ((await bubbleTextSafe(page)).includes(n16Text)) break
      const oppCls = (await page.locator('.game__opp').getAttribute('class')) ?? ''
      if (!oppCls.includes('game__opp--theirs')) {
        await page.waitForTimeout(150)
        continue
      }
      const coord = diagCoords().find((c) => c !== 'A1')!
      await input.fill(coord, { timeout: 2000 }).catch(() => {})
      await input.press('Enter', { timeout: 2000 }).catch(() => {})
      await page.waitForTimeout(250)
      created = (await prefire.count()) > 0 || (await bubbleTextSafe(page)).includes(n16Text)
    }
    expect(created, '应能在对手回合创建预报点').toBe(true)
    // p1：混合模式（整屏压暗 + 空网格开洞 + 气泡豁免）+ 5 段
    await expect(bubble(page)).toContainText('你刚才看见的红色“？”是预报点标记。', { timeout: 10_000 })
    await expectMixedModeInteractive(page)
    for (let k = 0; k < 6; k++) {
      if ((await bubbleTextSafe(page)).includes('预报点标记最多可以同时存在10个。')) break
      await clickBubble(page)
      await page.waitForTimeout(120)
    }
    await expect(bubble(page)).toContainText('预报点标记最多可以同时存在10个。')
    await clickBubble(page) // 读毕 → 本支线结束

    // 随后触发首杀 → k1 播报（验证两条支线触发顺序无关）
    await shootUntil(page, log, 1)
    await expect(bubble(page)).toContainText('你成功摧毁了对方的飞机！', { timeout: 20_000 })
    await expectMixedModeInteractive(page)

    // 收尾：对局内退出直达主页
    await page.getByRole('button', { name: '← 退出' }).click()
    await expect(modal(page)).toContainText('确认退出对局？')
    await modal(page).getByRole('button', { name: '确认退出' }).click()
    await expect(page.getByRole('heading', { name: '飞机杀' })).toBeVisible({ timeout: 10_000 })

    expect(errs()).toEqual([])
  })

  test('突显为模态：非突显区不可点、气泡/退出可点、弹窗期阻断带为 0（单元1/单元2）', async ({ page }) => {
    test.setTimeout(180_000)
    const errs = watchErrors(page)

    // 单元1：纯压暗 → 阻断带拦截非突显区；气泡可点；「← 退出教程」直达主页
    await openTutorial(page)
    await modal(page).getByRole('button', { name: '还不了解' }).click()
    await expect(page.getByRole('heading', { name: '新手教程 · 辨认飞机' })).toBeVisible({ timeout: 10_000 })
    await expect(bubble(page)).toContainText('欢迎来到《飞机杀》！', { timeout: 10_000 })
    expect(await blockCount(page)).toBeGreaterThan(0)
    const before = await bubbleTextSafe(page)
    await clickBlockedArea(page)
    await expect(bubble(page)).toHaveText(before)
    await clickBubble(page)
    await expect(bubble(page)).toContainText('在正式开始游戏之前，我们先来做几个练习吧！')
    await page.getByRole('button', { name: '← 退出教程' }).click()
    await expect(page.getByRole('heading', { name: '飞机杀' })).toBeVisible({ timeout: 10_000 })

    // 单元2：突显期真实点击退出 → 弹窗（阻断带 0）→ 继续摆阵（阻断带恢复）→ 确认退出直达主页
    await page.getByRole('button', { name: '新手教程' }).click()
    await modal(page).getByRole('button', { name: '我已了解' }).click()
    await expect(page.getByRole('heading', { name: '新手教程 · 摆阵' })).toBeVisible({ timeout: 10_000 })
    await expect(bubble(page)).toContainText('很好！接下来我们即将进入实战！', { timeout: 10_000 })
    await expectPureDim(page)
    const before2 = await bubbleTextSafe(page)
    await clickBlockedArea(page)
    await expect(bubble(page)).toHaveText(before2)
    await clickBubble(page)
    await expect(bubble(page)).toContainText('首先要做的一件事是')
    await page.getByRole('button', { name: '← 退出教程' }).click()
    await expect(modal(page)).toContainText('退出教程？')
    expect(await blockCount(page), '弹窗打开时阻断带应为 0').toBe(0)
    await modal(page).getByRole('button', { name: '继续摆阵' }).click()
    await expect(modal(page)).toHaveCount(0)
    await expect(page.locator('.tutorial-block')).not.toHaveCount(0)
    await page.getByRole('button', { name: '← 退出教程' }).click()
    await expect(modal(page)).toContainText('退出教程？')
    await modal(page).getByRole('button', { name: '确认退出' }).click()
    await expect(page.getByRole('heading', { name: '飞机杀' })).toBeVisible({ timeout: 10_000 })

    expect(errs()).toEqual([])
  })
})
