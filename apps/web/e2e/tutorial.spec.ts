/**
 * tutorial.spec —— 新手教程 e2e（v0.3.14 十四项修复验收；v0.3.17-beta2 遮罩常驻/缓动引擎增补）。
 *
 * v0.3.17-beta3 增补（单层遮罩 / 首帧豁免 / 融合平滑 / 跳过文本）：
 *   1) 遮罩恒为单层：元素数与 mode 数 =1，总暗度 ≤0.52（暗底 `--sheet` 与 path 填充不再叠加）；
 *   2) thanks/detect（重叠/非法）与 p1（预报点）等混合模式同为单层、暗度不超基础值；
 *   3) 「← 退出教程」首帧即真实可点（纯 dim 阻断带 =「气泡+豁免」补集；整屏容器型 escape 被过滤）；
 *   4) 空洞融合去重叠分解：k2→k3 融合逐帧并集面积连续（无融合瞬间向上跳变，单帧 ≤ 最大洞 12%）；
 *   5) 单元2 跳过文本两条路径（已有飞机 → 跳过拖拽引导；一把摆完 → 跳过续拖引导）；
 *   6) 阵型合法时 thanks 阶段即突显「确认布阵」；
 *   7) 放错位置的幽灵【不被回收】→ 复用同一架（旋转/拖动）即可换朝向重试成功。
 *
 * v0.3.18-beta2 适配/护栏：
 *   - 气泡换段改回【连续插值】（beta4「瞬移」需求反转）：到位 ≤1.2px 贴合 + 单帧位移 ≤ 全程 15%；
 *   - 教程内无先后手横幅（hideFirstTurnBanner）→ 采样窗口内 .game-banner 恒为 0；
 *   - 阻断恒在（bug1）：遮罩激活期逐帧断言 .tutorial-block>0、非豁免探针被阻断、豁免可点；
 *   - 豁免不开洞 + 结构化置顶（bug4/5）：洞矩形 ∩ .tutorial-top-layer .tutorial-escape = ∅、中心命中自身；
 *   - 提示带单条 evenodd 环形 clip（bug2）：2×M + 4×A3 3；
 *   - 多目标过渡无闪烁（bug6）：零洞帧 0、切片数无 A→B→A 跳变。
 *
 * v0.3.18-beta1 适配：洞几何断言全部改读 `data-spotlight-rects`（path 已改 3px 圆角、无法再按
 *   M…H…V…H…Z 解析）；动画时长 340→560ms（解析弹簧），提示带 --on 改 1250ms，故采样窗口相应放宽。
 *
 * v0.3.17-beta5 增补：
 *   1) k2 幽灵判定改为「每步重复检测」：松手才判定（按住 ≥0.9s 既不成也不败）、失败不回收
 *      （data-plane-id 不变）、复用同一架旋转/拖动到完全正确即成功（不新建副本）；
 *   2) 幂等：静置 ≥1.4s 不重复提示；k2 段内成功提示恰好 1 次。
 *
 * v0.3.17-beta4 增补：
 *   1) 聚焦静止期：整页洞 → 目标前先静止 380–900ms 再收缩（判「仍整页」用洞并集面积 ≥0.98·W·H）；
 *      add/transfer/blur 等其他过渡无静止期（几何立刻开始变化）；
 *   2) 气泡换段/换行 → 气泡洞立即突变跟随（全程 anim=none，dest ≈ 气泡 rect ≤0.5px）；
 *   3) 教程结束 = 常规结算（无「再来一局」、有「返回主页」）；
 *   7) 跨阶段续接回归：确认布阵 → 单元3 首个 transfer 首帧非整页（从确认按钮洞续接）。
 *
 * v0.3.17-beta2 增补（洞动画引擎 + 跨阶段续接）：
 *   1) 教程页首帧即渲染遮罩（恒渲染）；弹窗期同样渲染基础态且阻断带为 0；
 *   3) 压暗→目标切换期间无零洞帧（不闪整页洞）；
 *   4) 单元2 拖动/旋转等待期「待选栏 + 我方网格」双目标同时开洞（引擎洞数 2）；
 *   5) 全部飞机入格后网格洞保持（rotateWait / thanks / detect 合法态）；
 *   6) 确认布阵 → 单元3 首个遮罩过渡为 transfer（spotlightCarry 跨阶段续接确认按钮洞）；
 *   7) 教程横幅（v0.3.18-beta2 起教程内**不再渲染** .game-banner；改由 expectNoTutorialBanner 断言恒为 0）；
 *   8) k2 双洞（参考网格+空网格）、k3 仅空网格 1 洞且参考网格无残留。
 *
 * 覆盖：
 * 1) 单元1（本次全练习）：
 *    - 三场景网格居中（`.u1-grid` 中心 ≈ `.tutorial-unit1__body` 中心）；
 *    - 场景2 预置报点显式结果（D7/G8/F9 = ✗、C6/D6/E6/F8/G6/E8 = ◯）、错点落 ✗、E5 命中 ★ + 幽灵；
 *    - 场景3 预置（H6 = ✗、其余 ◯）、J7 试错落 ✗、F7 命中 ★，且【同一网格】真实位置渲染幽灵（页面仅 1 个网格）；
 * 2) 单元2：开场 4 段（逐字首行）→ 待选栏 → 拖 3 架 → 旋转引导气泡出现即突显网格（无需点击）→
 *    旋转 → thanks「压暗但不阻断」→ 合法 → 确认布阵；
 * 3) 单元3：
 *    - 开场 i1 为纯整屏压暗（无挖洞、覆盖全屏、气泡与 `.tutorial-escape` 可点）；i4 不可点击推进；
 *    - 混合模式 k1/k3/p1（整屏压暗 + 空网格开洞 + 气泡豁免）几何/命中断言；
 *    - 幽灵标记三态【每步重复检测】：位置不符=无提示、机头对朝向错=失败提示、完全正确=成功；
 *      按住指针期间一律不判定（必须松手落定）；失败不回收幽灵，复用同一架（旋转/拖动）即可成功；
 *      同一架同一结果只提示一次（静置不重复提示，k2 段成功/失败反馈各 1 次）；
 *    - k4 进入着色教学时空网格已取消突显（该处点击命中阻断带）；
 *    - 首杀支线与预报点支线【并行且顺序无关】：kill-first（用例2）与 prefire-first（用例3）；
 *    - 对局自然结束 → **常规结算画面**（.result，无「再来一局」hideRematch）→「返回主页」→ 主页；
 * 4) 突显为模态（v0.3.13 弹窗纵深防护回归）：非突显区不可点、气泡/退出可点、弹窗打开时阻断带为 0。
 *
 * 全程 console 零 error。
 */
import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import {
  diagCoords,
  oppCell,
  readBattleSnapshot,
  useE2eSeed,
  waitMyTurn,
  watchErrors,
} from './helpers'


/* ================= 通用定位/断言 ================= */

function modal(page: Page) {
  return page.locator('.paper-modal__dialog')
}
function bubble(page: Page) {
  return page.locator('.tutorial-bubble__text')
}
function spotlight(page: Page) {
  return page.locator('.tutorial-spotlight')
}
/** 安全读取气泡文本：气泡可能不存在（等待步）→ 先 count 再带短超时读取 */
async function bubbleTextSafe(page: Page): Promise<string> {
  if ((await bubble(page).count()) === 0) return ''
  return (await bubble(page).textContent({ timeout: 1000 }).catch(() => '')) ?? ''
}
async function clickBubble(page: Page, timeout = 10_000): Promise<void> {
  await expect(bubble(page)).toBeVisible({ timeout })
  await bubble(page).click({ timeout: 3000 })
}
/** 单层遮罩的挖洞数（v0.3.18-beta1：path 改 3px 圆角后含弧线，不能再数 ' M' → 读 data-spotlight-holes） */
async function spotlightHoles(page: Page): Promise<number> {
  return Number((await spotlightAttr(page, 'data-spotlight-holes')) ?? '0')
}
function blockCount(page: Page) {
  return page.locator('.tutorial-block').count()
}
/** v0.3.17-beta3 item 1/2：遮罩层度量（元素数 / mode 数 / 总暗度 / 暗底层与 path 层数） */
async function maskLayers(page: Page) {
  return page.evaluate(() => {
    const alpha = (c: string): number => {
      const m = /rgba?\(([^)]+)\)/.exec(c)
      if (!m) return 0
      const parts = m[1]!.split(',').map((x) => parseFloat(x.trim()))
      return parts.length >= 4 ? parts[3]! : 1
    }
    const spots = Array.from(document.querySelectorAll('.tutorial-spotlight'))
    let combined = 1
    for (const el of spots) {
      const bg = alpha(getComputedStyle(el).backgroundColor)
      const path = el.querySelector('path')
      const pf = path ? alpha(getComputedStyle(path).fill) : 0
      // 同一元素内「暗底 + path 填充」会叠加（v0.3.17-beta3 修复点）→ 逐元素先合再全局合
      combined *= 1 - (1 - (1 - bg) * (1 - pf))
    }
    return {
      count: spots.length,
      modeCount: document.querySelectorAll('[data-spotlight-mode]').length,
      sheet: document.querySelectorAll('.tutorial-spotlight--sheet').length,
      paths: document.querySelectorAll('.tutorial-spotlight path').length,
      darkness: 1 - combined,
    }
  })
}
/** v0.3.17-beta3 item 1/2：任何时刻遮罩恒为单层（元素数/mode 数 =1）且总暗度 ≤ 基础值 0.52 */
async function expectSingleLayer(page: Page): Promise<void> {
  const m = await maskLayers(page)
  expect(m.count, '遮罩元素数应为 1（不再叠加）').toBe(1)
  expect(m.modeCount, 'mode 元素数应为 1').toBe(1)
  expect(m.sheet + m.paths, '暗底层与 path 填充不应同时出现').toBeLessThanOrEqual(1)
  expect(m.darkness, `总暗度应 ≤ 0.53（实测 ${m.darkness.toFixed(3)}）`).toBeLessThanOrEqual(0.53)
}
/** 纯气泡突显（pure dim）：mode=dim、无 svg/path、阻断带存在、暗层覆盖全屏、单层 */
async function expectPureDim(page: Page): Promise<void> {
  await expect(page.locator('.tutorial-spotlight[data-spotlight-mode="dim"]')).toHaveCount(1)
  await expect(page.locator('.tutorial-spotlight path')).toHaveCount(0)
  await expect(page.locator('.tutorial-block')).not.toHaveCount(0)
  await expectSingleLayer(page)
  const dim = await page.locator('.tutorial-spotlight--dim').boundingBox()
  const vp = page.viewportSize()
  if (dim && vp) {
    expect(Math.abs(dim.x)).toBeLessThanOrEqual(1)
    expect(Math.abs(dim.y)).toBeLessThanOrEqual(1)
    expect(Math.abs(dim.width - vp.width)).toBeLessThanOrEqual(1)
    expect(Math.abs(dim.height - vp.height)).toBeLessThanOrEqual(1)
  }
}
/** 混合模式（整屏压暗 + 目标开洞）；断言引擎属性 data-spotlight-block=1 */
async function expectHybrid(page: Page): Promise<void> {
  await expect(page.locator('.tutorial-spotlight[data-spotlight-mode="hybrid"]')).toHaveCount(1)
  expect(await spotlightHoles(page)).toBeGreaterThanOrEqual(1)
  await expect(page.locator('.tutorial-block')).not.toHaveCount(0)
  await expect(page.locator('.tutorial-spotlight[data-spotlight-block="1"]')).toHaveCount(1)
  // v0.3.17-beta3 item 1/2：混合模式（dim + 目标开洞）恒为单层、总暗度不叠加
  await expectSingleLayer(page)
}
/** v0.3.17-beta3 item 5：rAF 逐帧采样气泡文本（用于断言某段文案在本阶段从未出现） */
async function observeBubbleTexts(page: Page, ms = 1200): Promise<string[]> {
  return page.evaluate(async (dur: number) => {
    const out = new Set<string>()
    const t0 = performance.now()
    while (performance.now() - t0 < dur) {
      const el = document.querySelector('.tutorial-bubble__text')
      out.add(el ? (el.textContent ?? '') : '')
      await new Promise((r) => requestAnimationFrame(() => r(null)))
    }
    return [...out]
  }, ms)
}
/** v0.3.17-beta3 item 4：逐帧采样空洞并集面积（含气泡尺寸，用于过滤气泡换文案造成的布局跳变） */
interface HoleAreaFrame {
  dt: number
  union: number
  maxHole: number
  holes: number
  bubble: string
}
async function observeHoleAreas(page: Page, ms = 1200): Promise<HoleAreaFrame[]> {
  return page.evaluate(async (dur: number) => {
    // v0.3.18-beta1：改读 data-spotlight-rects（圆角 path 无法用矩形正则解析）
    const parse = (raw: string | null) => {
      if (!raw) return [] as Array<{ l: number; t: number; r: number; b: number }>
      return raw
        .split(';')
        .filter(Boolean)
        .map((seg) => {
          const [l, t, w, h] = seg.split(',').map(Number)
          return { l: l!, t: t!, r: l! + w!, b: t! + h! }
        })
    }
    const frames: Array<{ dt: number; union: number; maxHole: number; holes: number; bubble: string }> = []
    let prev = 0
    const t0 = performance.now()
    while (performance.now() - t0 < dur) {
      const now = performance.now()
      const el = document.querySelector('.tutorial-spotlight')
      if (el) {
        const W = window.innerWidth
        const H = window.innerHeight
        const rects = parse(el.getAttribute('data-spotlight-rects')).filter(
          (r) => (r.r - r.l) * (r.b - r.t) < W * H * 0.999,
        )
        const areas = rects.map((r) => Math.max(0, r.r - r.l) * Math.max(0, r.b - r.t))
        const bb = document.querySelector('.tutorial-bubble')?.getBoundingClientRect()
        frames.push({
          dt: prev ? now - prev : 999,
          union: areas.reduce((a, b) => a + b, 0),
          maxHole: areas.length > 0 ? Math.max(...areas) : 0,
          holes: areas.length,
          bubble: bb ? `${Math.round(bb.width)}x${Math.round(bb.height)}` : '',
        })
      }
      prev = now
      await new Promise((r) => requestAnimationFrame(() => r(null)))
    }
    return frames
  }, ms)
}
/**
 * item 4 断言：空洞并集面积逐帧连续（去重叠分解下无包围盒合并式跳变）。
 * 阈值取组长契约：单帧 |Δ| ≤ 最大洞面积 12%（M8 实测最大 2.5%）。
 * 注意 v0.3.18-beta2 item 5 起 k2→k3 是「参考网格洞 → 气泡洞」的 **transfer**（两洞可能短暂分离/穿越），
 * 并集面积允许小幅瞬时上升，故不再单独断言「不向上跳变」（原 beta3 的 2% 上界只适用于单调融合）。
 */
