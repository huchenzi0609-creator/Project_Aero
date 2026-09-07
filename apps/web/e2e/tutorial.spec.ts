/**
 * tutorial.spec —— 新手教程 e2e（v0.3.11：教程全程无「跳过」，出口 = 自然打完整单元 / 退出确认）。
 *
 * 覆盖：
 * 1) 入口 P2：「还不了解」→ 单元1；「我已了解」→ 直达单元3；
 * 2) 单元1 完整摆阵：welcome→tray→drag→more→rotateHint→rotateWait→thanks→detect
 *    （非法文案「飞机不能重叠、不能越界哦！」↔ 合法确认文案 + 突显确认钮）→ 确认进单元2；
 * 3) 单元2 自然对局：T2-1（气泡整屏暗层）→ … → 真实全灭 → 立即「恭喜！你获得了一场胜利！」→ P3 → 返回主页；
 * 4) 单元3 完整工具链（我已了解直达）：残局校验 → a1…a3 拖幽灵 → a8 着色 → a9 涂色 1s 静默 →
 *    a10（双目标）→ 点按幽灵快捷批染（回收+退出）→ a11 → 两步预报点 → a12（单目标空网格）读完
 *    → P5「继续对局」free 模式（HUD/气泡/spotlight 消失）→ 确认退出直达主页；
 * 5) 中途退出路径（无跳过时的唯一退出）：单元1「← 退出教程」二次确认；教程对局内「← 退出」二次确认 → 主页；
 * 6) 气泡 key 稳定 / 弹窗豁免语义随断言保留；spotlight：气泡=整屏暗层，目标=svg 洞（merge 后 ≥1）；
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
async function clickBubble(page: import('@playwright/test').Page) {
  await bubble(page).click({ timeout: 3000 })
}
function spotlight(page: import('@playwright/test').Page) {
  return page.locator('.tutorial-spotlight')
}
/** 单层 svg 中的开洞数（path d 中 ' M' 子路径计数） */
async function spotlightHoles(page: import('@playwright/test').Page): Promise<number> {
  const d = await page.locator('.tutorial-spotlight path').getAttribute('d').catch(() => null)
  if (!d) return 0
  return (d.match(/ M/g) ?? []).length
}
/** 气泡突显 = 整屏暗层 .tutorial-spotlight--dim（无 svg 洞；气泡 z 豁免） */
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
  test.setTimeout(360_000)

  test('主链：还不了解 → 单元1 完整摆阵 → 单元2 真实全灭 → P3 返回主页', async ({ page }) => {
    const errs = watchErrors(page)

    await openTutorial(page)
    await modal(page).getByRole('button', { name: '还不了解' }).click()

    /* ============ 单元1 完整摆阵 ============ */
    await expect(page.getByRole('heading', { name: '新手教程 · 摆阵' })).toBeVisible()

    await expect(bubble(page)).toContainText('欢迎来到《飞机杀》！我们先来学习如何摆阵吧！', { timeout: 8000 })
    await expectSpotlightDim(page)
    await clickBubble(page) // tray

    await expect(bubble(page)).toContainText('这是飞机待选栏，可以从这里把飞机拖到网格中。')
    await expect(spotlight(page)).toHaveCount(1) // svg 洞（托盘）
    await clickBubble(page) // drag（wait）

    await expect(bubble(page)).toContainText('现在就试试看吧！把飞机拖到网格里！')
    await expect(spotlight(page)).toHaveCount(0) // 无突显全亮
    await expect(page.locator('.tutorial-bubble__hint')).toHaveCount(0)
    await clickBubble(page)
    await expect(bubble(page)).toContainText('现在就试试看吧！把飞机拖到网格里！')

    await dragDeckCardTo(page, 2, 0)
    await expect(bubble(page)).toContainText('好极了！现在尝试把剩余的飞机全部拖到网格里！', { timeout: 8000 })
    await expect(spotlight(page)).toHaveCount(0)
    await clickBubble(page)

    await dragDeckCardTo(page, 2, 5)
    await dragDeckCardTo(page, 6, 5)
    await expect(page.locator('.placement__plane')).toHaveCount(3)
    await expect(bubble(page)).toContainText('单击飞机可以使飞机旋转90度，试试看！', { timeout: 8000 })
    await expectSpotlightDim(page) // rotateHint：气泡整屏暗层
    await clickBubble(page) // rotateWait（突显棋盘）

    await expect(bubble(page)).toContainText('单击飞机可以使飞机旋转90度，试试看！')
    await expect(spotlight(page)).toHaveCount(1)

    const p0 = page.locator('.placement__plane').first()
    const b0 = await p0.boundingBox()
    if (!b0) throw new Error('已摆飞机不可见')
    await page.mouse.click(b0.x + b0.width / 2, b0.y + b0.height / 2)
    await expect(bubble(page)).toContainText('太棒了！确保你的飞机不重叠不越界之后，就可以开始游戏了！', { timeout: 8000 })
    await expect(spotlight(page)).toHaveCount(0)
    await clickBubble(page)

    // detect 非法/合法
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

    /* ============ 单元2：真实全灭 → P3 ============ */
    await expect(bubble(page)).toContainText('是时候学习如何对战了！', { timeout: 10000 })
    await expectSpotlightDim(page) // T2-1
    await expect(page.locator('.result')).toHaveCount(0)

    // 我方先手：以「我方小网格收到报点递增」驱动逐格扫描直至真实胜利
    const winBubble = page.locator('.tutorial-bubble__text').filter({ hasText: '恭喜！你获得了一场胜利！' })
    const mineStamps = page.locator('.game__mine .paper-grid__stamp')
    const coordInput = page.getByLabel('报点坐标，如 A5')
    await expect(page.locator('.game-banner')).toBeHidden({ timeout: 8000 })
    const shotCells = allCoords10x10()
    let idx = 0
    let shotsTaken = 0
    let firstTurn = true
    let rcvBase = await mineStamps.count()
    const deadline = Date.now() + 220_000
    while (Date.now() < deadline && (await winBubble.count()) === 0 && idx < shotCells.length) {
      const canShoot = firstTurn || (await mineStamps.count()) > rcvBase
      if (!canShoot) {
        await page.waitForTimeout(150)
        continue
      }
      const coord = shotCells[idx]!
      idx += 1
      shotsTaken += 1
      await coordInput.fill(coord)
      await coordInput.press('Enter')
      firstTurn = false
      rcvBase = await mineStamps.count()
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

    await clickBubble(page) // 胜利气泡 → 单元完成 → P3
    await expect(modal(page)).toContainText('基础教程已完成，是否继续进阶教程？')
    await modal(page).getByRole('button', { name: '返回主页' }).click()
    await expect(page.getByRole('heading', { name: '飞机杀' })).toBeVisible()

    expect(errs()).toEqual([])
  })

  test('我已了解 → 单元3 完整工具链 → P5「继续对局」free → 确认退出直达主页', async ({ page }) => {
    test.setTimeout(300_000)
    const errs = watchErrors(page)

    await openTutorial(page)
    await modal(page).getByRole('button', { name: '我已了解' }).click()

    await expect(bubble(page)).toContainText('《飞机杀》有很多实用的对局工具呢！', { timeout: 12000 })
    await expectSpotlightDim(page) // a1
    await expect(page.locator('.result')).toHaveCount(0)
    await expect(page.locator('.game-banner')).toBeHidden({ timeout: 8000 })
    await expect
      .poll(async () => page.locator('.game__mine .paper-grid__stamp').count(), { timeout: 10000 })
      .toBeGreaterThanOrEqual(9)

    // a2 → a3：拖幽灵（ghostCreated 后才能继续；拖拽偶发未落定 → 重试 ≤3）
    await clickUntil(page, (t) => t.includes('并且，这里的飞机也可以拖到空网格里'), 20)
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

    // a4…a8：推进到着色模式入口
    await clickUntil(page, (t) => t.includes('点击这个按钮进入着色模式'), 30)
    await expect(bubble(page)).toContainText('点击这个按钮进入着色模式，长按可以选择颜色。')
    await expect(spotlight(page)).toHaveCount(1)

    const colorBtn = page.locator('.coloring-stage__btn button')
    await expect(colorBtn).toBeVisible()
    await colorBtn.click()
    await expect(colorBtn).toHaveAttribute('aria-pressed', 'true')
    await expect(bubble(page)).toContainText('试试看给空网格涂色，点击和拖动都可以！', { timeout: 8000 })

    const emptyCell = page.locator('.game__opp .paper-grid__board button[aria-label="A1"]')
    await emptyCell.click({ timeout: 2000 }).catch(() => {})
    await expect(page.locator('.game__opp .paper-grid__colored')).toHaveCount(1, { timeout: 5000 })
    await expect(bubble(page)).toContainText('着色工具是对局中的好帮手，可助您事半功倍。', { timeout: 6000 })
    await expect(spotlight(page)).toHaveCount(1)
    await expect.poll(() => spotlightHoles(page), { timeout: 8000 }).toBeGreaterThanOrEqual(1) // a10

    // 快捷着色：点按幽灵 → 批染 + 回收 + 退出 → a11
    const ghost = page.locator('.game__opp .paper-grid__plane--ghost')
    const gb = await ghost.boundingBox()
    if (!gb) throw new Error('幽灵不可见')
    await page.mouse.click(gb.x + gb.width / 2, gb.y + gb.height / 2)
    await expect(bubble(page)).toContainText('你刚刚对幽灵飞机下的方格进行了一次批量着色！', { timeout: 8000 })
    await expect(page.locator('.game__opp .paper-grid__plane--ghost')).toHaveCount(0)
    await expect(colorBtn).toHaveAttribute('aria-pressed', 'false')

    // 两步创建预报点直至 a12（若逢我方回合，两连击 = 出枪交 AI；随后格上创建）
    const a12Text = '你刚刚创建了一个预报点标记！'
    const prefireMark = page.locator('.game__opp .paper-grid__stamp .prefire-mark')
    const attemptCells = ['J10', 'H9', 'I9']
    for (const cellName of attemptCells) {
      if ((await bubble(page).textContent().catch(() => ''))?.includes(a12Text)) break
      const c = page.locator(`.game__opp .paper-grid__board button[aria-label="${cellName}"]`)
      await c.click({ timeout: 1500 }).catch(() => {})
      await page.waitForTimeout(120)
      await c.click({ timeout: 1500 }).catch(() => {})
      await page.waitForTimeout(400)
    }
    await expect(bubble(page)).toContainText(a12Text, { timeout: 8000 })
    expect(await prefireMark.count()).toBeGreaterThanOrEqual(1)
    await expect(spotlight(page)).toHaveCount(1)
    await expect.poll(() => spotlightHoles(page), { timeout: 8000 }).toBeGreaterThanOrEqual(1) // a12 空网格

    // 读完 a12（5 段）→ P5
    for (let k = 0; k < 8; k++) {
      if (await modal(page).filter({ hasText: '进阶教程已完成' }).count()) break
      await clickBubble(page)
      await page.waitForTimeout(120)
    }
    await expect(modal(page)).toContainText('进阶教程已完成，是否完成对局？')
    await expect(modal(page)).toContainText('继续对局')

    // P5「继续对局」→ free：HUD/气泡/spotlight 消失；确认退出直达主页
    await modal(page).getByRole('button', { name: '继续对局' }).click()
    await expect(page.locator('.tutorial-hud')).toHaveCount(0)
    await expect(page.locator('.tutorial-bubble')).toHaveCount(0)
    await expect(spotlight(page)).toHaveCount(0)
    await expect(page.locator('.game__opp .paper-grid__board')).toBeVisible()
    await page.getByRole('button', { name: '← 退出' }).click()
    await expect(page.locator('.paper-modal__dialog')).toContainText('确认退出对局？')
    await page.locator('.paper-modal__dialog').getByRole('button', { name: '确认退出' }).click()
    await expect(page.getByRole('heading', { name: '飞机杀' })).toBeVisible({ timeout: 10000 })

    expect(errs()).toEqual([])
  })

  test('单元1「← 退出教程」→ 二次确认（继续摆阵保留 / 确认退出直达主页）', async ({ page }) => {
    test.setTimeout(120_000)
    const errs = watchErrors(page)

    await openTutorial(page)
    await modal(page).getByRole('button', { name: '还不了解' }).click()
    await expect(bubble(page)).toContainText('欢迎来到《飞机杀》！我们先来学习如何摆阵吧！', { timeout: 8000 })

    await page.getByRole('button', { name: '← 退出教程' }).click()
    await expect(modal(page)).toContainText('退出教程？')
    await expect(modal(page)).toContainText('确认离开教程')
    await modal(page).getByRole('button', { name: '继续摆阵' }).click()
    await expect(page.getByRole('heading', { name: '新手教程 · 摆阵' })).toBeVisible()

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
    // 单元1：完成 3 架摆放 + 旋转 + 确认，自然进入单元2（无跳过可用）
    await clickBubble(page)
    await clickBubble(page)
    await dragDeckCardTo(page, 2, 0)
    await clickBubble(page)
    await dragDeckCardTo(page, 2, 5)
    await dragDeckCardTo(page, 6, 5)
    await clickBubble(page) // rotateHint → rotateWait（点翻段，随后直接旋转推进）
    const p0 = page.locator('.placement__plane').first()
    const b0 = await p0.boundingBox()
    if (!b0) throw new Error('已摆飞机不可见')
    await page.mouse.click(b0.x + b0.width / 2, b0.y + b0.height / 2)
    await expect(bubble(page)).toContainText('太棒了！确保你的飞机不重叠不越界之后，就可以开始游戏了！', { timeout: 8000 })
    // thanks 后再次网格变化（转回）→ 进入 detect（阵型合法）
    const b1 = await p0.boundingBox()
    if (b1) await page.mouse.click(b1.x + b1.width / 2, b1.y + b1.height / 2)
    await expect(bubble(page)).toContainText('点击“确认布阵”开始游戏', { timeout: 8000 })
    await page.getByRole('button', { name: '确认布阵' }).click()

    await expect(bubble(page)).toContainText('是时候学习如何对战了！', { timeout: 10000 })
    await expect(page.locator('.game-banner')).toBeHidden({ timeout: 8000 })

    await page.getByRole('button', { name: '← 退出' }).click()
    await expect(page.locator('.paper-modal__dialog')).toContainText('确认退出对局？')
    await page.locator('.paper-modal__dialog').getByRole('button', { name: '确认退出' }).click()
    await expect(page.getByRole('heading', { name: '飞机杀' })).toBeVisible({ timeout: 10000 })

    expect(errs()).toEqual([])
  })
})
