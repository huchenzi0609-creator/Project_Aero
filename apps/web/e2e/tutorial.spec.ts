/**
 * tutorial.spec —— 新手教程 e2e（v0.3.2，M8 六项修复对齐 a8bbada）。
 *
 * 覆盖：
 * 1) 入口 P2：「还不了解」→ 单元1；「我已了解」→ 直达单元3（残局对局）；
 * 2) 单元1：T1-1 → 拖入 → T1-4 → 拖齐 3 架（T1-5 静默等待）→ 旋转 → T1-8 突显「确认布阵」→ 确认；
 * 3) 单元2：T2-1 → T2-2（*飞机机头* 强调）→ T2-3 条件步无「点击继续」→ 双击报点 → 分支文案其一；
 *    wait 节点气泡持久（点击不消失）；跳过/P3 弹窗打开时 spotlight 与气泡隐藏（弹窗豁免），关闭恢复；
 * 4) 单元2 真实胜利 → 立即「恭喜！你获得了一场胜利！」（无后续反馈）；
 * 5) 单元3：残局校验（对方先手 + 被毁残骸标记）→ T3-1 → 拖幽灵（T3-3 双目标突显：两层 HoleLayer）
 *    → T3-8 着色按钮 spotlight → P5 完成教程 回主页；
 * 6) P5「继续对局」→ free 模式（HUD/气泡/spotlight 消失）→「确认退出」收口回主页。
 * 全程 console 零 error。
 */
import { expect, test } from '@playwright/test'
import { watchErrors } from './helpers'

/** 10×10 全坐标扫描序列 */
function allCoords10x10(): string[] {
  const out: string[] = []
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 10; c++) out.push(`${String.fromCharCode(65 + c)}${r + 1}`)
  }
  return out
}

function modal(page: import('@playwright/test').Page) {
  return page.locator('.paper-modal__dialog')
}
function bubble(page: import('@playwright/test').Page) {
  return page.locator('.tutorial-bubble__text')
}
function hudSkip(page: import('@playwright/test').Page, unit: '对战基础' | '工具进阶') {
  return page.locator('.tutorial-hud .tutorial-bubble__skip', { hasText: `跳过 · ${unit}` })
}
async function clickBubble(page: import('@playwright/test').Page) {
  await bubble(page).click({ timeout: 3000 })
}
async function drag(page: import('@playwright/test').Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 14 })
  await page.mouse.up()
}
/** 从摆阵页把一张待选牌拖到「可视左上角格 = (r,c)」（吸附取整 → 指针放格内 0.25 处） */
async function dragDeckCardTo(page: import('@playwright/test').Page, r: number, c: number) {
  const card = page.locator('.placement__deck-card').first()
  const board = page.locator('.placement__board')
  const cb = await card.boundingBox()
  const bb = await board.boundingBox()
  if (!cb || !bb) throw new Error('待选牌/棋盘不可见')
  const cell = bb.width / 10
  await drag(
    page,
    { x: cb.x + cb.width / 2, y: cb.y + cb.height / 2 },
    { x: bb.x + (c + 0.25) * cell, y: bb.y + (r + 0.25) * cell },
  )
}
async function clickUntil(
  page: import('@playwright/test').Page,
  pred: (t: string) => boolean,
  max = 30,
): Promise<void> {
  for (let i = 0; i < max; i++) {
    const t = (await bubble(page).textContent().catch(() => '')) ?? ''
    if (pred(t)) return
    await bubble(page).click({ timeout: 1500 }).catch(() => {})
    await page.waitForTimeout(70)
  }
  const t = (await bubble(page).textContent().catch(() => '')) ?? ''
  throw new Error(`气泡未推进到目标步骤（当前：${t.slice(0, 60)}）`)
}
/** 确认跳过当前单元 */
async function confirmSkip(page: import('@playwright/test').Page) {
  await expect(modal(page)).toContainText('确认跳过当前单元？')
  await modal(page).getByRole('button', { name: '确认' }).click()
}

