/**
 * coloring.spec —— 对局工具（v0.2.2 起；v0.3.0 更新导航与快捷着色语义）：
 *
 * 用例 1（着色画笔）：点染 A1/B1（黄）→ 拖拽 D1→F1（未染色起点=染色画笔）→
 * 拖拽 A1→C1（同色起点=擦除画笔）→ 长按换蓝 → 点击 A1 变蓝 → 退出着色 → 点格恢复高亮。
 *
 * 用例 2（样式参考飞机 + 快捷着色）：拖参考飞机到中央棋盘（ghost）→ 点击旋转（宽高互换）
 * → 着色模式点幽灵飞机 = 整架批量着色 + 回收幽灵 + 退出着色模式（快捷着色默认开）。
 *
 * 用例 3（快捷着色关闭）：点击幽灵飞机仅批量着色，不回收、不退出。
 *
 * 用例 4（开关关闭 allowMoveRefPlane=false）：参考飞机不可拖拽（无放置副本），点击旋转仍允许。
 *
 * 用例 5（摆阵本体命中）：包围盒空白格不旋转、本体格旋转。
 */
import { expect, test } from '@playwright/test'
import type { BrowserContext, Page } from '@playwright/test'
import { oppCell, practiceToPlacement, startSingleSmallGame, watchErrors } from './helpers'

/** 指定坐标的着色块（可按颜色过滤） */
function coloredAt(page: Page, coord: string, color?: string) {
  const colorCls = color ? `--${color}` : ''
  return page.locator(`.game__opp .paper-grid__colored${colorCls}[data-coord="${coord}"]`)
}

/** 从 from 格拖拽到 to 格（路径插值） */
async function dragCells(page: Page, from: string, to: string) {
  const a = await oppCell(page, from).boundingBox()
  const b = await oppCell(page, to).boundingBox()
  if (!a || !b) throw new Error(`格子不可见：${from} / ${to}`)
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 10 })
  await page.mouse.up()
}

/** 等待轮到己方（输入框可用；我方不主动报点则回合停在己方） */
async function waitMyTurn(page: Page) {
  const input = page.getByLabel('报点坐标，如 A5')
  await expect(input).toBeEnabled({ timeout: 10000 })
}

