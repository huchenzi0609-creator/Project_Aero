/**
 * home.spec —— 主页验收（v0.3.0）：
 * 四入口（新手教程/练习模式/对战模式/设置）+ 规则说明与版本角标 v0.3.0、
 * 用户名显示、新手教程弹窗、练习模式面板进出、横竖版切换按钮生效。
 */
import { expect, test } from '@playwright/test'
import { watchErrors } from './helpers'

test.describe('主页', () => {
  test('四入口可见、用户名显示、教程弹窗、练习面板进出、横竖版切换', async ({ page }) => {
    const errs = watchErrors(page)

    await page.goto('/')
    await expect(page.getByRole('heading', { name: '飞机杀' })).toBeVisible()

    // 四入口 + 页脚规则说明
    await expect(page.getByRole('button', { name: '新手教程' })).toBeVisible()
    await expect(page.getByRole('button', { name: '练习模式' })).toBeVisible()
    await expect(page.getByRole('button', { name: '对战模式' })).toBeVisible()
    await expect(page.getByRole('button', { name: '设置' })).toBeVisible()
    await expect(page.getByRole('button', { name: '规则说明' })).toBeVisible()
    // 版本角标 v0.3.1
    await expect(page.locator('.home__version')).toHaveText('v0.3.1')
    // 新手教程位于练习模式之上（y 序）
    const tutorialY = await page.getByRole('button', { name: '新手教程' }).boundingBox()
    const practiceY = await page.getByRole('button', { name: '练习模式' }).boundingBox()
    expect(tutorialY && practiceY ? tutorialY.y < practiceY.y : false).toBe(true)

    // 用户名显示（本地占位「游客……」或服务端身份「游客XXXXX」）
    await expect(page.locator('.home__guest-label')).toHaveText('你好，')
    await expect(page.locator('.home__guest-name')).toHaveText(/游客/)

    // 新手教程：进入教程宿主页（入口弹窗 P1；G 教程全流程在 tutorial.spec 覆盖）
    await page.getByRole('button', { name: '新手教程' }).click()
    await expect(page.locator('h1.page__title').filter({ hasText: '新手教程' })).toBeVisible()
    await expect(page.locator('.paper-modal__dialog')).toContainText('您是否了解本游戏的基本规则？')
    await expect(page.locator('.paper-modal__dialog')).toContainText('还不了解')
    // 我已了解 = 跳过教程返回主页
    await page.locator('.paper-modal__dialog').getByRole('button', { name: '我已了解' }).click()
    await expect(page.getByRole('heading', { name: '飞机杀' })).toBeVisible()

    // 练习模式面板：四子模式入口可见 → 返回主页
    await page.getByRole('button', { name: '练习模式' }).click()
    await expect(page.getByRole('heading', { name: '练习模式' })).toBeVisible()
    for (const m of ['经典模式', '超快棋模式', '盲棋模式', '自定义模式']) {
      await expect(page.getByRole('button', { name: m })).toBeVisible()
    }
    await page.getByRole('button', { name: '← 返回主页' }).click()
    await expect(page.getByRole('heading', { name: '飞机杀' })).toBeVisible()

    // 横竖版切换：1280×800 默认横版 → 强制竖版 → 恢复自动
    await expect(page.locator('.home')).toHaveClass(/home--landscape/)
    await page.getByRole('button', { name: /切换为竖版/ }).click()
    await expect(page.locator('.home')).toHaveClass(/home--portrait/)
    await expect(page.getByRole('button', { name: /切换为横版/ })).toBeVisible()
    await page.getByRole('button', { name: '恢复自动' }).click()
    await expect(page.locator('.home')).toHaveClass(/home--landscape/)

    expect(errs()).toEqual([])
  })
})
