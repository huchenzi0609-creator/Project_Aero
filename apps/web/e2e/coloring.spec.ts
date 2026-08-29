/**
 * coloring.spec —— 对局着色工具（v0.2.0，单机）：
 * 开启着色模式 → 点染一格（黄）→ 同色再点擦除 → 长按按钮换色（蓝）→ 再点变蓝
 * → 退出着色模式 → 点格恢复报点（高亮出现）→ 全程零 console 错误。
 */
import { expect, test } from '@playwright/test'
import { oppCell, watchErrors } from './helpers'

test.describe('对局着色工具', () => {
  test.setTimeout(120_000)

  test('开启着色→点染→同色擦除→长按换蓝→再点变蓝→退出恢复报点', async ({ page }) => {
    const errs = watchErrors(page)

    // ---- 进入单机小型档对局（默认 1280 视口 = 横版） ----
    await page.goto('/')
    await page.getByRole('button', { name: '单人对局' }).click()
    await page.getByRole('button', { name: /小型 · 10×10/ }).click()
    await expect(page.getByRole('heading', { name: '摆阵 · 单人对局' })).toBeVisible()
    await page.getByRole('button', { name: '随机摆阵' }).click()
    await expect(page.locator('.placement__status')).toContainText('校验通过')
    await page.getByRole('button', { name: '确认布阵' }).click()
    await expect(page.locator('.game-banner')).toBeVisible()
    await expect(page.locator('.game-banner')).toBeHidden({ timeout: 5000 })

    // 横版：着色按钮在中央棋盘旁（竖版实例在 footer，横版隐藏）
    const btn = page.locator('.coloring-stage__btn button')
    await expect(btn).toBeVisible()

    // ---- 1. 点击进入着色模式 ----
    await btn.click()
    await expect(btn).toHaveAttribute('aria-pressed', 'true')

    // ---- 2. 点染一格 → 黄色色块出现 ----
    const cell = oppCell(page, 'A1')
    await cell.click()
    await expect(page.locator('.game__opp .paper-grid__colored--yellow')).toHaveCount(1)
    await expect(page.locator('.game__opp .paper-grid__colored')).toHaveCount(1)

    // ---- 3. 同色再点 → 擦除 ----
    await cell.click()
    await expect(page.locator('.game__opp .paper-grid__colored')).toHaveCount(0)

    // ---- 4. 长按（约 500ms）弹出调色板 → 选蓝 → 自动处于着色模式 ----
    const box = await btn.boundingBox()
    if (!box) throw new Error('着色按钮不可见')
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await expect(page.locator('.coloring-stage__btn .coloring-palette')).toBeVisible({
      timeout: 3000,
    })
    await page.mouse.up()
    await page.locator('.coloring-stage__btn .coloring-swatch--blue').click()
    await expect(btn).toHaveAttribute('aria-pressed', 'true')

    // ---- 5. 再点同一格 → 变为蓝色 ----
    await cell.click()
    await expect(page.locator('.game__opp .paper-grid__colored--blue')).toHaveCount(1)
    await expect(page.locator('.game__opp .paper-grid__colored--yellow')).toHaveCount(0)

    // ---- 6. 退出着色模式 → 点格恢复报点（高亮出现） ----
    await btn.click()
    await expect(btn).toHaveAttribute('aria-pressed', 'false')
    await cell.click()
    await expect(page.locator('.game__opp .paper-grid__highlight')).toBeVisible()

    expect(errs()).toEqual([])
  })
})
