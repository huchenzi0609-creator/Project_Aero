/**
 * home.spec —— 主页验收：
 * 三入口可见、用户名显示、横竖版切换按钮生效（布局类变化）。
 */
import { expect, test } from '@playwright/test'
import { watchErrors } from './helpers'

test.describe('主页', () => {
  test('三入口可见、用户名显示、横竖版切换生效', async ({ page }) => {
    const errs = watchErrors(page)

    await page.goto('/')
    await expect(page.getByRole('heading', { name: '纸面海战' })).toBeVisible()

    // 三入口
    await expect(page.getByRole('button', { name: '单人对局' })).toBeVisible()
    await expect(page.getByRole('button', { name: '联机对战' })).toBeVisible()
    await expect(page.getByRole('button', { name: '设置' })).toBeVisible()
    await expect(page.getByRole('button', { name: '规则说明' })).toBeVisible()

    // 用户名显示（本地占位「游客……」或服务端身份「游客XXXXX」）
    await expect(page.locator('.home__guest-label')).toHaveText('今日纸名')
    await expect(page.locator('.home__guest-name')).toHaveText(/游客/)

    // 横竖版切换：1280×800 默认横版 → 强制竖版 → 布局类变化 → 恢复自动
    await expect(page.locator('.home')).toHaveClass(/home--landscape/)
    await page.getByRole('button', { name: /切换为竖版/ }).click()
    await expect(page.locator('.home')).toHaveClass(/home--portrait/)
    // 强制后按钮文案变为「切到横版」，并提供「恢复自动」
    await expect(page.getByRole('button', { name: /切换为横版/ })).toBeVisible()
    await page.getByRole('button', { name: '恢复自动' }).click()
    await expect(page.locator('.home')).toHaveClass(/home--landscape/)

    expect(errs()).toEqual([])
  })
})
