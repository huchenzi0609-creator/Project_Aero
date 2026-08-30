/**
 * layout.spec —— 竖版 9:16 舞台适配（v0.2.3）：
 *
 * 在 390×667 与 390×844 竖版视口下：
 * - 单机摆阵：待选牌组（托盘）与棋盘 boundingBox 不重叠、无横向溢出；
 * - 单机对局：输入栏与中央棋盘 boundingBox 不重叠、状态条在最上、舞台宽高比 ≈ 9:16、无横向溢出；
 * - 全程零 console 错误。
 *
 * 舞台契约（.app-stage / cq 单位 / useViewport 舞台尺寸）由舞台 agent 落地，
 * 本 spec 直接消费真实舞台。
 */
import { expect, test } from '@playwright/test'
import type { BrowserContext, Page } from '@playwright/test'
import { allCoords, oppCell, watchErrors } from './helpers'

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

function overlap(a: Rect | null, b: Rect | null): boolean {
  if (!a || !b) throw new Error('元素不可见，无法比较')
  return !(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y)
}

/** 舞台容器内无横向溢出（scrollWidth 不超 clientWidth） */
async function noHorizontalOverflow(page: Page): Promise<boolean> {
  const overflow = await page.evaluate(() => {
    const stageEl = document.querySelector('.app-stage')
    if (!stageEl) return -1
    return stageEl.scrollWidth - stageEl.clientWidth
  })
  return overflow >= 0 && overflow <= 1
}

/** 页面容器无内部纵向滚动（scrollHeight 不超 clientHeight） */
async function noVerticalScroll(page: Page, selector: string): Promise<boolean> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (!el) return false
    return el.scrollHeight <= el.clientHeight + 1
  }, selector)
}

async function runPortraitChecks(
  ctx: BrowserContext,
  viewport: { width: number; height: number },
) {
  const page = await ctx.newPage()
  const errs = watchErrors(page)
  await page.goto('/')

  // ---- 舞台宽高比 ≈ 9:16 ----
  const stage = await page.locator('.app-stage').boundingBox()
  if (!stage) throw new Error('舞台未渲染')
  const ratio = stage.height / stage.width
  expect(Math.abs(ratio - 16 / 9)).toBeLessThan(0.03)

  // ---- 单机摆阵：待选牌组（托盘）与棋盘不重叠、无内部滚动、无横向溢出 ----
  await page.getByRole('button', { name: '单人对局' }).click()
  await page.getByRole('button', { name: /小型 · 10×10/ }).click()
  await expect(page.getByRole('heading', { name: '摆阵 · 单人对局' })).toBeVisible()
  const tray = await page.locator('.placement__tray').boundingBox()
  const board = await page.locator('.placement__board').boundingBox()
  expect(overlap(tray, board)).toBe(false)
  expect(await noVerticalScroll(page, '.placement')).toBe(true)
  expect(await noHorizontalOverflow(page)).toBe(true)

  // ---- 单机对局：无内部滚动；参考卡在左、我方卡在右同一行且都在中央棋盘上方；输入栏不重叠 ----
  await page.getByRole('button', { name: '随机摆阵' }).click()
  await expect(page.locator('.placement__status')).toContainText('校验通过')
  await page.getByRole('button', { name: '确认布阵' }).click()
  await expect(page.locator('.game-banner')).toBeVisible()
  await expect(page.locator('.game-banner')).toBeHidden({ timeout: 5000 })

  const refCard = await page.locator('.game__ref').boundingBox()
  const mineCard = await page.locator('.game__mine').boundingBox()
  const oppBoard = await page.locator('.game__opp .paper-grid__board').boundingBox()
  const inputbar = await page.locator('.game__inputbar').boundingBox()
  const statusbar = await page.locator('.game__statusbar').boundingBox()
  expect(overlap(oppBoard, inputbar)).toBe(false)
  if (refCard && mineCard && oppBoard && inputbar && statusbar) {
    // 参考在左、我方在右、同一行（顶对齐）
    expect(refCard.x < mineCard.x).toBe(true)
    expect(Math.abs(refCard.y - mineCard.y)).toBeLessThan(20)
    // 参考/我方行在中央棋盘上方
    expect(refCard.y + refCard.height <= oppBoard.y + 1).toBe(true)
    expect(mineCard.y + mineCard.height <= oppBoard.y + 1).toBe(true)
    // 状态条在最上、输入栏在最下
    expect(statusbar.y < refCard.y).toBe(true)
    expect(oppBoard.y < inputbar.y).toBe(true)
  }
  expect(await noVerticalScroll(page, '.game')).toBe(true)
  expect(await noHorizontalOverflow(page)).toBe(true)

  // ---- 尺寸冻结：进入对局后切换视口高度，棋盘/参考/我方网格尺寸保持不变 ----
  const boardW1 = (await page.locator('.game__opp .paper-grid__board').boundingBox())?.width
  const refW1 = (await page.locator('.game__ref .paper-grid__board').boundingBox())?.width
  const mineW1 = (await page.locator('.game__mine .paper-grid__board').boundingBox())?.width
  if (boardW1 !== undefined && refW1 !== undefined && mineW1 !== undefined) {
    const otherH = viewport.height === 667 ? 844 : 667
    await page.setViewportSize({ width: viewport.width, height: otherH })
    await page.waitForTimeout(400)
    const boardW2 = (await page.locator('.game__opp .paper-grid__board').boundingBox())?.width
    const refW2 = (await page.locator('.game__ref .paper-grid__board').boundingBox())?.width
    const mineW2 = (await page.locator('.game__mine .paper-grid__board').boundingBox())?.width
    expect(boardW2).toBe(boardW1)
    expect(refW2).toBe(refW1)
    expect(mineW2).toBe(mineW1)
  }

  expect(errs()).toEqual([])
  await page.close()
}

