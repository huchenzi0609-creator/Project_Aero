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

    // ---- 非当前回合禁报点：点空网格两步创建「?」（v0.3.4：先选中、再点同一格才创建） ----
    const aText = await A.locator('.game__status-text').innerText()
    const active = aText.includes('轮到我方报点') ? A : B
    const inactive = active === A ? B : A
    await expect(inactive.locator('.game__opp .paper-grid__stamp .prefire-mark')).toHaveCount(0)
    const a1 = inactive.locator('.game__opp .paper-grid__board button[aria-label="A1"]')
    await a1.click() // 第 1 次：仅选中（尚未创建）
    await expect(inactive.locator('.game__opp .paper-grid__stamp .prefire-mark')).toHaveCount(0)
    await a1.click() // 第 2 次：创建「?」
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

  test('快速匹配双人链路：配对入房一致、无「房间已解散」；重复匹配不踢对手（房码不变、仍可加入）', async ({
    browser,
  }) => {
    test.setTimeout(240_000)
    const ctxA = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const ctxB = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const A = await ctxA.newPage()
    const B = await ctxB.newPage()
    const errsA = watchErrors(A)
    const errsB = watchErrors(B)

    // 双方进入对战模式（默认勾选经典三档 → 交集必配）
    for (const p of [A, B]) {
      await p.goto('/')
      await expect(p.getByRole('heading', { name: '飞机杀' })).toBeVisible()
      await p.getByRole('button', { name: '对战模式' }).click()
      await expect(p.getByRole('heading', { name: '对战模式' })).toBeVisible()
    }

    // 双方点匹配 → 服务端配对
    await expect(A.getByRole('button', { name: '开始匹配' })).toBeEnabled({ timeout: 20000 })
    await A.getByRole('button', { name: '开始匹配' }).click()
    await expect(B.getByRole('button', { name: '开始匹配' })).toBeEnabled({ timeout: 20000 })
    await B.getByRole('button', { name: '开始匹配' }).click()

    // 配对成功：双方进入联机摆阵，房码一致、配置一致
    for (const p of [A, B]) {
      await expect(p.getByRole('heading', { name: '摆阵 · 联机对局' })).toBeVisible({ timeout: 25000 })
    }
    const codeA = (await A.locator('.online__roomcode').innerText()).trim()
    const codeB = (await B.locator('.online__roomcode').innerText()).trim()
    expect(codeA).toMatch(/^[A-Z0-9]{6}$/)
    expect(codeB).toBe(codeA)
    for (const p of [A, B]) {
      await expect(p.locator('.placement__head .page__subtitle')).toContainText('10×10 · 3 架飞机')
      await expect(p.locator('.online__statusrow')).not.toContainText('等待对手加入')
      await expect(p.locator('.online__statusrow')).toContainText('对手摆阵中')
    }
    // v0.3.16 修复点：配对入房后不得误报「房间已解散」
    await A.waitForTimeout(800)
    for (const p of [A, B]) {
      expect(await p.locator('.toast').filter({ hasText: '房间已解散' }).count()).toBe(0)
    }

    // 重复匹配（配对后再点）：A 刷新回主页 → 再进对战模式 → 再次开始匹配
    await A.reload()
    await expect(A.getByRole('button', { name: '对战模式' })).toBeVisible({ timeout: 20000 })
    await A.getByRole('button', { name: '对战模式' }).click()
    await expect(A.getByRole('button', { name: '开始匹配' })).toBeEnabled({ timeout: 20000 })
    await A.getByRole('button', { name: '开始匹配' }).click()
    await expect(A.getByText('正在匹配对手…')).toBeVisible({ timeout: 10000 })

    // 对手房间保留：房码不变、未出现「房间已解散」、仍在摆阵页且回到等待对手
    await expect(B.locator('.online__roomcode')).toHaveText(codeA)
    await B.waitForTimeout(800)
    expect(await B.locator('.toast').filter({ hasText: '房间已解散' }).count()).toBe(0)
    await expect(B.getByRole('heading', { name: '摆阵 · 联机对局' })).toBeVisible()
    await expect(B.locator('.online__statusrow')).toContainText('等待对手加入')

    // 取消匹配 → 用原房码重新加入（房码保留、对手房间仍可加入）
    await A.getByRole('button', { name: '取消匹配' }).click()
    await A.getByLabel('房码输入').fill(codeA)
    const joinBtn = A.getByRole('button', { name: '加入已有对局' })
    await expect(joinBtn).toBeEnabled({ timeout: 20000 })
    await joinBtn.click()
    await expect(A.getByRole('heading', { name: '摆阵 · 联机对局' })).toBeVisible({ timeout: 20000 })
    await expect(A.locator('.online__roomcode')).toHaveText(codeA)
    await expect(B.locator('.online__statusrow')).not.toContainText('等待对手加入')

    expect(errsA()).toEqual([])
    expect(errsB()).toEqual([])
    await ctxA.close()
    await ctxB.close()
  })
})
