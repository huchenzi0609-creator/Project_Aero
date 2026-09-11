/**
 * tutorial.spec —— 新手教程 e2e（v0.3.13 教程整体重写）。
 *
 * 新结构：入口 → 单元1 辨认飞机（5×5 演示 + 两个 10×10 练习场景）
 *        → 单元2 摆阵（复用摆阵组件）→ 单元3 初次实战对局（GameScreen + 幽灵标记 + 着色 + 预报点）。
 *
 * 覆盖：
 * 1) 主链（还不了解）：单元1 五×五演示 → 场景2 先错点（失败提示）再 E5（成功提示 + 幽灵）；
 *    场景3 J7（失败分支文案）→ F7（命中）→ 单元2 开场 4 段（首行逐字）→ 拖 3 架（成功提示）
 *    → 旋转 → 合法 → 确认布阵 → 单元3 n1–n4 突显序列 → 首次报点 → 对局内「← 退出」二次确认 → 主页；
 * 2) 我已了解 → 单元2 → 单元3 完整工具链：首次报点 → 真实击毁（循环报点直至 kill，AI 避机头 1s 间隔）
 *    → 幽灵标记（先错朝向：失败提示；再正确：成功提示）→ n11 → 着色按钮 → 着色点击幽灵
 *    → 预报点教学（对手回合两次点击）→ 完成弹窗「继续对局」free → 确认退出直达主页；
 * 3) 突显模态（v0.3.13 弹窗阻断修复复验）：非突显区域不可点（命中 .tutorial-block）、气泡可点；
 *    突显期间「← 退出教程」/ 对局内「← 退出」均【真实点击】可用；弹窗打开时 .tutorial-block == 0，
 *    关闭后阻断带恢复；单元1 退出直达主页、单元2 突显期二次确认（继续摆阵保留 / 确认退出直达主页）、
 *    单元3 n1 突显期「← 退出」→ 确认退出直达主页；
 * 4) 成功/失败边带（.tutorial-fx--success / --failure）出现断言。
 *
 * 全程 console 零 error。
 */
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { allCoords, oppCell, watchErrors } from './helpers'


/* ---------------- 通用定位/断言 ---------------- */

function modal(page: Page) {
  return page.locator('.paper-modal__dialog')
}
function bubble(page: Page) {
  return page.locator('.tutorial-bubble__text')
}
function spotlight(page: Page) {
  return page.locator('.tutorial-spotlight')
}
/** 单层 svg 中的开洞数（path d 中 ' M' 子路径计数） */
async function spotlightHoles(page: Page): Promise<number> {
  const d = await page.locator('.tutorial-spotlight path').getAttribute('d').catch(() => null)
  if (!d) return 0
  return (d.match(/ M/g) ?? []).length
}
/** 气泡突显 = 整屏暗层 .tutorial-spotlight--dim（无 svg 洞；气泡 z 豁免） */
async function expectSpotlightDim(page: Page): Promise<void> {
  await expect(page.locator('.tutorial-spotlight--dim')).toHaveCount(1)
  await expect(page.locator('.tutorial-spotlight:not(.tutorial-spotlight--dim)')).toHaveCount(0)
  await expect(bubble(page)).toBeVisible()
}
/** 安全读取气泡文本：气泡可能不存在（等待步/瞬态步）→ 先 count 再带短超时读取 */
async function bubbleTextSafe(page: Page): Promise<string> {
  if ((await bubble(page).count()) === 0) return ''
  return (await bubble(page).textContent({ timeout: 1000 }).catch(() => '')) ?? ''
}
async function clickBubble(page: Page, timeout = 10_000): Promise<void> {
  await expect(bubble(page)).toBeVisible({ timeout })
  await bubble(page).click({ timeout: 3000 })
}
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 14 })
  await page.mouse.up()
}
/** 同格两次点击（<600ms）= 教程练习网格的「双击」语义 */
async function dblclickCell(page: Page, loc: ReturnType<Page['locator']>) {
  await loc.click({ timeout: 2500 })
  await page.waitForTimeout(90)
  await loc.click({ timeout: 2500 })
}
/** 点击被 .tutorial-block 阻断的区域（当前突显之外的空白带），用于验证模态不可点 */
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
  // 取该阻断带靠上位置（避开底部气泡与左上退出按钮）
  await page.mouse.click(best.x + best.w / 2, best.y + 8)
}
async function openTutorial(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '飞机杀' })).toBeVisible()
  await page.getByRole('button', { name: '新手教程' }).click()
  await expect(modal(page)).toContainText('您是否了解本游戏的基本规则？')
}

