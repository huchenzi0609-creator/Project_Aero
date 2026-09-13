/**
 * settings.spec —— 设置页：音量推杆、反转 X/O、AI 难度选单；
 * 改动后刷新页面验证 localStorage 持久化。
 */
import { expect, test } from '@playwright/test'
import { watchErrors } from './helpers'

test.describe('设置', () => {
  test('音量推杆与反转 X/O 持久化（刷新后保留）、难度选单', async ({ page }) => {
    const errs = watchErrors(page)

    await page.goto('/')
    await page.getByRole('button', { name: '设置' }).click()

    const bgm = page
      .locator('label.paper-slider')
      .filter({ hasText: 'BGM 音量' })
      .locator('input[type="range"]')
    const sfx = page
      .locator('label.paper-slider')
      .filter({ hasText: '音效音量' })
      .locator('input[type="range"]')
    const toggle = page
      .locator('.paper-toggle')
      .filter({ hasText: '反转 X 和 O' })
      .locator('input[type="checkbox"]')
    const difficulty = page.getByLabel('AI 难度')

    // 默认值
    await expect(bgm).toHaveValue('0.5')
    await expect(sfx).toHaveValue('0.7')
    await expect(toggle).not.toBeChecked()
    await expect(difficulty).toHaveValue('normal')

    // 音量推杆（含试听按钮可用）
    await expect(page.getByRole('button', { name: '试听' }).first()).toBeEnabled()
    await bgm.fill('0')
    await sfx.fill('0.2')
    await expect(page.locator('.paper-slider__value').first()).toHaveText('0%')

    // 反转 X 和 O
    await toggle.check()
    await expect(toggle).toBeChecked()

    // 难度选单 → 地狱
    await difficulty.selectOption('hell')
    await expect(difficulty).toHaveValue('hell')

    // 地狱难度描述为新算法文案（机头概率热图 / 斩首式报点）
    await expect(page.locator('.paper-select__desc')).toContainText('斩首')

    // 刷新后保留（刷新回主页，需再进设置页）
    await page.reload()
    await page.getByRole('button', { name: '设置' }).click()
    await expect(bgm).toHaveValue('0')
    await expect(sfx).toHaveValue('0.2')
    await expect(toggle).toBeChecked()
    await expect(difficulty).toHaveValue('hell')

    expect(errs()).toEqual([])
  })

  test('「快捷着色」「单击报点」开关：默认值与持久化（刷新保持）；「允许移动参考飞机」已下线', async ({
    page,
  }) => {
    const errs = watchErrors(page)

    await page.goto('/')
    await page.getByRole('button', { name: '设置' }).click()

    const section = page.locator('.settings__section').filter({ hasText: '对局' })
    const toggle = (label: string) =>
      section
        .locator('.paper-toggle')
        .filter({ hasText: label })
        .locator('input[type="checkbox"]')

    // 默认均开
    await expect(section).toBeVisible()
    // v0.3.17-beta4 item 5：设置页不再提供「允许移动参考飞机」开关（单机恒允许，盲棋强制禁用）
    await expect(toggle('允许移动参考飞机'), '「允许移动参考飞机」开关应已下线').toHaveCount(0)
    await expect(page.getByText('允许移动参考飞机')).toHaveCount(0)
    // v0.3.0 快捷着色：默认开，含说明文案
    await expect(toggle('快捷着色')).toBeChecked()
    await expect(section.locator('.paper-toggle').filter({ hasText: '快捷着色' })).toContainText('批量着色')

    // 关闭快捷着色 → 刷新后仍关闭
    await toggle('快捷着色').uncheck()
    await expect(toggle('快捷着色')).not.toBeChecked()
    await page.reload()
    await page.getByRole('button', { name: '设置' }).click()
    await expect(toggle('快捷着色')).not.toBeChecked()

    // 再开回 → 刷新后仍开启（其余开关不受影响）
    await toggle('快捷着色').check()
    await expect(toggle('快捷着色')).toBeChecked()
    await page.reload()
    await page.getByRole('button', { name: '设置' }).click()
    await expect(toggle('快捷着色')).toBeChecked()
    await expect(toggle('允许移动参考飞机')).toHaveCount(0)

    // v0.3.16 单击报点：默认关（旧存档缺省视为 false，保持两步确认）→ 开启后刷新仍保持
    await expect(toggle('单击报点')).not.toBeChecked()
    await expect(section.locator('.paper-toggle').filter({ hasText: '单击报点' })).toContainText('单击方格')
    await toggle('单击报点').check()
    await page.reload()
    await page.getByRole('button', { name: '设置' }).click()
    await expect(toggle('单击报点')).toBeChecked()

    expect(errs()).toEqual([])
  })
})
