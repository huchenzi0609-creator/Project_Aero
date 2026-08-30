/**
 * fab.spec —— 全局小浮窗「回到未完成的对局」（v0.2.9）：
 *
 * 用例 1（摆阵中）：双人房间摆阵阶段 → A 刷新落主页 → 浮窗出现（图标、约 48px、无文字）
 * → 单击浮窗回到联机摆阵 → 浮窗隐藏（已在界面内）；
 * 用例 2（拖拽吸附 + 单击导航区分）：拖拽浮窗到另一侧边缘 → 释放吸附（x 明显变化）；
 *   拖拽后单击仍回到摆阵（非拖拽才触发导航）；
 * 用例 3（房间清理）：摆阵中确认退出 → 房间清理（leaveRoom）→ 主页不再出现浮窗；
 * 用例 4（对局中）：双方就绪进入对局 → A 刷新 → 浮窗出现 → 单击回到联机对局。
 * 全程零 console 错误。
 */
import { expect, test } from '@playwright/test'
import type { BrowserContext, Page } from '@playwright/test'
import { watchErrors } from './helpers'

/** A 建房、B 入房（双人摆阵阶段）；返回房间码 */
async function createTwoPlayerRoom(A: Page, B: Page): Promise<string> {
  await A.goto('/')
  await A.getByRole('button', { name: '联机对战' }).click()
  await A.getByRole('button', { name: '创建房间' }).click()
  await expect(A.locator('.online__roomcode')).toBeVisible({ timeout: 10000 })
  const code = (await A.locator('.online__roomcode').innerText()).trim()
  expect(code).toMatch(/^[A-Z0-9]{6}$/)
  await B.goto('/')
  await B.getByRole('button', { name: '联机对战' }).click()
  await B.getByLabel('房码输入').fill(code)
  await B.getByRole('button', { name: '加入房间' }).click()
  await expect(B.locator('.online__roomcode')).toHaveText(code, { timeout: 10000 })
  await expect(A.locator('.placement__board')).toBeVisible({ timeout: 10000 })
  return code
}

/** 双方随机摆阵并就绪（进入对局） */
async function bothReady(A: Page, B: Page) {
  for (const p of [A, B]) {
    await p.getByRole('button', { name: '随机摆阵' }).click()
    await expect(p.getByRole('button', { name: '确认布阵并就绪' })).toBeEnabled({ timeout: 10000 })
    await p.getByRole('button', { name: '确认布阵并就绪' }).click()
  }
  await expect(A.locator('.game__opp .paper-grid__board')).toBeVisible({ timeout: 20000 })
  await expect(B.locator('.game__opp .paper-grid__board')).toBeVisible({ timeout: 20000 })
}

test.describe('回到未完成对局浮窗', () => {
  test.setTimeout(150_000)

  test('摆阵中刷新→浮窗→点击回摆阵；拖拽吸附；退出清房间；对局中刷新→浮窗→点击回对局', async ({
    browser,
  }) => {
    const ctxA: BrowserContext = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const ctxB: BrowserContext = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const A = await ctxA.newPage()
    const B = await ctxB.newPage()
    const errsA = watchErrors(A)
    const errsB = watchErrors(B)
    const fab = A.locator('.fab')

    // ---- 无未完成对局：主页不出现浮窗 ----
    await A.goto('/')
    await expect(fab).toHaveCount(0)

    // ---- 摆阵中（双人）刷新 → 浮窗出现 → 单击回到联机摆阵 ----
    await createTwoPlayerRoom(A, B)
    await expect(fab).toHaveCount(0) // 已在摆阵页内不显示
    await A.reload()
    await expect(fab).toBeVisible({ timeout: 15000 })
    // 圆形图标：宽高约 48px、无文字
    const box = await fab.boundingBox()
    if (!box) throw new Error('浮窗不可见')
    expect(box.width).toBeGreaterThanOrEqual(42)
    expect(box.width).toBeLessThanOrEqual(54)
    expect(box.height).toBeGreaterThanOrEqual(42)
    expect(Math.abs(box.width - box.height)).toBeLessThanOrEqual(2)
    await fab.click()
    await expect(A.locator('.placement__board')).toBeVisible({ timeout: 10000 })
    await expect(fab).toHaveCount(0) // 已回到界面内 → 隐藏

    // ---- 拖拽浮窗到左侧边缘 → 释放吸附（x 明显变化），拖拽后单击仍导航 ----
    await A.reload()
    await expect(fab).toBeVisible({ timeout: 15000 })
    const before = await fab.boundingBox()
    if (!before) throw new Error('浮窗不可见')
    await A.mouse.move(before.x + before.width / 2, before.y + before.height / 2)
    await A.mouse.down()
    await A.mouse.move(60, before.y + before.height / 2, { steps: 8 })
    await A.mouse.up()
    await A.waitForTimeout(200)
    const after = await fab.boundingBox()
    if (!after) throw new Error('拖拽后浮窗不可见')
    expect(after.x).toBeLessThan(before.x - 100) // 吸附到左侧边缘
    await fab.click()
    await expect(A.locator('.placement__board')).toBeVisible({ timeout: 10000 })

    // ---- 确认退出摆阵：leaveRoom 清理房间 → 主页不再出现浮窗 ----
    await A.getByRole('button', { name: '← 退出' }).click()
    await A.getByRole('button', { name: '确认退出' }).click()
    await expect(A.locator('.online__card-title').first()).toBeVisible({ timeout: 10000 })
    await A.getByRole('button', { name: '← 返回主页' }).click()
    await expect(A.getByRole('heading', { name: '方格空袭' })).toBeVisible({ timeout: 10000 })
    await expect(fab).toHaveCount(0)

    // ---- 双方就绪进入对局 → A 刷新 → 浮窗出现 → 单击回到联机对局 ----
    await createTwoPlayerRoom(A, B)
    await bothReady(A, B)
    await expect(fab).toHaveCount(0)
    await A.reload()
    await expect(fab).toBeVisible({ timeout: 15000 })
    await fab.click()
    await expect(A.locator('.game__opp .paper-grid__board')).toBeVisible({ timeout: 15000 })
    await expect(fab).toHaveCount(0)

    expect(errsA()).toEqual([])
    expect(errsB()).toEqual([])
    await ctxA.close()
    await ctxB.close()
  })
})
