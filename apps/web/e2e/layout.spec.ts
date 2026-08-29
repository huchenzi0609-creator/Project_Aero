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
import { watchErrors } from './helpers'

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

async function runPortraitChecks(ctx: BrowserContext) {
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

  expect(errs()).toEqual([])
  await page.close()
}

test.describe('竖版 9:16 舞台布局', () => {
  test.setTimeout(120_000)

  test('390×667 竖版：摆阵与对局互不重叠、无溢出', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 667 } })
    await runPortraitChecks(ctx)
    await ctx.close()
  })

  test('390×844 竖版：摆阵与对局互不重叠、无溢出', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
    await runPortraitChecks(ctx)
    await ctx.close()
  })
})