/* ---------------- 单元1 ---------------- */

/** 单元1 全练习：s1a/s1b → 场景2（错点失败 + E5 成功）→ 场景3（J7 失败分支 + F7 命中）→ 单元2 */
async function runUnit1(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: '新手教程 · 辨认飞机' })).toBeVisible({ timeout: 10_000 })
  // s1a：5×5 演示（整屏压暗突出气泡）
  await expect(bubble(page)).toContainText('欢迎来到《飞机杀》！', { timeout: 10_000 })
  await expectSpotlightDim(page)
  await clickBubble(page)
  await expect(bubble(page)).toContainText('在正式开始游戏之前，我们先来做几个练习吧！')
  await clickBubble(page) // → s1b
  // s1b：突显演示网格
  await expect(bubble(page)).toContainText('请记住图上飞机的样式')
  await expect(spotlight(page)).toHaveCount(1)
  await clickBubble(page)
  await expect(bubble(page)).toContainText('记住了吗？')
  await clickBubble(page) // → 场景2
  // 场景2：先故意点错 → 失败提示；再双击 E5 → 成功提示 + 幽灵飞机
  await expect(bubble(page)).toContainText('试着双击可能的')
  const grid = page.locator('.u1-grid')
  await dblclickCell(page, grid.locator('button[aria-label="A1"]'))
  await expect(bubble(page)).toContainText('机头不在这里，想想飞机的形状！', { timeout: 8000 })
  await expect(page.locator('.tutorial-fx--failure')).toHaveCount(1)
  await dblclickCell(page, grid.locator('button[aria-label="E5"]'))
  await expect(bubble(page)).toContainText('致命打击！干得漂亮！', { timeout: 8000 })
  await expect(page.locator('.tutorial-fx--success')).toHaveCount(1)
  await expect(page.locator('.u1-grid .paper-grid__plane--ghost')).toHaveCount(1)
  await clickBubble(page) // → 场景3 s3a
  // 场景3：歧义讲解 → J7 失败分支 → F7 命中
  await expect(bubble(page)).toContainText('在这种情况下，我们不能完全确定机头位置呢。')
  await clickBubble(page)
  await expect(bubble(page)).toContainText('机头可能在F7，也可能在J7。')
  await clickBubble(page) // → s3j7
  await expect(bubble(page)).toContainText('我们需要更多的信息。试着双击J7！')
  await dblclickCell(page, grid.locator('button[aria-label="J7"]'))
  await expect(bubble(page)).toContainText('看来机头不在这里，试试另一个吧！', { timeout: 8000 })
  await clickBubble(page) // → s3f7
  await expect(bubble(page)).toContainText('试试双击F7！')
  await dblclickCell(page, grid.locator('button[aria-label="F7"]'))
  await expect(bubble(page)).toContainText('恭喜！你成功锁定了机头的位置！', { timeout: 8000 })
  await expect(page.locator('.u1-grid')).toHaveCount(2) // 目标机揭示网格
  await clickBubble(page) // → 单元2
}

/* ---------------- 单元2 ---------------- */

/** 从摆阵页把一张待选牌拖到「可视左上角格 = (r,c)」 */
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
  await page.waitForTimeout(200)
}

