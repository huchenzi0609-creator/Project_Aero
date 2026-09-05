/**
 * custom.spec —— 自定义模式（v0.3.0，经 练习模式 → 自定义模式）：
 * 校验清单逐条触发 + 26×26 对局页性能冒烟 + 单机自定义规则开关（超快棋/盲棋）+ 对战模式菜单默认勾选。
 */
import { expect, test } from '@playwright/test'
import { openPractice, openOnline, watchErrors } from './helpers'

test.describe('自定义模式', () => {
  /** 进入单机自定义配置页并关闭「使用默认飞机形状」 */
  async function openCustomEditor(page: import('@playwright/test').Page) {
    await openPractice(page)
    await page.getByRole('button', { name: '自定义模式' }).click()
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
    await page.getByRole('button', { name: '练习模式' }).click()
    await page.getByRole('button', { name: '自定义模式' }).click()

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

  test('单机自定义页含「允许移动参考飞机」（默认开）与超快棋/盲棋开关（默认关、可独立开启）', async ({ page }) => {
    const errs = watchErrors(page)

    await openPractice(page)
    await page.getByRole('button', { name: '自定义模式' }).click()
    await expect(page.getByRole('heading', { name: '自定义配置' })).toBeVisible()

    // 参考飞机开关默认开
    const refToggle = page
      .locator('.paper-toggle')
      .filter({ hasText: '允许移动参考飞机' })
      .locator('input')
    await expect(refToggle).toBeChecked()

    // v0.3.0 规则开关：默认关；可各自独立开启
    const blitzToggle = page.locator('.paper-toggle').filter({ hasText: '超快棋模式' }).locator('input')
    const blindToggle = page.locator('.paper-toggle').filter({ hasText: '盲棋模式' }).locator('input')
    await expect(blitzToggle).not.toBeChecked()
    await expect(blindToggle).not.toBeChecked()

    await blitzToggle.check()
    await expect(blitzToggle).toBeChecked()
    await expect(blindToggle).not.toBeChecked()

    await blindToggle.check()
    await expect(blindToggle).toBeChecked()
    await expect(blitzToggle).toBeChecked() // 双开不互斥

    // 盲棋 + 允许移动参考飞机 → 提示将自动失效
    await expect(page.getByText('盲棋模式下「允许移动参考飞机」将自动失效。')).toBeVisible()

    expect(errs()).toEqual([])
  })

  test('对战模式菜单：三板块默认勾选（经典小/中/大）、多选组合汇总、开始匹配与等待态、自定义房间板块', async ({ page }) => {
    const errs = watchErrors(page)
    await openOnline(page)

    // 三板块标题
    for (const t of ['经典模式', '超快棋模式', '盲棋模式']) {
      await expect(page.locator('.online__card-title').filter({ hasText: t })).toBeVisible()
    }

    const group = (title: string) => page.getByRole('group', { name: `${title}档位勾选` })
    const classicChecks = group('经典模式').locator('input[type="checkbox"]')
    const blitzChecks = group('超快棋模式').locator('input[type="checkbox"]')
    const blindChecks = group('盲棋模式').locator('input[type="checkbox"]')

    // 每板块 3 档；默认仅经典三档勾选
    for (const checks of [classicChecks, blitzChecks, blindChecks]) await expect(checks).toHaveCount(3)
    for (let i = 0; i < 3; i++) await expect(classicChecks.nth(i)).toBeChecked()
    for (let i = 0; i < 3; i++) await expect(blitzChecks.nth(i)).not.toBeChecked()
    for (let i = 0; i < 3; i++) await expect(blindChecks.nth(i)).not.toBeChecked()
    await expect(page.getByText('已勾选 3 组组合')).toBeVisible()

    // 取消经典·大型 + 勾选超快棋·中型 → 汇总更新为 3
    await classicChecks.nth(2).uncheck()
    await expect(page.getByText('已勾选 2 组组合')).toBeVisible()
    await blitzChecks.nth(1).check()
    await expect(page.getByText('已勾选 3 组组合')).toBeVisible()

    // 开始匹配 → 等待态（真实服务器；无对手时保持等待）→ 取消匹配
    const startBtn = page.getByRole('button', { name: '开始匹配' })
    await expect(startBtn).toBeEnabled({ timeout: 10000 })
    await startBtn.click()
    await expect(page.getByText('正在匹配对手…')).toBeVisible({ timeout: 8000 })
    await expect(page.getByRole('button', { name: '取消匹配' })).toBeVisible()
    await page.getByRole('button', { name: '取消匹配' }).click()
    await expect(page.getByText('正在匹配对手…')).toBeHidden()

    // 自定义房间板块渲染：档位 + 超快棋/盲棋开关 + 房码输入 + 加入已有对局
    const customCard = page.locator('.paper-card').filter({ hasText: '自定义房间' })
    await expect(customCard).toBeVisible()
    await expect(customCard.getByRole('group', { name: '创建房间档位' }).getByRole('button')).toHaveCount(3)
    await expect(customCard.locator('label', { hasText: '超快棋（' })).toBeVisible()
    await expect(customCard.locator('label', { hasText: '盲棋（' })).toBeVisible()
    await expect(page.getByLabel('房码输入')).toBeVisible()
    await expect(page.getByRole('button', { name: '加入已有对局' })).toBeVisible()
    await expect(customCard.getByRole('button', { name: '创建房间' })).toBeVisible()

    expect(errs()).toEqual([])
  })
})
