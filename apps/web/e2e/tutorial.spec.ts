/**
 * tutorial.spec —— 新手教程 e2e（v0.3.1 重构版，M4 十连 commit 对齐）。
 *
 * 覆盖（qa-checklist-v030 G 段）：
 * 1) 入口 P2：「我已了解」→ 回主页；「还不了解」→ 单元1摆阵；
 * 2) 单元1：T1-1 → 拖入 1 架 → T1-4 → 拖齐 3 架（含 T1-5 静默等待）→ 旋转 → T1-8 突显「确认布阵」→ 确认；
 * 3) 单元2：T2-1 → T2-2（含 *飞机机头* 强调）→ T2-3（条件步无「点击继续」）→ 双击报点 → 击空/击中分支其一；
 *    教程对局全程无 .result 结算 overlay；
 * 4) 跳过二次确认：「跳过」→「确认跳过当前单元？」（确认/取消）——单元1/2/3 均覆盖；
 * 5) P3「继续教程」→ 单元3（残局：被毁残骸标记 + 对方先手）→ T3-1 → 拖参考飞机成幽灵 → T3-4
 *    → 推进至 T3-8 着色按钮 spotlight（开洞遮罩 + 气泡）→ 跳过确认 → P5「完成教程」回主页；
 * 6) 全程 console 零 error。
 */
import { expect, test } from '@playwright/test'
import { watchErrors } from './helpers'

/** 纸片弹窗（教程气泡同为 role=dialog，需限定容器） */
function modal(page: import('@playwright/test').Page) {
  return page.locator('.paper-modal__dialog')
}

/** 气泡文本区 */
function bubble(page: import('@playwright/test').Page) {
  return page.locator('.tutorial-bubble__text')
}

/** 右上 HUD 跳过按钮（单元2/3；单元1 的跳过在气泡内） */
function hudSkip(page: import('@playwright/test').Page, unit: '对战基础' | '工具进阶') {
  return page.locator('.tutorial-hud .tutorial-bubble__skip', { hasText: `跳过 · ${unit}` })
}

/** 点击气泡文本区（避开脚部跳过按钮）推进 */
async function clickBubble(page: import('@playwright/test').Page) {
  await bubble(page).click({ timeout: 3000 })
}

/** 像素级拖拽 */
async function drag(page: import('@playwright/test').Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 14 })
  await page.mouse.up()
}

/** 从摆阵页把一张待选牌拖到「可视左上角格 = (r,c)」（吸附取整 → 指针放格内 0.25 处） */
async function dragDeckCardTo(page: import('@playwright/test').Page, r: number, c: number) {
  const card = page.locator('.placement__deck-card').first()
  const board = page.locator('.placement__board')
  const cb = await card.boundingBox()
  const bb = await board.boundingBox()
  if (!cb || !bb) throw new Error('待选牌/棋盘不可见')
  const cell = bb.width / 10 // 10×10 档
  await drag(
    page,
    { x: cb.x + cb.width / 2, y: cb.y + cb.height / 2 },
    { x: bb.x + (c + 0.25) * cell, y: bb.y + (r + 0.25) * cell },
  )
}

/** 连续点击气泡直至文本满足谓词（覆盖多段 click 节点推进） */
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

/** 确认跳过当前单元（跳过确认弹窗） */
async function confirmSkip(page: import('@playwright/test').Page) {
  await expect(modal(page)).toContainText('确认跳过当前单元？')
  await modal(page).getByRole('button', { name: '确认' }).click()
}