test.describe('对局着色工具', () => {
  test.setTimeout(120_000)

  test('着色画笔：点击三态 + 起始格决定拖拽画笔', async ({ page }) => {
    const errs = watchErrors(page)
    await startSingleSmallGame(page)

    const btn = page.locator('.coloring-stage__btn button')
    await expect(btn).toBeVisible()
    await btn.click()
    await expect(btn).toHaveAttribute('aria-pressed', 'true')

    // 点染 A1 / B1 → 黄色
    await oppCell(page, 'A1').click()
    await expect(coloredAt(page, 'A1', 'yellow')).toHaveCount(1)
    await oppCell(page, 'B1').click()
    await expect(coloredAt(page, 'B1', 'yellow')).toHaveCount(1)

    // 拖拽 D1→F1（未染色起点 → 染色画笔）：D1/E1/F1 路径染色
    await dragCells(page, 'D1', 'F1')
    await expect(coloredAt(page, 'D1', 'yellow')).toHaveCount(1)
    await expect(coloredAt(page, 'E1', 'yellow')).toHaveCount(1)
    await expect(coloredAt(page, 'F1', 'yellow')).toHaveCount(1)

    // 拖拽 A1→C1（同色起点 → 擦除画笔）：A1/B1/C1 还原为未染色
    await dragCells(page, 'A1', 'C1')
    await expect(coloredAt(page, 'A1')).toHaveCount(0)
    await expect(coloredAt(page, 'B1')).toHaveCount(0)
    await expect(coloredAt(page, 'C1')).toHaveCount(0)
    // D/E/F1 不受影响
    await expect(coloredAt(page, 'D1', 'yellow')).toHaveCount(1)
    await expect(coloredAt(page, 'F1', 'yellow')).toHaveCount(1)

    // 长按 → 选蓝 → 点击 A1（未染色 → 染蓝）
    const box = await btn.boundingBox()
    if (!box) throw new Error('着色按钮不可见')
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await expect(page.locator('.coloring-stage__btn .coloring-palette')).toBeVisible({ timeout: 3000 })
    await page.mouse.up()
    await page.locator('.coloring-stage__btn .coloring-swatch--blue').click()
    await expect(btn).toHaveAttribute('aria-pressed', 'true')
    await oppCell(page, 'A1').click()
    await expect(coloredAt(page, 'A1', 'blue')).toHaveCount(1)
    await expect(coloredAt(page, 'A1', 'yellow')).toHaveCount(0)

    // 退出着色 → 点格恢复报点（高亮出现；需等轮到己方）
    await btn.click()
    await expect(btn).toHaveAttribute('aria-pressed', 'false')
    await waitMyTurn(page)
    await oppCell(page, 'A1').click()
    await expect(page.locator('.game__opp .paper-grid__highlight')).toBeVisible()

    expect(errs()).toEqual([])
  })

  test('样式参考飞机 + 快捷着色：拖幽灵到棋盘、着色点幽灵=整架染黄并回收退出', async ({ page }) => {
    const errs = watchErrors(page)
    await startSingleSmallGame(page)

    const refPlane = page.locator('.game__ref .paper-grid__plane')
    await expect(refPlane).toBeVisible()

    // 拖参考飞机到中央对手棋盘 → 放置副本（ghost）
    const oppBoard = page.locator('.game__opp .paper-grid__board')
    const rp = await refPlane.boundingBox()
    const ob = await oppBoard.boundingBox()
    if (!rp || !ob) throw new Error('参考飞机/棋盘不可见')
    await page.mouse.move(rp.x + rp.width / 2, rp.y + rp.height / 2)
    await page.mouse.down()
    await page.mouse.move(ob.x + ob.width / 2, ob.y + ob.height / 2, { steps: 10 })
    await page.mouse.up()
    const placed = page.locator('.game__opp .paper-grid__plane--ghost')
    await expect(placed).toHaveCount(1)
    const pb = await placed.boundingBox()
    if (!pb) throw new Error('放置副本不可见')
    expect(pb.x >= ob.x && pb.x + pb.width <= ob.x + ob.width + 1).toBeTruthy()
    expect(pb.y >= ob.y && pb.y + pb.height <= ob.y + ob.height + 1).toBeTruthy()

    // v0.3.0 快捷着色（默认开）：着色模式点击幽灵飞机所在格 = 整机批量染黄 + 回收幽灵 + 退出着色
    const btn = page.locator('.coloring-stage__btn button')
    await btn.click()
    await expect(btn).toHaveAttribute('aria-pressed', 'true')
    // 点击幽灵中心（命中其机体格 → 整机批量着色）
    await page.mouse.click(pb.x + pb.width / 2, pb.y + pb.height / 2)
    await expect(page.locator('.game__opp .paper-grid__colored--yellow')).toHaveCount(10)
    await expect(page.locator('.game__opp .paper-grid__plane--ghost')).toHaveCount(0)
    await expect(btn).toHaveAttribute('aria-pressed', 'false')

    expect(errs()).toEqual([])
  })

  test('快捷着色关闭：点击幽灵飞机仅批量着色，不回收、不退出着色', async ({ browser }) => {
    const ctx: BrowserContext = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const page = await ctx.newPage()
    const errs = watchErrors(page)
    // 预置设置存档：quickColor=false（zustand persist 格式）
    await page.addInitScript(() => {
      localStorage.setItem(
        'aero-settings',
        JSON.stringify({ state: { quickColor: false }, version: 0 }),
      )
    })
    await startSingleSmallGame(page)

    // 拖参考飞机到对手棋盘（与上例相同路径）
    const refPlane = page.locator('.game__ref .paper-grid__plane')
    await expect(refPlane).toBeVisible()
    const oppBoard = page.locator('.game__opp .paper-grid__board')
    const rp = await refPlane.boundingBox()
    const ob = await oppBoard.boundingBox()
    if (!rp || !ob) throw new Error('参考飞机/棋盘不可见')
    await page.mouse.move(rp.x + rp.width / 2, rp.y + rp.height / 2)
    await page.mouse.down()
    await page.mouse.move(ob.x + ob.width / 2, ob.y + ob.height / 2, { steps: 10 })
    await page.mouse.up()
    const placed = page.locator('.game__opp .paper-grid__plane--ghost')
    await expect(placed).toHaveCount(1)
    const pb = await placed.boundingBox()
    if (!pb) throw new Error('放置副本不可见')

    const btn = page.locator('.coloring-stage__btn button')
    await btn.click()
    await expect(btn).toHaveAttribute('aria-pressed', 'true')
    await page.mouse.click(pb.x + pb.width / 2, pb.y + pb.height / 2)
    // 批量着色生效，但幽灵仍在、着色模式未退出（快捷着色关闭）
    await expect(page.locator('.game__opp .paper-grid__colored--yellow')).toHaveCount(10)
    await expect(page.locator('.game__opp .paper-grid__plane--ghost')).toHaveCount(1)
    await expect(btn).toHaveAttribute('aria-pressed', 'true')

    expect(errs()).toEqual([])
    await ctx.close()
  })

  test('开关关闭后参考飞机不可拖拽（点击旋转仍允许）', async ({ browser }) => {
    const ctx: BrowserContext = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const page = await ctx.newPage()
    const errs = watchErrors(page)
    // 预置设置存档：allowMoveRefPlane=false（zustand persist 格式）
    await page.addInitScript(() => {
      localStorage.setItem(
        'aero-settings',
        JSON.stringify({ state: { allowMoveRefPlane: false }, version: 0 }),
      )
    })
    await startSingleSmallGame(page)

    const refPlane = page.locator('.game__ref .paper-grid__plane')
    await expect(refPlane).toBeVisible()

    // 点击旋转仍允许（宽高互换）
    const before = await refPlane.boundingBox()
    await refPlane.click()
    await page.waitForTimeout(200)
    const after = await refPlane.boundingBox()
    if (!before || !after) throw new Error('参考飞机尺寸不可读')
    expect(before.width > before.height).toBeTruthy()
    expect(after.width < after.height).toBeTruthy()

    // 拖拽到对手棋盘 → 不产生放置副本
    const oppBoard = page.locator('.game__opp .paper-grid__board')
    const rp = await refPlane.boundingBox()
    const ob = await oppBoard.boundingBox()
    if (!rp || !ob) throw new Error('参考飞机/棋盘不可见')
    await page.mouse.move(rp.x + rp.width / 2, rp.y + rp.height / 2)
    await page.mouse.down()
    await page.mouse.move(ob.x + ob.width / 2, ob.y + ob.height / 2, { steps: 10 })
    await page.mouse.up()
    await expect(page.locator('.game__opp .paper-grid__plane')).toHaveCount(0)

    expect(errs()).toEqual([])
    await ctx.close()
  })

  test('摆阵飞机本体命中：包围盒空白格不旋转、本体格旋转', async ({ page }) => {
    const errs = watchErrors(page)
    await practiceToPlacement(page, '经典模式')

    // 拖第一张待选卡（rotation 0）到棋盘中央
    const card = page.locator('.placement__deck-card').first()
    const board = page.locator('.placement__board')
    const cb = await card.boundingBox()
    const bb = await board.boundingBox()
    if (!cb || !bb) throw new Error('待选卡/棋盘不可见')
    await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2)
    await page.mouse.down()
    await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2, { steps: 10 })
    await page.mouse.up()
    await expect(page.locator('.placement__plane')).toHaveCount(1)
    const plane = page.locator('.placement__plane').first()

    // 旋转前：默认形状 5×4（宽 > 高）
    const p0 = await plane.boundingBox()
    if (!p0) throw new Error('飞机不可见')
    expect(p0.width > p0.height).toBe(true)

    // v0.2.7：点击包围盒左上角空白格（默认形状 (0,0) 为空）→ 不旋转（宽高不变）
    await page.mouse.click(p0.x + 3, p0.y + 3)
    await page.waitForTimeout(200)
    const p1 = await plane.boundingBox()
    expect(p1?.width).toBe(p0.width)
    expect(p1?.height).toBe(p0.height)

    // 点击本体中心（默认形状 (2,2) 为机身格）→ 旋转 90°（4×5，宽 < 高）
    await page.mouse.click(p0.x + p0.width / 2, p0.y + p0.height / 2)
    await page.waitForTimeout(200)
    const p2 = await plane.boundingBox()
    expect(p2?.width < p2?.height).toBe(true)

    expect(errs()).toEqual([])
  })
})