/** 单元2：从头（开场任意段）推进到 thanks 阶段（此时无突显遮罩） */
async function advanceUnit2ToThanks(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: '新手教程 · 摆阵' })).toBeVisible({ timeout: 10_000 })
  // 开场 4 段：逐段点击直至进入待选栏（容忍从任意段进入）
  for (let k = 0; k < 8; k++) {
    const t = await bubbleTextSafe(page)
    if (t.includes('这是飞机待选栏')) break
    await clickBubble(page)
    await page.waitForTimeout(80)
  }
  await expect(bubble(page)).toContainText('这是飞机待选栏，可以从这里把飞机拖到网格中。')
  await expect(spotlight(page)).toHaveCount(1)
  await expect.poll(() => spotlightHoles(page), { timeout: 8000 }).toBeGreaterThanOrEqual(1)
  await clickBubble(page) // → drag
  await expect(bubble(page)).toContainText('现在就试试看吧！把飞机拖到网格里！')
  // 拖入第 1 架 → 成功提示 + 续拖
  await dragDeckCardTo(page, 2, 0)
  await expect(bubble(page)).toContainText('好极了！现在尝试把剩余的飞机全部拖到网格里！', { timeout: 8000 })
  await expect(page.locator('.tutorial-fx--success')).toHaveCount(1)
  // 拖完全部 → 成功提示 + 旋转引导
  await dragDeckCardTo(page, 2, 5)
  await dragDeckCardTo(page, 6, 5)
  await expect(page.locator('.placement__plane')).toHaveCount(3, { timeout: 8000 })
  await expect(bubble(page)).toContainText('单击飞机可以使飞机旋转90度，试试看！', { timeout: 8000 })
  await expectSpotlightDim(page) // rotateHint：气泡整屏暗层
  await clickBubble(page) // → rotateWait（突显待选栏 + 网格）
  await expect(bubble(page)).toContainText('单击飞机可以使飞机旋转90度，试试看！')
  await expect(spotlight(page)).toHaveCount(1)
  // 旋转 → thanks 常驻（无突显 → 无 .tutorial-block）
  await clickPlaneCenter(page)
  await expect(bubble(page)).toContainText('太棒了！确保你的飞机不重叠不越界之后，就可以开始游戏了！', {
    timeout: 8000,
  })
  await expect(page.locator('.tutorial-block')).toHaveCount(0)
}

/** 单元2 完整摆阵：开场 4 段（逐字核对首行）→ 待选栏 → 拖 3 架 → 旋转 → 合法 → 确认布阵 → 单元3 */
async function runUnit2(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: '新手教程 · 摆阵' })).toBeVisible({ timeout: 10_000 })
  // 开场首行逐字核对
  await expect(bubble(page)).toContainText('很好！接下来我们即将进入实战！', { timeout: 10_000 })
  await expectSpotlightDim(page)
  await clickBubble(page)
  await expect(bubble(page)).toContainText('首先要做的一件事是')
  await clickBubble(page)
  await expect(bubble(page)).toContainText('对手将尝试破解我方阵型')
  await clickBubble(page)
  await expect(bubble(page)).toContainText('在真实对局中，一个好的阵型可以充分地迷惑对手，为我方取得优势！')
  await advanceUnit2ToThanks(page)
  // 再次变化 → 合法性检测（阵型合法 → 突显确认按钮）
  await clickPlaneCenter(page)
  await expect(bubble(page)).toContainText('点击“确认布阵”开始游戏', { timeout: 8000 })
  await expect(page.getByRole('button', { name: '确认布阵' })).toBeEnabled()
  await expect(spotlight(page)).toHaveCount(1)
  await page.getByRole('button', { name: '确认布阵' }).click()
}

/* ---------------- 单元3 ---------------- */

function cellOf(coord: string) {
  return { r: Number(coord.slice(1)) - 1, c: coord.charCodeAt(0) - 65 }
}

/** 我方回合判定：状态条「轮到我方报点」/「对方报点 X：…」（AI 已回应）；排除「等待对方报点…」 */
function isMyTurnStatus(st: string): boolean {
  const t = st.trim()
  return t.includes('轮到我方报点') || t.includes('绝地反击') || /^对方报点/.test(t)
}
async function waitMyTurn(page: Page, timeoutMs = 20_000): Promise<void> {
  const statusText = page.locator('.game__status-text')
  const n8 = bubble(page).filter({ hasText: '你成功摧毁了对方的飞机！' })
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if ((await n8.count()) > 0) return
    const st = (await statusText.textContent().catch(() => '')) ?? ''
    if (isMyTurnStatus(st)) return
    await page.waitForTimeout(120)
  }
  throw new Error('等待我方回合超时')
}

