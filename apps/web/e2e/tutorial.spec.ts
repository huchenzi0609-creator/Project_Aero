/**
 * tutorial.spec —— 新手教程 e2e（qa-checklist-v030 G 段，v0.3.0）。
 *
 * 覆盖：
 * 1) 入口两分支：「还没有」→ 单元1摆阵；「是的」→ 直达单元3（工具进阶）；
 * 2) 单元1：T1-1 → 拖入一架 → T1-4 → 拖齐 3 架 → 旋转 → T1-7 突显「确认布阵」→ 进入单元2；
 * 3) 单元2：T2-1 → 双击报点 → 击空/击中分支其一 → 右上「跳过 · 对战基础」→ P3「继续教程」；
 * 4) 单元3：残局开局校验（我方被毁 1 架 → 残骸标记、对方先手）→ T3-1 → 拖参考飞机成幽灵 → T3-4
 *    → 右上「跳过 · 工具进阶」→ P5「完成教程」回主页；
 * 5) 全程 console 零 error；气泡/右上跳过按钮逐单元存在。
 *
 * AI 随机性处理：只做「等待出现」断言；拖拽使用确定性像素路径。
 */
import { expect, test } from '@playwright/test'
import { watchErrors } from './helpers'

/** 纸片弹窗（与教程气泡同是 role=dialog，需限定容器） */
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

/** 像素级拖拽 */
async function drag(page: import('@playwright/test').Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 14 })
  await page.mouse.up()
}

/** 从摆阵页把第 k 张待选牌拖到「可视左上角格 = (r,c)」（拖拽吸附取 round，指针放格内 0.25 处保证落格精确） */
async function dragDeckCardTo(page: import('@playwright/test').Page, r: number, c: number) {
  const card = page.locator('.placement__deck-card').first()
  const board = page.locator('.placement__board')
  const cb = await card.boundingBox()
  const bb = await board.boundingBox()
  if (!cb || !bb) throw new Error('待选牌/棋盘不可见')
  const cell = bb.width / 10 // 10×10 档
  const tx = bb.x + (c + 0.25) * cell
  const ty = bb.y + (r + 0.25) * cell
  await drag(page, { x: cb.x + cb.width / 2, y: cb.y + cb.height / 2 }, { x: tx, y: ty })
}

async function openTutorialEntry(page: import('@playwright/test').Page) {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '飞机杀' })).toBeVisible()
  await page.getByRole('button', { name: '新手教程' }).click()
  await expect(modal(page)).toContainText('您是否了解本游戏的基本规则？')
}

