/**
 * online.spec —— 双 context 联机全流程（v0.3.0 导航，复用 helpers）：
 * 建房 → 房码 → 入房 → 双摆阵 → 就绪 → 对局若干轮 → 结算；
 * v0.3.0：非当前回合点击空网格 = 创建「?」预报点（纯客户端）；回合外缘随回合变色。
 * 另：经典房间对局显示回合读秒条（byo-yomi，.game__timerbar）。
 */
import { expect, test } from '@playwright/test'
import {
  allCoords,
  bothReadyOnline,
  createRoomHost,
  joinRoomByCode,
  oppCell,
  watchErrors,
} from './helpers'

test.describe('联机全流程', () => {
  test.setTimeout(150_000)

  test('建房→入房→双摆阵→就绪→对局→结算；非当前回合=预报点', async ({ browser }) => {
    const ctxA = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const ctxB = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const A = await ctxA.newPage()
    const B = await ctxB.newPage()
    const errsA = watchErrors(A)
    const errsB = watchErrors(B)

    // ---- A 建房（对战模式 · 自定义房间） ----
    const code = await createRoomHost(A)

    // ---- B 凭房码入房 ----
    await joinRoomByCode(B, code)
    await expect(A.getByRole('heading', { name: '摆阵 · 联机对局' })).toBeVisible()
    await expect(B.getByRole('heading', { name: '摆阵 · 联机对局' })).toBeVisible()

    // ---- 双摆阵并就绪 ----
    await bothReadyOnline(A, B)

    // ---- 进入对局（服务端随机先手；双方就绪后由服务端开局） ----
    await expect(A.locator('.game__status-text')).toContainText(/轮到我方报点|等待对方报点/, {
      timeout: 20000,
    })
    await expect(B.locator('.game__status-text')).toContainText(/轮到我方报点|等待对方报点/, {
      timeout: 20000,
    })

    // ---- 非当前回合禁报点：点击空网格 = 创建「?」预报点（无"还没轮到"提示） ----
    const aText = await A.locator('.game__status-text').innerText()
    const active = aText.includes('轮到我方报点') ? A : B
    const inactive = active === A ? B : A
    await expect(inactive.locator('.game__opp .paper-grid__stamp .prefire-mark')).toHaveCount(0)
    await inactive.locator('.game__opp .paper-grid__board button[aria-label="A1"]').click()
    await expect(inactive.locator('.game__opp .paper-grid__stamp .prefire-mark')).toHaveCount(1)

    // ---- v0.2.9 空网格外缘随回合变色：回合方=深绿（mine）、非回合方=深红（theirs），恰一方轮到 ----
    const aIsMine = ((await A.locator('.game__opp').getAttribute('class')) ?? '').includes('game__opp--mine')
    const bIsMine = ((await B.locator('.game__opp').getAttribute('class')) ?? '').includes('game__opp--mine')
    expect(aIsMine !== bIsMine).toBe(true) // 双方必有一方轮到
    const mineColor = 'rgb(47, 107, 79)' // --hit-green
    const theirsColor = 'rgb(168, 54, 47)' // --kill-red
    const aColor = await A.locator('.game__opp .paper-grid__board').evaluate((el) => getComputedStyle(el).borderTopColor)
    const bColor = await B.locator('.game__opp .paper-grid__board').evaluate((el) => getComputedStyle(el).borderTopColor)
    expect(aIsMine ? aColor : bColor).toBe(mineColor)
    expect(aIsMine ? bColor : aColor).toBe(theirsColor)

    // ---- 对局若干轮（回合方报点，双点式） ----
    const shotCoords = allCoords(10, 10)
    const shotSets: Record<'A' | 'B', Set<string>> = { A: new Set(), B: new Set() }
    const shotIdx: Record<'A' | 'B', number> = { A: 0, B: 0 }
    const pages: Array<['A' | 'B', typeof A]> = [
      ['A', A],
      ['B', B],
    ]
    let rounds = 0
    while (rounds < 40 && !(await A.locator('.result').isVisible().catch(() => false))) {
      rounds += 1
      for (const [name, p] of pages) {
        if (await p.locator('.result').isVisible().catch(() => false)) break
        if (!(await p.getByLabel('报点坐标，如 A5').isEnabled())) continue
        while (shotSets[name].has(shotCoords[shotIdx[name]] ?? '')) shotIdx[name] += 1
        const coord = shotCoords[shotIdx[name]] ?? 'A1'
        shotSets[name].add(coord)
        const cell = oppCell(p, coord)
        await cell.click({ timeout: 2000 }).catch(() => {})
        if (await p.locator('.result').isVisible().catch(() => false)) break
        await p.waitForTimeout(120)
        if (await p.locator('.result').isVisible().catch(() => false)) break
        await cell.click({ timeout: 2000 }).catch(() => {})
        await p.waitForTimeout(600)
      }
    }

    // ---- 若仍未终局：B 投降触发结算 ----
    if (!(await A.locator('.result').isVisible().catch(() => false))) {
      await B.getByRole('button', { name: '投降' }).click()
      await B.getByRole('button', { name: '确认投降' }).click()
    }

    // ---- 结算：双方一致 ----
    for (const p of [A, B]) {
      await expect(p.locator('.result')).toBeVisible({ timeout: 20000 })
      await expect(p.locator('.result__title')).toHaveText(/恭喜您，您赢了！|您输了，下次一定！/)
      await expect(p.locator('.result')).toContainText('我方真实阵型')
      await expect(p.locator('.result')).toContainText('对方真实阵型')
      await expect(p.locator('.result__stats')).toContainText('总报点数')
      await expect(p.locator('.result__stats')).toContainText('平均击杀效率')
      await expect(p.locator('.result__stat-eff')).toContainText('/')
      await expect(p.getByRole('button', { name: '返回联机菜单' })).toBeVisible()
    }
    // v0.2.9 结算叠加标记：双方报点后必有一方结算棋盘带标记（本局已进行若干轮）
    const aStamps = await A.locator('.result .paper-grid__stamp').count()
    const bStamps = await B.locator('.result .paper-grid__stamp').count()
    expect(aStamps + bStamps).toBeGreaterThan(0)

    expect(errsA()).toEqual([])
    expect(errsB()).toEqual([])
    await ctxA.close()
    await ctxB.close()
  })

  test('经典自定义房间对局：显示回合读秒条（byo-yomi）与状态文案', async ({ browser }) => {
    test.setTimeout(150_000)
    const ctxA = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const ctxB = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const A = await ctxA.newPage()
    const B = await ctxB.newPage()
    const errsA = watchErrors(A)

    // ---- A 建房（自定义房间默认小型经典）----
    const code = await createRoomHost(A)
    await joinRoomByCode(B, code)
    await bothReadyOnline(A, B)

    // ---- 经典 byo-yomi：进入对局后双方看到回合读秒条 ----
    await expect(A.locator('.game__opp .paper-grid__board')).toBeVisible({ timeout: 20000 })
    await expect(A.locator('.game__status-text')).toContainText(/轮到我方报点|等待对方报点/, { timeout: 10000 })
    await expect(A.locator('.game__timerbar').first()).toBeVisible({ timeout: 10000 })

    expect(errsA()).toEqual([])
    await ctxA.close()
    await ctxB.close()
  })
})
