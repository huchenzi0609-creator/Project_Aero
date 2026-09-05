/**
 * fab.spec —— 全局小浮窗「回到未完成的对局」（v0.2.9；v0.3.0 导航 + 每场景独立连接）：
 *
 * 阶段 1（摆阵中刷新）：双人摆阵 → A 刷新落主页 → 浮窗出现（约 48px 圆钮）→ 单击回到联机摆阵 → 隐藏；
 * 阶段 2（拖拽吸附 + 退出清房间）：拖拽浮窗到左缘吸附；确认退出 → 房间清理，主页不再出现浮窗；
 * 阶段 3（对局中刷新）：双方就绪进入对局 → A 刷新 → 浮窗 → 单击回到联机对局。
 * 全程零 console 错误。
 */
import { expect, test } from '@playwright/test'
import type { BrowserContext } from '@playwright/test'
import { bothReadyOnline, createRoomHost, joinRoomByCode, watchErrors } from './helpers'

async function pairContexts(browser: import('@playwright/test').Browser) {
  const ctxA: BrowserContext = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const ctxB: BrowserContext = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const A = await ctxA.newPage()
  const B = await ctxB.newPage()
  return { ctxA, ctxB, A, B, errsA: watchErrors(A), errsB: watchErrors(B) }
}

/** 建房 + B 加入（返回 A、B） */
async function twoInRoom(browser: import('@playwright/test').Browser) {
  const { ctxA, ctxB, A, B, errsA, errsB } = await pairContexts(browser)
  const code = await createRoomHost(A)
  await joinRoomByCode(B, code)
  await expect(A.locator('.placement__board')).toBeVisible({ timeout: 10000 })
  return { ctxA, ctxB, A, B, errsA, errsB }
}

test.describe('回到未完成对局浮窗', () => {
  test.setTimeout(150_000)

  test('摆阵中刷新→浮窗→点击回摆阵', async ({ browser }) => {
    const { ctxA, ctxB, A, errsA, errsB } = await twoInRoom(browser)
    const fab = A.locator('.fab')
    await expect(fab).toHaveCount(0) // 已在摆阵页内不显示
    await A.reload()
    await expect(fab).toBeVisible({ timeout: 15000 })
    const box = await fab.boundingBox()
    if (!box) throw new Error('浮窗不可见')
    expect(box.width).toBeGreaterThanOrEqual(42)
    expect(box.width).toBeLessThanOrEqual(54)
    expect(Math.abs(box.width - box.height)).toBeLessThanOrEqual(2)
    await fab.click()
    await expect(A.locator('.placement__board')).toBeVisible({ timeout: 10000 })
    await expect(fab).toHaveCount(0)
    expect(errsA()).toEqual([])
    expect(errsB()).toEqual([])
    await ctxA.close()
    await ctxB.close()
  })

  test('拖拽吸附到边缘；确认退出清理房间后主页无浮窗', async ({ browser }) => {
    const { ctxA, ctxB, A, errsA, errsB } = await twoInRoom(browser)
    const fab = A.locator('.fab')
    await A.reload()
    await expect(fab).toBeVisible({ timeout: 15000 })

    // 拖拽到左侧边缘 → 释放吸附（x 明显变化）；拖拽后单击仍回到摆阵
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

    // 确认退出摆阵：leaveRoom 清理房间 → 主页不再出现浮窗
    await A.getByRole('button', { name: '← 退出' }).click()
    await A.getByRole('button', { name: '确认退出' }).click()
    await expect(A.locator('.online__card-title').first()).toBeVisible({ timeout: 10000 })
    await A.getByRole('button', { name: '← 返回主页' }).click()
    await expect(A.getByRole('heading', { name: '飞机杀' })).toBeVisible({ timeout: 10000 })
    await expect(fab).toHaveCount(0)

    expect(errsA()).toEqual([])
    expect(errsB()).toEqual([])
    await ctxA.close()
    await ctxB.close()
  })

  test('对局中刷新→浮窗→点击回联机对局', async ({ browser }) => {
    const { ctxA, ctxB, A, B, errsA, errsB } = await twoInRoom(browser)
    const fab = A.locator('.fab')
    await bothReadyOnline(A, B)
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