function expectHoleAreaContinuity(frames: HoleAreaFrame[], label: string): void {
  expect(frames.length, `${label} 应采到空洞帧`).toBeGreaterThan(3)
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1]!
    const b = frames[i]!
    // 跳过掉帧与「气泡换文案导致自身尺寸跳变」的采样对
    if (b.dt > 20 || a.bubble !== b.bubble || b.bubble === '') continue
    const maxHole = Math.max(a.maxHole, b.maxHole, 1)
    const delta = Math.abs(b.union - a.union)
    expect(
      delta,
      `${label} 单帧面积变化应 ≤ 最大洞面积 12%（实测 ${((delta / maxHole) * 100).toFixed(1)}%，Δ=${delta.toFixed(1)}px² / 最大洞 ${maxHole.toFixed(0)}px²）`,
    ).toBeLessThanOrEqual(Math.max(0.12 * maxHole, 1))
  }
}

/* ---------- v0.3.17-beta1：空洞动画引擎（遮罩常驻）断言工具 ---------- */

/** 遮罩属性读取（基础态常驻同一 svg） */
async function spotlightAttr(page: Page, name: string): Promise<string | null> {
  return page.locator('.tutorial-spotlight').first().getAttribute(name).catch(() => null)
}
interface SpotlightFrame {
  anim: string | null
  mode: string | null
  raw: number
  holes: number
  block: string | null
  /** 采样时刻（performance.now()） */
  t: number
  /** 洞几何签名（逐洞四舍五入到 1px）——用于判定“几何是否已开始变化” */
  sig: string
  /** 洞并集面积（px²；无 path 的静止 dim 层为 0） */
  area: number
  /** 洞是否仍≈整页（≥0.98·W·H，二值：整页静止期的判据，不能只看单片宽——洞是 x 切片） */
  full: boolean
  /** data-spotlight-anim-rects 首项（动画插值中的原始洞矩形，未加 PAD）——用于气泡洞连续性/贴合度 */
  animRect: { l: number; t: number; w: number; h: number } | null
}
/** rAF 轮询逐帧采样遮罩属性（dest 变化前开始观测；覆盖 ~340ms smootherstep 过渡 + v0.3.17-beta4 聚焦静止期） */
async function observeFrames(page: Page, ms = 700): Promise<SpotlightFrame[]> {
  return page.evaluate(async (dur: number) => {
    // v0.3.18-beta1：洞几何改读 data-spotlight-rects（分号分隔 l,t,w,h 的去重叠切片列表）——
    // 圆角后 path 由弧线构成，M…H…V…H…Z 解析会得到 0 个洞。切片互不重叠 → 面积和 = 并集面积。
    const parseHoles = (raw: string | null) => {
      if (!raw) return [] as Array<[number, number, number, number]>
      return raw
        .split(';')
        .filter(Boolean)
        .map((seg) => {
          const [l, t, w, h] = seg.split(',').map(Number)
          return [l!, t!, l! + w!, t! + h!] as [number, number, number, number]
        })
    }
    const out: Array<{
      anim: string | null
      mode: string | null
      raw: number
      holes: number
      block: string | null
      t: number
      sig: string
      area: number
      full: boolean
      animRect: { l: number; t: number; w: number; h: number } | null
    }> = []
    const t0 = performance.now()
    while (performance.now() - t0 < dur) {
      const el = document.querySelector('.tutorial-spotlight')
      if (el) {
        const holes = parseHoles(el.getAttribute('data-spotlight-rects'))
        const area = holes.reduce(
          (a, [l, t, r, b]) => a + Math.max(0, r - l) * Math.max(0, b - t),
          0,
        )
        const vp = window.innerWidth * window.innerHeight
        // 几何签名用【并集包围盒】：去重叠分解会因豁免元素微动而改变切片数，
        // 但并集范围只随真正的洞形变而变（静止期恒为整页 bbox）
        const sig = holes.length
          ? [
              Math.min(...holes.map((r) => r[0])),
              Math.min(...holes.map((r) => r[1])),
              Math.max(...holes.map((r) => r[2])),
              Math.max(...holes.map((r) => r[3])),
            ]
              .map((v) => Math.round(v))
              .join(',')
          : ''
        const anim0 = (el.getAttribute('data-spotlight-anim-rects') ?? '').split(';').filter(Boolean)[0]
        const animRect = anim0
          ? (() => {
              const [l, t, w, h] = anim0.split(',').map(Number)
              return { l: l!, t: t!, w: w!, h: h! }
            })()
          : null
        out.push({
          anim: el.getAttribute('data-spotlight-anim'),
          mode: el.getAttribute('data-spotlight-mode'),
          raw: Number(el.getAttribute('data-spotlight-holes-raw') ?? '-1'),
          holes: Number(el.getAttribute('data-spotlight-holes') ?? '-1'),
          block: el.getAttribute('data-spotlight-block'),
          t: performance.now(),
          sig,
          area,
          full: vp > 0 && area >= 0.98 * vp,
          animRect,
        })
      }
      await new Promise((r) => requestAnimationFrame(() => r(null)))
    }
    return out
  }, ms)
}
/** 过渡期间出现过的 data-spotlight-anim 取值集合 */
function animSet(frames: SpotlightFrame[]): string[] {
  return [...new Set(frames.map((f) => f.anim).filter((v): v is string => Boolean(v)))]
}
/** 聚焦静止期：focus 首帧（整页）→ 洞并集面积首次跌破 0.98·W·H（开始收缩） */
function focusHoldMs(frames: SpotlightFrame[]): number | null {
  const i0 = frames.findIndex((f) => f.anim === 'focus')
  if (i0 < 0) return null
  const i1 = frames.findIndex((f, i) => i > i0 && !f.full)
  return i1 < 0 ? null : frames[i1]!.t - frames[i0]!.t
}
/** 过渡持续时长：首个 label 帧 → 落定（anim 变为非 label） */
function transitionMs(frames: SpotlightFrame[], label: string): number | null {
  const i0 = frames.findIndex((f) => f.anim === label)
  if (i0 < 0) return null
  const i1 = frames.findIndex((f, i) => i > i0 && f.anim !== label)
  return i1 < 0 ? null : frames[i1]!.t - frames[i0]!.t
}
/**
 * v0.3.17-beta4 item 1：focus（整页 → 目标）应先静止 380–900ms 再收缩。
 * 判「仍整页」用**洞并集面积**（≥0.98·W·H）——洞是 x 切片，单片宽不可用。
 */
function expectFocusHold(frames: SpotlightFrame[], label: string): void {
  const i0 = frames.findIndex((f) => f.anim === 'focus')
  expect(i0, `${label} 应观测到 focus 过渡`).toBeGreaterThanOrEqual(0)
  expect(frames[i0]!.full, `${label} focus 首帧洞应为整页（静止期）`).toBe(true)
  const hold = focusHoldMs(frames)
  expect(hold, `${label} 应观测到聚焦开始收缩`).not.toBeNull()
  // 诊断串：focus 起始后前 16 帧（相对毫秒 / anim / 是否整页 / 面积）
  const diag = frames
    .slice(i0, i0 + 16)
    .map(
      (f) =>
        `${Math.round(f.t - frames[i0]!.t)}:${f.anim}:raw${f.raw}:${f.full ? 'full' : 'shrunk'}:${Math.round(f.area)}`,
    )
    .join(' | ')
  expect(
    hold!,
    `${label} 聚焦静止期应 ≥380ms（实测 ${hold!.toFixed(0)}ms）｜帧序列 ${diag}`,
  ).toBeGreaterThanOrEqual(380)
  expect(hold!, `${label} 聚焦静止期应 ≤900ms（实测 ${hold!.toFixed(0)}ms）`).toBeLessThanOrEqual(900)
  // 整段 = 静止 500ms + 收缩 340ms ≈ 840ms（远长于其他过渡的 ~340ms）
  const total = transitionMs(frames, 'focus')
  expect(total, `${label} 应观测到 focus 落定`).not.toBeNull()
  expect(total!, `${label} focus 总时长应 ≥750ms（实测 ${total!.toFixed(0)}ms）`).toBeGreaterThanOrEqual(750)
}
/** 某过渡的「静止期」：从 label 首帧到洞几何（anim-rects 原始洞矩形）首次变化的时间 */
function staticMs(frames: SpotlightFrame[], label: string): number | null {
  const i0 = frames.findIndex((f) => f.anim === label)
  if (i0 < 0) return null
  const a0 = frames[i0]!.animRect
  if (!a0) return null
  const i1 = frames.findIndex(
    (f, i) =>
      i > i0 &&
      !!f.animRect &&
      (Math.abs(f.animRect.l - a0.l) > 0.4 ||
        Math.abs(f.animRect.t - a0.t) > 0.4 ||
        Math.abs(f.animRect.w - a0.w) > 0.4 ||
        Math.abs(f.animRect.h - a0.h) > 0.4),
  )
  return i1 < 0 ? null : frames[i1]!.t - frames[i0]!.t
}
/** 等待遮罩过渡落定（data-spotlight-anim 回到 none）：让观测窗只覆盖目标过渡，不混入入场 focus */
async function expectSpotlightSettled(page: Page): Promise<void> {
  await expect
    .poll(() => spotlightAttr(page, 'data-spotlight-anim'), {
      timeout: 6000,
      message: '遮罩过渡应已落定（anim=none）',
    })
    .toBe('none')
}
/**
 * 过渡契约分派（v0.3.18-beta2 复跑修正）：
 * - **focus**：静止期 380–900ms（`expectFocusHold`；仅当观测窗完整覆盖该 focus —— 首帧仍为整页且窗内已落定 —— 才判定）；
 * - **add/transfer/blur**：静止期 ≤200ms（`expectNoStartDelay`，不放宽）。
 * 旧写法把窗口内所有非 none 标签一律按 200ms 判，若窗口起点早于 k1 入场 focus（时序抖动）即误判。
 */
function expectTransitionContracts(frames: SpotlightFrame[], label: string): void {
  const labels = animSet(frames).filter((l) => l !== 'none')
  expect(labels.length, `${label} 应有洞过渡动画`).toBeGreaterThan(0)
  for (const l of labels.filter((l) => l !== 'focus')) expectNoStartDelay(frames, l)
  const i0 = frames.findIndex((f) => f.anim === 'focus')
  const settledInWindow = i0 >= 0 && frames.slice(i0 + 1).some((f) => f.anim !== 'focus')
  if (i0 >= 0 && frames[i0]!.full && settledInWindow) expectFocusHold(frames, `${label} focus`)
}
/**
 * v0.3.17-beta4 item 1：add/transfer/blur 等其他过渡**不加静止期** ——
 * 洞几何应在 label 出现后立刻开始变化（≤200ms；只有 focus 才允许 ~500ms 静止）。
 * 用「几何静止时长」而非「整段时长」判定：引擎会因测量更新重规划，重规划会让整段变长
 * （实测 787–984ms），但不会让几何静止 —— 后者才对应“加延迟”这一契约。
 */
function expectNoStartDelay(frames: SpotlightFrame[], label: string, maxMs = 200): void {
  const st = staticMs(frames, label)
  expect(st, `应观测到 ${label} 过渡并出现几何变化`).not.toBeNull()
  expect(
    st!,
    `${label} 不应有额外静止期（首帧后几何静止 ${st!.toFixed(0)}ms；focus 才允许 ~500ms）`,
  ).toBeLessThanOrEqual(maxMs)
}
/** data-spotlight-holes-raw / -sel（引擎目标洞数与选择器） */
async function rawHoles(page: Page): Promise<number> {
  return Number((await spotlightAttr(page, 'data-spotlight-holes-raw')) ?? '-1')
}
async function engineSel(page: Page): Promise<string> {
  return (await spotlightAttr(page, 'data-spotlight-sel')) ?? ''
}
/**
 * v0.3.18-beta2 item 7：教程内**不再渲染**「您先手/您后手」横幅（GameScreen hideFirstTurnBanner）。
 * 采样覆盖教程对局挂载初期（原横幅窗口 1.5s）→ 全程 .game-banner 计数恒为 0；
 * 同时断言遮罩激活时阻断带仍 >0（阻断恒在，item 1）。普通练习对局仍有横幅：single.spec/layout.spec 覆盖。
 */
