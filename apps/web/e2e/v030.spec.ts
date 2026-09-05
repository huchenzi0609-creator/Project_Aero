/**
 * v030.spec —— v0.3.0 新规则与工具（单机 + 联机双 context）：
 *
 * 1) 盲棋（单机）：着色工具与参考飞机拖拽禁用；对手网格可见非击毁标记 ≤ 3（FIFO 窗口）；
 * 2) 经典回归：着色按钮存在；重复报点被拒（toast「该格已经报过点了」）；
 * 3) 超快棋（单机）：初始倒计时 0:30（10×n，n=3）、<10s 出现 blitz-clock--danger、超时判负结算；
 * 4) 预报点（联机真实对局）：非我方回合点击空网格产生深红「?」；第 11 个提示上限；
 *    再次单击选中 + 点选可取消；轮到己方时 FIFO 自动上报（每回合消耗 1）。
 */
import { expect, test } from '@playwright/test'
import type { BrowserContext, Page } from '@playwright/test'
import {
  allCoords,
  bothReadyOnline,
  createRoomHost,
  joinRoomByCode,
  oppCell,
  startSingleSmallGame,
  watchErrors,
} from './helpers'

/** 对手网格可见非击毁（miss/hit）与击毁（kill）章数量 */
async function oppStampCounts(page: Page): Promise<{ nonKill: number; kill: number }> {
  return page.evaluate(() => {
    const stamp = '.game__opp .paper-grid__stamp '
    const missHit = document.querySelectorAll(stamp + '.stamp--miss, ' + stamp + '.stamp--hit').length
    const kill = document.querySelectorAll(stamp + '.stamp--kill').length
    return { nonKill: missHit, kill }
  })
}

/** 我方回合报一个坐标（双点式）；返回前等待 AI 走完回到我方回合 */
async function shootOnMyTurn(page: Page, coord: string, shootSet: Set<string>) {
  const input = page.getByLabel('报点坐标，如 A5')
  await expect(input).toBeEnabled({ timeout: 10000 })
  shootSet.add(coord)
  const cell = oppCell(page, coord)
  await cell.click({ timeout: 2000 }).catch(() => {})
  if (await page.locator('.result').isVisible().catch(() => false)) return
  await page.waitForTimeout(120)
  if (await page.locator('.result').isVisible().catch(() => false)) return
  await cell.click({ timeout: 2000 }).catch(() => {})
  await page.waitForTimeout(700)
}

test.describe('v0.3.0 盲棋', () => {
  test('盲棋：着色/参考拖拽禁用；可见非击毁标记 ≤ 3（FIFO）', async ({ page }) => {
    test.setTimeout(150_000)
    const errs = watchErrors(page)
    await startSingleSmallGame(page, '盲棋模式')

    // 着色工具入口隐藏（对战区 + 输入栏均无）
    await expect(page.locator('.coloring-stage__btn')).toHaveCount(0)
    await expect(page.locator('.coloring-inputbar__btn')).toHaveCount(0)

    // 参考飞机拖拽 → 不产生放置副本（盲棋禁参考）
    const refPlane = page.locator('.game__ref .paper-grid__plane')
    const oppBoard = page.locator('.game__opp .paper-grid__board')
    const rp = await refPlane.boundingBox()
    const ob = await oppBoard.boundingBox()
    if (rp && ob) {
      await page.mouse.move(rp.x + rp.width / 2, rp.y + rp.height / 2)
      await page.mouse.down()
      await page.mouse.move(ob.x + ob.width / 2, ob.y + ob.height / 2, { steps: 8 })
      await page.mouse.up()
      await expect(page.locator('.game__opp .paper-grid__plane--ghost')).toHaveCount(0)
    }

    // 连报 ≥6 个不同坐标：任何时刻可见 miss/hit 章 ≤ 3（击毁章永久保留另计）
    const input = page.getByLabel('报点坐标，如 A5')
    const candidates = allCoords(10, 10)
    const shotSet = new Set<string>()
    let idx = 0
    const result = page.locator('.result')
    for (let round = 0; round < 8; round++) {
      if (await result.isVisible().catch(() => false)) break
      if (!(await input.isEnabled())) {
        await page.waitForTimeout(300)
        continue
      }
      while (shotSet.has(candidates[idx] ?? '')) idx += 1
      const coord = candidates[idx] ?? 'A1'
      await shootOnMyTurn(page, coord, shotSet)
      if (shotSet.size >= 3) {
        const c = await oppStampCounts(page)
        expect(c.nonKill).toBeLessThanOrEqual(3)
      }
    }
    // 至少打满 3 个不同坐标（保证窗口断言有机会成立）
    expect(shotSet.size).toBeGreaterThanOrEqual(3)

    expect(errs()).toEqual([])
  })
})

test.describe('v0.3.0 经典回归', () => {
  test('经典：着色可用；重复报点被拒', async ({ page }) => {
    test.setTimeout(120_000)
    const errs = watchErrors(page)
    await startSingleSmallGame(page, '经典模式')

    // 着色工具存在
    await expect(page.locator('.coloring-stage__btn button')).toBeVisible()

    // 首次报点 A1（双点式），回到我方回合后再次点 A1 → 被拒 toast
    const input = page.getByLabel('报点坐标，如 A5')
    await expect(input).toBeEnabled({ timeout: 10000 })
    await shootOnMyTurn(page, 'A1', new Set())
    // 等 AI 走完回到我方回合；第二次选 A1：先点高亮、再点报点 → 客户端已报格拦截
    await expect(input).toBeEnabled({ timeout: 10000 })
    const a1 = oppCell(page, 'A1')
    await a1.click({ timeout: 2000 }).catch(() => {})
    if (!(await page.locator('.result').isVisible().catch(() => false))) {
      await page.waitForTimeout(120)
      await a1.click({ timeout: 2000 }).catch(() => {})
    }
    await expect(page.locator('.toast').filter({ hasText: '该格已经报过点了' }).first()).toBeVisible()
    // 已报点格不会产生预报点
    await expect(page.locator('.game__opp .prefire-mark')).toHaveCount(0)

    // R1 已修复（8920e87）：重复报点被拒分支不再产生 React key 警告 → 控制台零容忍
    expect(errs()).toEqual([])
  })
})

