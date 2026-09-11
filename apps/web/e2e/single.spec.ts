/**
 * single.spec —— 单机小型档全流程（v0.3.0，经练习模式 → 经典模式）：
 * 摆阵（随机摆阵→确认）→ 先后手横幅 → 对局（轮到我方时报点：双点报点/输入框报点交替）
 * → 结算（胜负文案+统计卡+阵型公开）→ 再来一局回到摆阵。
 */
import { expect, test } from '@playwright/test'
import { allCoords, oppCell, practiceToPlacement, watchErrors } from './helpers'

test.describe('单机全流程', () => {
  // v0.3.13：教程套件（含 1.7m 长流程）与联机对局并行时，单机对局的 AI 定时器/回合成倍变慢，
  // 收敛时间可远超单独运行的 ~20s；放宽超时避免并行长尾误判（语义不变）。
  test.setTimeout(600_000)

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

    // ---- v0.3.13 人机回合色边框：对局中 .game__opp 带 --mine（我方回合）/ --theirs（对方回合） ----
    await expect
      .poll(async () => (await page.locator('.game__opp').getAttribute('class')) ?? '', { timeout: 10000 })
      .toMatch(/game__opp--(mine|theirs)/)

    // ---- 横版三栏顺序（v0.3.10）：参考 < 空网格 < 我方 ----
    if ((await page.evaluate(() => window.innerWidth)) > (await page.evaluate(() => window.innerHeight))) {
      const ref = await page.locator('.game__ref').boundingBox()
      const opp = await page.locator('.game__opp').boundingBox()
      const mine = await page.locator('.game__mine').boundingBox()
      if (ref && opp && mine) {
        expect(ref.x < opp.x).toBe(true)
        expect(opp.x < mine.x).toBe(true)
      }
    }

    // ---- 报点循环：双点报点（1/3）与输入框报点（2/3）交替，直至结算 ----
    // v0.3.13：改为「轮到我方回合才报点」——对方回合输入只会堆积预报点（上限 10），
    // 全量并行下会把真实出枪压到每回合 1 发的长尾（旧实现可跑满 8 分钟仍不收敛）。
    const shotCoords = allCoords(10, 10)
    const shotSet = new Set<string>()
    let shotIndex = 0
    let rounds = 0
    let shotsTaken = 0
    const isMyTurn = (st: string) => {
      const t = st.trim()
      return t.includes('轮到我方报点') || t.includes('绝地反击') || /^对方报点/.test(t)
    }
    const deadline = Date.now() + 420_000
    while (Date.now() < deadline && !(await result.isVisible().catch(() => false)) && shotIndex < shotCoords.length) {
      // 等 AI 走完 → 我方回合（或已结算）
      const st = (await status.textContent().catch(() => '')) ?? ''
      if (!isMyTurn(st)) {
        await page.waitForTimeout(120)
        continue
      }
      // 取下一个未报点坐标（报点由本测试发起，追踪精确）
      while (shotSet.has(shotCoords[shotIndex] ?? '')) shotIndex += 1
      const coord = shotCoords[shotIndex] ?? 'A1'
      if (shotSet.has(coord)) break
      shotSet.add(coord)
      rounds += 1
      shotsTaken += 1

      // 每 3 枪用一次双点报点覆盖该交互，其余走输入框（回车），避免点击竞态拖慢收敛
      if (rounds % 3 === 0) {
        const cell = oppCell(page, coord)
        await cell.click({ timeout: 1500 }).catch(() => {})
        if (await result.isVisible().catch(() => false)) break
        await page.waitForTimeout(140)
        if (await result.isVisible().catch(() => false)) break
        await cell.click({ timeout: 1500 }).catch(() => {})
      } else {
        await coordInput.fill(coord)
        await coordInput.press('Enter')
        await expect(coordInput).toHaveValue('', { timeout: 3000 }).catch(() => {})
      }
    }
    expect(shotsTaken).toBeGreaterThanOrEqual(5) // 确实进行过报点循环

    // ---- 结算：胜负文案 + 统计卡 + 双方真实阵型公开 ----
    await expect(result).toBeVisible({ timeout: 60000 })
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

    // ---- v0.3.13：结算期间回合色边框隐藏（.game__opp 不再带 --mine/--theirs） ----
    if ((await page.locator('.game__opp').count()) > 0) {
      const cls = (await page.locator('.game__opp').getAttribute('class')) ?? ''
      expect(cls).not.toMatch(/game__opp--(mine|theirs)/)
    }

    // ---- 再来一局：回到摆阵页 ----
    await result.getByRole('button', { name: '再来一局' }).click()
    await expect(page.getByRole('heading', { name: '摆阵 · 单人对局' })).toBeVisible()
    await expect(page.getByRole('button', { name: '随机摆阵' })).toBeVisible()

    expect(errs()).toEqual([])
  })
})