async function expectNoTutorialBanner(page: Page): Promise<void> {
  const seen = page.evaluate(async (dur: number) => {
    let max = 0
    const t0 = performance.now()
    while (performance.now() - t0 < dur) {
      max = Math.max(max, document.querySelectorAll('.game-banner').length)
      await new Promise((r) => requestAnimationFrame(() => r(null)))
    }
    return max
  }, 2000)
  await expect(bubble(page)).toContainText('现在，我们正式进入实战！', { timeout: 20_000 })
  await expect
    .poll(() => blockCount(page), { timeout: 8000, message: '遮罩激活时阻断带应 >0' })
    .toBeGreaterThan(0)
  expect(await seen, '教程内不得出现先后手横幅（含挂载初期窗口）').toBe(0)
  await expect(page.locator('.game-banner')).toHaveCount(0)
}
/** 基础态（无突显）：遮罩仍常驻，但洞=整页（视觉无压暗）且阻断带=0 */
async function expectNoHighlight(page: Page): Promise<void> {
  await expect(page.locator('.tutorial-spotlight')).toHaveCount(1)
  await expect(page.locator('.tutorial-block')).toHaveCount(0)
  await expect.poll(() => spotlightAttr(page, 'data-spotlight-mode'), { timeout: 5000 }).toBe('holes')
  expect(Number(await spotlightAttr(page, 'data-spotlight-holes'))).toBeGreaterThanOrEqual(1)
}
/**
 * v0.3.18-beta2 bug1 护栏：遮罩激活期间「阻断恒在」的逐帧采样。
 * 覆盖：有遮罩 => .tutorial-block 数量 >0；非豁免探针恒被阻断；退出按钮/气泡中心恒可点。
 */
async function sampleBlockInvariants(
  page: Page,
  ms: number,
  probes: { nonExempt: string; requireEscape?: boolean },
) {
  return page.evaluate(
    async ([dur, sel, needEscape]) => {
      const hitAt = (selector: string) => {
        const el = document.querySelector(selector)
        if (!el) return null
        const r = el.getBoundingClientRect()
        if (r.width <= 0 || r.height <= 0) return null
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
        if (!top) return null
        return {
          blocked: !!top.closest('.tutorial-block'),
          escape: !!top.closest('.tutorial-escape'),
          bubble: !!top.closest('.tutorial-bubble'),
        }
      }
      let frames = 0
      let zeroBlock = 0
      let probeUnblocked = 0
      let escapeMiss = 0
      let bubbleMiss = 0
      const t0 = performance.now()
      while (performance.now() - t0 < (dur as number)) {
        const active = document.querySelector('.tutorial-spotlight[data-spotlight-block="1"]')
        if (active) {
          frames += 1
          if (!document.querySelector('.tutorial-block')) zeroBlock += 1
          const p = hitAt(sel as string)
          if (p && !p.blocked) probeUnblocked += 1
          if (needEscape) {
            const e = hitAt('.tutorial-escape')
            if (!e || !e.escape) escapeMiss += 1
          }
          const b = hitAt('.tutorial-bubble')
          if (b && !b.bubble) bubbleMiss += 1
        }
        await new Promise((r) => requestAnimationFrame(() => r(null)))
      }
      return { frames, zeroBlock, probeUnblocked, escapeMiss, bubbleMiss }
    },
    [ms, probes.nonExempt, Boolean(probes.requireEscape)] as [number, string, boolean],
  )
}
/** v0.3.18-beta2 bug1：断言逐帧采样结果（零帧违反） */
function expectBlockInvariants(
  r: { frames: number; zeroBlock: number; probeUnblocked: number; escapeMiss: number; bubbleMiss: number },
  label: string,
): void {
  expect(r.frames, `${label} 应采到遮罩激活帧`).toBeGreaterThan(20)
  expect(r.zeroBlock, `${label} 不得出现「有遮罩但阻断带=0」的帧`).toBe(0)
  expect(r.probeUnblocked, `${label} 非豁免探针应恒被阻断`).toBe(0)
  expect(r.escapeMiss, `${label} 退出按钮应恒可点`).toBe(0)
  expect(r.bubbleMiss, `${label} 气泡应恒可点`).toBe(0)
}
/**
 * v0.3.18-beta2 bug4/5 护栏：豁免对象（退出按钮）**不在任何洞矩形内**，且绘制在遮罩之上（中心命中自身）。
 * 洞几何读 data-spotlight-rects（去重叠切片、已含 PAD），精确选择器用顶层真实按钮。
 */
async function expectExemptNotHoled(page: Page): Promise<void> {
  const r = await page.evaluate(() => {
    const esc = document.querySelector('.tutorial-top-layer .tutorial-escape') as HTMLElement | null
    if (!esc) return null
    const e = esc.getBoundingClientRect()
    const holes = Array.from(document.querySelectorAll('.tutorial-spotlight[data-spotlight-rects]'))
      .flatMap((el) => (el.getAttribute('data-spotlight-rects') ?? '').split(';').filter(Boolean))
      .map((seg) => seg.split(',').map(Number))
    const overlap = holes.filter(
      ([l, t, w, h]) => e.left < l! + w! && e.right > l! && e.top < t! + h! && e.bottom > t!,
    ).length
    const top = document.elementFromPoint(e.left + e.width / 2, e.top + e.height / 2)
    const host = document.getElementById('tutorial-top-layer')
    return {
      overlap,
      hitSelf: !!(top && top.closest('.tutorial-escape')),
      inTopLayer: !!esc.closest('#tutorial-top-layer'),
      z: host ? Number(getComputedStyle(host).zIndex) : -1,
      holes: holes.length,
    }
  })
  expect(r, '顶层退出按钮应存在（.tutorial-top-layer .tutorial-escape）').not.toBeNull()
  expect(r!.overlap, '退出按钮不应落在任何洞矩形内（豁免不再开洞）').toBe(0)
  expect(r!.hitSelf, '退出按钮中心应命中按钮自身（绘制在遮罩之上）').toBe(true)
  expect(r!.inTopLayer, '退出按钮应位于置顶层内').toBe(true)
  expect(r!.z, '置顶层 z 应高于遮罩(130)/阻断带(150)').toBeGreaterThanOrEqual(200)
}
/** v0.3.18-beta2 bug2 护栏：提示带为单条 evenodd 环形路径（2×M：外圈+内圈）+ 内圈 4×A3 3 圆角 */
async function expectFxRing(page: Page, kind: 'success' | 'failure'): Promise<void> {
  const band = page.locator(`.tutorial-fx--${kind}`)
  await expect(band, `${kind} 提示带应存在`).toHaveCount(1, { timeout: 8000 })
  const d = await band.locator('.tutorial-fx__svg clipPath path').first().getAttribute('d')
  expect(d, `${kind} 提示带应有环形 clip 路径`).toBeTruthy()
  expect((d!.match(/M/g) ?? []).length, `${kind} 环形路径应为单一 path（外圈+内圈 2 段）`).toBe(2)
  expect((d!.match(/A\s*3\s+3/g) ?? []).length, `${kind} 内圈应有 4 段 A3 3 圆角弧`).toBe(4)
  const meta = await band.evaluate((el) => ({
    band: Number(el.getAttribute('data-fx-band')),
    radius: Number(el.getAttribute('data-fx-radius')),
  }))
  expect(meta.band, '提示带宽应为 16px').toBe(16)
  expect(meta.radius, '提示带内圆角应为 3px').toBe(3)
}
/** v0.3.18-beta2 bug6 护栏：过渡逐帧「零洞帧=0、切片数不出现 A→B→A 跳变」 */
function expectHoleCountStable(frames: SpotlightFrame[], label: string): void {
  const seq = frames.filter((f) => f.anim !== null && f.holes >= 0)
  expect(seq.length, `${label} 应采到洞帧`).toBeGreaterThan(5)
  const zero = seq.filter((f) => f.holes === 0)
  expect(zero.length, `${label} 不得出现零洞帧（遮罩恒有洞）`).toBe(0)
  const osc: string[] = []
  for (let i = 2; i < seq.length; i++) {
    const a = seq[i - 2]!.holes
    const b = seq[i - 1]!.holes
    const c = seq[i]!.holes
    if (a === c && b !== a) osc.push(`${a}→${b}→${c}@${Math.round(seq[i]!.t)}ms`)
  }
  expect(osc, `${label} 切片数不得出现 A→B→A 跳变（闪烁）`).toEqual([])
}
/** v0.3.18-beta2 bug3 护栏：气泡洞连续（单帧位移 ≤ 全程 15%，掉帧对跳过） */
function expectBubbleHoleContinuity(frames: SpotlightFrame[], label: string): void {
  const seq = frames.filter((f) => f.animRect)
  expect(seq.length, `${label} 应采到动画洞帧`).toBeGreaterThan(3)
  const dist = (
    a: { l: number; t: number; w: number; h: number },
    b: { l: number; t: number; w: number; h: number },
  ) => Math.abs(b.l - a.l) + Math.abs(b.t - a.t) + Math.abs(b.w - a.w) + Math.abs(b.h - a.h)
  const first = seq[0]!
  const last = seq[seq.length - 1]!
  const travel = dist(first.animRect!, last.animRect!)
  expect(travel, `${label} 应确有洞位移（换段/换行导致尺寸变化）`).toBeGreaterThan(1)
  let maxStep = 0
  for (let i = 1; i < seq.length; i++) {
    const a = seq[i - 1]!
    const b = seq[i]!
    if (b.t - a.t > 24) continue // 跳过掉帧采样对（避免把系统卡顿判成跳变）
    maxStep = Math.max(maxStep, dist(a.animRect!, b.animRect!))
  }
  expect(
    maxStep / travel,
    `${label} 单帧位移应 ≤ 全程 15%（实测 ${((maxStep / travel) * 100).toFixed(1)}%）`,
  ).toBeLessThanOrEqual(0.15)
}
/** 等待基础态落定：anim=none 且洞=整页（≥0.98·W·H）——聚焦静止期断言的前置条件 */
async function expectBaseSettled(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const el = document.querySelector('.tutorial-spotlight')
          if (!el) return null
          const area = (el.getAttribute('data-spotlight-rects') ?? '')
            .split(';')
            .filter(Boolean)
            .map((seg) => seg.split(',').map(Number))
            .reduce((a, [, , w, h]) => a + Math.max(0, w!) * Math.max(0, h!), 0)
          const vp = window.innerWidth * window.innerHeight
          return { anim: el.getAttribute('data-spotlight-anim'), full: vp > 0 && area >= 0.98 * vp }
        }),
      { timeout: 6000, message: '基础态应落定（anim=none 且洞=整页）' },
    )
    .toEqual({ anim: 'none', full: true })
}
/** data-spotlight-anim-rects 首项（动画插值洞矩形，未加 PAD） */
async function animRects(page: Page): Promise<Array<{ left: number; top: number; width: number; height: number }>> {
  const raw = await spotlightAttr(page, 'data-spotlight-anim-rects')
  if (!raw) return []
  return raw
    .split(';')
    .filter(Boolean)
    .map((seg) => {
      const [left, top, width, height] = seg.split(',').map(Number)
      return { left: left!, top: top!, width: width!, height: height! }
    })
}
/** 目标中心点“命中信息”：topmost 元素是否落在阻断带 / 气泡 / 退出豁免里 */
async function hitInfo(page: Page, selector: string) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const r = el.getBoundingClientRect()
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return {
      blocked: Boolean(top && top.closest('.tutorial-block')),
      inBubble: Boolean(top && top.closest('.tutorial-bubble')),
      inEscape: Boolean(top && top.closest('.tutorial-escape')),
      tag: top ? top.tagName : 'NONE',
    }
  }, selector)
}
/** 命中断言（轮询：突显换目标后阻断带/开洞有一帧~400ms 的重测窗口） */
async function expectHit(
  page: Page,
  selector: string,
  field: 'blocked' | 'inBubble' | 'inEscape',
  value: boolean,
  timeout = 4000,
): Promise<void> {
  await expect
    .poll(async () => (await hitInfo(page, selector))?.[field] ?? null, {
      timeout,
      message: `${selector} ${field} 应为 ${value}`,
    })
    .toBe(value)
}
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 14 })
  await page.mouse.up()
}
/** 按住拖拽（不松手），返回后由调用方检查/松手 */
async function dragHoldFromRef(page: Page, target: { x: number; y: number }) {
  const rb = await page.locator('.game__ref .paper-grid__plane').boundingBox()
  if (!rb) throw new Error('参考飞机不可见')
  await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2)
  await page.mouse.down()
  await page.mouse.move(target.x, target.y, { steps: 12 })
  await page.waitForTimeout(120)
}
async function releaseOverRef(page: Page) {
  const r = await page.locator('.game__ref').boundingBox()
  if (r) await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2, { steps: 6 })
  await page.mouse.up()
  await page.waitForTimeout(180)
}
/** 同格两次点击（<600ms）= 教程练习网格的「双击」语义 */
async function dblclickCell(page: Page, loc: Locator) {
  await loc.click({ timeout: 2500 })
  await page.waitForTimeout(90)
  await loc.click({ timeout: 2500 })
}
/** 点击被 .tutorial-block 阻断的区域（取最大阻断带靠上位置，避开气泡与退出按钮） */
async function clickBlockedArea(page: Page): Promise<void> {
  const blocks = page.locator('.tutorial-block')
  const n = await blocks.count()
  if (n === 0) throw new Error('没有 .tutorial-block（当前无突显阻断）')
  let best = { x: 0, y: 0, w: 0, h: 0, area: -1 }
  for (let i = 0; i < n; i++) {
    const b = await blocks.nth(i).boundingBox()
    if (!b) continue
    const area = b.width * b.height
    if (area > best.area) best = { x: b.x, y: b.y, w: b.width, h: b.height, area }
  }
  await page.mouse.click(best.x + best.w / 2, best.y + 8)
}
async function openTutorial(page: Page) {
  await useE2eSeed(page) // v0.3.15：E2E_SEED → localStorage（教程单元3 对手阵型/机头可复现）
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '飞机杀' })).toBeVisible()
  await page.getByRole('button', { name: '新手教程' }).click()
  await expect(modal(page)).toContainText('您是否了解本游戏的基本规则？')
}

/* ================= 坐标 / 形状几何 ================= */

