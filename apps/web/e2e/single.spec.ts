/**
 * single.spec —— 单机小型档全流程（v0.3.0，经练习模式 → 经典模式）：
 * 摆阵（随机摆阵→确认）→ 先后手横幅 → 对局（轮到我方时报点：双点报点/输入框报点交替）
 * → 结算（胜负文案+统计卡+阵型公开）→ 再来一局回到摆阵。
 */
import { expect, test } from '@playwright/test'
import { allCoords, oppCell, practiceToPlacement, watchErrors } from './helpers'

test.describe('单机全流程', () => {
  test.setTimeout(240_000)

  test('经典模式小型档：摆阵→横幅→对局→结算→再来一局', async ({ page }) => {
    const errs = watchErrors(page)
    // 地狱 AI 更快结束对局：无论我方先手后手，双方任一方胜出都在更少步数内收敛（避免全量并行下的长尾）
    await page.addInitScript(() => {
      localStorage.setItem('aero-settings', JSON.stringify({ state: { difficulty: 'hell' }, version: 0 }))
    })

    // 练习模式 → 经典模式 → 小型档 → 摆阵页
    await practiceToPlacement(page, '经典模式')

    // ---- 摆阵：随机摆阵 → 校验通过 → 确认 ----
    await page.getByRole('button', { name: '随机摆阵' }).click()
    await expect(page.locator('.placement__status')).toContainText('校验通过')
    await page.getByRole('button', { name: '确认布阵' }).click()

    // ---- 先后手横幅（1.5s） ----
    await expect(page.locator('.game-banner')).toBeVisible()
    await expect(page.locator('.game-banner__text')).toHaveText(/您先手|您后手/)
    await expect(page.locator('.game-banner')).toBeHidden({ timeout: 5000 })

    // ---- 对战 ----
    const status = page.locator('.game__status-text')
    // AI 先手且已报点时状态条为"对方报点 X：…"，三种回合状态均可确认已进入对局
    await expect(status).toContainText(/轮到我方报点|等待对方报点|对方报点/, { timeout: 10000 })
    const coordInput = page.getByLabel('报点坐标，如 A5')
    const result = page.locator('.result')

    // ---- 报点循环：双点报点（2/3）与输入框报点（1/3）交替，直至结算 ----
    // 用轮询等待回合翻转（非硬编码步长），兼容全量并行下的调度抖动
    const shotCoords = allCoords(10, 10)
    const shotSet = new Set<string>()
    let shotIndex = 0
    let rounds = 0
    let inputShot = 0
    while (rounds < 300 && !(await result.isVisible().catch(() => false))) {
      rounds += 1
      // 等 AI 走完 → 我方回合（或已结算）
      for (let i = 0; i < 60; i++) {
        if (await result.isVisible().catch(() => false)) break
        if (await coordInput.isEnabled()) break
        await page.waitForTimeout(150)
      }
      if (!(await coordInput.isEnabled())) continue
      // 取下一个未报点坐标（报点由本测试发起，追踪精确）
      while (shotSet.has(shotCoords[shotIndex] ?? '')) shotIndex += 1
      const coord = shotCoords[shotIndex] ?? 'A1'
      shotSet.add(coord)

      // 每 3 枪用一次双点报点覆盖该交互，其余走输入框（回车），避免点击竞态拖慢收敛
      if (rounds % 3 === 0) {
        const cell = oppCell(page, coord)
        await cell.click({ timeout: 1500 }).catch(() => {})
        if (await result.isVisible().catch(() => false)) break
        await page.waitForTimeout(140)
        if (await result.isVisible().catch(() => false)) break
        await cell.click({ timeout: 1500 }).catch(() => {})
      } else {
        inputShot += 1
        await coordInput.fill(coord)
        await coordInput.press('Enter')
        await expect(coordInput).toHaveValue('', { timeout: 3000 }).catch(() => {})
      }
    }
    expect(inputShot + Math.floor(rounds / 3)).toBeGreaterThanOrEqual(5) // 确实进行过报点循环

    // ---- 结算：胜负文案 + 统计卡 + 双方真实阵型公开 ----
    await expect(result).toBeVisible({ timeout: 20000 })
    await expect(result.locator('.result__title')).toHaveText(/恭喜您，您赢了！|您输了，下次一定！/)
    await expect(result.locator('.result__stats')).toContainText('总回合数')
    await expect(result.locator('.result__stats')).toContainText('我方命中率')
    await expect(result.locator('.result__stats')).toContainText('电脑命中率')
    // v0.2.9 平均击杀效率对比
    await expect(result.locator('.result__stats')).toContainText('平均击杀效率')
    await expect(result.locator('.result__stat-eff')).toContainText('/')
    // v0.2.9 结算叠加标记：真实阵型上带双方报点标记（本局双方均有报点）
    await expect(result.locator('.result__board').nth(0).locator('.paper-grid__stamp').first()).toBeVisible()
    await expect(result.locator('.result__board').nth(1).locator('.paper-grid__stamp').first()).toBeVisible()
    await expect(result.locator('.result__board')).toHaveCount(2)
    await expect(result).toContainText('我方真实阵型')
    await expect(result).toContainText('对方真实阵型')
    await expect(result.getByRole('button', { name: '再来一局' })).toBeVisible()
    await expect(result.getByRole('button', { name: '返回主页' })).toBeVisible()

    // ---- 再来一局：回到摆阵页 ----
    await result.getByRole('button', { name: '再来一局' }).click()
    await expect(page.getByRole('heading', { name: '摆阵 · 单人对局' })).toBeVisible()
    await expect(page.getByRole('button', { name: '随机摆阵' })).toBeVisible()

    expect(errs()).toEqual([])
  })
})