/** 单元3 n1–n4 突显序列 → 首次报点（双击）→ n6（无突显） */
async function runUnit3ToFirstShot(page: Page): Promise<void> {
  await expect(bubble(page)).toContainText('现在，我们正式进入实战！', { timeout: 20_000 })
  await expectSpotlightDim(page)
  await clickBubble(page) // n2 我方网格
  await expect(bubble(page)).toContainText('这是你刚才摆的阵型')
  await expect(spotlight(page)).toHaveCount(1)
  await clickBubble(page) // n3 参考网格
  await expect(bubble(page)).toContainText('这是参考网格')
  await expect(spotlight(page)).toHaveCount(1)
  await clickBubble(page) // n4 空网格
  await expect(bubble(page)).toContainText('这是空网格，你需要通过双击报点来获得对方飞机的信息。试试看！')
  await expect(spotlight(page)).toHaveCount(1)
  await clickBubble(page) // n5 等首次报点（无气泡）
  await expect(bubble(page)).toBeHidden({ timeout: 8000 })
  await expect(page.locator('.game-banner')).toBeHidden({ timeout: 8000 })
  await dblclickCell(page, oppCell(page, 'A1'))
  await expect(bubble(page)).toContainText('好极了！运用你刚才学到的所有技巧', { timeout: 10_000 })
}

/** 循环报点直至首次击毁（真实 kill）；返回机头坐标 */
async function shootUntilOppKill(page: Page, shotSet: Set<string>): Promise<string> {
  const input = page.getByLabel('报点坐标，如 A5')
  const statusText = page.locator('.game__status-text')
  const n8 = bubble(page).filter({ hasText: '你成功摧毁了对方的飞机！' })
  const deadline = Date.now() + 200_000
  let kill: string | null = null
  for (const coord of allCoords(10, 10)) {
    if (shotSet.has(coord)) continue
    if ((await n8.count()) > 0) break
    if (Date.now() > deadline) break
    await waitMyTurn(page)
    if ((await n8.count()) > 0) break
    await input.fill(coord)
    await input.press('Enter')
    shotSet.add(coord)
    for (let k = 0; k < 12; k++) {
      const st = (await statusText.textContent().catch(() => '')) ?? ''
      const m = /我方报点\s*([A-J]\d+)：击毁/.exec(st)
      if (m) {
        kill = m[1]!
        break
      }
      if ((await n8.count()) > 0) break
      await page.waitForTimeout(120)
    }
    if (kill || (await n8.count()) > 0) break
  }
  await expect(n8).toBeVisible({ timeout: 15_000 })
  if (!kill) throw new Error('未能解析首次击毁坐标（无法进行幽灵标记）')
  return kill
}

/**
 * 幽灵标记朝向/位置推导（默认形状 5×5 归一化旋转）：
 * origin = 机头 - headRel(rot)；vis(可视左上角) = origin + min(rot) = 机头 - headRel + min。
 * 落点格 → 可视左上角 的吸附偏移为 (⌈h/2⌉-1, ⌈w/2⌉-1)（参考网格与对手棋盘格宽不同所致，
 * 由 v0.3.13 实测标定）；dragToVis 还会读回幽灵实际 left/top 做一次纠偏，保证落点精确。
 */