const LETTERS = 'ABCDEFGHIJ'
function coordToCell(coord: string) {
  return { r: Number(coord.slice(1)) - 1, c: LETTERS.indexOf(coord[0]!) }
}
function cellToCoord(c: { r: number; c: number }) {
  return `${LETTERS[c.c]}${c.r + 1}`
}
/** 默认形状格（未旋转）与机头 */
const SHAPE_CELLS: Array<[number, number]> = [
  [0, 2],
  [1, 0],
  [1, 1],
  [1, 2],
  [1, 3],
  [1, 4],
  [2, 2],
  [3, 1],
  [3, 2],
  [3, 3],
]
function rotCell(r: number, c: number, times: number) {
  let cur = { r, c }
  for (let i = 0; i < times; i++) cur = { r: cur.c, c: 4 - cur.r }
  return cur
}
function rotCells(rot: number) {
  return SHAPE_CELLS.map(([r, c]) => rotCell(r, c, rot))
}
function headRelOf(rot: number) {
  return rotCell(0, 2, rot)
}
function shapeBBox(rot: number) {
  const cs = rotCells(rot)
  const minR = Math.min(...cs.map((c) => c.r))
  const maxR = Math.max(...cs.map((c) => c.r))
  const minC = Math.min(...cs.map((c) => c.c))
  const maxC = Math.max(...cs.map((c) => c.c))
  return { minR, minC, h: maxR - minR + 1, w: maxC - minC + 1 }
}
/** 机身格相对机头的偏移（不含机头） */
function bodyOffsets(rot: number) {
  const h = headRelOf(rot)
  return rotCells(rot)
    .map((c) => ({ r: c.r - h.r, c: c.c - h.c }))
    .filter((o) => o.r !== 0 || o.c !== 0)
}
/** 若 `coord` 是某飞机任一格，可能的机头格（所有朝向/格位的并集） */
const HEAD_DELTAS: Array<{ r: number; c: number }> = (() => {
  const set = new Map<string, { r: number; c: number }>()
  for (const rot of [0, 1, 2, 3]) {
    const h = headRelOf(rot)
    for (const c of rotCells(rot)) {
      const d = { r: h.r - c.r, c: h.c - c.c }
      if (d.r === 0 && d.c === 0) continue
      set.set(`${d.r},${d.c}`, d)
    }
  }
  return [...set.values()]
})()
function headCandidates(coord: string): string[] {
  const cell = coordToCell(coord)
  const out: string[] = []
  for (const d of HEAD_DELTAS) {
    const h = { r: cell.r + d.r, c: cell.c + d.c }
    if (h.r < 0 || h.r > 9 || h.c < 0 || h.c > 9) continue
    out.push(cellToCoord(h))
  }
  return out
}
/** 幽灵「机头落在 head」时该朝向对应的可视左上角（= origin + min） */
function headMatchVis(head: { r: number; c: number }, rot: number) {
  const h = headRelOf(rot)
  const b = shapeBBox(rot)
  return { r: head.r - h.r + b.minR, c: head.c - h.c + b.minC }
}
/** 机头落在 head 时，该朝向可视左上角是否仍在 10×10 界内（越界会被 snapOrigin 夹取 → 判定为「位置不符」） */
function rotRealizableAtHead(head: { r: number; c: number }, rot: number): boolean {
  const vis = headMatchVis(head, rot)
  const b = shapeBBox(rot)
  return vis.r >= 0 && vis.c >= 0 && vis.r <= 10 - b.h && vis.c <= 10 - b.w
}

/** 落点格 → 可视左上角 的吸附偏移（v0.3.13 实测标定：参考网格与对手棋盘格宽不同） */
function dropCell(vis: { r: number; c: number }, rot: number) {
  const b = shapeBBox(rot)
  return { r: vis.r + Math.ceil(b.h / 2) - 1, c: vis.c + Math.ceil(b.w / 2) - 1 }
}
/** 最后一只幽灵（含拖拽预览 data-plane-id=-1）的可视左上角格位 */
async function lastGhostVis(page: Page): Promise<{ r: number; c: number } | null> {
  const board = await page.locator('.game__opp .paper-grid__board').boundingBox()
  const el = page.locator('.game__opp .paper-grid__plane[data-plane-id]').last()
  if (!board || (await el.count()) === 0) return null
  const style = (await el.getAttribute('style')) ?? ''
  const left = Number(/left:\s*([\d.]+)px/.exec(style)?.[1] ?? 'NaN')
  const top = Number(/top:\s*([\d.]+)px/.exec(style)?.[1] ?? 'NaN')
  if (!Number.isFinite(left) || !Number.isFinite(top)) return null
  const cell = board.width / 10
  return { r: Math.round(top / cell), c: Math.round(left / cell) }
}
/** 参考飞机当前朝向（由渲染几何反推：min 偏移 + 宽高类别四态唯一） */
async function refRotation(page: Page): Promise<number> {
  const el = page.locator('.game__ref .paper-grid__plane')
  if ((await el.count()) === 0) return -1
  const style = (await el.getAttribute('style')) ?? ''
  const left = Number(/left:\s*([\d.]+)px/.exec(style)?.[1] ?? 'NaN')
  const top = Number(/top:\s*([\d.]+)px/.exec(style)?.[1] ?? 'NaN')
  const box = await el.boundingBox()
  if (!box) return -1
  const wide = box.width >= box.height
  if (top === 0 && left === 0) return wide ? 0 : 3
  if (top === 0 && left > 0) return 1
  return 2
}
async function setRefRotation(page: Page, target: number): Promise<void> {
  for (let i = 0; i < 5; i++) {
    if ((await refRotation(page)) === target) return
    const b = await page.locator('.game__ref .paper-grid__plane').boundingBox()
    if (!b) throw new Error('参考飞机不可见')
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2)
    await page.waitForTimeout(140)
  }
  throw new Error(`参考飞机朝向设置失败（目标 ${target}）`)
}
/**
 * 从参考网格拖一只幽灵到「可视左上角 = vis」（读回纠偏 ≤3 次）。
 * release=false 时保持按住（供拖动中持续检测/无反馈场景使用）。
 */
async function placeGhostAt(
  page: Page,
  vis: { r: number; c: number },
  rot: number,
  opts: { release?: boolean } = {},
): Promise<void> {
  const board = page.locator('.game__opp .paper-grid__board')
  let drop = dropCell(vis, rot)
  for (let attempt = 0; attempt < 3; attempt++) {
    const bb = await board.boundingBox()
    if (!bb) throw new Error('对手棋盘不可见')
    const cell = bb.width / 10
    await dragHoldFromRef(page, { x: bb.x + (drop.c + 0.5) * cell, y: bb.y + (drop.r + 0.5) * cell })
    const act = await lastGhostVis(page)
    if (act && act.r === vis.r && act.c === vis.c) break
    if (act) drop = { r: drop.r + (vis.r - act.r), c: drop.c + (vis.c - act.c) }
  }
  if (opts.release !== false) {
    await page.mouse.up()
    await page.waitForTimeout(320)
  }
}

/* ---------- v0.3.17-beta5：k2 复用同一架幽灵（不新建副本）工具 ---------- */

/** 已放置幽灵元素（排除参考拖拽预览 id=-1） */
function ghostPlanes(page: Page) {
  return page.locator('.game__opp .paper-grid__plane[data-plane-id]:not([data-plane-id="-1"])')
}
/** 幽灵包围盒长宽类别（90° 旋转必然互换） */
async function ghostAspect(page: Page): Promise<'wide' | 'tall' | null> {
  const b = await ghostPlanes(page).first().boundingBox()
  if (!b) return null
  return b.width >= b.height ? 'wide' : 'tall'
}
/** 旋转后各本体格相对「可视左上角」的偏移（点击本体格用） */
function visBodyOffsets(rot: number) {
  const b = shapeBBox(rot)
  return rotCells(rot).map((c) => ({ r: c.r - b.minR, c: c.c - b.minC }))
}
/**
 * 点击【已放置的同一架幽灵】本体格 → 原地旋转 90°（同一 data-plane-id，不新建副本）。
 * 先用真实点击（挑未被气泡/阻断带覆盖的本体格）；若长宽类别未互换则退回合成指针事件。
 * 返回是否确实发生旋转。
 */
async function clickGhostRotate(page: Page, rotNow: number): Promise<boolean> {
  const before = await ghostAspect(page)
  if (!before) return false
  const b = shapeBBox(rotNow)
  for (const mode of ['real', 'synth'] as const) {
    for (const off of visBodyOffsets(rotNow)) {
      const gb = await ghostPlanes(page).first().boundingBox()
      if (!gb) return false
      const x = gb.x + (off.c + 0.5) * (gb.width / b.w)
      const y = gb.y + (off.r + 0.5) * (gb.height / b.h)
      if (mode === 'real') {
        const hittable = await page.evaluate(
          ([px, py]) => {
            const t = document.elementFromPoint(px as number, py as number)
            return !!(t && t.closest('.game__opp .paper-grid__plane-hit'))
          },
          [x, y] as [number, number],
        )
        if (!hittable) continue
        await page.mouse.click(x, y)
      } else {
        await page.evaluate(
          ([px, py]) => {
            const top = document.elementFromPoint(px as number, py as number)
            const hit = (top?.closest('.game__opp .paper-grid__plane-hit') ??
              document.querySelector('.game__opp .paper-grid__plane-hit')) as HTMLElement | null
            if (!hit) return
            const base = {
              bubbles: true,
              cancelable: true,
              composed: true,
              pointerId: 7,
              pointerType: 'mouse',
              isPrimary: true,
            }
            hit.dispatchEvent(
              new PointerEvent('pointerdown', {
                ...base,
                clientX: px as number,
                clientY: py as number,
                button: 0,
                buttons: 1,
              }),
            )
            window.dispatchEvent(
              new PointerEvent('pointerup', {
                ...base,
                clientX: px as number,
                clientY: py as number,
                button: 0,
                buttons: 0,
              }),
            )
          },
          [x, y] as [number, number],
        )
      }
      await page.waitForTimeout(200)
      if ((await ghostAspect(page)) !== before) return true
    }
  }
  return false
}
/** 拖动【已放置的同一架幽灵】到「可视左上角 = vis」（不新建副本）；读回纠偏 ≤3 次 */
async function dragGhostTo(page: Page, vis: { r: number; c: number }, rot: number): Promise<void> {
  const board = page.locator('.game__opp .paper-grid__board')
  let drop = dropCell(vis, rot)
  for (let attempt = 0; attempt < 3; attempt++) {
    const cur = await lastGhostVis(page)
    if (cur && cur.r === vis.r && cur.c === vis.c) break
    const bb = await board.boundingBox()
    const gb = await ghostPlanes(page).first().boundingBox()
    if (!bb || !gb) throw new Error('幽灵/对手棋盘不可见')
    const cell = bb.width / 10
    if (cur) drop = { r: drop.r + (vis.r - cur.r), c: drop.c + (vis.c - cur.c) }
    await drag(
      page,
      { x: gb.x + gb.width / 2, y: gb.y + gb.height / 2 },
      { x: bb.x + (drop.c + 0.5) * cell, y: bb.y + (drop.r + 0.5) * cell },
    )
    await page.waitForTimeout(260)
  }
  const act = await lastGhostVis(page)
  expect(
    act && act.r === vis.r && act.c === vis.c,
    `幽灵应被拖到可视左上角 (${vis.r},${vis.c})（实测 ${JSON.stringify(act)}）`,
  ).toBe(true)
  await page.waitForTimeout(340) // 等落定后评估（松手后 80/260ms 两次）
}
/** rAF 采样某 fx 边带的「点亮」次数（flash 触发 700ms 的 --on），用于幂等判据 */
async function countFxFlashes(page: Page, kind: 'success' | 'failure', ms: number): Promise<number> {
  return page.evaluate(
    async ([k, dur]) => {
      const sel = `.tutorial-fx--${k}`
      // wasOn 用首帧真实状态初始化：窗口起点若仍在闪，不应被计成一次新提示
      let wasOn: boolean | null = null
      let count = 0
      const t0 = performance.now()
      while (performance.now() - t0 < (dur as number)) {
        const el = document.querySelector(sel as string)
        const on = !!el && (el.getAttribute('class') ?? '').includes('--on')
        if (wasOn === null) wasOn = on
        else {
          if (on && !wasOn) count += 1
          wasOn = on
        }
        await new Promise((r) => requestAnimationFrame(() => r(null)))
      }
      return count
    },
    [kind, ms] as [string, number],
  )
}

/* ================= 单元1 ================= */

/** 练习网格当前所有报点标记：coord → miss(✗) / hit(◯) / kill(★) */
async function u1Marks(page: Page, size: number): Promise<Record<string, string>> {
  return page.evaluate((n) => {
    const board = document.querySelector('.u1-grid .paper-grid__board')
    if (!board) return {}
    const rect = board.getBoundingClientRect()
    const cell = rect.width / n
    const out: Record<string, string> = {}
    const letters = 'ABCDEFGHIJ'
    for (const stamp of Array.from(document.querySelectorAll('.u1-grid .paper-grid__stamp'))) {
      const el = stamp as HTMLElement
      const left = parseFloat(el.style.left || '0')
      const top = parseFloat(el.style.top || '0')
      const r = Math.round(top / cell)
      const c = Math.round(left / cell)
      const mark = el.querySelector('.stamp--miss, .stamp--hit, .stamp--kill')
      // SVG 元素的 className 是 SVGAnimatedString，须用 getAttribute('class')
      const cls = mark ? (mark.getAttribute('class') ?? '') : ''
      const kind = cls.includes('stamp--miss')
        ? 'miss'
        : cls.includes('stamp--hit')
          ? 'hit'
          : cls.includes('stamp--kill')
            ? 'kill'
            : '?'
      out[`${letters[c]}${r + 1}`] = kind
    }
    return out
  }, size)
}
async function expectCentered(page: Page, inner: string, outer: string): Promise<void> {
  const a = await page.locator(inner).boundingBox()
  const b = await page.locator(outer).boundingBox()
  if (!a || !b) throw new Error(`居中测量失败：${inner}/${outer}`)
  expect(Math.abs(a.x + a.width / 2 - (b.x + b.width / 2))).toBeLessThanOrEqual(3)
  expect(Math.abs(a.y + a.height / 2 - (b.y + b.height / 2))).toBeLessThanOrEqual(3)
}

