/**
 * custom.spec —— 自定义编辑器校验清单逐条触发 + 26×26 对局页性能冒烟（无横向溢出）。
 */
import { expect, test } from '@playwright/test'
import { watchErrors } from './helpers'

test.describe('自定义模式', () => {
  /** 进入自定义配置页并关闭「使用默认飞机形状」 */
  async function openCustomEditor(page: import('@playwright/test').Page) {
    await page.goto('/')
    await page.getByRole('button', { name: '单人对局' }).click()
    await page.getByRole('button', { name: /自定义/ }).click()
    await expect(page.getByRole('heading', { name: '自定义配置' })).toBeVisible()
    await page.locator('.paper-toggle').filter({ hasText: '使用默认飞机形状' }).locator('input').uncheck()
  }

  test('校验清单逐条触发：0 机头 / 孤立格 / 超 15 格 / 少于 2 格时确认不可用', async ({ page }) => {
    const errs = watchErrors(page)
    await openCustomEditor(page)

    const confirmBtn = page.getByRole('button', { name: '确认 · 进入摆阵' })
    const checklist = page.locator('.checklist')
    const cell = (n: number) => page.locator('.shape-editor__cell').nth(n)

    // 0 格 → 确认不可用
    await expect(confirmBtn).toBeDisabled()

    // 少于 2 格：画 1 格（自动成为机头）→ 格数 ✗
    await cell(0).click() // (0,0)
    await expect(checklist).toContainText('至少为 2 个')
    await expect(confirmBtn).toBeDisabled()

    // 0 机头：再点机头格移除机头 → 机头 ✗
    await cell(0).click()
    await expect(checklist).toContainText('缺少机头')
    await expect(confirmBtn).toBeDisabled()

    // 孤立格：画 (0,1) 与 (2,2)，(2,2) 与已填格不相邻 → 连通 ✗
    await cell(1).click() // (0,1)，自动成为机头
    await cell(12).click() // (2,2) 孤立
    await expect(checklist).toContainText('存在孤立的方格')
    await expect(confirmBtn).toBeDisabled()

    // 擦除孤立格 → 2 格连通且恰 1 机头 → 确认可用
    await page.getByRole('button', { name: '橡皮擦' }).click()
    await cell(12).click() // 擦除 (2,2)
    await page.getByRole('button', { name: '绘制' }).click()
    await expect(confirmBtn).toBeEnabled()

    // 超 15 格：补画到 15 格后第 16 格被拒（Toast），且不会混入形状
    for (const n of [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 14, 15]) {
      await cell(n).click()
    }
    await expect(page.locator('.editor-count')).toContainText('15 / 15')
    await expect(confirmBtn).toBeEnabled()
    await cell(16).click() // (3,1) 第 16 格 → 拒绝
    await expect(page.locator('.toast')).toContainText('已达 15 格上限')
    await expect(page.locator('.editor-count')).toContainText('15 / 15')

    // 合法形状可确认：重画一个 3 格 L 形
    await page.getByRole('button', { name: '清空' }).click()
    await cell(0).click() // (0,0) 机头
    await cell(5).click() // (1,0)
    await cell(6).click() // (1,1)
    for (const label of ['四邻连通', '格数 2 ~ 15', '机头恰 1 个']) {
      await expect(checklist.locator('.checklist__item').filter({ hasText: label })).toContainText('✓')
    }
    await expect(confirmBtn).toBeEnabled()

    // 确认 → 进入自定义摆阵页
    await confirmBtn.click()
    await expect(page.getByRole('heading', { name: '摆阵 · 单人对局' })).toBeVisible()
    await expect(page.locator('.placement__status')).toContainText('校验未通过') // 3 架未摆齐

    expect(errs()).toEqual([])
  })

  test('26×26 自定义棋盘对局页无横向溢出（竖版 390px / 横版 1280px）', async ({ page }) => {
    const errs = watchErrors(page)
    // 竖版视口进入
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    await page.getByRole('button', { name: '单人对局' }).click()
    await page.getByRole('button', { name: /自定义/ }).click()

    // 26×26、1 架飞机，默认形状
    await page.locator('#cfg-width').fill('26')
    await page.locator('#cfg-height').fill('26')
    await page.locator('#cfg-planes').fill('1')
    await page.getByRole('button', { name: '确认 · 进入摆阵' }).click()

    // 摆阵 → 随机 → 确认 → 对局
    await page.getByRole('button', { name: '随机摆阵' }).click()
    await page.getByRole('button', { name: '确认布阵' }).click()
    await expect(page.locator('.game__status-text')).toContainText(/轮到我方报点|等待对方报点|对方报点/, {
      timeout: 15000,
    })

    const noHorizOverflow = () =>
      page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)

    // 竖版 390px：无横向滚动
    await expect.poll(() => noHorizOverflow(), { timeout: 5000 }).toBe(true)

    // 横版 1280px：布局切换后仍无横向滚动
    await page.setViewportSize({ width: 1280, height: 800 })
    await expect.poll(() => noHorizOverflow(), { timeout: 5000 }).toBe(true)

    expect(errs()).toEqual([])
  })

  test('自定义页存在「允许移动参考飞机」开关（默认开）；联机自定义房间为「允许对战双方移动参考飞机」（默认开）', async ({
    page,
  }) => {
    const errs = watchErrors(page)

    // 单机自定义配置页
    await page.goto('/')
    await page.getByRole('button', { name: '单人对局' }).click()
    await page.getByRole('button', { name: /自定义/ }).click()
    await expect(page.getByRole('heading', { name: '自定义配置' })).toBeVisible()
    const singleToggle = page
      .locator('.paper-toggle')
      .filter({ hasText: '允许移动参考飞机' })
      .locator('input')
    await expect(singleToggle).toBeChecked()

    // 单机自定义模式不显示「每步限时」选单
    await expect(page.getByLabel('每步限时')).toHaveCount(0)

    // 联机自定义房间页
    await page.getByRole('button', { name: '← 返回单人对局' }).click()
    await page.getByRole('button', { name: '← 返回主页' }).click()
    await page.getByRole('button', { name: '联机对战' }).click()
    await page.getByRole('button', { name: '自定义…' }).click()
    await expect(page.getByRole('heading', { name: '自定义房间' })).toBeVisible()
    const onlineToggle = page
      .locator('.paper-toggle')
      .filter({ hasText: '允许对战双方移动参考飞机' })
      .locator('input')
    await expect(onlineToggle).toBeChecked()

    // 联机自定义房间「每步限时」：默认 30 秒、共 5 档（10/20/30/60 秒 + 不限）
    const turnSelect = page.getByLabel('每步限时')
    await expect(turnSelect).toBeVisible()
    await expect(turnSelect).toHaveValue('30000')
    await expect(turnSelect.locator('option')).toHaveCount(5)
    await expect(turnSelect.locator('option').first()).toHaveAttribute('value', '10000')
    await expect(turnSelect.locator('option').last()).toHaveAttribute('value', '0')

    expect(errs()).toEqual([])
  })
})