const ROT_INFO: Record<number, { minR: number; minC: number; h: number; w: number; headR: number; headC: number }> = {
  0: { minR: 0, minC: 0, h: 4, w: 5, headR: 0, headC: 2 },
  1: { minR: 0, minC: 1, h: 5, w: 4, headR: 2, headC: 4 },
  2: { minR: 1, minC: 0, h: 4, w: 5, headR: 4, headC: 2 },
  3: { minR: 0, minC: 0, h: 5, w: 4, headR: 2, headC: 0 },
}
function requiredVis(head: { r: number; c: number }, rot: number) {
  const i = ROT_INFO[rot]!
  return { r: head.r - i.headR + i.minR, c: head.c - i.headC + i.minC }
}
function dropCellFor(vis: { r: number; c: number }, rot: number) {
  const i = ROT_INFO[rot]!
  return { r: vis.r + Math.ceil(i.h / 2) - 1, c: vis.c + Math.ceil(i.w / 2) - 1 }
}
/** 对手棋盘上最后一只幽灵的可视左上角格位（无则 null） */
async function actualGhostVis(page: Page): Promise<{ r: number; c: number } | null> {
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
/** 从参考飞机拖一只幽灵到「可视左上角 = vis」（含读回纠偏，≤3 次） */
async function dragGhostToVis(page: Page, vis: { r: number; c: number }, rot: number): Promise<void> {
  const refPlane = page.locator('.game__ref .paper-grid__plane')
  const board = page.locator('.game__opp .paper-grid__board')
  let drop = dropCellFor(vis, rot)
  for (let attempt = 0; attempt < 3; attempt++) {
    const rb = await refPlane.boundingBox()
    const bb = await board.boundingBox()
    if (!rb || !bb) throw new Error('参考飞机/对手棋盘不可见')
    const cell = bb.width / 10
    await drag(
      page,
      { x: rb.x + rb.width / 2, y: rb.y + rb.height / 2 },
      { x: bb.x + (drop.c + 0.5) * cell, y: bb.y + (drop.r + 0.5) * cell },
    )
    await page.waitForTimeout(320)
    const act = await actualGhostVis(page)
    if (act && act.r === vis.r && act.c === vis.c) return
    if (!act) return // 落点被拒（如重叠）：交由调用方处理
    drop = { r: drop.r + (vis.r - act.r), c: drop.c + (vis.c - act.c) }
    await removeGhosts(page)
  }
}

async function rotateRefTo(page: Page, curRot: number, target: number): Promise<number> {
  const refPlane = page.locator('.game__ref .paper-grid__plane')
  let cur = curRot
  const need = (target - cur + 4) % 4
  for (let k = 0; k < need; k++) {
    const b = await refPlane.boundingBox()
    if (!b) throw new Error('参考飞机不可见')
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2)
    await page.waitForTimeout(150)
    cur = (cur + 1) % 4
  }
  return cur
}

/** 把错误幽灵拖回参考区移除，避免后续尝试互相重叠被拒 */
async function removeGhosts(page: Page): Promise<void> {
  const ghosts = page.locator('.game__opp .paper-grid__plane[data-plane-id]')
  for (let guard = 0; guard < 8 && (await ghosts.count()) > 0; guard++) {
    const g = ghosts.first()
    const gb = await g.boundingBox().catch(() => null)
    const ref = await page.locator('.game__ref').boundingBox()
    if (!gb || !ref) return
    await drag(
      page,
      { x: gb.x + gb.width / 2, y: gb.y + gb.height / 2 },
      { x: ref.x + ref.width / 2, y: ref.y + ref.height / 2 },
    )
    await page.waitForTimeout(250)
  }
}

/** n10：幽灵标记（先错朝向 → 失败提示；再按真位/真朝向 → 成功）；返回已执行的错误尝试次数 */
async function markGhost(page: Page, head: { r: number; c: number }): Promise<{ failedTries: number }> {
  const refPlane = page.locator('.game__ref .paper-grid__plane')
  const board = page.locator('.game__opp .paper-grid__board')
  let curRot = 0
  let failedTries = 0
  const candidates: number[] = []
  for (const rot of [0, 1, 2, 3]) {
    const i = ROT_INFO[rot]!
    const vis = requiredVis(head, rot)
    if (vis.r < 0 || vis.c < 0 || vis.r > 10 - i.h || vis.c > 10 - i.w) continue
    candidates.push(rot)
  }
  // 先制造一次「朝向/位置错」的失败提示：取第一个候选、落点整体下移一格
  const firstRot = candidates[0] ?? 0
  curRot = await rotateRefTo(page, curRot, firstRot)
  {
    const vis = requiredVis(head, firstRot)
    const drop = dropCellFor(vis, firstRot)
    const rb = await refPlane.boundingBox()
    const bb = await board.boundingBox()
    if (!rb || !bb) throw new Error('参考飞机/对手棋盘不可见')
    const cell = bb.width / 10
    await drag(
      page,
      { x: rb.x + rb.width / 2, y: rb.y + rb.height / 2 },
      { x: bb.x + (drop.c + 0.5) * cell, y: bb.y + (drop.r + 1 + 0.5) * cell },
    )
    await page.waitForTimeout(400)
    if (!(await bubbleTextSafe(page)).includes('飞机就在这里')) {
      failedTries += 1
      await expect(bubble(page)).toContainText('好像不太对，试试换个朝向吧。', { timeout: 8000 })
      await expect(page.locator('.tutorial-fx--failure')).toHaveCount(1)
      await removeGhosts(page)
    }
  }
  // 正确尝试：候选朝向依次试（真位落点 + 读回纠偏）
  for (const rot of candidates) {
    const t = await bubbleTextSafe(page)
    if (t.includes('飞机就在这里')) return { failedTries }
    curRot = await rotateRefTo(page, curRot, rot)
    await dragGhostToVis(page, requiredVis(head, rot), rot)
    const after = await bubbleTextSafe(page)
    if (after.includes('飞机就在这里')) return { failedTries }
    failedTries += 1
    await removeGhosts(page)
  }
  throw new Error('幽灵标记未通过（全部朝向已尝试）')
}