/** 单元1 全练习：s1a/s1b → 场景2（预置标记 + 错点 + E5）→ 场景3（J7 试错 + F7 命中 + 同网格幽灵） */
async function runUnit1(page: Page): Promise<void> {
  // v0.3.17-beta2 item 1：教程页首帧即渲染遮罩（恒渲染）
  await expect(spotlight(page), '教程页应首帧渲染遮罩（恒渲染）').toHaveCount(1, { timeout: 2000 })
  await expect(page.getByRole('heading', { name: '新手教程 · 辨认飞机' })).toBeVisible({ timeout: 10_000 })
  // s1a：5×5 演示（整屏压暗突出气泡）+ 网格居中
  await expect(bubble(page)).toContainText('欢迎来到《飞机杀》！', { timeout: 10_000 })
  await expectPureDim(page)
  await expectCentered(page, '.u1-grid', '.tutorial-unit1__body')
  await clickBubble(page)
  await expect(bubble(page)).toContainText('在正式开始游戏之前，我们先来做几个练习吧！')
  await clickBubble(page) // → s1b
  // s1b：突显 5×5 演示网格，仍居中
  await expect(bubble(page)).toContainText('请记住图上飞机的样式')
  await expect(spotlight(page)).toHaveCount(1)
  expect(await spotlightHoles(page)).toBeGreaterThanOrEqual(1)
  await expectCentered(page, '.u1-grid', '.tutorial-unit1__body')
  await clickBubble(page)
  await expect(bubble(page)).toContainText('记住了吗？')
  await clickBubble(page) // → 场景2（10×10 居中）
  // 场景2：预置显式报点
  await expect(bubble(page)).toContainText('试着双击可能的')
  await expectCentered(page, '.u1-grid', '.tutorial-unit1__body')
  const m2 = await u1Marks(page, 10)
  for (const c of ['D7', 'G8', 'F9']) expect(m2[c], `场景2 ${c} 应为击空`).toBe('miss')
  for (const c of ['C6', 'D6', 'E6', 'F8', 'G6', 'E8']) expect(m2[c], `场景2 ${c} 应为击中`).toBe('hit')
  expect(Object.values(m2).filter((v) => v === 'kill')).toHaveLength(0)
  // 故意点错 A1 → 落 ✗ + 失败提示
  const grid = page.locator('.u1-grid')
  await dblclickCell(page, grid.locator('button[aria-label="A1"]'))
  await expect(bubble(page)).toContainText('机头不在这里，想想飞机的形状！', { timeout: 8000 })
  await expect(page.locator('.tutorial-fx--failure')).toHaveCount(1)
  expect((await u1Marks(page, 10))['A1'], '玩家错点应留下 ✗').toBe('miss')
  // 双击 E5（机头）→ ★ + 幽灵飞机（同网格）
  await dblclickCell(page, grid.locator('button[aria-label="E5"]'))
  await expect(bubble(page)).toContainText('致命打击！干得漂亮！', { timeout: 8000 })
  await expect(page.locator('.tutorial-fx--success')).toHaveCount(1)
  expect((await u1Marks(page, 10))['E5'], '机头命中应为 ★').toBe('kill')
  await expect(page.locator('.u1-grid .paper-grid__plane--ghost')).toHaveCount(1)
  await clickBubble(page) // → 场景3 s3a（纯压暗）
  // 场景3 歧义讲解 → J7 试错 → F7 命中
  await expect(bubble(page)).toContainText('在这种情况下，我们不能完全确定机头位置呢。')
  await expectPureDim(page)
  await clickBubble(page)
  await expect(bubble(page)).toContainText('机头可能在F7，也可能在J7。')
  await clickBubble(page) // → s3j7（突显 J7 格）
  await expect(bubble(page)).toContainText('我们需要更多的信息。试着双击J7！')
  const m3 = await u1Marks(page, 10)
  expect(m3['H6'], '场景3 H6 应为击空').toBe('miss')
  for (const c of ['G6', 'G8', 'I6', 'I8', 'H7']) expect(m3[c], `场景3 ${c} 应为击中`).toBe('hit')
  await dblclickCell(page, grid.locator('button[aria-label="J7"]'))
  await expect(bubble(page)).toContainText('看来机头不在这里，试试另一个吧！', { timeout: 8000 })
  expect((await u1Marks(page, 10))['J7'], 'J7 试错应留下 ✗').toBe('miss')
  await clickBubble(page) // → s3f7
  await expect(bubble(page)).toContainText('试试双击F7！')
  await dblclickCell(page, grid.locator('button[aria-label="F7"]'))
  await expect(bubble(page)).toContainText('恭喜！你成功锁定了机头的位置！', { timeout: 8000 })
  expect((await u1Marks(page, 10))['F7'], 'F7 命中应为 ★').toBe('kill')
  // 同一网格真实位置渲染幽灵（页面只有 1 个网格）
  await expect(page.locator('.u1-grid')).toHaveCount(1)
  await expect(page.locator('.u1-grid .paper-grid__plane--ghost')).toHaveCount(1)
  await clickBubble(page) // → 单元2
}

/* ================= 单元2 ================= */

async function dragDeckCardTo(page: Page, r: number, c: number) {
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
  await page.waitForTimeout(180)
}
async function clickPlaneCenter(page: Page) {
  const p = page.locator('.placement__plane').first()
  const b = await p.boundingBox()
  if (!b) throw new Error('已摆飞机不可见')
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2)
  await page.waitForTimeout(220)
}

/** 单元2：从开场推进到 thanks（v0.3.14：旋转引导气泡出现即突显网格，无需点击） */
async function advanceUnit2ToThanks(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: '新手教程 · 摆阵' })).toBeVisible({ timeout: 10_000 })
  for (let k = 0; k < 8; k++) {
    if ((await bubbleTextSafe(page)).includes('这是飞机待选栏')) break
    await clickBubble(page)
    await page.waitForTimeout(80)
  }
  await expect(bubble(page)).toContainText('这是飞机待选栏，可以从这里把飞机拖到网格中。')
  await expect(spotlight(page)).toHaveCount(1)
  // v0.3.18-beta2 bug6 护栏：单目标 → 双目标（待选栏+网格）过渡逐帧采样：零洞帧 0、切片数无 A→B→A 跳变
  const trayFrames = observeFrames(page, 1500)
  await clickBubble(page) // → drag
  await expect(bubble(page)).toContainText('现在就试试看吧！把飞机拖到网格里！')
  expectHoleCountStable(await trayFrames, '待选栏→待选栏+网格')
  // v0.3.17-beta2 item 4：待选栏 + 我方网格【双目标同时生效】（引擎洞数 = 2）
  await expect.poll(() => rawHoles(page), { timeout: 5000 }).toBe(2)
  expect(await engineSel(page), '双目标应同时包含待选栏与网格').toContain('.placement__tray')
  expect(await engineSel(page)).toContain('.placement__board-wrap')
  await dragDeckCardTo(page, 2, 0)
  await expect(bubble(page)).toContainText('好极了！现在尝试把剩余的飞机全部拖到网格里！', { timeout: 8000 })
  await expect(page.locator('.tutorial-fx--success')).toHaveCount(1)
  await dragDeckCardTo(page, 2, 5)
  await dragDeckCardTo(page, 6, 5)
  await expect(page.locator('.placement__plane')).toHaveCount(3, { timeout: 8000 })
  // v0.3.14 item 5：旋转引导气泡出现时【已突显待选栏 + 网格】（无需先点击气泡）
  await expect(bubble(page)).toContainText('单击飞机可以使飞机旋转90度，试试看！', { timeout: 8000 })
  expect(await spotlightHoles(page)).toBeGreaterThanOrEqual(1)
  // v0.3.17-beta2 item 5：全部飞机入格后我方网格突显保持（rotateWait 仍为 待选栏+网格 双洞）
  await expect.poll(() => rawHoles(page), { timeout: 5000 }).toBe(2)
  expect(await engineSel(page)).toContain('.placement__board-wrap')
  await expectHit(page, '.placement__board', 'blocked', false)
  await expectHit(page, '.placement__tray', 'blocked', false)
  // 旋转 → thanks（bubble-soft：压暗但不阻断，玩家仍需操作飞机）
  await clickPlaneCenter(page)
  await expect(bubble(page)).toContainText('太棒了！确保你的飞机不重叠不越界之后，就可以开始游戏了！', {
    timeout: 8000,
  })
  await expect(page.locator('.tutorial-spotlight--dim')).toHaveCount(1)
  expect(await blockCount(page), 'thanks 应压暗但不阻断').toBe(0)
  // v0.3.17-beta2 item 5 + beta3 item 6 + v0.3.18-beta2 item 5：thanks 混合模式下
  // **气泡 + 我方网格**恒为引擎洞；阵型【合法】时再加「确认布阵」
  // → 合法 = 3 洞（气泡/网格/确认），非法 = 2 洞（气泡/网格）
  const thanksLegal =
    ((await page.locator('.placement__status').textContent().catch(() => '')) ?? '').includes('校验通过')
  await expect.poll(() => rawHoles(page), { timeout: 5000 }).toBe(thanksLegal ? 3 : 2)
  expect(await engineSel(page), 'thanks 应含气泡与网格洞').toContain('.tutorial-bubble')
  expect(await engineSel(page), 'thanks 应含我方网格洞').toContain('.placement__board-wrap')
  if (thanksLegal) {
    expect(await engineSel(page), 'thanks 合法应已突显确认布阵').toContain('.tutorial-confirm')
    await expectHit(page, '.tutorial-confirm', 'blocked', false)
  } else {
    expect(await engineSel(page), 'thanks 非法不应突显确认布阵').not.toContain('.tutorial-confirm')
  }
  await expectHit(page, '.placement__board', 'blocked', false)
}

/** 单元2：开场 4 段逐段读毕 → 停在「待选栏」气泡（v0.3.17-beta3 item 5 跳过路径构造用） */
async function advanceUnit2ToTray(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: '新手教程 · 摆阵' })).toBeVisible({ timeout: 10_000 })
  await expect(bubble(page)).toContainText('很好！接下来我们即将进入实战！', { timeout: 10_000 })
  await clickBubble(page)
  await expect(bubble(page)).toContainText('首先要做的一件事是')
  await clickBubble(page)
  await expect(bubble(page)).toContainText('对手将尝试破解我方阵型')
  await clickBubble(page)
  await expect(bubble(page)).toContainText('在真实对局中，一个好的阵型可以充分地迷惑对手，为我方取得优势！')
  await clickBubble(page)
  await expect(bubble(page)).toContainText('这是飞机待选栏，可以从这里把飞机拖到网格中。')
}

/** 单元2 完整摆阵 → 确认布阵进入单元3 */
async function runUnit2(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: '新手教程 · 摆阵' })).toBeVisible({ timeout: 10_000 })
  await expect(bubble(page)).toContainText('很好！接下来我们即将进入实战！', { timeout: 10_000 })
  await expectPureDim(page)
  // v0.3.18-beta2 item 3（反转 beta4 需求）：气泡换段/换行 → 气泡洞走【连续插值】通道（不再瞬移）
  const bubbleFrames = observeFrames(page, 1500)
  await clickBubble(page)
  await expect(bubble(page)).toContainText('首先要做的一件事是')
  const bf = await bubbleFrames
  // (1) 到位后洞（未加 PAD 的动画矩形）应贴合气泡实测矩形 ≤1.2px
  await expect
    .poll(
      async () => {
        const d = (await animRects(page))[0]
        const b = await page.locator('.tutorial-bubble').boundingBox()
        if (!d || !b) return null
        return Math.max(
          Math.abs(d.left - b.x),
          Math.abs(d.top - b.y),
          Math.abs(d.width - b.width),
          Math.abs(d.height - b.height),
        )
      },
      { timeout: 5000, message: '换段后气泡洞应贴合气泡 rect（≤1.2px）' },
    )
    .toBeLessThanOrEqual(1.2)
  // (2) 过渡连续：不得单帧吃掉 >15% 行程（anim 不再要求 none）
  expectBubbleHoleContinuity(bf, '气泡换段')
  await clickBubble(page)
  await expect(bubble(page)).toContainText('对手将尝试破解我方阵型')
  await clickBubble(page)
  await expect(bubble(page)).toContainText('在真实对局中，一个好的阵型可以充分地迷惑对手，为我方取得优势！')
  await advanceUnit2ToThanks(page)
  // 再次变化 → 合法性检测（合法 → 突显确认按钮）→ 确认布阵
  await clickPlaneCenter(page)
  await expect(bubble(page)).toContainText('点击“确认布阵”开始游戏', { timeout: 8000 })
  await expect(page.getByRole('button', { name: '确认布阵' })).toBeEnabled()
  await expectHit(page, '.tutorial-confirm', 'blocked', false)
  // v0.3.17-beta2 item 5：detect 合法态 = 我方网格洞 + 确认按钮洞（双目标）
  await expect.poll(() => rawHoles(page), { timeout: 5000 }).toBe(2)
  expect(await engineSel(page)).toContain('.placement__board-wrap')
  // item 6：跨阶段交接——确认布阵后单元3 首个遮罩过渡应为 transfer（洞从确认按钮续接）
  const carryFrames = observeFrames(page, 1500)
  // item 7（beta2）：教程内不再渲染先后手横幅 → 与交接观测并行启动（点击前开始采样）
  const bannerCheck = expectNoTutorialBanner(page)
  await page.getByRole('button', { name: '确认布阵' }).click()
  const cf = await carryFrames
  // v0.3.17-beta4 item 7：跨阶段续接回归——首个过渡必须是 transfer，且起点非整页（续接确认按钮洞）
  expect(animSet(cf), 'unit2→unit3 应为 transfer（spotlightCarry 跨阶段续接）').toContain('transfer')
  const firstCarry = cf.find((f) => f.anim === 'transfer')
  expect(firstCarry?.full, '交接首帧不应是整页洞（应从确认按钮洞续接）').toBe(false)
  await bannerCheck
}