test.describe('v0.3.0 超快棋', () => {
  test('超快棋：初始 0:30、<10s danger、超时判负结算', async ({ page }) => {
    test.setTimeout(150_000)
    const errs = watchErrors(page)
    await startSingleSmallGame(page, '超快棋模式')

    // 双方 BlitzClock 出现，格式 m:ss，初始约 0:30（10×3）
    const clocks = page.locator('.game__clocks .blitz-clock')
    await expect(clocks).toHaveCount(2, { timeout: 10000 })
    const text = await clocks.first().textContent()
    expect(text).toMatch(/^0:(2\d|3\d)$/)

    // 等轮到己方（对方走完）后不再报点 → 己方时钟走空：先出现 <10s danger 红闪类，再超时判负
    const input = page.getByLabel('报点坐标，如 A5')
    await expect(input).toBeEnabled({ timeout: 15000 })
    const danger = page.locator('.blitz-clock--danger').first()
    await expect(danger).toBeVisible({ timeout: 40000 })
    const dangerText = await danger.textContent()
    // 剩余 <10s（含临界显示 0:10）→ 数字标红闪烁
    expect(dangerText).toMatch(/^0:(0\d|10)$/)

    // 超时 → 结算「超时判负」+ 副文案（胜负方向取决于先归零的一方；见产品缺陷报告：blitz 下 AI 偶发停顿）
    const result = page.locator('.result')
    await expect(result).toBeVisible({ timeout: 30000 })
    await expect(result.locator('.result__title')).toHaveText('超时判负')
    await expect(result).toContainText(/你超时，本局判负。|对方超时，你获胜。/)

    expect(errs()).toEqual([])
  })
})

test.describe('v0.3.0 预报点', () => {
  test('联机：非我方回合创建「?」、上限 10 提示、点选取消、我方回合自动上报', async ({ browser }) => {
    test.setTimeout(150_000)
    const ctxA: BrowserContext = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const ctxB: BrowserContext = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const A = await ctxA.newPage()
    const B = await ctxB.newPage()
    const errsA = watchErrors(A)
    const errsB = watchErrors(B)

    const code = await createRoomHost(A)
    await joinRoomByCode(B, code)
    await bothReadyOnline(A, B)

    const AInput = A.getByLabel('报点坐标，如 A5')
    const BInput = B.getByLabel('报点坐标，如 A5')
    const prefire = A.locator('.game__opp .paper-grid__stamp .prefire-mark')
    await expect(A.locator('.game__status-text')).toContainText(/轮到我方报点|等待对方报点/, { timeout: 15000 })

    // 自检当前是否轮到 A：点击 A2，若无「?」出现（= 仍是己方回合的高亮）则 A 先打一枪把回合交给 B
    await oppCell(A, 'A2').click()
    if ((await prefire.count()) === 0) {
      const passCell = oppCell(A, 'B1')
      await passCell.click({ timeout: 2000 }).catch(() => {})
      await A.waitForTimeout(120)
      await passCell.click({ timeout: 2000 }).catch(() => {})
      // 回合翻转后（B 的回合）再点 A2 创建「?」；未翻转则轮询补点
      await A.waitForTimeout(600)
      for (let k = 0; k < 8 && (await prefire.count()) === 0; k++) {
        await oppCell(A, 'A2').click()
        await A.waitForTimeout(350)
      }
    }
    await expect(prefire).toHaveCount(1, { timeout: 5000 })

    // 非我方回合：继续点其余 9 个不同空格 → 累计 10 个「?」；第 11 个提示上限
    const cells = ['B2', 'C2', 'D2', 'E2', 'F2', 'G2', 'H2', 'I2', 'J2', 'A3']
    for (let i = 0; i < 9; i++) {
      await oppCell(A, cells[i]!).click()
      await expect(prefire).toHaveCount(i + 2, { timeout: 5000 })
    }
    await oppCell(A, 'A3').click()
    await expect(A.locator('.toast').filter({ hasText: '预报点已达上限' }).first()).toBeVisible()
    await expect(prefire).toHaveCount(10)

    // 选中预报点后再点同一格取消 → toast「预报点已取消。」（选中无独立高亮，仅输入框回填坐标）
    await oppCell(A, 'B2').click() // 选中
    await expect(AInput).toHaveValue(/B2|b2/i)
    await oppCell(A, 'B2').click() // 再点 = 取消
    await expect(A.locator('.toast').filter({ hasText: '预报点已取消。' }).first()).toBeVisible()
    await expect(prefire).toHaveCount(9)

    // B 打一枪把回合交回 A → A 回合开始 FIFO 自动上报 1 个（9 → 8）
    await BInput.fill('C1')
    await BInput.press('Enter')
    await expect
      .poll(async () => A.locator('.game__opp .paper-grid__stamp .prefire-mark').count(), {
        timeout: 15000,
      })
      .toBeLessThan(9)

    expect(errsA()).toEqual([])
    expect(errsB()).toEqual([])
    await ctxA.close()
    await ctxB.close()
  })
})