/** 单元3 工具链：幽灵标记 → n11 → 着色 → n13 → n14 → 预报点 n15 → n16 完成弹窗 */
async function runUnit3Toolchain(page: Page): Promise<void> {
  const shotSet = new Set<string>(['A1'])
  const killCoord = await shootUntilOppKill(page, shotSet)
  // n8：击毁教学（成功边带）
  await expect(page.locator('.tutorial-fx--success')).toHaveCount(1)
  await clickBubble(page) // n9
  await expect(bubble(page)).toContainText('被击毁的飞机')
  await clickBubble(page)
  await expect(bubble(page)).toContainText('尝试从参考网格处拖动飞机')
  await clickBubble(page) // → n10（等待幽灵创建）
  await expect(bubble(page)).toBeHidden({ timeout: 8000 })
  const { failedTries } = await markGhost(page, cellOf(killCoord))
  expect(failedTries).toBeGreaterThanOrEqual(1) // 至少覆盖一次「朝向/位置错」失败分支
  await expect(bubble(page)).toContainText('飞机就在这里！', { timeout: 8000 })
  await expect(page.locator('.tutorial-fx--success')).toHaveCount(1)
  await clickBubble(page) // n11 → n12（突显着色按钮）

  // n12：点击着色工具按钮 → 进入着色
  await expect(bubble(page)).toContainText('接下来，试试点击着色工具按钮！', { timeout: 8000 })
  const colorBtn = page.locator('.coloring-stage__btn .coloring-btn')
  await expect(colorBtn).toBeVisible()
  await colorBtn.click()
  await expect(colorBtn).toHaveAttribute('aria-pressed', 'true')

  // n13：着色模式下点击幽灵 → 整机批染 + 回收
  await expect(bubble(page)).toContainText('现在，试试点击你刚才摆放的飞机！', { timeout: 8000 })
  const ghost = page.locator('.game__opp .paper-grid__plane[data-plane-id]').last()
  const gb = await ghost.boundingBox()
  if (!gb) throw new Error('幽灵不可见')
  await page.mouse.click(gb.x + gb.width / 2, gb.y + gb.height / 2)
  await expect(bubble(page)).toContainText('现在，你学会了如何标记被击毁的飞机。', { timeout: 8000 })
  await expect(page.locator('.game__opp .paper-grid__plane[data-plane-id]')).toHaveCount(0)
  await expect(colorBtn).toHaveAttribute('aria-pressed', 'false')
  await clickBubble(page) // n14 → n15（预报点，暂停 AI）

  // n15：预报点教学——对手回合「两次点击」创建（手稿语义）；若逢我方回合，第 1 次双击 = 出枪交 AI
  const prefire = page.locator('.game__opp .paper-grid__stamp .prefire-mark')
  const prefireInput = page.getByLabel('报点坐标，如 A5')
  const n16Text = '你刚才看见的红色'
  const n16Reached = async () => (await bubbleTextSafe(page)).includes(n16Text)
  let attempts = 0
  for (const coord of allCoords(10, 10)) {
    if ((await prefire.count()) > 0) break
    if (await n16Reached()) break
    if (shotSet.has(coord)) continue
    shotSet.add(coord)
    await dblclickCell(page, oppCell(page, coord))
    await page.waitForTimeout(320)
    attempts += 1
    if (attempts >= 4) break
  }
  // 兜底：点击竞态未落定时，用坐标输入一步创建（同一 preFireCreated 事件）
  if ((await prefire.count()) === 0 && !(await n16Reached())) {
    for (const coord of allCoords(10, 10)) {
      if ((await prefire.count()) > 0 || (await n16Reached())) break
      if (shotSet.has(coord)) continue
      shotSet.add(coord)
      await prefireInput.fill(coord, { timeout: 3000 }).catch(() => {})
      await prefireInput.press('Enter', { timeout: 3000 }).catch(() => {})
      await page.waitForTimeout(320)
      attempts += 1
      if (attempts >= 6) break
    }
  }
  await expect(bubble(page)).toContainText('你刚才看见的红色“？”是预报点标记。', { timeout: 10_000 })
  expect(await prefire.count()).toBeGreaterThanOrEqual(1)
  await expectSpotlightDim(page)

  // n16：5 段读毕 → 完成弹窗
  for (let k = 0; k < 8; k++) {
    if ((await modal(page).filter({ hasText: '教程已完成' }).count()) > 0) break
    await clickBubble(page)
    await page.waitForTimeout(120)
  }
  await expect(modal(page)).toContainText('教程已完成，是否完成对局？')
  await expect(modal(page)).toContainText('完成教程')
  await expect(modal(page)).toContainText('继续对局')
}

