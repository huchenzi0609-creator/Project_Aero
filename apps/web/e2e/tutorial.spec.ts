/**
 * tutorial.spec —— 新手教程 e2e（v0.3.3：单元1 新流程 / spotlight 单层 SVG / 退出确认 / 废弃界面清理）。
 *
 * 覆盖：
 * 1) 入口 P2：「还不了解」→ 单元1；「我已了解」→ 直达单元3；
 * 2) 单元1 新流程：welcome/tray(点击)→drag/more(wait 常驻、无 hint、点击不消失)→rotateHint(突显气泡)
 *    →rotateWait(突显棋盘)→thanks(常驻)→detect(合法→确认文案+突显确认钮；非法→"飞机不能重叠、不能越界哦！")；
 * 3) 单元2：T2-2(*飞机机头* 强调)、条件步无「点击继续」、wait 气泡持久、弹窗豁免（spotlight/气泡隐藏后恢复）；
 * 4) 单元2 真实全灭 → 立即「恭喜！你获得了一场胜利！」；
 * 5) 单元3：残局校验、T3-3 双目标（单层 SVG 双洞）、T3-8 着色钮 spotlight、P5 完成教程回主页；
 * 6) 退出教程确认：单元1「← 退出教程」→「退出教程？」→ 确认退出 → 主页（title 飞机杀）；
 * 7) P5「继续对局」free 模式（HUD/气泡/spotlight 消失）→ 单机「确认退出」→ 直达主页；
 * spotlight 契约：有目标 = 1 个 .tutorial-spotlight（svg）；无目标 = 0（全亮）；多目标 = 单层多洞（path ' M' 计数）。
 * 全程 console 零 error。
 */
import { expect, test } from '@playwright/test'
import { watchErrors } from './helpers'

function modal(page: import('@playwright/test').Page) {
  return page.locator('.paper-modal__dialog')
}
function bubble(page: import('@playwright/test').Page) {
  return page.locator('.tutorial-bubble__text')
}
function hudSkip(page: import('@playwright/test').Page, unit: '对战基础' | '工具进阶') {
  return page.locator('.tutorial-hud .tutorial-bubble__skip', { hasText: `跳过 · ${unit}` })
}
async function clickBubble(page: import('@playwright/test').Page) {
  await bubble(page).click({ timeout: 3000 })
}
/** spotlight：有目标 → 单层 svg；无目标 → 0 */
function spotlight(page: import('@playwright/test').Page) {
  return page.locator('.tutorial-spotlight')
}
/** 单层 svg 中的开洞数（path d 中 ' M' 子路径计数） */
async function spotlightHoles(page: import('@playwright/test').Page): Promise<number> {
  const d = await page.locator('.tutorial-spotlight path').getAttribute('d').catch(() => null)
  if (!d) return 0
  return (d.match(/ M/g) ?? []).length
}
/** 气泡突显（v0.3.9）= 整屏暗层 .tutorial-spotlight--dim（无 svg 洞；气泡 z 豁免） */
async function expectSpotlightDim(page: import('@playwright/test').Page): Promise<void> {
  await expect(page.locator('.tutorial-spotlight--dim')).toHaveCount(1)
  await expect(page.locator('.tutorial-spotlight:not(.tutorial-spotlight--dim)')).toHaveCount(0)
  await expect(bubble(page)).toBeVisible()
}
async function drag(page: import('@playwright/test').Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 14 })
  await page.mouse.up()
}
/** 从摆阵页把一张待选牌拖到「可视左上角格 = (r,c)」 */
async function dragDeckCardTo(page: import('@playwright/test').Page, r: number, c: number) {
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
}
async function clickUntil(
  page: import('@playwright/test').Page,
  pred: (t: string) => boolean,
  max = 30,
): Promise<void> {
  for (let i = 0; i < max; i++) {
    const t = (await bubble(page).textContent().catch(() => '')) ?? ''
    if (pred(t)) return
    await bubble(page).click({ timeout: 1500 }).catch(() => {})
    await page.waitForTimeout(70)
  }
  const t = (await bubble(page).textContent().catch(() => '')) ?? ''
  throw new Error(`气泡未推进到目标步骤（当前：${t.slice(0, 60)}）`)
}
async function confirmSkip(page: import('@playwright/test').Page) {
  await expect(modal(page)).toContainText('确认跳过当前单元？')
  await modal(page).getByRole('button', { name: '确认' }).click()
}
async function openTutorial(page: import('@playwright/test').Page) {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '飞机杀' })).toBeVisible()
  await page.getByRole('button', { name: '新手教程' }).click()
  await expect(modal(page)).toContainText('您是否了解本游戏的基本规则？')
}
function allCoords10x10(): string[] {
  const out: string[] = []
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 10; c++) out.push(`${String.fromCharCode(65 + c)}${r + 1}`)
  }
  return out
}