/* ================= 单元3 ================= */

type Outcome = 'miss' | 'hit' | 'kill'
type ShotLog = Map<string, Outcome>

async function gameEnded(page: Page): Promise<boolean> {
  return (await modal(page).count()) > 0
}
/** 我方回合报一个坐标（坐标输入一步）；接受任意「我方报点 X：结果」（含预报点自动上报） */
async function fireCoord(
  page: Page,
  coord: string,
): Promise<{ coord: string; outcome: Outcome } | null> {
  const input = page.getByLabel('报点坐标，如 A5')
  const status = page.locator('.game__status-text')
  await waitMyTurn(page)
  if (await gameEnded(page)) return null
  await input.fill(coord, { timeout: 3000 }).catch(() => {})
  await input.press('Enter', { timeout: 3000 }).catch(() => {})
  const toasts = await page.locator('.toast').allTextContents().catch(() => [])
  if (toasts.some((t) => t.includes('该格已经报过点了'))) return { coord, outcome: 'miss' as Outcome }
  for (let k = 0; k < 14; k++) {
    const st = (await status.textContent().catch(() => '')) ?? ''
    const m = /我方报点\s*([A-J]\d+)：(击空|击中|击毁)/.exec(st)
    if (m) {
      const outcome: Outcome = m[2] === '击空' ? 'miss' : m[2] === '击中' ? 'hit' : 'kill'
      return { coord: m[1]!, outcome }
    }
    if (await gameEnded(page)) return null
    await page.waitForTimeout(100)
  }
  return null
}
/**
 * 循环报点直至击杀数达标：对角扫描 + 「机身命中→机头候选猎杀」加速。
 * 对角序保证被击毁飞机在机头之前至少被扫到一个无歧义机身格 → 朝向可确定性推断。
 * 预报点队列非空时回合开始会自动上报（手动报点被禁），此处按实际上报坐标记账。
 */
async function shootUntil(
  page: Page,
  log: ShotLog,
  minKills: number,
  opts: { heads?: string[]; deadlineMs?: number } = {},
): Promise<void> {
  const deadline = Date.now() + (opts.deadlineMs ?? 360_000)
  // v0.3.15：已知对手机头（会话快照）时优先直取；其余坐标对角序补扫
  const known = new Set(opts.heads ?? [])
  const order = [...(opts.heads ?? []), ...diagCoords().filter((c) => !known.has(c))]
  const pending: string[] = []
  let idx = 0
  let guard = 0
  const kills = () => [...log.values()].filter((v) => v === 'kill').length
  while (Date.now() < deadline && kills() < minKills && guard++ < 400) {
    if (await gameEnded(page)) return
    let coord: string | undefined
    while (pending.length > 0) {
      const c = pending.shift()!
      if (!log.has(c)) {
        coord = c
        break
      }
    }
    if (!coord) {
      while (idx < order.length && log.has(order[idx]!)) idx += 1
      if (idx >= order.length) return
      coord = order[idx]!
    }
    const res = await fireCoord(page, coord)
    if (!res) {
      if (await gameEnded(page)) return
      await page.waitForTimeout(200)
      continue // 未出枪（预报点自动上报/回合未到）→ 重试
    }
    log.set(res.coord, res.outcome)
    if (res.outcome === 'hit') {
      for (const c of headCandidates(res.coord)) if (!log.has(c)) pending.push(c)
    }
  }
}
/** 机头落在 head 时界内可实现的朝向集合 */
function realizableRots(head: { r: number; c: number }): number[] {
  return [0, 1, 2, 3].filter((r) => rotRealizableAtHead(head, r))
}
/** 判定真朝向候选集（真朝向必在其中；命中越多越可信） */
function inferRotations(head: { r: number; c: number }, hits: Array<{ r: number; c: number }>): number[] {
  const scores = [0, 1, 2, 3].map(
    (rot) =>
      hits.filter((h) => bodyOffsets(rot).some((o) => head.r + o.r === h.r && head.c + o.c === h.c)).length,
  )
  const max = Math.max(...scores)
  return scores.map((s, i) => (s === max ? i : -1)).filter((i) => i >= 0)
}
/** 混合模式断言：空网格可交互、参考网格/顶部面板被阻断、气泡与退出按钮可点 */
async function expectMixedModeInteractive(page: Page): Promise<void> {
  await expectHybrid(page)
  // v0.3.17-beta3 item 2：k1/k3/p1 等混合模式（含预报点 p1）恒单层、总暗度不超基础值
  await expectSingleLayer(page)
  await expectHit(page, '.game__opp .paper-grid__board', 'blocked', false)
  await expectHit(page, '.game__ref', 'blocked', true)
  await expectHit(page, '.game__statusbar', 'blocked', true)
  await expectHit(page, '.tutorial-bubble', 'inBubble', true)
  // v0.3.18-beta2 item 4：退出按钮已改为「占位 + 顶层真实按钮」→ 用顶层选择器精确断言可点且不被阻断
  await expectHit(page, '.tutorial-top-layer .tutorial-escape', 'inEscape', true)
  await expectHit(page, '.tutorial-top-layer .tutorial-escape', 'blocked', false)
}

/**
 * 单元3 开场链：断言 i1（纯整屏压暗）→ 可选 atI1 回调 → i2/i3 → i4（不可点击推进）→ 首个真实报点 → i6。
 * 返回时停在 i6（未点击读毕）。
 */
async function runUnit3Intro(
  page: Page,
  opts: { atI1?: () => Promise<void>; log?: ShotLog } = {},
): Promise<void> {
  await expect(bubble(page)).toContainText('现在，我们正式进入实战！', { timeout: 20_000 })
  await expectPureDim(page)
  await expectHit(page, '.tutorial-bubble', 'inBubble', true)
  await expectHit(page, '.tutorial-top-layer .tutorial-escape', 'inEscape', true)
  await expectHit(page, '.tutorial-top-layer .tutorial-escape', 'blocked', false)
  // v0.3.18-beta2 bug1/4/5 护栏：i1 纯压暗期逐帧采样「阻断恒在」+ 豁免不开洞/置顶
  expectBlockInvariants(
    await sampleBlockInvariants(page, 1600, {
      nonExempt: '.game__ref .paper-grid__board',
      requireEscape: true,
    }),
    '单元3 i1',
  )
  await expectExemptNotHoled(page)
  if (opts.atI1) await opts.atI1()
  const framesDimToTarget = observeFrames(page, 1000) // v0.3.17-beta2 item 3
  await clickBubble(page) // → i2（突显我方网格）
  await expect(bubble(page)).toContainText('这是你刚才摆的阵型')
  // item 3：压暗→目标（含气泡豁免）切换期间不得出现零洞帧（否则整页闪洞）
  for (const f of await framesDimToTarget) {
    if (f.anim && f.anim !== 'none') {
      expect(f.raw, `过渡帧 anim=${f.anim} mode=${f.mode} 不应零洞`).toBeGreaterThanOrEqual(1)
    }
  }
  await expectHit(page, '.game__mine', 'blocked', false)
  const trFrames = observeFrames(page, 900) // 先开始观测，再触发 i2→i3
  await clickBubble(page) // → i3（突显参考网格）
  await expect(bubble(page)).toContainText('这是参考网格')
  const trf = await trFrames
  expect(animSet(trf), 'i2→i3 过渡应为 transfer（洞连续转移）').toContain('transfer')
  expectNoStartDelay(trf, 'transfer') // item 1：transfer 不加静止期
  await expectHit(page, '.game__ref', 'blocked', false)
  await clickBubble(page) // → i4（等真实报点，不可点击推进）
  await expect(bubble(page)).toContainText('这是空网格，你需要通过双击报点来获得对方飞机的信息。试试看！')
  await expect(page.locator('.tutorial-bubble__hint')).toHaveCount(0)
  const t4 = await bubbleTextSafe(page)
  await bubble(page).click({ timeout: 3000 })
  await page.waitForTimeout(180)
  expect(await bubbleTextSafe(page), 'i4 点击不应推进节点').toBe(t4)
  await expect(page.locator('.game-banner'), '教程内不应有先后手横幅').toHaveCount(0)
  await expectHit(page, '.game__opp .paper-grid__board', 'blocked', false)
  // 首个真实报点（首杀可在此或之后触发支线）；结果计入报点账本
  const status = page.locator('.game__status-text')
  await dblclickCell(page, oppCell(page, 'A1'))
  for (let k = 0; k < 14; k++) {
    const st = (await status.textContent().catch(() => '')) ?? ''
    const m = /我方报点\s*([A-J]\d+)：(击空|击中|击毁)/.exec(st)
    if (m) {
      opts.log?.set(m[1]!, m[2] === '击空' ? 'miss' : m[2] === '击中' ? 'hit' : 'kill')
      break
    }
    await page.waitForTimeout(100)
  }
  await expect(bubble(page)).toContainText('好极了！运用你刚才学到的所有技巧', { timeout: 12_000 })
}

/** k1..k6 击毁支线（含 k2 幽灵三态与 k4 取消空网格突显）
 *  trueRotation：v0.3.15 会话快照给出的被毁飞机真朝向（已知时幽灵三态判定全确定；
 *  未知时回退「机身命中→朝向候选推断」。 */
