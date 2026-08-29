/**
 * coloring.spec —— 对局着色工具（v0.2.1，单机）：
 * 开启着色 → 点染 A1/B1（黄）→ 拖拽 A1→C1（经 B1）：
 *   起点 A1 与拖过格 B1 同色仍保持黄色（拖拽不擦除）、C1 被路径染色
 * → 点击同色 B1 擦除 → 长按换蓝 → 点击 A1 变蓝（异色更新）
 * → 退出着色 → 点格恢复报点（高亮出现）→ 全程零 console 错误。
 */
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { oppCell, watchErrors } from './helpers'

/** 指定坐标的着色块（可按颜色过滤） */
function coloredAt(page: Page, coord: string, color?: string) {
  const colorCls = color ? `--${color}` : ''
  return page.locator(`.game__opp .paper-grid__colored${colorCls}[data-coord="${coord}"]`)
}

/** 从 from 格拖拽到 to 格（路径插值） */
async function dragBetween(page: Page, from: string, to: string) {
  const a = await oppCell(page, from).boundingBox()
  const b = await oppCell(page, to).boundingBox()
  if (!a || !b) throw new Error(`格子不可见：${from} / ${to}`)
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 10 })
  await page.mouse.up()
}

test.describe('对局着色工具', () => {
  test.setTimeout(120_000)

  test('点染→拖过同色不擦→点同色擦除→长按换蓝→异色更新→退出恢复报点', async ({ page }) => {
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

    // ---- 2. 点染 A1 / B1 → 黄色 ----
    await oppCell(page, 'A1').click()
    await expect(coloredAt(page, 'A1', 'yellow')).toHaveCount(1)
    await oppCell(page, 'B1').click()
    await expect(coloredAt(page, 'B1', 'yellow')).toHaveCount(1)

    // ---- 3. 拖拽 A1 → C1（经过 B1）：同色格保持、路径格染色 ----
    await dragBetween(page, 'A1', 'C1')
    await expect(coloredAt(page, 'A1', 'yellow')).toHaveCount(1) // 起点同色：拖拽不擦除
    await expect(coloredAt(page, 'B1', 'yellow')).toHaveCount(1) // 拖过同色：保持不变
    await expect(coloredAt(page, 'C1', 'yellow')).toHaveCount(1) // 路径染色

    // ---- 4. 点击同色 B1 → 擦除（仅点击才擦除） ----
    await oppCell(page, 'B1').click()
    await expect(coloredAt(page, 'B1')).toHaveCount(0)
    await expect(coloredAt(page, 'A1', 'yellow')).toHaveCount(1)
    await expect(coloredAt(page, 'C1', 'yellow')).toHaveCount(1)

    // ---- 5. 长按（约 500ms）弹出调色板 → 选蓝 → 自动处于着色模式 ----
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

    // ---- 6. 点击 A1（黄 → 蓝）：异色更新 ----
    await oppCell(page, 'A1').click()
    await expect(coloredAt(page, 'A1', 'blue')).toHaveCount(1)
    await expect(coloredAt(page, 'A1', 'yellow')).toHaveCount(0)

    // ---- 7. 退出着色模式 → 点格恢复报点（高亮出现） ----
    await btn.click()
    await expect(btn).toHaveAttribute('aria-pressed', 'false')
    await oppCell(page, 'A1').click()
    await expect(page.locator('.game__opp .paper-grid__highlight')).toBeVisible()

    expect(errs()).toEqual([])
  })
})