test.describe('新手教程', () => {
  test.setTimeout(300_000)

  test('主链：还不了解 → 单元1 摆阵确认 → 单元2 报点 → P3 继续教程 → 单元3 → P5 完成教程回主页', async ({ page }) => {
    const errs = watchErrors(page)

    /* ================= 入口：P2「还不了解」 ================= */
    await page.goto('/')
    await expect(page.getByRole('heading', { name: '飞机杀' })).toBeVisible()
    await page.getByRole('button', { name: '新手教程' }).click()
    await expect(modal(page)).toContainText('您是否了解本游戏的基本规则？')
    await modal(page).getByRole('button', { name: '还不了解' }).click()

    /* ================= 单元1 摆阵 ================= */
    await expect(page.getByRole('heading', { name: '新手教程 · 摆阵' })).toBeVisible()
    await expect(bubble(page)).toContainText('欢迎来到《飞机杀》！我们先来学习如何摆阵吧！', { timeout: 8000 })
    await expect(page.locator('.tutorial-bubble__skip', { hasText: '跳过单元' })).toBeVisible()

    await clickBubble(page) // → T1-2 待选栏
    await expect(bubble(page)).toContainText('这是飞机待选栏，可以从这里把飞机拖到网格中。')
    await clickBubble(page) // → T1-3 试试拖入（wait planePlaced）
    await expect(bubble(page)).toContainText('现在就试试看吧！把飞机拖到网格里！')

    // 拖入第 1 架 → T1-4
    await dragDeckCardTo(page, 2, 0)
    await expect(bubble(page)).toContainText('好极了！现在尝试把剩余的飞机全部拖到网格里！', { timeout: 8000 })
    await clickBubble(page) // → T1-5 静默等待 allPlanesPlaced

    // 拖齐剩余 2 架 → 自动进入 T1-6（旋转引导）
    await dragDeckCardTo(page, 2, 5)
    await dragDeckCardTo(page, 6, 5)
    await expect(page.locator('.placement__plane')).toHaveCount(3)
    await expect(bubble(page)).toContainText('单击飞机可以使飞机旋转90度，试试看！', { timeout: 8000 })

    // 单击飞机本体旋转 → T1-7
    const placed = page.locator('.placement__plane').first()
    const pb = await placed.boundingBox()
    if (!pb) throw new Error('已摆飞机不可见')
    await page.mouse.click(pb.x + pb.width / 2, pb.y + pb.height / 2)
    await expect(bubble(page)).toContainText('太棒了！确保你的飞机不重叠不越界之后，就可以开始游戏了！', { timeout: 8000 })
    await clickBubble(page) // → T1-8 确认布阵

    // T1-8：突显「确认布阵」→ 点击进入单元2
    const confirm = page.getByRole('button', { name: '确认布阵' })
    await expect(confirm).toBeEnabled()
    await expect(bubble(page)).toContainText('点击“确认布阵”开始游戏')
    await expect(page.locator('.tutorial-spotlight:not(.tutorial-spotlight--dim)')).toBeVisible()
    await confirm.click()

    /* ================= 单元2 对战基础 ================= */
    await expect(bubble(page)).toContainText('是时候学习如何对战了！', { timeout: 10000 })
    await expect(hudSkip(page, '对战基础')).toBeVisible()
    // 教程全程无结算 overlay（hideSettlement）
    await expect(page.locator('.result')).toHaveCount(0)

    await clickBubble(page) // → T2-2 空网格（含 *飞机机头* 强调）
    await expect(bubble(page)).toContainText('找出对手的')
    await expect(bubble(page)).toContainText('飞机机头')
    await expect(page.locator('.game__opp')).toBeVisible()
    await clickBubble(page) // → T2-3 双击报点（wait 条件步）

    // T2-3 为条件步：无「点击继续」提示
    await expect(bubble(page)).toContainText('试试双击一个格子')
    await expect(page.locator('.tutorial-bubble__hint')).toHaveCount(0)

    // 我方先手：横幅结束 + 轮到我方 → 双击 A1 报点
    const coordInput = page.getByLabel('报点坐标，如 A5')
    await expect(page.locator('.game-banner')).toBeHidden({ timeout: 8000 })
    await expect(coordInput).toBeEnabled({ timeout: 10000 })
    const a1 = page.locator('.game__opp .paper-grid__board button[aria-label="A1"]')
    await a1.click({ timeout: 2000 }).catch(() => {})
    await page.waitForTimeout(140)
    await a1.click({ timeout: 2000 }).catch(() => {})

    // 反馈分支（击空/击中）其一出现（AI/落子随机 → 或断言 + 等待出现）
    const branch = page
      .locator('.tutorial-bubble__text')
      .filter({ hasText: /哎呀，不走运，这里没有飞机呢|机头就在这附近！/ })
    await expect(branch.first()).toBeVisible({ timeout: 12000 })

    // 右上跳过 → 二次确认 → P3 → 继续教程
    await hudSkip(page, '对战基础').click()
    await confirmSkip(page)
    await expect(modal(page)).toContainText('基础教程已完成，是否继续进阶教程？')
    await modal(page).getByRole('button', { name: '继续教程' }).click()

    /* ================= 单元3 工具进阶 ================= */
    await expect(bubble(page)).toContainText('《飞机杀》有很多实用的对局工具呢！', { timeout: 12000 })
    await expect(hudSkip(page, '工具进阶')).toBeVisible()
    await expect(page.locator('.result')).toHaveCount(0)

    // 残局开局：我方等待（对方先手）；被毁 1 架 → 小网格残骸标记（≥9 章 + 恰 1 枚 ★）
    await expect(page.locator('.game-banner')).toBeHidden({ timeout: 8000 })
    await expect(page.locator('.game__status-text')).toContainText(/等待对方报点|对方报点/, { timeout: 10000 })
    await expect
      .poll(async () => page.locator('.game__mine .paper-grid__stamp').count(), { timeout: 10000 })
      .toBeGreaterThanOrEqual(9)
    await expect(page.locator('.game__mine .paper-grid__stamp .stamp--kill')).toHaveCount(1)

    // T3-1 → T3-2（两段）→ T3-3（拖幽灵）
    await clickBubble(page)
    await expect(bubble(page)).toContainText('这是“参考网格”。')
    await clickBubble(page)
    await expect(bubble(page)).toContainText('这里的飞机也可点击旋转90度')
    await clickBubble(page)
    await expect(bubble(page)).toContainText('并且，这里的飞机也可以拖到空网格里。试试看！')

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
    // T3-4 幽灵说明（两段）→ 继续推进到 T3-8 着色按钮
    await expect(bubble(page)).toContainText('你创建了一个幽灵飞机！', { timeout: 10000 })
    await clickBubble(page)
    await expect(bubble(page)).toContainText('你可以创建多个幽灵飞机')
    await clickUntil(page, (t) => t.includes('这是坐标输入框'))
    await expect(bubble(page)).toContainText('这是坐标输入框，网格太小不便点击时，可输入坐标进行报点。')
    await clickBubble(page) // → T3-8 着色按钮（wait enteredColoring）

    // T3-8：着色按钮 spotlight 开洞 + 气泡文本
    await expect(bubble(page)).toContainText('点击这个按钮进入着色模式，长按可以选择颜色。', { timeout: 8000 })
    await expect(page.locator('.tutorial-spotlight:not(.tutorial-spotlight--dim)')).toBeVisible()

    // 右上跳过 → 二次确认 → P5 → 完成教程 → 回主页
    await hudSkip(page, '工具进阶').click()
    await confirmSkip(page)
    await expect(modal(page)).toContainText('进阶教程已完成，是否完成对局？')
    await modal(page).getByRole('button', { name: '完成教程' }).click()
    await expect(page.getByRole('heading', { name: '飞机杀' })).toBeVisible()

    expect(errs()).toEqual([])
  })

  test('入口「我已了解」→ 返回主页', async ({ page }) => {
    const errs = watchErrors(page)
    await page.goto('/')
    await page.getByRole('button', { name: '新手教程' }).click()
    await expect(modal(page)).toContainText('您是否了解本游戏的基本规则？')
    await modal(page).getByRole('button', { name: '我已了解' }).click()
    await expect(page.getByRole('heading', { name: '飞机杀' })).toBeVisible()
    expect(errs()).toEqual([])
  })

  test('单元1 气泡「跳过单元」→ 二次确认（取消保留 / 确认进单元2）；P3「返回主页」退出', async ({ page }) => {
    test.setTimeout(120_000)
    const errs = watchErrors(page)
    await page.goto('/')
    await page.getByRole('button', { name: '新手教程' }).click()
    await modal(page).getByRole('button', { name: '还不了解' }).click()

    // 单元1：气泡跳过 → 取消 → 仍停留在单元1
    await expect(bubble(page)).toContainText('欢迎来到《飞机杀》！我们先来学习如何摆阵吧！', { timeout: 8000 })
    await page.locator('.tutorial-bubble__skip', { hasText: '跳过单元' }).click()
    await expect(modal(page)).toContainText('确认跳过当前单元？')
    await modal(page).getByRole('button', { name: '取消' }).click()
    await expect(page.getByRole('heading', { name: '新手教程 · 摆阵' })).toBeVisible()

    // 再次跳过 → 确认（阵型不足由宿主随机补齐）→ 直接进入单元2
    await page.locator('.tutorial-bubble__skip', { hasText: '跳过单元' }).click()
    await modal(page).getByRole('button', { name: '确认' }).click()
    await expect(bubble(page)).toContainText('是时候学习如何对战了！', { timeout: 10000 })

    // P3「返回主页」：单元2 跳过确认 → P3 → 返回主页
    await hudSkip(page, '对战基础').click()
    await modal(page).getByRole('button', { name: '确认' }).click()
    await expect(modal(page)).toContainText('基础教程已完成，是否继续进阶教程？')
    await modal(page).getByRole('button', { name: '返回主页' }).click()
    await expect(page.getByRole('heading', { name: '飞机杀' })).toBeVisible()

    expect(errs()).toEqual([])
  })
})
