/**
 * coloring.spec —— 对局工具（v0.2.2，单机）：
 *
 * 用例 1（着色画笔）：点染 A1/B1（黄）→ 拖拽 D1→F1（未染色起点=染色画笔，路径 D1/E1/F1 变黄）
 * → 拖拽 A1→C1（同色起点=擦除画笔，A1/B1/C1 还原为未染色）→ 长按换蓝 → 点击 A1 变蓝
 * → 退出着色 → 点格恢复报点（高亮）→ 零 console 错误。
 *
 * 用例 2（样式参考飞机）：拖参考飞机到中央棋盘（断言 ghost 类与位置）→ 点击旋转（宽高互换）
 * → 着色模式点飞机：批量染 10 格 → 再点批量擦除 → 零 console 错误。
 *
 * 用例 3（开关关闭）：localStorage 预置 allowMoveRefPlane=false → 参考飞机不可拖拽（无放置副本），
 * 点击旋转仍允许 → 零 console 错误。
 */
import { expect, test } from '@playwright/test'
import type { BrowserContext, Page } from '@playwright/test'
import { oppCell, watchErrors } from './helpers'

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

/** 进入单机小型档对局（默认 1280 视口 = 横版），等待横幅结束 */
async function enterGame(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: '单人对局' }).click()
  await page.getByRole('button', { name: /小型 · 10×10/ }).click()
  await expect(page.getByRole('heading', { name: '摆阵 · 单人对局' })).toBeVisible()
  await page.getByRole('button', { name: '随机摆阵' }).click()
  await expect(page.locator('.placement__status')).toContainText('校验通过')
  await page.getByRole('button', { name: '确认布阵' }).click()
  await expect(page.locator('.game-banner')).toBeVisible()
  await expect(page.locator('.game-banner')).toBeHidden({ timeout: 5000 })
}

test.describe('对局着色工具', () => {
  test.setTimeout(120_000)

  test('着色画笔：点击三态 + 起始格决定拖拽画笔', async ({ page }) => {
    const errs = watchErrors(page)
    await enterGame(page)

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

    // 退出着色 → 点格恢复报点（高亮出现）
    await btn.click()
    await expect(btn).toHaveAttribute('aria-pressed', 'false')
    await oppCell(page, 'A1').click()
    await expect(page.locator('.game__opp .paper-grid__highlight')).toBeVisible()

    expect(errs()).toEqual([])
  })

  test('样式参考飞机：拖到中央棋盘 / 点击旋转 / 着色批量染擦', async ({ page }) => {
    const errs = watchErrors(page)
    await enterGame(page)

    const refPlane = page.locator('.game__ref .paper-grid__plane')
    await expect(refPlane).toBeVisible()

    // 拖参考飞机到中央对手棋盘
    const oppBoard = page.locator('.game__opp .paper-grid__board')
    const rp = await refPlane.boundingBox()
    const ob = await oppBoard.boundingBox()
    if (!rp || !ob) throw new Error('参考飞机/棋盘不可见')
    await page.mouse.move(rp.x + rp.width / 2, rp.y + rp.height / 2)
    await page.mouse.down()
    await page.mouse.move(ob.x + ob.width / 2, ob.y + ob.height / 2, { steps: 10 })
    await page.mouse.up()

    // 放置副本：ghost 类 + 位于棋盘内
    const placed = page.locator('.game__opp .paper-grid__plane--ghost')
    await expect(placed).toHaveCount(1)
    const pb = await placed.boundingBox()
    if (!pb) throw new Error('放置副本不可见')
    expect(pb.x >= ob.x && pb.x + pb.width <= ob.x + ob.width + 1).toBeTruthy()
    expect(pb.y >= ob.y && pb.y + pb.height <= ob.y + ob.height + 1).toBeTruthy()

    // v0.2.7：点击包围盒内【空白格】（默认形状左上角格为空）→ 不旋转（宽高不变）
    const beforeMiss = await placed.boundingBox()
    if (beforeMiss) {
      await page.mouse.click(beforeMiss.x + 3, beforeMiss.y + 3)
      await page.waitForTimeout(200)
      const afterMiss = await placed.boundingBox()
      expect(afterMiss?.width).toBe(beforeMiss.width)
      expect(afterMiss?.height).toBe(beforeMiss.height)
    }

    // 点击放置副本【本体】中心 → 旋转 90°（默认形状 5×4 → 4×5，宽高互换）
    const before = await placed.boundingBox()
    await placed.click()
    await page.waitForTimeout(200)
    const after = await placed.boundingBox()
    if (!before || !after) throw new Error('放置副本尺寸不可读')
    expect(before.width > before.height).toBeTruthy() // 旋转前 5 列 × 4 行
    expect(after.width < after.height).toBeTruthy() // 旋转后 4 列 × 5 行

    // 着色模式：点飞机 → 整机批量染黄（默认形状 10 格）
    const btn = page.locator('.coloring-stage__btn button')
    await btn.click()
    await expect(btn).toHaveAttribute('aria-pressed', 'true')
    await placed.click()
    await expect(page.locator('.game__opp .paper-grid__colored--yellow')).toHaveCount(10)
    // 再点（命中格同色）→ 整机批量擦除
    await placed.click()
    await expect(page.locator('.game__opp .paper-grid__colored')).toHaveCount(0)

    expect(errs()).toEqual([])
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
    await enterGame(page)

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
    await page.goto('/')
    await page.getByRole('button', { name: '单人对局' }).click()
    await page.getByRole('button', { name: /小型 · 10×10/ }).click()
    await expect(page.getByRole('heading', { name: '摆阵 · 单人对局' })).toBeVisible()

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