test.describe('竖版 9:16 舞台布局', () => {
  test.setTimeout(120_000)

  test('390×667 竖版：摆阵与对局互不重叠、无溢出；尺寸冻结', async ({ browser }) => {
    const viewport = { width: 390, height: 667 }
    const ctx = await browser.newContext({ viewport })
    await runPortraitChecks(ctx, viewport)
    await ctx.close()
  })

  test('390×844 竖版：摆阵与对局互不重叠、无溢出；尺寸冻结', async ({ browser }) => {
    const viewport = { width: 390, height: 844 }
    const ctx = await browser.newContext({ viewport })
    await runPortraitChecks(ctx, viewport)
    await ctx.close()
  })

  test('390×667 竖版结算：两真实阵型棋盘并排、无滚动、尺寸冻结', async ({ browser }) => {
    test.setTimeout(180_000)
    const ctx = await browser.newContext({ viewport: { width: 390, height: 667 } })
    const page = await ctx.newPage()
    const errs = watchErrors(page)
    // 难度地狱：AI 更快找到我方机队，缩短对局
    await page.addInitScript(() => {
      localStorage.setItem(
        'aero-settings',
        JSON.stringify({ state: { difficulty: 'hell' }, version: 0 }),
      )
    })
    await page.goto('/')
    await page.getByRole('button', { name: '单人对局' }).click()
    await page.getByRole('button', { name: /小型 · 10×10/ }).click()
    await expect(page.getByRole('heading', { name: '摆阵 · 单人对局' })).toBeVisible()
    await page.getByRole('button', { name: '随机摆阵' }).click()
    await page.getByRole('button', { name: '确认布阵' }).click()
    await expect(page.locator('.game-banner')).toBeVisible()
    await expect(page.locator('.game-banner')).toBeHidden({ timeout: 5000 })

    // ---- 报点循环至结算（复用 single.spec 手法） ----
    const result = page.locator('.result')
    const coordInput = page.getByLabel('报点坐标，如 A5')
    const shotCoords = allCoords(10, 10)
    const shotSet = new Set<string>()
    let shotIndex = 0
    let rounds = 0
    while (rounds < 150 && !(await result.isVisible().catch(() => false))) {
      rounds += 1
      if (!(await coordInput.isEnabled())) {
        await page.waitForTimeout(250)
        continue
      }
      while (shotSet.has(shotCoords[shotIndex] ?? '')) shotIndex += 1
      const coord = shotCoords[shotIndex] ?? 'A1'
      shotSet.add(coord)
      const cell = oppCell(page, coord)
      await cell.click()
      await page.waitForTimeout(120)
      await cell.click()
      await page.waitForTimeout(900)
    }
    await expect(result).toBeVisible({ timeout: 30000 })

    // ---- 两真实阵型棋盘并排（同行、x 递增） ----
    const boardA = result.locator('.result__board').nth(0)
    const boardB = result.locator('.result__board').nth(1)
    const gridA = boardA.locator('.paper-grid__board')
    const gridB = boardB.locator('.paper-grid__board')
    const ra = await boardA.boundingBox()
    const rb = await boardB.boundingBox()
    const ga = await gridA.boundingBox()
    const gb = await gridB.boundingBox()
    if (ra && rb && ga && gb) {
      expect(ra.x < rb.x).toBe(true)
      expect(Math.abs(ra.y - rb.y)).toBeLessThan(20)
      expect(ga.x < gb.x).toBe(true)
    }

    // ---- 结算容器无内部滚动、无横向溢出 ----
    const noScroll = await page.evaluate(() => {
      const el = document.querySelector('.result')
      if (!el) return false
      return el.scrollHeight <= el.clientHeight + 1
    })
    expect(noScroll).toBe(true)
    const noH = await page.evaluate(() => {
      const el = document.querySelector('.result')
      if (!el) return false
      return el.scrollWidth <= el.clientWidth + 1
    })
    expect(noH).toBe(true)

    // ---- 结算尺寸冻结：切换视口高度后两棋盘宽度不变 ----
    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForTimeout(400)
    const ga2 = await gridA.boundingBox()
    const gb2 = await gridB.boundingBox()
    expect(ga2?.width).toBe(ga?.width)
    expect(gb2?.width).toBe(gb?.width)

    expect(errs()).toEqual([])
    await ctx.close()
  })
})