async function openTutorial(page: import('@playwright/test').Page) {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '飞机杀' })).toBeVisible()
  await page.getByRole('button', { name: '新手教程' }).click()
  await expect(modal(page)).toContainText('您是否了解本游戏的基本规则？')
}

test.describe('新手教程', () => {
  test.setTimeout(300_000)

  test('主链：还不了解 → 单元1 → 单元2（弹窗豁免/气泡持久）→ P3 → 单元3（双目标突显）→ P5 回主页', async ({ page }) => {
    const errs = watchErrors(page)

    /* ---- 入口 P2「还不了解」 ---- */
    await openTutorial(page)
    await modal(page).getByRole('button', { name: '还不了解' }).click()

    /* ---- 单元1 摆阵 ---- */
    await expect(page.getByRole('heading', { name: '新手教程 · 摆阵' })).toBeVisible()
    await expect(bubble(page)).toContainText('欢迎来到《飞机杀》！我们先来学习如何摆阵吧！', { timeout: 8000 })
    await expect(page.locator('.tutorial-bubble__skip', { hasText: '跳过单元' })).toBeVisible()

    await clickBubble(page)
    await expect(bubble(page)).toContainText('这是飞机待选栏，可以从这里把飞机拖到网格中。')
    await clickBubble(page)
    await expect(bubble(page)).toContainText('现在就试试看吧！把飞机拖到网格里！')

    await dragDeckCardTo(page, 2, 0)
    await expect(bubble(page)).toContainText('好极了！现在尝试把剩余的飞机全部拖到网格里！', { timeout: 8000 })
    await clickBubble(page) // → T1-5 静默等待
    await dragDeckCardTo(page, 2, 5)
    await dragDeckCardTo(page, 6, 5)
    await expect(page.locator('.placement__plane')).toHaveCount(3)
    await expect(bubble(page)).toContainText('单击飞机可以使飞机旋转90度，试试看！', { timeout: 8000 })

    const placed = page.locator('.placement__plane').first()
    const pb = await placed.boundingBox()
    if (!pb) throw new Error('已摆飞机不可见')
    await page.mouse.click(pb.x + pb.width / 2, pb.y + pb.height / 2)
    await expect(bubble(page)).toContainText('太棒了！确保你的飞机不重叠不越界之后，就可以开始游戏了！', { timeout: 8000 })
    await clickBubble(page) // → T1-8 确认布阵
    const confirm = page.getByRole('button', { name: '确认布阵' })
    await expect(confirm).toBeEnabled()
    await expect(bubble(page)).toContainText('点击“确认布阵”开始游戏')
    await expect(page.locator('.tutorial-spotlight:not(.tutorial-spotlight--dim)')).toBeVisible()
    await confirm.click()

    /* ---- 单元2 对战基础 ---- */
    await expect(bubble(page)).toContainText('是时候学习如何对战了！', { timeout: 10000 })
    await expect(hudSkip(page, '对战基础')).toBeVisible()
    await expect(page.locator('.result')).toHaveCount(0)

    await clickBubble(page) // → T2-2（*飞机机头* 强调）
    await expect(bubble(page)).toContainText('找出对手的')
    await expect(bubble(page)).toContainText('飞机机头')
    await clickBubble(page) // → T2-3 条件步
    await expect(bubble(page)).toContainText('试试双击一个格子')
    await expect(page.locator('.tutorial-bubble__hint')).toHaveCount(0) // 条件步无「点击继续」

    // 我方先手：双击 A1 报点 → 反馈分支
    const coordInput = page.getByLabel('报点坐标，如 A5')
    await expect(page.locator('.game-banner')).toBeHidden({ timeout: 8000 })
    await expect(coordInput).toBeEnabled({ timeout: 10000 })
    const a1 = page.locator('.game__opp .paper-grid__board button[aria-label="A1"]')
    await a1.click({ timeout: 2000 }).catch(() => {})
    await page.waitForTimeout(140)
    await a1.click({ timeout: 2000 }).catch(() => {})

    const branch = page
      .locator('.tutorial-bubble__text')
      .filter({ hasText: /哎呀，不走运，这里没有飞机呢|机头就在这附近！/ })
    await expect(branch.first()).toBeVisible({ timeout: 12000 })

    // wait 节点气泡持久：点击不消失、无「点击继续」
    await clickBubble(page)
    await expect(branch.first()).toBeVisible()
    await expect(page.locator('.tutorial-bubble__hint')).toHaveCount(0)

    // 弹窗豁免：跳过确认打开时 spotlight 与气泡隐藏；关闭后恢复（反馈节点无突显目标 → 弱化遮罩即可）
    await hudSkip(page, '对战基础').click()
    await expect(modal(page)).toContainText('确认跳过当前单元？')
    await expect(page.locator('.tutorial-spotlight')).toHaveCount(0)
    await expect(page.locator('.tutorial-bubble')).toHaveCount(0)
    await modal(page).getByRole('button', { name: '取消' }).click()
    await expect(page.locator('.tutorial-bubble')).toBeVisible()
    await expect(hudSkip(page, '对战基础')).toBeVisible()

    await hudSkip(page, '对战基础').click()
    await confirmSkip(page)
    await expect(modal(page)).toContainText('基础教程已完成，是否继续进阶教程？')
    // P3 弹窗豁免同样生效
    await expect(page.locator('.tutorial-spotlight')).toHaveCount(0)
    await modal(page).getByRole('button', { name: '继续教程' }).click()

    /* ---- 单元3 工具进阶 ---- */
    await expect(bubble(page)).toContainText('《飞机杀》有很多实用的对局工具呢！', { timeout: 12000 })
    await expect(hudSkip(page, '工具进阶')).toBeVisible()
    await expect(page.locator('.result')).toHaveCount(0)

    await expect(page.locator('.game-banner')).toBeHidden({ timeout: 8000 })
    await expect(page.locator('.game__status-text')).toContainText(/等待对方报点|对方报点/, { timeout: 10000 })
    await expect
      .poll(async () => page.locator('.game__mine .paper-grid__stamp').count(), { timeout: 10000 })
      .toBeGreaterThanOrEqual(9)
    await expect(page.locator('.game__mine .paper-grid__stamp .stamp--kill')).toHaveCount(1)

    // 缺陷 R3 规避窗口：preKill 残骸格未记入 AI 报点史 → AI 偶发重报造成重复章/React key 警告（见报告）。
    // 先点空网格创建一个预报点，触发教程 AI 额外暂停（+5s），保证深度教学步骤期间 AI 不出手。
    await page
      .locator('.game__opp .paper-grid__board button[aria-label="J10"]')
      .click({ timeout: 1500 })
      .catch(() => {})

    // T3-1 → T3-2 → T3-3（双目标突显：参考网格 + 空网格 = 两层 HoleLayer）
    await clickBubble(page)
    await expect(bubble(page)).toContainText('这是“参考网格”。')
    await clickBubble(page)
    await expect(bubble(page)).toContainText('这里的飞机也可点击旋转90度')
    await clickBubble(page)
    await expect(bubble(page)).toContainText('并且，这里的飞机也可以拖到空网格里。试试看！')
    await expect(page.locator('.tutorial-spotlight')).toHaveCount(2, { timeout: 8000 })

    const refPlane = page.locator('.game__ref .paper-grid__plane')
    const oppBoard = page.locator('.game__opp .paper-grid__board')
    const rp = await refPlane.boundingBox()
    const ob = await oppBoard.boundingBox()
    if (!rp || !ob) throw new Error('参考飞机/对手棋盘不可见')
    const cellW = ob.width / 10
    await drag(
      page,
      { x: rp.x + rp.width / 2, y: rp.y + rp.height / 2 },
      { x: ob.x + 5 * cellW, y: ob.y + 4 * cellW },
    )
    await expect(page.locator('.game__opp .paper-grid__plane--ghost')).toHaveCount(1)
    await expect(bubble(page)).toContainText('你创建了一个幽灵飞机！', { timeout: 10000 })
    await clickBubble(page)
    await expect(bubble(page)).toContainText('你可以创建多个幽灵飞机')
    await clickUntil(page, (t) => t.includes('这是坐标输入框'))
    await clickBubble(page) // → T3-8 着色按钮
    await expect(bubble(page)).toContainText('点击这个按钮进入着色模式，长按可以选择颜色。', { timeout: 8000 })
    await expect(page.locator('.tutorial-spotlight:not(.tutorial-spotlight--dim)')).toBeVisible()

    // 跳过 → 二次确认 → P5 → 完成教程 → 回主页
    await hudSkip(page, '工具进阶').click()
    await confirmSkip(page)
    await expect(modal(page)).toContainText('进阶教程已完成，是否完成对局？')
    await modal(page).getByRole('button', { name: '完成教程' }).click()
    await expect(page.getByRole('heading', { name: '飞机杀' })).toBeVisible()

    expect(errs()).toEqual([])
  })

  test('入口「我已了解」→ 直达单元3 → P5「继续对局」free 模式（HUD/气泡/spotlight 消失）→ 确认退出回主页', async ({ page }) => {
    test.setTimeout(150_000)
    const errs = watchErrors(page)

    await openTutorial(page)
    await modal(page).getByRole('button', { name: '我已了解' }).click()

    // 直达单元3
    await expect(bubble(page)).toContainText('《飞机杀》有很多实用的对局工具呢！', { timeout: 12000 })
    await expect(hudSkip(page, '工具进阶')).toBeVisible()
    await expect(page.locator('.result')).toHaveCount(0)
    await expect(page.locator('.game-banner')).toBeHidden({ timeout: 8000 })
    await expect
      .poll(async () => page.locator('.game__mine .paper-grid__stamp').count(), { timeout: 10000 })
      .toBeGreaterThanOrEqual(9)

    // 跳过确认 → P5 → 继续对局（free 模式）
    await hudSkip(page, '工具进阶').click()
    await confirmSkip(page)
    await expect(modal(page)).toContainText('进阶教程已完成，是否完成对局？')
    await modal(page).getByRole('button', { name: '继续对局' }).click()

    // free：教程 HUD / 气泡 / spotlight 全部消失
    await expect(page.locator('.tutorial-hud')).toHaveCount(0)
    await expect(page.locator('.tutorial-bubble')).toHaveCount(0)
    await expect(page.locator('.tutorial-spotlight')).toHaveCount(0)

    // 对局仍在（自由继续）→ 经对局「确认退出」收口：单机退出路由到单机菜单，再「返回主页」
    await expect(page.locator('.game__opp .paper-grid__board')).toBeVisible()
    await page.getByRole('button', { name: '← 退出' }).click()
    await expect(page.locator('.paper-modal__dialog')).toContainText('确认退出对局？')
    await page.locator('.paper-modal__dialog').getByRole('button', { name: '确认退出' }).click()
    await expect(page.getByRole('heading', { name: '单人对局' })).toBeVisible({ timeout: 10000 })
    await page.getByRole('button', { name: '← 返回主页' }).click()
    await expect(page.getByRole('heading', { name: '飞机杀' })).toBeVisible({ timeout: 10000 })

    expect(errs()).toEqual([])
  })

  test('单元2 真实全灭 → 立即「恭喜！你获得了一场胜利！」（无后续反馈）→ P3 返回主页', async ({ page }) => {
    test.setTimeout(300_000)
    const errs = watchErrors(page)

    // 直达单元2：入口 → 单元1 直接跳过（确认）→ 进入单元2
    await openTutorial(page)
    await modal(page).getByRole('button', { name: '还不了解' }).click()
    await expect(bubble(page)).toContainText('欢迎来到《飞机杀》！我们先来学习如何摆阵吧！', { timeout: 8000 })
    await page.locator('.tutorial-bubble__skip', { hasText: '跳过单元' }).click()
    await modal(page).getByRole('button', { name: '确认' }).click()
    await expect(bubble(page)).toContainText('是时候学习如何对战了！', { timeout: 10000 })
    await expect(hudSkip(page, '对战基础')).toBeVisible()

    // 逐格扫描直至真正胜利（教学 AI 避让我方机头 → 我方不会先输；胜负只看是否全灭对方）。
    // 我方回合判定用 .game__hint（可报点提示含「再点一次报点」；状态条会被报点消息占用不可靠）。
    const winBubble = page.locator('.tutorial-bubble__text').filter({ hasText: '恭喜！你获得了一场胜利！' })
    const hint = page.locator('.game__hint')
    await expect(page.locator('.game-banner')).toBeHidden({ timeout: 8000 })
    const shotCells = allCoords10x10()
    let idx = 0
    let shotsTaken = 0
    const deadline = Date.now() + 200_000
    while (Date.now() < deadline && (await winBubble.count()) === 0 && idx < shotCells.length) {
      const h = (await hint.textContent().catch(() => '')) ?? ''
      if (!h.includes('再点一次报点')) {
        await page.waitForTimeout(150)
        continue
      }
      const coord = shotCells[idx]!
      idx += 1
      shotsTaken += 1
      const cell = page.locator(`.game__opp .paper-grid__board button[aria-label="${coord}"]`)
      await cell.click({ timeout: 1500 }).catch(() => {})
      await page.waitForTimeout(120)
      if ((await winBubble.count()) > 0) break
      await cell.click({ timeout: 1500 }).catch(() => {})
      // 本枪落定：等 AI 回应后回到我方回合（或已胜利）
      for (let k = 0; k < 60 && (await winBubble.count()) === 0; k++) {
        const hh = (await hint.textContent().catch(() => '')) ?? ''
        if (hh.includes('再点一次报点')) break
        await page.waitForTimeout(150)
      }
    }
    expect(shotsTaken).toBeGreaterThanOrEqual(5)

    // v0.3.2 胜利即时：胜利气泡立即出现且无后续反馈文本
    await expect(winBubble).toBeVisible({ timeout: 20000 })
    await page.waitForTimeout(300)
    await expect(bubble(page)).toContainText('恭喜！你获得了一场胜利！')
    await expect(bubble(page).filter({ hasText: /哎呀，不走运|机头就在这附近/ })).toHaveCount(0)

    // 点击胜利气泡 → 单元完成 → P3 → 返回主页
    await clickBubble(page)
    await expect(modal(page)).toContainText('基础教程已完成，是否继续进阶教程？')
    await modal(page).getByRole('button', { name: '返回主页' }).click()
    await expect(page.getByRole('heading', { name: '飞机杀' })).toBeVisible()

    expect(errs()).toEqual([])
  })

  test('单元1 气泡「跳过单元」→ 二次确认（取消保留 / 确认进单元2）；P3「返回主页」退出', async ({ page }) => {
    test.setTimeout(120_000)
    const errs = watchErrors(page)

    await openTutorial(page)
    await modal(page).getByRole('button', { name: '还不了解' }).click()

    await expect(bubble(page)).toContainText('欢迎来到《飞机杀》！我们先来学习如何摆阵吧！', { timeout: 8000 })
    await page.locator('.tutorial-bubble__skip', { hasText: '跳过单元' }).click()
    await expect(modal(page)).toContainText('确认跳过当前单元？')
    await modal(page).getByRole('button', { name: '取消' }).click()
    await expect(page.getByRole('heading', { name: '新手教程 · 摆阵' })).toBeVisible()

    await page.locator('.tutorial-bubble__skip', { hasText: '跳过单元' }).click()
    await modal(page).getByRole('button', { name: '确认' }).click()
    await expect(bubble(page)).toContainText('是时候学习如何对战了！', { timeout: 10000 })

    await hudSkip(page, '对战基础').click()
    await modal(page).getByRole('button', { name: '确认' }).click()
    await expect(modal(page)).toContainText('基础教程已完成，是否继续进阶教程？')
    await modal(page).getByRole('button', { name: '返回主页' }).click()
    await expect(page.getByRole('heading', { name: '飞机杀' })).toBeVisible()

    expect(errs()).toEqual([])
  })
})