test.describe('新手教程', () => {
  test.setTimeout(300_000)

  test('主链：还不了解 → 单元1 新流程（含非法/合法检测）→ 单元2 → P3 → 单元3 → P5 回主页', async ({ page }) => {
    const errs = watchErrors(page)

    await openTutorial(page)
    await modal(page).getByRole('button', { name: '还不了解' }).click()

    /* ---- 单元1 v0.3.3：welcome → tray → drag → more → rotateHint → rotateWait → thanks → detect ---- */
    await expect(page.getByRole('heading', { name: '新手教程 · 摆阵' })).toBeVisible()

    // welcome（click 节点，气泡突显 = 整屏暗层）
    await expect(bubble(page)).toContainText('欢迎来到《飞机杀》！我们先来学习如何摆阵吧！', { timeout: 8000 })
    await expectSpotlightDim(page)
    await expect(page.locator('.tutorial-bubble__skip', { hasText: '跳过单元' })).toBeVisible()
    await clickBubble(page) // tray

    await expect(bubble(page)).toContainText('这是飞机待选栏，可以从这里把飞机拖到网格中。')
    await expect(spotlight(page)).toHaveCount(1)
    await clickBubble(page) // drag（wait：无 hint、点击不消失、无突显全亮）

    await expect(bubble(page)).toContainText('现在就试试看吧！把飞机拖到网格里！')
    await expect(spotlight(page)).toHaveCount(0)
    await expect(page.locator('.tutorial-bubble__hint')).toHaveCount(0)
    await clickBubble(page)
    await expect(bubble(page)).toContainText('现在就试试看吧！把飞机拖到网格里！')

    // 拖入第 1 架 → more（wait allPlanesPlaced：常驻无 hint、无突显）
    await dragDeckCardTo(page, 2, 0)
    await expect(bubble(page)).toContainText('好极了！现在尝试把剩余的飞机全部拖到网格里！', { timeout: 8000 })
    await expect(spotlight(page)).toHaveCount(0)
    await expect(page.locator('.tutorial-bubble__hint')).toHaveCount(0)
    await clickBubble(page)
    await expect(bubble(page)).toContainText('好极了！现在尝试把剩余的飞机全部拖到网格里！')

    // 拖齐剩余 2 架 → rotateHint（click，突显气泡）
    await dragDeckCardTo(page, 2, 5)
    await dragDeckCardTo(page, 6, 5)
    await expect(page.locator('.placement__plane')).toHaveCount(3)
    await expect(bubble(page)).toContainText('单击飞机可以使飞机旋转90度，试试看！', { timeout: 8000 })
    await expectSpotlightDim(page) // rotateHint：气泡突显 = 整屏暗层

    // 点击 → rotateWait（wait，突显棋盘、文本常驻、无 hint）
    await clickBubble(page)
    await expect(bubble(page)).toContainText('单击飞机可以使飞机旋转90度，试试看！')
    await expect(spotlight(page)).toHaveCount(1)
    await expect(page.locator('.tutorial-bubble__hint')).toHaveCount(0)

    // 旋转一架 → thanks（常驻、无突显）
    const p0 = page.locator('.placement__plane').first()
    const b0 = await p0.boundingBox()
    if (!b0) throw new Error('已摆飞机不可见')
    await page.mouse.click(b0.x + b0.width / 2, b0.y + b0.height / 2)
    await expect(bubble(page)).toContainText('太棒了！确保你的飞机不重叠不越界之后，就可以开始游戏了！', { timeout: 8000 })
    await expect(spotlight(page)).toHaveCount(0)
    await expect(page.locator('.tutorial-bubble__hint')).toHaveCount(0)
    await clickBubble(page)
    await expect(bubble(page)).toContainText('太棒了！确保你的飞机不重叠不越界之后，就可以开始游戏了！')

    // detect：把第 2 架下移 4 格叠上第 3 架 → 非法文案 + 确认禁用 + 无突显
    const board = page.locator('.placement__board')
    const bb = await board.boundingBox()
    if (!bb) throw new Error('摆阵棋盘不可见')
    const cell = bb.width / 10
    const p1 = page.locator('.placement__plane').nth(1)
    const p1b = await p1.boundingBox()
    if (!p1b) throw new Error('第 2 架不可见')
    await drag(
      page,
      { x: p1b.x + p1b.width / 2, y: p1b.y + p1b.height / 2 },
      { x: p1b.x + p1b.width / 2, y: p1b.y + p1b.height / 2 + 4 * cell },
    )
    await expect(bubble(page)).toContainText('飞机不能重叠、不能越界哦！', { timeout: 8000 })
    await expect(page.getByRole('button', { name: '确认布阵' })).toBeDisabled()
    await expect(spotlight(page)).toHaveCount(0)

    // 移回原位 → 合法 → 自动切「点击"确认布阵"开始游戏」+ 突显确认按钮
    const p1moved = page.locator('.placement__plane').nth(1)
    const pm = await p1moved.boundingBox()
    if (!pm) throw new Error('重叠后第 2 架不可见')
    await drag(
      page,
      { x: pm.x + pm.width / 2, y: pm.y + pm.height / 2 },
      { x: pm.x + pm.width / 2, y: pm.y + pm.height / 2 - 4 * cell },
    )
    await expect(bubble(page)).toContainText('点击“确认布阵”开始游戏', { timeout: 8000 })
    const confirm = page.getByRole('button', { name: '确认布阵' })
    await expect(confirm).toBeEnabled()
    await expect(spotlight(page)).toHaveCount(1)
    await confirm.click()

    /* ---- 单元2 对战基础 ---- */
    await expect(bubble(page)).toContainText('是时候学习如何对战了！', { timeout: 10000 })
    await expect(hudSkip(page, '对战基础')).toBeVisible()
    await expect(page.locator('.result')).toHaveCount(0)
    await expectSpotlightDim(page) // T2-1 welcome：气泡突显 = 整屏暗层

    await clickBubble(page) // T2-2（*飞机机头* 强调，突显空网格）
    await expect(bubble(page)).toContainText('找出对手的')
    await expect(bubble(page)).toContainText('飞机机头')
    await expect(spotlight(page)).toHaveCount(1)
    await clickBubble(page) // T2-3 条件步（无突显、无 hint）
    await expect(bubble(page)).toContainText('试试双击一个格子')
    await expect(page.locator('.tutorial-bubble__hint')).toHaveCount(0)
    await expect(spotlight(page)).toHaveCount(0)

    // 我方先手：双击 A1 报点 → 反馈分支（wait，无突显、无 hint、点击不消失）
    await expect(page.locator('.game-banner')).toBeHidden({ timeout: 8000 })
    const coordInput = page.getByLabel('报点坐标，如 A5')
    await expect(coordInput).toBeEnabled({ timeout: 10000 })
    const a1 = page.locator('.game__opp .paper-grid__board button[aria-label="A1"]')
    await a1.click({ timeout: 2000 }).catch(() => {})
    await page.waitForTimeout(140)
    await a1.click({ timeout: 2000 }).catch(() => {})
    const branch = page
      .locator('.tutorial-bubble__text')
      .filter({ hasText: /哎呀，不走运，这里没有飞机呢|机头就在这附近！/ })
    await expect(branch.first()).toBeVisible({ timeout: 12000 })
    await expect(spotlight(page)).toHaveCount(0)
    await clickBubble(page)
    await expect(branch.first()).toBeVisible() // wait 气泡持久

    // 弹窗豁免：跳过确认打开 → spotlight 与气泡隐藏；取消关闭恢复
    await hudSkip(page, '对战基础').click()
    await expect(modal(page)).toContainText('确认跳过当前单元？')
    await expect(spotlight(page)).toHaveCount(0)
    await expect(page.locator('.tutorial-bubble')).toHaveCount(0)
    await modal(page).getByRole('button', { name: '取消' }).click()
    await expect(page.locator('.tutorial-bubble')).toBeVisible()

    await hudSkip(page, '对战基础').click()
    await confirmSkip(page)
    await expect(modal(page)).toContainText('基础教程已完成，是否继续进阶教程？')
    await expect(spotlight(page)).toHaveCount(0) // P3 弹窗豁免
    await modal(page).getByRole('button', { name: '继续教程' }).click()

    /* ---- 单元3 工具进阶 ---- */
    await expect(bubble(page)).toContainText('《飞机杀》有很多实用的对局工具呢！', { timeout: 12000 })
    await expect(hudSkip(page, '工具进阶')).toBeVisible()
    await expect(page.locator('.result')).toHaveCount(0)
    await expectSpotlightDim(page) // a1：气泡突显 = 整屏暗层

    await expect(page.locator('.game-banner')).toBeHidden({ timeout: 8000 })
    await expect(page.locator('.game__status-text')).toContainText(/等待对方报点|对方报点/, { timeout: 10000 })
    await expect
      .poll(async () => page.locator('.game__mine .paper-grid__stamp').count(), { timeout: 10000 })
      .toBeGreaterThanOrEqual(9)
    await expect(page.locator('.game__mine .paper-grid__stamp .stamp--kill')).toHaveCount(1)

    // 缺陷 R3 规避窗口（preKill 残骸格未记入 AI 报点史 → 预报点触发 AI +5s 暂停）。
    // v0.3.4 两步语义：单击选中 + 再点同一格才创建预报点；若恰在我方回合则两连击=出枪，
    // 回合交给 AI 后再于其它格尝试创建（与单元3 工具链同法）。
    const r3Prefire = page.locator('.game__opp .paper-grid__stamp .prefire-mark')
    for (const cellName of ['J10', 'H9', 'I9']) {
      if ((await r3Prefire.count()) > 0) break
      const cell = page.locator(`.game__opp .paper-grid__board button[aria-label="${cellName}"]`)
      await cell.click({ timeout: 1500 }).catch(() => {})
      await page.waitForTimeout(120)
      await cell.click({ timeout: 1500 }).catch(() => {})
      await page.waitForTimeout(400)
    }
    await expect
      .poll(async () => r3Prefire.count(), { timeout: 8000 })
      .toBeGreaterThanOrEqual(1)

    // T3-1→T3-2（单目标）→ T3-3（双目标 = 单层 svg 双洞）
    await clickBubble(page) // a1 → a2
    await expect(bubble(page)).toContainText('这是“参考网格”。')
    await expect(spotlight(page)).toHaveCount(1)
    await clickBubble(page)
    await expect(bubble(page)).toContainText('这里的飞机也可点击旋转90度')
    await clickBubble(page) // a3（双目标）
    await expect(bubble(page)).toContainText('并且，这里的飞机也可以拖到空网格里。试试看！')
    await expect(spotlight(page)).toHaveCount(1)
    await expect.poll(() => spotlightHoles(page), { timeout: 8000 }).toBe(2)

    const refPlane = page.locator('.game__ref .paper-grid__plane')
    const oppBoard = page.locator('.game__opp .paper-grid__board')
    const rp = await refPlane.boundingBox()
    const ob = await oppBoard.boundingBox()
    if (!rp || !ob) throw new Error('参考飞机/对手棋盘不可见')
    const cellW = ob.width / 10
    await drag(
      page,
      { x: rp.x + rp.width / 2, y: rp.y + rp.height / 2 },
      { x: ob.x + 5 * cellW, y: ob.y + 4 * cellW },
    )
    await expect(page.locator('.game__opp .paper-grid__plane--ghost')).toHaveCount(1)
    await expect(bubble(page)).toContainText('你创建了一个幽灵飞机！', { timeout: 10000 })
    await clickBubble(page)
    await expect(bubble(page)).toContainText('你可以创建多个幽灵飞机')
    await clickUntil(page, (t) => t.includes('这是坐标输入框'))
    await expect(spotlight(page)).toHaveCount(1)
    await clickBubble(page) // → a8 着色按钮
    await expect(bubble(page)).toContainText('点击这个按钮进入着色模式，长按可以选择颜色。', { timeout: 8000 })
    await expect(spotlight(page)).toHaveCount(1)

    await hudSkip(page, '工具进阶').click()
    await confirmSkip(page)
    await expect(modal(page)).toContainText('进阶教程已完成，是否完成对局？')
    await modal(page).getByRole('button', { name: '完成教程' }).click()
    await expect(page.getByRole('heading', { name: '飞机杀' })).toBeVisible()

    expect(errs()).toEqual([])
  })

  test('入口「我已了解」→ 直达单元3 → P5「继续对局」free 模式 → 单机确认退出直达主页', async ({ page }) => {
    test.setTimeout(150_000)
    const errs = watchErrors(page)

    await openTutorial(page)
    await modal(page).getByRole('button', { name: '我已了解' }).click()

    await expect(bubble(page)).toContainText('《飞机杀》有很多实用的对局工具呢！', { timeout: 12000 })
    await expect(hudSkip(page, '工具进阶')).toBeVisible()
    await expect(page.locator('.result')).toHaveCount(0)
    await expect(page.locator('.game-banner')).toBeHidden({ timeout: 8000 })
    await expect
      .poll(async () => page.locator('.game__mine .paper-grid__stamp').count(), { timeout: 10000 })
      .toBeGreaterThanOrEqual(9)

    await hudSkip(page, '工具进阶').click()
    await confirmSkip(page)
    await expect(modal(page)).toContainText('进阶教程已完成，是否完成对局？')
    await modal(page).getByRole('button', { name: '继续对局' }).click()

    // free：HUD / 气泡 / spotlight 全部消失
    await expect(page.locator('.tutorial-hud')).toHaveCount(0)
    await expect(page.locator('.tutorial-bubble')).toHaveCount(0)
    await expect(spotlight(page)).toHaveCount(0)

    // v0.3.3：单机对局退出直达主页
    await expect(page.locator('.game__opp .paper-grid__board')).toBeVisible()
    await page.getByRole('button', { name: '← 退出' }).click()
    await expect(page.locator('.paper-modal__dialog')).toContainText('确认退出对局？')
    await page.locator('.paper-modal__dialog').getByRole('button', { name: '确认退出' }).click()
    await expect(page.getByRole('heading', { name: '飞机杀' })).toBeVisible({ timeout: 10000 })

    expect(errs()).toEqual([])
  })

  test('单元2 真实全灭 → 立即「恭喜！你获得了一场胜利！」（无后续反馈）→ P3 返回主页', async ({ page }) => {
    test.setTimeout(300_000)
    const errs = watchErrors(page)

    await openTutorial(page)
    await modal(page).getByRole('button', { name: '还不了解' }).click()
    await expect(bubble(page)).toContainText('欢迎来到《飞机杀》！我们先来学习如何摆阵吧！', { timeout: 8000 })
    await page.locator('.tutorial-bubble__skip', { hasText: '跳过单元' }).click()
    await modal(page).getByRole('button', { name: '确认' }).click()
    await expect(bubble(page)).toContainText('是时候学习如何对战了！', { timeout: 10000 })
    await expect(hudSkip(page, '对战基础')).toBeVisible()

    // 逐格扫描直至真正胜利（教学 AI 避让我方机头 → 我方不会先输）。
    // 单元2 强制我方先手；后续回合以「我方小网格收到 AI 报点数递增」判定（AI 回应后回合即归我；
    // v0.3.5 无回合提示文案可用，状态条会被报点消息占用）。
    const winBubble = page.locator('.tutorial-bubble__text').filter({ hasText: '恭喜！你获得了一场胜利！' })
    const mineStamps = page.locator('.game__mine .paper-grid__stamp')
    await expect(page.locator('.game-banner')).toBeHidden({ timeout: 8000 })
    const shotCells = allCoords10x10()
    let idx = 0
    let shotsTaken = 0
    let firstTurn = true // 我方先手 → 可直接开第一枪
    let rcvBase = 0 // AI 已回应（我方小网格新增报点）的计数阈值
    const deadline = Date.now() + 200_000
    while (Date.now() < deadline && (await winBubble.count()) === 0 && idx < shotCells.length) {
      const canShoot = firstTurn || (await mineStamps.count()) > rcvBase
      if (!canShoot) {
        await page.waitForTimeout(150)
        continue
      }
      const coord = shotCells[idx]!
      idx += 1
      shotsTaken += 1
      const cell = page.locator(`.game__opp .paper-grid__board button[aria-label="${coord}"]`)
      await cell.click({ timeout: 1500 }).catch(() => {})
      await page.waitForTimeout(120)
      if ((await winBubble.count()) > 0) break
      await cell.click({ timeout: 1500 }).catch(() => {})
      firstTurn = false
      rcvBase = await mineStamps.count() // 等 AI 回应后（计数递增）才能打下一枪
      for (let k = 0; k < 80 && (await winBubble.count()) === 0; k++) {
        if ((await mineStamps.count()) > rcvBase) break
        await page.waitForTimeout(150)
      }
    }
    expect(shotsTaken).toBeGreaterThanOrEqual(5)

    await expect(winBubble).toBeVisible({ timeout: 20000 })
    await page.waitForTimeout(300)
    await expect(bubble(page)).toContainText('恭喜！你获得了一场胜利！')
    await expect(bubble(page).filter({ hasText: /哎呀，不走运|机头就在这附近/ })).toHaveCount(0)

    await clickBubble(page)
    await expect(modal(page)).toContainText('基础教程已完成，是否继续进阶教程？')
    await modal(page).getByRole('button', { name: '返回主页' }).click()
    await expect(page.getByRole('heading', { name: '飞机杀' })).toBeVisible()

    expect(errs()).toEqual([])
  })

  test('单元1 气泡「跳过单元」→ 二次确认（取消保留 / 确认进单元2）；P3「返回主页」退出', async ({ page }) => {
    test.setTimeout(120_000)
    const errs = watchErrors(page)

    await openTutorial(page)
    await modal(page).getByRole('button', { name: '还不了解' }).click()

    await expect(bubble(page)).toContainText('欢迎来到《飞机杀》！我们先来学习如何摆阵吧！', { timeout: 8000 })
    await page.locator('.tutorial-bubble__skip', { hasText: '跳过单元' }).click()
    await expect(modal(page)).toContainText('确认跳过当前单元？')
    await modal(page).getByRole('button', { name: '取消' }).click()
    await expect(page.getByRole('heading', { name: '新手教程 · 摆阵' })).toBeVisible()

    await page.locator('.tutorial-bubble__skip', { hasText: '跳过单元' }).click()
    await modal(page).getByRole('button', { name: '确认' }).click()
    await expect(bubble(page)).toContainText('是时候学习如何对战了！', { timeout: 10000 })

    await hudSkip(page, '对战基础').click()
    await modal(page).getByRole('button', { name: '确认' }).click()
    await expect(modal(page)).toContainText('基础教程已完成，是否继续进阶教程？')
    await modal(page).getByRole('button', { name: '返回主页' }).click()
    await expect(page.getByRole('heading', { name: '飞机杀' })).toBeVisible()

    expect(errs()).toEqual([])
  })

  test('单元1「← 退出教程」→ 二次确认（继续摆阵保留 / 确认退出直达主页）', async ({ page }) => {
    test.setTimeout(120_000)
    const errs = watchErrors(page)

    await openTutorial(page)
    await modal(page).getByRole('button', { name: '还不了解' }).click()
    await expect(bubble(page)).toContainText('欢迎来到《飞机杀》！我们先来学习如何摆阵吧！', { timeout: 8000 })

    // 取消：继续摆阵保留
    await page.getByRole('button', { name: '← 退出教程' }).click()
    await expect(modal(page)).toContainText('退出教程？')
    await expect(modal(page)).toContainText('确认离开教程')
    await modal(page).getByRole('button', { name: '继续摆阵' }).click()
    await expect(page.getByRole('heading', { name: '新手教程 · 摆阵' })).toBeVisible()

    // 确认退出 → 主页（title 飞机杀）
    await page.getByRole('button', { name: '← 退出教程' }).click()
    await modal(page).getByRole('button', { name: '确认退出' }).click()
    await expect(page.getByRole('heading', { name: '飞机杀' })).toBeVisible()

    expect(errs()).toEqual([])
  })

  test('教程对局内「← 退出」→「确认退出」→ 直达主页（无错误页）', async ({ page }) => {
    test.setTimeout(120_000)
    const errs = watchErrors(page)

    await openTutorial(page)
    await modal(page).getByRole('button', { name: '还不了解' }).click()
    await expect(bubble(page)).toContainText('欢迎来到《飞机杀》！我们先来学习如何摆阵吧！', { timeout: 8000 })
    // 跳过单元1 → 进入单元2 对局
    await page.locator('.tutorial-bubble__skip', { hasText: '跳过单元' }).click()
    await modal(page).getByRole('button', { name: '确认' }).click()
    await expect(bubble(page)).toContainText('是时候学习如何对战了！', { timeout: 10000 })
    await expect(page.locator('.game-banner')).toBeHidden({ timeout: 8000 })

    // 对局内退出 → 二次确认 → 直达主页
    await page.getByRole('button', { name: '← 退出' }).click()
    await expect(page.locator('.paper-modal__dialog')).toContainText('确认退出对局？')
    await page.locator('.paper-modal__dialog').getByRole('button', { name: '确认退出' }).click()
    await expect(page.getByRole('heading', { name: '飞机杀' })).toBeVisible({ timeout: 10000 })

    expect(errs()).toEqual([])
  })

  test('单元3 工具链：涂色 1s 静默 → a10 双目标 → 快捷着色批染 → 两步预报点 → a12 双目标 → P5 回主页', async ({ page }) => {
    test.setTimeout(240_000)
    const errs = watchErrors(page)

    await openTutorial(page)
    await modal(page).getByRole('button', { name: '我已了解' }).click() // 直达单元3

    // a1：教学开始（此后 a3/a4/a8/a9/a10 均 pauseAi 冻结 AI；无需预建停顿预报点）
    await expect(bubble(page)).toContainText('《飞机杀》有很多实用的对局工具呢！', { timeout: 12000 })

    // a2 → a3：推进到拖幽灵并执行（ghostCreated 后才能继续；拖拽偶发未落定 → 重试 ≤3 次）
    await clickUntil(page, (t) => t.includes('并且，这里的飞机也可以拖到空网格里'), 20)
    await expect(bubble(page)).toContainText('并且，这里的飞机也可以拖到空网格里。试试看！')
    const ghostT = page.locator('.game__opp .paper-grid__plane--ghost')
    for (let attempt = 0; attempt < 3 && (await ghostT.count()) === 0; attempt++) {
      const refPlaneT = page.locator('.game__ref .paper-grid__plane')
      const oppBoardT = page.locator('.game__opp .paper-grid__board')
      const rpT = await refPlaneT.boundingBox()
      const obT = await oppBoardT.boundingBox()
      if (!rpT || !obT) throw new Error('参考飞机/对手棋盘不可见')
      const cellT = obT.width / 10
      await drag(
        page,
        { x: rpT.x + rpT.width / 2, y: rpT.y + rpT.height / 2 },
        { x: obT.x + 5 * cellT, y: obT.y + 4 * cellT },
      )
      await page.waitForTimeout(250)
    }
    await expect(ghostT).toHaveCount(1)

    // a4…a8：推进到「点击这个按钮进入着色模式」
    await clickUntil(page, (t) => t.includes('点击这个按钮进入着色模式'), 30)
    await expect(bubble(page)).toContainText('点击这个按钮进入着色模式，长按可以选择颜色。')
    await expect(spotlight(page)).toHaveCount(1)

    // 进入着色模式（a8 wait enteredColoring → a9 涂色引导，quiet 1s）
    const colorBtn = page.locator('.coloring-stage__btn button')
    await expect(colorBtn).toBeVisible()
    await colorBtn.click()
    await expect(colorBtn).toHaveAttribute('aria-pressed', 'true')
    await expect(bubble(page)).toContainText('试试看给空网格涂色，点击和拖动都可以！', { timeout: 8000 })

    // 涂一个空网格格（a9 活动）→ ~1s 静默 → a10（双目标突显：空网格 + 着色按钮）
    const emptyCell = page.locator('.game__opp .paper-grid__board button[aria-label="A1"]')
    await emptyCell.click({ timeout: 2000 }).catch(() => {})
    await expect(page.locator('.game__opp .paper-grid__colored')).toHaveCount(1, { timeout: 5000 })
    await expect(bubble(page)).toContainText('着色工具是对局中的好帮手，可助您事半功倍。', { timeout: 6000 })
    await expect(spotlight(page)).toHaveCount(1)
    // a10 双目标（空网格 + 着色按钮）：单层 svg 保持；着色按钮用泛 .coloring-btn 定位二义（横/竖版其一 display:none），
    // 洞数以 ≥1 断言（单层多洞机制已在 a3/a12 以双洞严格验证）
    await expect.poll(() => spotlightHoles(page), { timeout: 8000 }).toBeGreaterThanOrEqual(1)

    // 快捷着色：着色模式点按幽灵 → 整机批染 + 回收 + 退出（ghostBatchColored deliberate → a11）
    const ghost = page.locator('.game__opp .paper-grid__plane--ghost')
    await expect(ghost).toHaveCount(1)
    const gb = await ghost.boundingBox()
    if (!gb) throw new Error('幽灵不可见')
    await page.mouse.click(gb.x + gb.width / 2, gb.y + gb.height / 2)
    await expect(bubble(page)).toContainText('你刚刚对幽灵飞机下的方格进行了一次批量着色！', { timeout: 8000 })
    await expect(page.locator('.game__opp .paper-grid__plane--ghost')).toHaveCount(0)
    await expect(colorBtn).toHaveAttribute('aria-pressed', 'false')

    // 需要非我方回合才能两步创建预报点（v0.3.5 无回合提示文案可用）：
    // 若恰在我方回合，两连击 = 出枪把回合交给 AI（a11 pauseAi 会冻结其回合）；
    // 若已在对方回合，两连击 = 选中+创建。逐格尝试直至 a12（真实预创建事件）出现。
    const a12Text = '你刚刚创建了一个预报点标记！'
    const prefireMark = page.locator('.game__opp .paper-grid__stamp .prefire-mark')
    const attemptCells = ['J10', 'H9', 'I9']
    for (const cellName of attemptCells) {
      if ((await bubble(page).textContent().catch(() => ''))?.includes(a12Text)) break
      const cell = page.locator(`.game__opp .paper-grid__board button[aria-label="${cellName}"]`)
      await cell.click({ timeout: 1500 }).catch(() => {})
      await page.waitForTimeout(120)
      await cell.click({ timeout: 1500 }).catch(() => {})
      await page.waitForTimeout(400)
    }
    await expect(bubble(page)).toContainText(a12Text, { timeout: 8000 })
    expect(await prefireMark.count()).toBeGreaterThanOrEqual(1)
    await expect(spotlight(page)).toHaveCount(1)
    // a12（v0.3.9）：突显空网格（单目标 svg 洞；气泡以整屏暗层豁免不再入洞）
    await expect.poll(() => spotlightHoles(page), { timeout: 8000 }).toBeGreaterThanOrEqual(1)

    // P5：跳过确认 → 完成教程 → 主页
    await hudSkip(page, '工具进阶').click()
    await confirmSkip(page)
    await expect(modal(page)).toContainText('进阶教程已完成，是否完成对局？')
    await modal(page).getByRole('button', { name: '完成教程' }).click()
    await expect(page.getByRole('heading', { name: '飞机杀' })).toBeVisible()

    expect(errs()).toEqual([])
  })
})
