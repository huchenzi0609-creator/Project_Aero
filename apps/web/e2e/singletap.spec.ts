/**
 * singletap.spec —— v0.3.16「单击报点」设置（默认关）行为验收：
 * 1) 单机·关：保持两步确认（第 1 次点击仅选中、第 2 次才出枪）——回归；
 * 2) 单机·开：单击空格即出枪；
 * 3) 联机·开：单击即出枪；出枪后（非回合方）单击即创建预报点「?」（无需第二次点击）。
 *
 * 设置经 localStorage['aero-settings'] 注入（与设置页持久化同一键，缺省键按 store 默认合并）。
 */
import { expect, test } from '@playwright/test'
import {
  bothReadyOnline,
  createRoomHost,
  joinRoomByCode,
  oppCell,
  startSingleSmallGame,
  waitMyTurn,
  watchErrors,
} from './helpers'

const enableSingleTap = () => {
  localStorage.setItem('aero-settings', JSON.stringify({ state: { singleTapShot: true }, version: 0 }))
}

test.describe('单击报点（v0.3.16）', () => {
  test('单机·关（默认）：两步确认不变——第 1 次点击仅选中，第 2 次才出枪', async ({ page }) => {
    test.setTimeout(180_000)
    const errs = watchErrors(page)
    await startSingleSmallGame(page, '经典模式')

    const status = page.locator('.game__status-text')
    const input = page.getByLabel('报点坐标，如 A5')
    await waitMyTurn(page)
    const a1 = oppCell(page, 'A1')

    await a1.click() // 第 1 次：仅选中
    await page.waitForTimeout(500)
    expect(await input.inputValue(), '两步语义：首次点击后坐标填入输入框（选中态）').toBe('A1')
    expect(await status.innerText(), '首次点击不应出枪').not.toContain('我方报点 A1')

    await a1.click() // 第 2 次：出枪
    await expect.poll(async () => status.innerText(), { timeout: 8000 }).toContain('我方报点 A1')

    expect(errs()).toEqual([])
  })

  test('单机·开：单击空格即出枪（设置页开关同键持久化）', async ({ page }) => {
    test.setTimeout(180_000)
    const errs = watchErrors(page)
    await page.addInitScript(enableSingleTap)
    await startSingleSmallGame(page, '经典模式')

    const status = page.locator('.game__status-text')
    await waitMyTurn(page)
    await oppCell(page, 'A1').click() // 单击
    await expect.poll(async () => status.innerText(), { timeout: 8000 }).toContain('我方报点 A1')

    expect(errs()).toEqual([])
  })

  test('联机·开：单击即出枪；非回合方单击即创建预报点', async ({ browser }) => {
    test.setTimeout(240_000)
    const ctxA = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const ctxB = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const A = await ctxA.newPage()
    const B = await ctxB.newPage()
    const errsA = watchErrors(A)
    const errsB = watchErrors(B)
    for (const p of [A, B]) await p.addInitScript(enableSingleTap)

    const code = await createRoomHost(A)
    await joinRoomByCode(B, code)
    await bothReadyOnline(A, B)
    for (const p of [A, B]) {
      await expect(p.locator('.game__status-text')).toContainText(/轮到我方报点|等待对方报点/, {
        timeout: 20000,
      })
    }

    const active = (await A.locator('.game__status-text').innerText()).includes('轮到我方报点') ? A : B

    // ① 回合方单击即出枪
    await active.locator('.game__opp .paper-grid__board button[aria-label="A1"]').click()
    await expect
      .poll(async () => active.locator('.game__status-text').innerText(), { timeout: 8000 })
      .toContain('我方报点 A1')

    // ② 出枪方现已是非回合方：单击另一空格即创建预报点（单击一步，无需第二次点击）
    await expect(active.locator('.game__opp .paper-grid__stamp .prefire-mark')).toHaveCount(0)
    await active.locator('.game__opp .paper-grid__board button[aria-label="B2"]').click()
    await expect(active.locator('.game__opp .paper-grid__stamp .prefire-mark')).toHaveCount(1, {
      timeout: 8000,
    })

    expect(errsA()).toEqual([])
    expect(errsB()).toEqual([])
    await ctxA.close()
    await ctxB.close()
  })
})