async function runUnit3KillBranch(
  page: Page,
  log: ShotLog,
  opts: { trueRotation?: number | null; headCoord?: string | null } = {},
): Promise<void> {
  // k1（混合模式）
  await expect(bubble(page)).toContainText('你成功摧毁了对方的飞机！', { timeout: 20_000 })
  await expectMixedModeInteractive(page)
  // 先等 k1 入场过渡落定再开窗：k1 入场是「基础态 → 气泡+空网格」的 focus（静止期 380–900ms），
  // 若混进本观测窗会被误按 ≤200ms 判（其静止期契约已在单元1 首帧与 p1 两处单独断言）
  await expectSpotlightSettled(page)
  const addFrames = observeFrames(page, 1600) // 先开始观测，再触发 k1→k2
  await clickBubble(page)
  const af = await addFrames
  // v0.3.18-beta2 item 5：k1 为混合模式（气泡 + 空网格，2 洞）→ k2（参考网格 + 空网格）
  // 气泡洞会与参考网格洞做最近匹配，过渡标签可能是 transfer（不再是纯 add）；按契约分派判定
  expectTransitionContracts(af, 'k1→k2')
  // v0.3.17-beta2 item 8：k2 = 参考网格 + 空网格 双目标（引擎洞数 2）
  await expect.poll(() => rawHoles(page), { timeout: 5000 }).toBe(2)
  expect(await engineSel(page)).toContain('.game__ref')
  expect(await engineSel(page)).toContain('.game__opp')
  // k2（等在空网格拖入幽灵；两段教学、不可点击推进）
  await expect(bubble(page)).toContainText('被击毁的飞机')
  await expect(page.locator('.tutorial-bubble__hint')).toHaveCount(0)
  await bubble(page).click({ timeout: 3000 })
  await page.waitForTimeout(150)
  const k2Now = await bubbleTextSafe(page)
  expect(k2Now.includes('尝试从参考网格处拖动飞机'), 'k2 点击只翻段、不推进节点').toBe(true)
  expect(k2Now.includes('飞机就在这里'), 'k2 不应跳到成功节点').toBe(false)

  const killCoords = [...log.entries()].filter(([, o]) => o === 'kill').map(([c]) => c)
  const head = coordToCell(opts.headCoord ?? killCoords[0]!)
  const hits = [...log.entries()]
    .filter(([, o]) => o === 'hit')
    .map(([c]) => coordToCell(c))
  const knownRotation = opts.trueRotation ?? null
  const candidates =
    knownRotation != null ? [knownRotation] : inferRotations(head, hits)
  // 「机头对、朝向错」需该朝向在界内可实现（否则 snapOrigin 夹取 → 变成「位置不符」）
  const realizable = [0, 1, 2, 3].filter((r) => rotRealizableAtHead(head, r))
  const wrongRealizable =
    knownRotation != null ? realizable.find((r) => r !== knownRotation) ?? null : null
  const wrongRot =
    wrongRealizable ??
    (knownRotation != null
      ? (knownRotation + 1) % 4
      : (realizable.find((r) => !candidates.includes(r)) ?? (candidates[0]! + 1) % 4))

  // ① 位置不符（none）：按住拖到机头不对的位置 → 既不成功也不提示；松手于参考区（不落子）
  // 宽幽灵可被判读为 rot0 或 rot2 两种朝向，两者推出的机头都必须 ≠ 真机头，才是纯「位置不符」
  const impliedHead = (vis: { r: number; c: number }, rot: number) => {
    const b = shapeBBox(rot)
    const h = headRelOf(rot)
    return { r: vis.r - b.minR + h.r, c: vis.c - b.minC + h.c }
  }
  await setRefRotation(page, 0)
  let noneVis: { r: number; c: number } | null = null
  for (let r = 0; r <= 5 && !noneVis; r++) {
    for (let c = 0; c <= 5 && !noneVis; c++) {
      const v = { r, c }
      const collides = [0, 2].some((rot) => {
        const h = impliedHead(v, rot)
        return h.r === head.r && h.c === head.c
      })
      if (!collides) noneVis = v
    }
  }
  if (!noneVis) throw new Error('找不到「机头不符」的演示落点')
  await placeGhostAt(page, noneVis, 0, { release: false })
  await page.waitForTimeout(320)
  const during = await bubbleTextSafe(page)
  expect(during.includes('飞机就在这里'), '位置不符不应成功').toBe(false)
  expect(during.includes('好像不太对'), '位置不符不应给失败提示').toBe(false)
  await releaseOverRef(page)
  expect((await bubbleTextSafe(page)).includes('好像不太对'), '松手于参考区不应落子提示').toBe(false)

  // ② 机头正确、朝向错（headOnly）→ 松手后失败提示
  //    v0.3.17-beta5：每步重复检测；失败【不再自动回收】幽灵（同一架留在场、data-plane-id 不变）
  await setRefRotation(page, wrongRot)
  await placeGhostAt(page, headMatchVis(head, wrongRot), wrongRot, { release: false })
  // (a) 按住未松手 ≥0.9s：拖动中一律不判定（既不成功也不失败）
  await page.waitForTimeout(950)
  const holding = await bubbleTextSafe(page)
  expect(holding.includes('飞机就在这里'), '按住未松手不得判定成功').toBe(false)
  expect(holding.includes('好像不太对'), '按住未松手不得判定失败').toBe(false)
  await page.mouse.up()

  const ghostLoc = ghostPlanes(page)
  await expect(ghostLoc, '幽灵应已落定').toHaveCount(1, { timeout: 5000 })
  const ghostIdBefore = await ghostLoc.first().getAttribute('data-plane-id')
  await expect(bubble(page)).toContainText('好像不太对，试试换个朝向吧。', { timeout: 8000 })
  await expect(page.locator('.tutorial-fx--failure')).toHaveCount(1)
  // v0.3.18-beta2 bug2 护栏：提示带为单条 evenodd 环形路径（外圈+内圈、内圈 4×A3 3 圆角）
  await expectFxRing(page, 'failure')
  // beta5：失败不回收 —— 同一架幽灵仍在场且 id 不变（不回收、不新建 id）
  await expect(ghostLoc, '失败后幽灵应仍在场（不回收）').toHaveCount(1)
  expect(await ghostLoc.first().getAttribute('data-plane-id'), '幽灵 data-plane-id 不应变化').toBe(
    ghostIdBefore,
  )
  if (knownRotation != null) {
    expect(wrongRot, '失败分支所用朝向应≠真朝向').not.toBe(knownRotation)
  }

  // (b) 幂等：静置 ≥1.4s 不重复提示（同一架 + 同一结果只提示一次）
  // v0.3.18-beta1：提示带 --on 改为 1250ms（点亮 110ms/熄灭 820ms，总可见 ≈2s），
  // 固定 800ms 等待已不够 → 显式等本次闪烁熄灭后再开始采样，避免把残留计成新提示
  await expect(page.locator('.tutorial-fx--on'), '本次提示闪烁应已熄灭').toHaveCount(0, {
    timeout: 4000,
  })
  const idleText = await bubbleTextSafe(page)
  const idleFlashes = countFxFlashes(page, 'failure', 1600)
  await page.waitForTimeout(1400)
  expect(await idleFlashes, '静置期间不应重复播失败提示').toBe(0)
  expect(await bubbleTextSafe(page), '静置期间气泡文案不应变化').toBe(idleText)
  expect(await ghostLoc.first().getAttribute('data-plane-id'), '静置期间幽灵 id 不变').toBe(ghostIdBefore)

  // ③ 完全正确（exact）：**复用同一架幽灵**（点击原地旋转到真朝向 + 拖动该元素到正确位置）→ k3
  //    beta5 起旧幽灵占位会挡掉参考网格新建副本（overlapAt 拒绝），故不再新建
  const successFlashes = countFxFlashes(page, 'success', 3600) // 覆盖弹道动画（560ms）+ 提示带点亮
  let exact = false
  let rotNow = wrongRot // ② 落子时的参考朝向 = 该幽灵朝向
  for (const rot of [...candidates, 0, 1, 2, 3].filter((v, i, a) => a.indexOf(v) === i)) {
    if (exact) break
    if ((await bubbleTextSafe(page)).includes('飞机就在这里')) {
      exact = true
      break
    }
    if (!rotRealizableAtHead(head, rot)) continue
    for (let i = 0; i < 4 && rotNow !== rot; i++) {
      expect(await clickGhostRotate(page, rotNow), '点击幽灵本体应原地旋转 90°（同一架）').toBe(true)
      rotNow = (rotNow + 1) % 4
    }
    if (rotNow !== rot) continue
    const blurFrames = observeFrames(page, 1600) // 覆盖落定判定到 k3 过渡（动画 560ms）
    const areaFrames = observeHoleAreas(page, 1500) // v0.3.17-beta3 item 4：融合面积连续性
    await dragGhostTo(page, headMatchVis(head, rot), rot)
    const frames = await areaFrames
    const blf = await blurFrames
    if ((await bubbleTextSafe(page)).includes('飞机就在这里')) {
      exact = true
      // v0.3.18-beta2 item 5：k3 亦为混合模式（气泡 + 空网格）→ 参考网格洞并入气泡洞，
      // 标签可能是 transfer（而非旧 blur）；按契约分派（focus→380–900ms，其余 ≤200ms）
      expectTransitionContracts(blf, 'k2→k3')
      // item 4：去重叠分解下并集面积应逐帧连续（无融合/转移跳变）
      expectHoleAreaContinuity(frames, 'k2→k3 过渡')
    }
  }
  expect(exact, '复用同一架幽灵应最终判定为完全正确').toBe(true)
  // v0.3.18-beta2 bug2 护栏：成功提示带同样是单条环形路径
  await expectFxRing(page, 'success')
  // (c) k2 段内成功提示恰好 1 次（幂等：不重复播成功反馈）
  expect(await successFlashes, 'k2 段内成功提示应恰好 1 次').toBe(1)
  await expect(ghostLoc, '成功复用同一架（幽灵仍在场）').toHaveCount(1)
  expect(await ghostLoc.first().getAttribute('data-plane-id'), '成功后幽灵 id 仍不变').toBe(ghostIdBefore)
  await expect(bubble(page)).toContainText('飞机就在这里！', { timeout: 8000 })
  await expect(page.locator('.tutorial-fx--success')).toHaveCount(1)
  // v0.3.17-beta2 item 8 + v0.3.18-beta2 item 5：k3 = 气泡 + 空网格（2 洞），参考网格突显无残留
  await expect.poll(() => rawHoles(page), { timeout: 5000 }).toBe(2)
  expect(await engineSel(page), 'k3 不应残留参考网格').not.toContain('.game__ref')
  expect(await engineSel(page)).toContain('.game__opp')
  expect(await engineSel(page), 'k3 气泡洞应在（混合模式被突显对象）').toContain('.tutorial-bubble')
  await expectHit(page, '.game__opp .paper-grid__board', 'blocked', false)
  await clickBubble(page) // k3 → k4

  // k4：进入着色教学时空网格已取消突显（仅突显着色按钮）
  await expect(bubble(page)).toContainText('接下来，试试点击着色工具按钮！', { timeout: 8000 })
  await expectHit(page, '.game__opp .paper-grid__board', 'blocked', true)
  const colorBtn = page.locator('.coloring-stage__btn .coloring-btn')
  await expect(colorBtn).toBeVisible()
  await expectHit(page, '.coloring-stage__btn .coloring-btn', 'blocked', false)
  await colorBtn.click()
  await expect(colorBtn).toHaveAttribute('aria-pressed', 'true')

  // k5：着色模式下点击幽灵 → 整机批染 + 回收
  await expect(bubble(page)).toContainText('现在，试试点击你刚才摆放的飞机！', { timeout: 8000 })
  const ghost = page.locator('.game__opp .paper-grid__plane[data-plane-id]').last()
  const gb = await ghost.boundingBox()
  if (!gb) throw new Error('幽灵不可见')
  await page.mouse.click(gb.x + gb.width / 2, gb.y + gb.height / 2)
  await expect(bubble(page)).toContainText('现在，你学会了如何标记被击毁的飞机。继续寻找剩下的所有飞机吧！', {
    timeout: 8000,
  })
  await expect(colorBtn).toHaveAttribute('aria-pressed', 'false')
  await clickBubble(page) // k6 读毕 → 本支线结束
  await expectNoHighlight(page) // v0.3.17-beta1：基础态遮罩常驻但洞=整页
}

/* ================= 用例 ================= */