/* ---------------- 用例 ---------------- */

test.describe('新手教程', () => {
  test('主链：还不了解 → 单元1 全练习 → 单元2 完整摆阵 → 单元3 首次报点 → 对局内退出回主页', async ({
    page,
  }) => {
    test.setTimeout(240_000)
    const errs = watchErrors(page)

    await openTutorial(page)
    await modal(page).getByRole('button', { name: '还不了解' }).click()
    await runUnit1(page)
    await runUnit2(page)
    await runUnit3ToFirstShot(page)

    // n6 无突显（无阻断）→ 对局内退出可用：二次确认 → 主页
    await expect(page.locator('.tutorial-block')).toHaveCount(0)
    await expect(page.locator('.game__opp .paper-grid__stamp').first()).toBeVisible()
    await page.getByRole('button', { name: '← 退出' }).click()
    await expect(modal(page)).toContainText('确认退出对局？')
    await modal(page).getByRole('button', { name: '确认退出' }).click()
    await expect(page.getByRole('heading', { name: '飞机杀' })).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('.tutorial-bubble')).toHaveCount(0)

    expect(errs()).toEqual([])
  })

  test('我已了解 → 单元2 摆阵 → 单元3 全工具链（击毁/幽灵标记/着色/预报点）→ 完成弹窗「继续对局」free → 退出主页', async ({
    page,
  }) => {
    test.setTimeout(360_000)
    const errs = watchErrors(page)

    await openTutorial(page)
    await modal(page).getByRole('button', { name: '我已了解' }).click()
    await runUnit2(page)
    await runUnit3ToFirstShot(page)
    await expect(bubble(page)).toContainText('好极了！运用你刚才学到的所有技巧')
    await clickBubble(page) // n6 → n7（等待首次击毁）
    await runUnit3Toolchain(page)

    // 「继续对局」→ free 模式：气泡/突显消失，对局可继续；退出 → 主页
    await modal(page).getByRole('button', { name: '继续对局' }).click()
    await expect(page.locator('.tutorial-bubble')).toHaveCount(0)
    await expect(spotlight(page)).toHaveCount(0)
    await expect(page.locator('.game__opp .paper-grid__board')).toBeVisible()
    await page.getByRole('button', { name: '← 退出' }).click()
    await expect(modal(page)).toContainText('确认退出对局？')
    await modal(page).getByRole('button', { name: '确认退出' }).click()
    await expect(page.getByRole('heading', { name: '飞机杀' })).toBeVisible({ timeout: 10_000 })

    expect(errs()).toEqual([])
  })

  test('突显为模态：非突显区不可点（.tutorial-block）、气泡与退出按钮均可真实点击；单元1/单元2/单元3 突显期退出路径', async ({
    page,
  }) => {
    test.setTimeout(240_000)
    const errs = watchErrors(page)

    // 单元1：气泡整屏暗层 → 阻断带存在且点击无效；气泡可点；「← 退出教程」直达主页（单元1 无二次确认）
    await openTutorial(page)
    await modal(page).getByRole('button', { name: '还不了解' }).click()
    await expect(page.getByRole('heading', { name: '新手教程 · 辨认飞机' })).toBeVisible({ timeout: 10_000 })
    await expect(bubble(page)).toContainText('欢迎来到《飞机杀》！', { timeout: 10_000 })
    await expect(page.locator('.tutorial-block')).not.toHaveCount(0)
    const before = await bubbleTextSafe(page)
    await clickBlockedArea(page)
    await expect(bubble(page)).toHaveText(before)
    await clickBubble(page)
    await expect(bubble(page)).toContainText('在正式开始游戏之前，我们先来做几个练习吧！')
    await page.getByRole('button', { name: '← 退出教程' }).click()
    await expect(page.getByRole('heading', { name: '飞机杀' })).toBeVisible({ timeout: 10_000 })

    // 单元2：突显（整屏暗层）期间——阻断带拦截非突显区、气泡可点、退出按钮真实可点；
    // v0.3.13 修复复验：弹窗打开时教程层不渲染阻断带（.tutorial-block == 0），关闭后恢复。
    await page.getByRole('button', { name: '新手教程' }).click()
    await modal(page).getByRole('button', { name: '我已了解' }).click()
    await expect(page.getByRole('heading', { name: '新手教程 · 摆阵' })).toBeVisible({ timeout: 10_000 })
    await expect(bubble(page)).toContainText('很好！接下来我们即将进入实战！', { timeout: 10_000 })
    await expectSpotlightDim(page)
    await expect(page.locator('.tutorial-block')).not.toHaveCount(0)
    const before2 = await bubbleTextSafe(page)
    await clickBlockedArea(page)
    await expect(bubble(page)).toHaveText(before2)
    await clickBubble(page)
    await expect(bubble(page)).toContainText('首先要做的一件事是')

    // 突显阶段真实点击「← 退出教程」→ 弹窗出现且阻断带为 0 →「继续摆阵」保留 → 阻断带恢复
    await page.getByRole('button', { name: '← 退出教程' }).click()
    await expect(modal(page)).toContainText('退出教程？')
    await expect(modal(page)).toContainText('确认离开教程')
    await expect(page.locator('.tutorial-block')).toHaveCount(0)
    await modal(page).getByRole('button', { name: '继续摆阵' }).click()
    await expect(modal(page)).toHaveCount(0)
    await expect(page.locator('.tutorial-block')).not.toHaveCount(0)
    await expect(bubble(page)).toContainText('首先要做的一件事是')

    // 突显阶段再次真实点击「← 退出教程」→「确认退出」直达主页（同一阻断带为 0 断言）
    await page.getByRole('button', { name: '← 退出教程' }).click()
    await expect(modal(page)).toContainText('退出教程？')
    await expect(page.locator('.tutorial-block')).toHaveCount(0)
    await modal(page).getByRole('button', { name: '确认退出' }).click()
    await expect(page.getByRole('heading', { name: '飞机杀' })).toBeVisible({ timeout: 10_000 })

    // 单元3：突显节点（n1 整屏暗层）内「← 退出」真实可点（M4 .tutorial-escape）→ 弹窗阻断带为 0
    // →「确认退出」直达主页（上一轮因 .tutorial-block 拦截而无法真实点击的路径）
    await page.getByRole('button', { name: '新手教程' }).click()
    await modal(page).getByRole('button', { name: '我已了解' }).click()
    await runUnit2(page)
    await expect(bubble(page)).toContainText('现在，我们正式进入实战！', { timeout: 20_000 })
    await expect(page.locator('.tutorial-block')).not.toHaveCount(0)
    await page.getByRole('button', { name: '← 退出' }).click()
    await expect(modal(page)).toContainText('确认退出对局？')
    await expect(page.locator('.tutorial-block')).toHaveCount(0)
    await modal(page).getByRole('button', { name: '确认退出' }).click()
    await expect(page.getByRole('heading', { name: '飞机杀' })).toBeVisible({ timeout: 10_000 })

    expect(errs()).toEqual([])
  })
})
