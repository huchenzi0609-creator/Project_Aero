/**
 * online.spec —— 双 context 联机全流程（复用 scripts/online-smoke.mjs 选择器思路）：
 * 建房 → 房码 → 入房 → 双摆阵 → 就绪 → 对局若干轮 → 结算；
 * 另加：非当前回合报点被拒（UI 禁点 + Toast 提示）。
 */
import { expect, test } from '@playwright/test'
import { allCoords, oppCell, watchErrors } from './helpers'

test.describe('联机全流程', () => {
  test.setTimeout(150_000)

  test('建房→入房→双摆阵→就绪→对局→结算；非当前回合禁点', async ({ browser }) => {
    const ctxA = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const ctxB = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const A = await ctxA.newPage()
    const B = await ctxB.newPage()
    const errsA = watchErrors(A)
    const errsB = watchErrors(B)

    // ---- A 建房 ----
    await A.goto('/')
    await expect(A.getByRole('heading', { name: '方格空袭' })).toBeVisible()
    await A.getByRole('button', { name: '联机对战' }).click()
    await A.getByRole('button', { name: '创建房间' }).click()
    await expect(A.locator('.online__roomcode')).toBeVisible({ timeout: 10000 })
    const code = (await A.locator('.online__roomcode').innerText()).trim()
    expect(code).toMatch(/^[A-Z0-9]{6}$/)

    // ---- B 凭房码入房 ----
    await B.goto('/')
    await B.getByRole('button', { name: '联机对战' }).click()
    await B.getByLabel('房码输入').fill(code)
    await B.getByRole('button', { name: '加入房间' }).click()
    await expect(B.locator('.online__roomcode')).toHaveText(code, { timeout: 10000 })
    await expect(A.getByRole('heading', { name: '摆阵 · 联机对局' })).toBeVisible()
    await expect(B.getByRole('heading', { name: '摆阵 · 联机对局' })).toBeVisible()

    // ---- 双摆阵并就绪 ----
    for (const p of [A, B]) {
      await p.getByRole('button', { name: '随机摆阵' }).click()
      await expect(p.getByRole('button', { name: '确认布阵并就绪' })).toBeEnabled({ timeout: 10000 })
      await p.getByRole('button', { name: '确认布阵并就绪' }).click()
    }

    // ---- 进入对局（服务端随机先手；双方就绪后由服务端开局，即双方就绪的最强证明） ----
    await expect(A.locator('.game__status-text')).toContainText(/轮到我方报点|等待对方报点/, {
      timeout: 20000,
    })
    await expect(B.locator('.game__status-text')).toContainText(/轮到我方报点|等待对方报点/, {
      timeout: 20000,
    })

    // ---- 非当前回合报点被拒（UI 禁点） ----
    const aText = await A.locator('.game__status-text').innerText()
    const active = aText.includes('轮到我方报点') ? A : B
    const inactive = active === A ? B : A
    // 非回合方：坐标输入与确认按钮禁用
    await expect(inactive.getByLabel('报点坐标，如 A5')).toBeDisabled()
    await expect(inactive.getByRole('button', { name: '确认报点' })).toBeDisabled()
    // 点击棋盘格 → Toast 提示「还没轮到您报点」
    await inactive.locator('.game__opp .paper-grid__cell--clickable').first().click()
    await expect(inactive.locator('.toast').filter({ hasText: '还没轮到您报点' })).toBeVisible()
    await inactive.waitForTimeout(300)

    // ---- 对局若干轮（回合方报点，双点式） ----
    const shotCoords = allCoords(10, 10)
    const shotSets: Record<'A' | 'B', Set<string>> = { A: new Set(), B: new Set() }
    const shotIdx: Record<'A' | 'B', number> = { A: 0, B: 0 }
    const pages: Array<['A' | 'B', typeof A]> = [
      ['A', A],
      ['B', B],
    ]
    let rounds = 0
    while (rounds < 30 && !(await A.locator('.result').isVisible().catch(() => false))) {
      rounds += 1
      for (const [name, p] of pages) {
        if (await p.locator('.result').isVisible().catch(() => false)) break
        if (!(await p.getByLabel('报点坐标，如 A5').isEnabled())) continue
        while (shotSets[name].has(shotCoords[shotIdx[name]] ?? '')) shotIdx[name] += 1
        const coord = shotCoords[shotIdx[name]] ?? 'A1'
        shotSets[name].add(coord)
        const cell = oppCell(p, coord)
        await cell.click()
        await p.waitForTimeout(120)
        await cell.click()
        await p.waitForTimeout(700)
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
      await expect(p.getByRole('button', { name: '返回联机菜单' })).toBeVisible()
    }

    expect(errsA()).toEqual([])
    expect(errsB()).toEqual([])
    await ctxA.close()
    await ctxB.close()
  })
})