test.describe('新手教程', () => {
  test('主链：还不了解 → 单元1 全练习（居中/预置标记/幽灵）→ 单元2 摆阵 → 单元3 开场与退出', async ({
    page,
  }) => {
    test.setTimeout(300_000)
    const errs = watchErrors(page)

    await openTutorial(page)
    // v0.3.17-beta4 item 1：观测教程首帧「整页 → 气泡」聚焦（先启动观测，再进入教程）
    const enterFrames = observeFrames(page, 2200)
    await modal(page).getByRole('button', { name: '还不了解' }).click()
    expectFocusHold(await enterFrames, '教程首帧聚焦')
    // v0.3.18-beta2 bug1/4/5 护栏：单元1 纯压暗首帧起逐帧采样「阻断恒在」+ 豁免不开洞/置顶
    // （先等顶层真实按钮挂载，避免把「尚未 portal」的 1-2 帧误计为未阻断）
    await expectHit(page, '.tutorial-top-layer .tutorial-escape', 'inEscape', true)
    expectBlockInvariants(
      await sampleBlockInvariants(page, 1600, {
        nonExempt: '.u1-grid .paper-grid__board',
        requireEscape: true,
      }),
      '单元1 首帧',
    )
    await expectExemptNotHoled(page)
    await runUnit1(page)
    await runUnit2(page)

    // 单元3 开场：i1 突显期「← 退出」真实可点（M4）→ 弹窗（阻断带 0）→ 继续对局 → 阻断带恢复
    await runUnit3Intro(page, {
      atI1: async () => {
        await page.getByRole('button', { name: '← 退出' }).click()
        await expect(modal(page)).toContainText('确认退出对局？')
        expect(await blockCount(page), '弹窗打开时阻断带应为 0').toBe(0)
        // v0.3.17-beta2 item 1：弹窗期遮罩仍渲染基础态（恒渲染）且无阻断带
        await expect(spotlight(page), '弹窗期遮罩应仍存在（基础态）').toHaveCount(1)
        expect(await spotlightAttr(page, 'data-spotlight-block'), '弹窗期阻断属性应为 0').toBe('0')
        await expect(page.locator('.tutorial-spotlight path'), '基础态应含整页洞路径').not.toHaveCount(0)
        await expectSingleLayer(page)
        await modal(page).getByRole('button', { name: '继续对局' }).click()
        await expect(modal(page)).toHaveCount(0)
        await expect(page.locator('.tutorial-block')).not.toHaveCount(0)
        await expect(bubble(page)).toContainText('现在，我们正式进入实战！')
      },
    })

    // i6 纯压暗：对局内「← 退出」→ 确认退出 → 主页
    await expect(bubble(page)).toContainText('好极了！运用你刚才学到的所有技巧')
    await expectPureDim(page)
    await page.getByRole('button', { name: '← 退出' }).click()
    await expect(modal(page)).toContainText('确认退出对局？')
    expect(await blockCount(page)).toBe(0)
    await modal(page).getByRole('button', { name: '确认退出' }).click()
    await expect(page.getByRole('heading', { name: '飞机杀' })).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('.tutorial-bubble')).toHaveCount(0)

    expect(errs()).toEqual([])
  })

  test('我已了解 → 单元2 → 单元3：首杀支线（幽灵三态/着色）+ 自然结束→常规结算返回主页', async ({
    page,
  }) => {
    test.setTimeout(600_000)
    const errs = watchErrors(page)
    const log: ShotLog = new Map()

    await openTutorial(page)
    await modal(page).getByRole('button', { name: '我已了解' }).click()
    await runUnit2(page)
    await runUnit3Intro(page, { log })
    await clickBubble(page) // i6 读毕 → 自由对局（首杀支线若已排队则立即开播）

    // v0.3.15 提速：读会话快照取对手机头 → 一击命中直取；被毁飞机真朝向用于幽灵三态判定
    const snap = await readBattleSnapshot(page)
    const allHeads = snap?.oppHeads ?? []
    // 首杀优先选「机头处另有界内可实现朝向」的飞机：保证幽灵失败分支（机头对/朝向错）可确定复现
    const firstTarget =
      allHeads.find((h) => realizableRots(h.head).some((r) => r !== h.rotation)) ?? allHeads[0]
    const heads = firstTarget
      ? [firstTarget.coord, ...allHeads.filter((h) => h.id !== firstTarget.id).map((h) => h.coord)]
      : []

    // 首杀 → k1..k6
    await shootUntil(page, log, 1, { heads })
    const snapAfter = await readBattleSnapshot(page)
    const destroyedId = snapAfter?.destroyedPlaneIds[0]
    const target = snapAfter?.oppHeads.find((h) => h.id === destroyedId) ?? null
    await runUnit3KillBranch(page, log, {
      trueRotation: target?.rotation ?? null,
      headCoord: target?.coord ?? null,
    })

    // 继续清剿直至自然结束（教程对局 AI 避机头，只能由我方全歼结束）
    await shootUntil(page, log, 3, { heads })
    // v0.3.17-beta4 item 3：教程结束不再有「教程完成」PaperModal，改为 **常规结算画面**
    await expect(page.locator('.result__title--win'), '教程全歼 → 常规结算胜利标题').toBeVisible({
      timeout: 60_000,
    })
    await expect(page.locator('.result')).toContainText('对方真实阵型')
    await expect(page.locator('.paper-modal__dialog'), '教程结束不应再弹 PaperModal').toHaveCount(0)
    // hideRematch：教程上下文无「再来一局」，仅「返回主页」
    await expect(page.locator('.result').getByRole('button', { name: '再来一局' })).toHaveCount(0)
    await expect(page.locator('.result').getByRole('button', { name: '返回主页' })).toHaveCount(1)
    await page.locator('.result').getByRole('button', { name: '返回主页' }).click()
    await expect(page.getByRole('heading', { name: '飞机杀' })).toBeVisible({ timeout: 10_000 })

    expect(errs()).toEqual([])
  })

  test('我已了解 → 单元3：预报点支线先播（p1 混合模式）→ 首杀支线后播（顺序无关）→ 退出主页', async ({
    page,
  }) => {
    test.setTimeout(420_000)
    const errs = watchErrors(page)
    const log: ShotLog = new Map()

    await openTutorial(page)
    await modal(page).getByRole('button', { name: '我已了解' }).click()
    await runUnit2(page)
    await runUnit3Intro(page, { log })
    await clickBubble(page) // i6 → 自由对局

    // v0.3.17-beta1：开场链结束 → 基础态（遮罩常驻、洞=整页、无阻断带）；首杀未发生时可观测 rest→focus
    const preKill = (await readBattleSnapshot(page))?.destroyedPlaneIds.length ?? 0
    if (preKill === 0) {
      await expectNoHighlight(page)
      // 先等基础态 blur 落定，保证 p1 走「整页 → 目标」的 focus 路径（否则落在 blur 中途 = transfer/add）
      await expectBaseSettled(page)
    }

    // 对手回合内创建预报点（`--theirs` 回合色边框为回合信号）→ p1 先播
    const animFocus = observeFrames(page, 3000) // 覆盖创建重试窗口，捕捉 rest→focus（含聚焦静止期）
    const input = page.getByLabel('报点坐标，如 A5')
    const prefire = page.locator('.game__opp .paper-grid__stamp .prefire-mark')
    const n16Text = '你刚才看见的红色'
    let created = false
    for (let attempt = 0; attempt < 10 && !created; attempt++) {
      if ((await bubbleTextSafe(page)).includes(n16Text)) break
      const oppCls = (await page.locator('.game__opp').getAttribute('class')) ?? ''
      if (!oppCls.includes('game__opp--theirs')) {
        await page.waitForTimeout(150)
        continue
      }
      const coord = diagCoords().find((c) => c !== 'A1')!
      await input.fill(coord, { timeout: 2000 }).catch(() => {})
      await input.press('Enter', { timeout: 2000 }).catch(() => {})
      await page.waitForTimeout(250)
      created = (await prefire.count()) > 0 || (await bubbleTextSafe(page)).includes(n16Text)
    }
    expect(created, '应能在对手回合创建预报点').toBe(true)
    // p1：混合模式（整屏压暗 + 空网格开洞 + 气泡豁免）+ 5 段
    await expect(bubble(page)).toContainText('你刚才看见的红色“？”是预报点标记。', { timeout: 10_000 })
    await expectMixedModeInteractive(page)
    if (preKill === 0) {
      const pff = await animFocus
      expect(animSet(pff), '基础态→p1 应为 focus（洞由整页收缩到目标）').toContain('focus')
      // v0.3.17-beta4 item 1：focus 前应先静止 380–900ms 再开始收缩（整页静止期判据用洞并集面积）
      expectFocusHold(pff, '基础态→p1')
    }
    for (let k = 0; k < 6; k++) {
      if ((await bubbleTextSafe(page)).includes('预报点标记最多可以同时存在10个。')) break
      await clickBubble(page)
      await page.waitForTimeout(120)
    }
    await expect(bubble(page)).toContainText('预报点标记最多可以同时存在10个。')
    await clickBubble(page) // 读毕 → 本支线结束

    // 随后触发首杀 → k1 播报（验证两条支线触发顺序无关；v0.3.15：快照机头一击命中）
    const snap3 = await readBattleSnapshot(page)
    await shootUntil(page, log, 1, { heads: (snap3?.oppHeads ?? []).map((h) => h.coord) })
    await expect(bubble(page)).toContainText('你成功摧毁了对方的飞机！', { timeout: 20_000 })
    await expectMixedModeInteractive(page)

    // 收尾：对局内退出直达主页
    await page.getByRole('button', { name: '← 退出' }).click()
    await expect(modal(page)).toContainText('确认退出对局？')
    await modal(page).getByRole('button', { name: '确认退出' }).click()
    await expect(page.getByRole('heading', { name: '飞机杀' })).toBeVisible({ timeout: 10_000 })

    expect(errs()).toEqual([])
  })

  test('突显为模态：非突显区不可点、气泡/退出可点、弹窗期阻断带为 0（单元1/单元2）', async ({ page }) => {
    test.setTimeout(180_000)
    const errs = watchErrors(page)

    // 单元1：纯压暗 → 阻断带拦截非突显区；气泡可点；「← 退出教程」首帧即真实可点
    await openTutorial(page)
    await modal(page).getByRole('button', { name: '还不了解' }).click()
    await expect(spotlight(page), '教程页应首帧渲染遮罩（恒渲染）').toHaveCount(1, { timeout: 2000 })
    await expect(page.getByRole('heading', { name: '新手教程 · 辨认飞机' })).toBeVisible({ timeout: 10_000 })
    await expect(bubble(page)).toContainText('欢迎来到《飞机杀》！', { timeout: 10_000 })
    // v0.3.17-beta3 item 3：纯 dim 阻断带 =「气泡 + 豁免」补集 → 阻断带仍 >0（expectPureDim 内断言）
    await expectPureDim(page)
    // item 3：首帧起退出按钮所在豁免区就不被阻断 —— v0.3.18-beta2 起豁免按钮在顶层 portal
    // （占位 visibility:hidden + 真实按钮），故用顶层选择器精确断言「不被阻断 + 绘制在遮罩之上」
    await expect(page.locator('.tutorial-top-layer .tutorial-escape'), '顶层退出按钮应已挂载').toHaveCount(
      1,
      { timeout: 3000 },
    )
    await expectHit(page, '.tutorial-top-layer .tutorial-escape', 'inEscape', true)
    await expectHit(page, '.tutorial-top-layer .tutorial-escape', 'blocked', false)
    const before = await bubbleTextSafe(page)
    await clickBlockedArea(page)
    await expect(bubble(page)).toHaveText(before)
    // 首帧直接点击「← 退出教程」→ 直达主页（无需先读毕气泡）
    await page.getByRole('button', { name: '← 退出教程' }).click()
    await expect(page.getByRole('heading', { name: '飞机杀' })).toBeVisible({ timeout: 10_000 })

    // 单元2：突显期真实点击退出 → 弹窗（阻断带 0）→ 继续摆阵（阻断带恢复）→ 确认退出直达主页
    await page.getByRole('button', { name: '新手教程' }).click()
    await modal(page).getByRole('button', { name: '我已了解' }).click()
    await expect(page.getByRole('heading', { name: '新手教程 · 摆阵' })).toBeVisible({ timeout: 10_000 })
    await expect(bubble(page)).toContainText('很好！接下来我们即将进入实战！', { timeout: 10_000 })
    await expectPureDim(page)
    const before2 = await bubbleTextSafe(page)
    await clickBlockedArea(page)
    await expect(bubble(page)).toHaveText(before2)
    await clickBubble(page)
    await expect(bubble(page)).toContainText('首先要做的一件事是')
    await page.getByRole('button', { name: '← 退出教程' }).click()
    await expect(modal(page)).toContainText('退出教程？')
    expect(await blockCount(page), '弹窗打开时阻断带应为 0').toBe(0)
    // v0.3.17-beta2 item 1：弹窗期遮罩仍渲染基础态（恒渲染）且无阻断带
    await expect(spotlight(page), '弹窗期遮罩应仍存在（基础态）').toHaveCount(1)
    expect(await spotlightAttr(page, 'data-spotlight-block'), '弹窗期阻断属性应为 0').toBe('0')
    await expectSingleLayer(page)
    await modal(page).getByRole('button', { name: '继续摆阵' }).click()
    await expect(modal(page)).toHaveCount(0)
    await expect(page.locator('.tutorial-block')).not.toHaveCount(0)
    await page.getByRole('button', { name: '← 退出教程' }).click()
    await expect(modal(page)).toContainText('退出教程？')
    await modal(page).getByRole('button', { name: '确认退出' }).click()
    await expect(page.getByRole('heading', { name: '飞机杀' })).toBeVisible({ timeout: 10_000 })

    expect(errs()).toEqual([])
  })

  test('单元2 跳过路径①：待选栏内先摆一架 → 跳过「拖到网格里」直接续拖；合法/重叠单层遮罩', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    const errs = watchErrors(page)

    await openTutorial(page)
    await modal(page).getByRole('button', { name: '我已了解' }).click()
    await advanceUnit2ToTray(page)
    // 待选栏阶段阻挡网格交互，但拖拽经 window 指针事件仍可落子 → 构造「已有飞机」前置态
    await dragDeckCardTo(page, 2, 0)
    await expect(page.locator('.placement__plane')).toHaveCount(1, { timeout: 8000 })
    await expect(bubble(page)).toContainText('这是飞机待选栏')
    const trayTexts = observeBubbleTexts(page, 1400)
    await clickBubble(page) // 待选栏读毕 → 已有飞机 → 跳过「现在就试试看吧…」
    expect((await trayTexts).join('|'), '「现在就试试看吧」应被跳过').not.toContain('现在就试试看吧')
    await expect(bubble(page)).toContainText('好极了！现在尝试把剩余的飞机全部拖到网格里！', {
      timeout: 8000,
    })
    await dragDeckCardTo(page, 2, 5)
    await dragDeckCardTo(page, 6, 5)
    await expect(page.locator('.placement__plane')).toHaveCount(3, { timeout: 8000 })
    await expect(bubble(page)).toContainText('单击飞机可以使飞机旋转90度，试试看！', { timeout: 8000 })
    await clickPlaneCenter(page) // 旋转 → thanks
    await expect(bubble(page)).toContainText('太棒了！确保你的飞机不重叠不越界之后，就可以开始游戏了！', {
      timeout: 8000,
    })
    // item 2：thanks（混合模式）恒为单层遮罩、总暗度不超基础值 0.52
    await expectSingleLayer(page)
    expect(await blockCount(page), 'thanks 压暗不阻断').toBe(0)
    await expectHit(page, '.placement__board', 'blocked', false)
    // item 6：阵型合法时「太棒了…」阶段已突显确认按钮
    expect(
      (((await page.locator('.placement__status').textContent().catch(() => '')) ?? '').includes('校验通过')),
      '本用例构造的阵型在 thanks 阶段应合法',
    ).toBe(true)
    await expect.poll(() => engineSel(page), { timeout: 5000 }).toContain('.tutorial-confirm')
    expect(await engineSel(page)).toContain('.placement__board-wrap')
    await expectHit(page, '.tutorial-confirm', 'blocked', false)

    // 重叠 → 非法阵型（detect 混合模式）：单层遮罩、不阻断、网格洞仍在
    const b1 = await page.locator('.placement__plane').nth(0).boundingBox()
    const b2 = await page.locator('.placement__plane').nth(1).boundingBox()
    if (!b1 || !b2) throw new Error('已摆飞机不可见')
    const c1 = { x: b1.x + b1.width / 2, y: b1.y + b1.height / 2 }
    const c2 = { x: b2.x + b2.width / 2, y: b2.y + b2.height / 2 }
    await drag(page, c1, c2) // 把 1 号飞机拖到 2 号上 → 重叠
    await expect(bubble(page)).toContainText('飞机不能重叠、不能越界哦！', { timeout: 8000 })
    await expectSingleLayer(page)
    await expect(page.locator('.tutorial-spotlight--dim')).toHaveCount(1)
    expect(await blockCount(page), '非法阵型压暗不阻断').toBe(0)
    await expectHit(page, '.placement__board', 'blocked', false)
    // 移开 → 恢复合法 → 确认按钮重新突显且可点
    await drag(page, c2, c1)
    await expect(bubble(page)).toContainText('点击“确认布阵”开始游戏', { timeout: 8000 })
    await expectSingleLayer(page)
    await expectHit(page, '.tutorial-confirm', 'blocked', false)

    expect(errs()).toEqual([])
  })

  test('单元2 跳过路径②：待选栏内一把摆完 → 跳过两段引导直达旋转', async ({ page }) => {
    test.setTimeout(180_000)
    const errs = watchErrors(page)

    await openTutorial(page)
    await modal(page).getByRole('button', { name: '我已了解' }).click()
    await advanceUnit2ToTray(page)
    await dragDeckCardTo(page, 2, 0)
    await dragDeckCardTo(page, 2, 5)
    await dragDeckCardTo(page, 6, 5)
    await expect(page.locator('.placement__plane')).toHaveCount(3, { timeout: 8000 })
    await expect(bubble(page)).toContainText('这是飞机待选栏')
    const texts = observeBubbleTexts(page, 1600)
    await clickBubble(page) // 已全部入格 → 跳过 drag + more，直达旋转引导（成功提示）
    const seen = (await texts).join('|')
    expect(seen, '「现在就试试看吧」应被跳过').not.toContain('现在就试试看吧')
    expect(seen, '「剩余的飞机全部拖到网格里」应被跳过').not.toContain('剩余的飞机全部拖到网格里')
    await expect(page.locator('.tutorial-fx--success')).toHaveCount(1, { timeout: 8000 })
    await expect(bubble(page)).toContainText('单击飞机可以使飞机旋转90度，试试看！', { timeout: 8000 })
    await expectSingleLayer(page)

    await page.getByRole('button', { name: '← 退出教程' }).click()
    await expect(modal(page)).toContainText('退出教程？')
    await modal(page).getByRole('button', { name: '确认退出' }).click()
    await expect(page.getByRole('heading', { name: '飞机杀' })).toBeVisible({ timeout: 10_000 })

    expect(errs()).toEqual([])
  })
})