test.describe('新手教程', () => {
  test.setTimeout(240_000)

  test('入口「还没有」→ 单元1摆阵 → 单元2报点 → P3 继续教程 → 单元3 → P5 完成教程回主页', async ({ page }) => {
    const errs = watchErrors(page)

    /* ================= 入口 ================= */
    await openTutorialEntry(page)
    await modal(page).getByRole('button', { name: '还没有' }).click()

    /* ================= 单元1 摆阵（T1-1…T1-7） ================= */
    await expect(page.getByRole('heading', { name: '新手教程 · 摆阵' })).toBeVisible()
    await expect(bubble(page)).toContainText('欢迎来到《飞机杀》！我们先来学习如何摆阵吧！', { timeout: 8000 })
    // 单元1 跳过在气泡内
    await expect(page.locator('.tutorial-bubble__skip', { hasText: '跳过单元' })).toBeVisible()

    await bubble(page).click() // T1-2 飞机待选栏
    await expect(bubble(page)).toContainText('这是飞机待选栏，可以从这里把飞机拖到网格中。')
    await bubble(page).click() // T1-3 试试拖入
    await expect(bubble(page)).toContainText('现在就试试看吧！把飞机拖到网格里！')

    // 拖入第 1 架 → T1-4
    await dragDeckCardTo(page, 2, 0)
    await expect(bubble(page)).toContainText('好极了！现在尝试把剩余的飞机全部拖到网格里！', { timeout: 8000 })

    // 拖齐剩余 2 架（互不重叠摆放；右列避开旋转后的纵向伸展）
    await bubble(page).click() // 进入 T1-5（等待旋转）
    await dragDeckCardTo(page, 2, 5)
    await dragDeckCardTo(page, 6, 5)
    await expect(page.locator('.placement__plane')).toHaveCount(3)
    await expect(bubble(page)).toContainText('单击飞机可以使飞机旋转90度，试试看！', { timeout: 8000 })

    // 点击已摆飞机本体 → 旋转 → T1-6
    const placed = page.locator('.placement__plane').first()
    const pb = await placed.boundingBox()
    if (!pb) throw new Error('已摆飞机不可见')
    await page.mouse.click(pb.x + pb.width / 2, pb.y + pb.height / 2)
    await expect(bubble(page)).toContainText('太棒了！确保你的飞机不重叠不越界之后，就可以开始游戏了！', { timeout: 8000 })
    // 再点一次（转回，重新测包围盒）→ 阵型保持合法
    const pb2 = await placed.boundingBox()
    if (pb2) await page.mouse.click(pb2.x + pb2.width / 2, pb2.y + pb2.height / 2)
    await bubble(page).click() // → T1-7

    // T1-7：突显「确认布阵」，点击进入单元2
    const confirm = page.getByRole('button', { name: '确认布阵' })
    await expect(confirm).toBeEnabled()
    await expect(bubble(page)).toContainText('点击“确认布阵”开始游戏')
    await expect(page.locator('.tutorial-spotlight:not(.tutorial-spotlight--dim)')).toBeVisible()
    await confirm.click()

    /* ================= 单元2 对战（T2-1…；跳过 → P3） ================= */
    await expect(bubble(page)).toContainText('是时候学习如何对战了！', { timeout: 10000 })
    await expect(hudSkip(page, '对战基础')).toBeVisible()

    await bubble(page).click() // T2-2 空网格
    await expect(bubble(page)).toContainText('我们要在这张网格上找出对手的飞机机头的位置')
    await bubble(page).click() // T2-3 双击报点（wait shotByPlayer）
    await expect(bubble(page)).toContainText('试试双击一个格子')

    // 我方先手：横幅结束 + 轮到我方 → 双击 A1 报点
    const coordInput = page.getByLabel('报点坐标，如 A5')
    await expect(page.locator('.game-banner')).toBeHidden({ timeout: 8000 })
    await expect(coordInput).toBeEnabled({ timeout: 10000 })
    const a1 = page.locator('.game__opp .paper-grid__board button[aria-label="A1"]')
    await a1.click({ timeout: 2000 }).catch(() => {})
    await page.waitForTimeout(140)
    await a1.click({ timeout: 2000 }).catch(() => {})

    // T2-4：击空 / 击中分支文案其一（AI 随机性 → 用或断言 + 等待出现）
    const branch = page
      .locator('.tutorial-bubble__text')
      .filter({ hasText: /哎呀，不走运，这里没有飞机呢|机头就在这附近！/ })
    await expect(branch.first()).toBeVisible({ timeout: 10000 })

    // 右上跳过 → P3「基础教程已完成，是否继续进阶教程？」→ 继续教程
    await hudSkip(page, '对战基础').click()
    await expect(modal(page)).toContainText('基础教程已完成，是否继续进阶教程？')
    await modal(page).getByRole('button', { name: '继续教程' }).click()

    /* ================= 单元3 工具进阶（T3-1…T3-4；跳过 → P5） ================= */
    await expect(bubble(page)).toContainText('《飞机杀》有很多实用的对局工具呢！', { timeout: 10000 })
    await expect(hudSkip(page, '工具进阶')).toBeVisible()

    // 残局开局校验：我方等待（对方先手）；我方被毁 1 架 → 小网格上带击毁残骸标记
    await expect(page.locator('.game-banner')).toBeHidden({ timeout: 8000 })
    await expect(page.locator('.game__status-text')).toContainText(/等待对方报点|对方报点/, { timeout: 10000 })
    await expect
      .poll(async () => page.locator('.game__mine .paper-grid__stamp').count(), { timeout: 10000 })
      .toBeGreaterThanOrEqual(9)
    await expect(page.locator('.game__mine .paper-grid__stamp .stamp--kill')).toHaveCount(1)

    await bubble(page).click() // T3-2 参考网格（段1）
    await expect(bubble(page)).toContainText('这是“参考网格”')
    await bubble(page).click() // 段2
    await expect(bubble(page)).toContainText('这里的飞机也可点击旋转90度')
    await bubble(page).click() // T3-3 拖到空网格（wait ghostCreated）
    await expect(bubble(page)).toContainText('并且，这里的飞机也可以拖到空网格里。试试看！')

    // 拖参考飞机到对手棋盘空位 → ghostCreated → T3-4
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

    // 右上跳过 → P5 → 完成教程 → 回主页
    await hudSkip(page, '工具进阶').click()
    await expect(modal(page)).toContainText('进阶教程已完成，是否完成对局？')
    await modal(page).getByRole('button', { name: '完成教程' }).click()
    await expect(page.getByRole('heading', { name: '飞机杀' })).toBeVisible()

    expect(errs()).toEqual([])
  })

  test('入口「是的」→ 直达单元3：残局校验 → T3-1 → 跳过 → P5 完成回主页', async ({ page }) => {
    test.setTimeout(150_000)
    const errs = watchErrors(page)

    await openTutorialEntry(page)
    await modal(page).getByRole('button', { name: '是的' }).click()

    // 直达工具进阶（单元3）
    await expect(bubble(page)).toContainText('《飞机杀》有很多实用的对局工具呢！', { timeout: 12000 })
    await expect(hudSkip(page, '工具进阶')).toBeVisible()

    // 残局开局：我方等待（对方先手）+ 被毁残骸标记
    await expect(page.locator('.game-banner')).toBeHidden({ timeout: 8000 })
    await expect(page.locator('.game__status-text')).toContainText(/等待对方报点|对方报点/, { timeout: 10000 })
    await expect
      .poll(async () => page.locator('.game__mine .paper-grid__stamp').count(), { timeout: 10000 })
      .toBeGreaterThanOrEqual(9)
    await expect(page.locator('.game__mine .paper-grid__stamp .stamp--kill')).toHaveCount(1)

    await hudSkip(page, '工具进阶').click()
    await expect(modal(page)).toContainText('进阶教程已完成，是否完成对局？')
    await modal(page).getByRole('button', { name: '完成教程' }).click()
    await expect(page.getByRole('heading', { name: '飞机杀' })).toBeVisible()

    expect(errs()).toEqual([])
  })
})
