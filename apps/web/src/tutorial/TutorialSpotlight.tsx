/**
 * TutorialSpotlight —— <突显> 空洞几何动画引擎（v0.3.17-beta1 全新实现）。
 *
 * 模型：**遮罩 + 可动画矩形空洞**，任意时刻至少有一个空洞。
 * - 基础态（无突显对象）：遮罩存在，但空洞 = 整个页面 → 视觉上无压暗（等价“未突显”）；
 * - rest → focus：空洞从页面尺寸向突显对象收缩（光线聚焦）；
 * - 叠加（append）：新目标对应的空洞从**目标中心**向外生长到目标矩形；
 * - 切换（transfer）：旧洞**位置+尺寸连续变形**到新目标（取最近洞做 morph），无中间“无洞/清零”帧；
 * - 取消（blur-all）：各空洞扩大到页面；多洞独立并行；
 * - 动画：rAF 逐帧插值 `holes: Rect[]`（不依赖 CSS 尺寸过渡、不重挂载），每帧同步更新
 *   ①SVG evenodd 挖洞路径 ②交互阻断带（洞外阻断），缓动 cubic-bezier(0.22,0.61,0.36,1)，时长常量可调。
 *
 * 豁免：气泡（z 210）与弹窗（.paper-modal，弹窗打开时本组件整体不渲染）始终高于遮罩；
 * `.tutorial-escape`（左上角退出按钮）的矩形始终并入“交互洞” → 任何模式下都可点。
 *
 * `<突显对话气泡>`（dim）：仍渲染整屏暗层（div，无 path）+ 阻断带，气泡因 z-index 豁免可见/可点；
 * 与目标节点的相互切换会走引擎动画（进入目标节点时从“气泡矩形”morph 过去、进入 dim 时收拢到气泡矩形），
 * 保证过渡期间遮罩始终存在、不闪白。
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { disjointHoleRects, mergeHoleRects } from './spotlightMerge'
import { useAnyModalOpen } from './useAnyModalOpen'
import { clearSpotlightCarry, peekSpotlightCarry, rememberSpotlightRects } from './spotlightCarry'

export interface TargetRect {
  left: number
  top: number
  width: number
  height: number
}

const PAD = 6 // 开洞外扩（目标呼吸空间）
const DARK = 'rgba(58, 46, 28, 0.52)'
/** 空洞几何动画时长（ms，300–400 可调） */
const HOLE_ANIM_MS = 340
/** 聚焦前静止期（ms）：基础态/整页洞 → 突显目标 时，先等待再开始收缩（v0.3.17-beta4 item 1） */
const FOCUS_DELAY_MS = 500
/**
 * 空洞几何缓动：smootherstep 6t⁵−15t⁴+10t³ —— 起点速度与终点速度**都为 0**，
 * 中段最快，避免“起手一顿/收尾一顿”的机械感（逐帧速度采样见验证脚本）。
 */
const HOLE_EASE = (t: number) => t * t * t * (t * (t * 6 - 15) + 10)

type AnimLabel = 'focus' | 'add' | 'transfer' | 'blur' | 'none'

interface AnimHole {
  id: number
  from: TargetRect
  to: TargetRect
  start: number
  dur: number
  /** 本次过渡类型（用于 data-spotlight-anim） */
  label: AnimLabel
}

/* ============ 工具 ============ */

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const lerpRect = (a: TargetRect, b: TargetRect, t: number): TargetRect => ({
  left: lerp(a.left, b.left, t),
  top: lerp(a.top, b.top, t),
  width: lerp(a.width, b.width, t),
  height: lerp(a.height, b.height, t),
})
const sameRect = (a: TargetRect, b: TargetRect, eps = 0.6) =>
  Math.abs(a.left - b.left) < eps &&
  Math.abs(a.top - b.top) < eps &&
  Math.abs(a.width - b.width) < eps &&
  Math.abs(a.height - b.height) < eps
const centerRect = (r: TargetRect): TargetRect => ({
  left: r.left + r.width / 2,
  top: r.top + r.height / 2,
  width: 0,
  height: 0,
})
const center = (r: TargetRect) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 })
const dist = (a: TargetRect, b: TargetRect) => {
  const ca = center(a)
  const cb = center(b)
  return Math.hypot(ca.x - cb.x, ca.y - cb.y)
}

/** 求目标矩形；隐藏目标返回 null */
function targetRectOf(selector: string): TargetRect | null {
  const el = document.querySelector(selector)
  if (!el) return null
  const b = el.getBoundingClientRect()
  if (b.width === 0 || b.height === 0) return null
  return { left: b.left, top: b.top, width: b.width, height: b.height }
}

function measureRects(list: string[]): TargetRect[] {
  const out: TargetRect[] = []
  for (const sel of list) {
    const r = targetRectOf(sel)
    if (r) out.push(r)
  }
  return out
}

/**
 * 豁免元素（.tutorial-escape）矩形：任何模式下都不参与阻断。
 * v0.3.17-beta3：跳过**整屏容器型**豁免元素（如 GameScreen 横幅的外层 backdrop 包裹层，
 * 它本身带 `.tutorial-escape` 但覆盖整个视口）——否则整屏都成洞、阻断带归零；
 * 真正需要豁免的是它内部的按钮/卡片（它们各自也带 `.tutorial-escape`）。
 */
function measureEscapeRects(): TargetRect[] {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 0
  const vh = typeof window !== 'undefined' ? window.innerHeight : 0
  const out: TargetRect[] = []
  for (const el of Array.from(document.querySelectorAll('.tutorial-escape'))) {
    const b = el.getBoundingClientRect()
    if (b.width <= 0 || b.height <= 0) continue
    const fullScreen = b.width >= vw - 2 && b.height >= vh - 2
    if (fullScreen) continue
    out.push({ left: b.left, top: b.top, width: b.width, height: b.height })
  }
  return out
}

/* ============ 组件 ============ */

export function TutorialSpotlight({
  /** 是否处于突显状态；false = 基础态（遮罩在、空洞=整页 → 视觉无压暗） */
  active = true,
  target,
  dim = false,
  block = true,
  measureKey,
}: {
  active?: boolean
  target?: string | string[] | null
  /** <突显对话气泡>：整屏暗层（div，无 path），气泡 z 210 豁免可见/可点 */
  dim?: boolean
  /** 是否附加模态交互阻断带（默认 true）；false = 只压暗不阻断（如摆阵 thanks / 非法阵形） */
  block?: boolean
  /** 目标元素尺寸/位置随场景变化但选择器不变时（如 5×5 ↔ 10×10 同为 `.u1-grid`）强制重测 */
  measureKey?: string | number
}) {
  const targets = useMemo(
    () => (Array.isArray(target) ? target : target ? [target] : []),
    [target],
  )
  /** 纵深防护（v0.3.13 加固）：任何弹窗打开期间都不渲染遮罩 */
  const modalOpen = useAnyModalOpen()
  /** <突显对话气泡> 且无目标 = 纯 dim 节点（气泡即“被突显对象”，走同一空洞引擎） */
  const dimOnly = dim && targets.length === 0
  /** 引擎内的实际目标：纯 dim 节点以对话气泡矩形为洞，与 dim 桥接路径统一（v0.3.17-beta2 item 3） */
  const engineTargets = useMemo(
    () => (dimOnly ? ['.tutorial-bubble'] : targets),
    [dimOnly, targets],
  )

  /* ---------- 渲染期即时测量（切换同帧即有几何） ---------- */
  const W = typeof window !== 'undefined' ? window.innerWidth : 0
  const H = typeof window !== 'undefined' ? window.innerHeight : 0
  const pageRect = useMemo<TargetRect>(() => ({ left: 0, top: 0, width: W, height: H }), [W, H])
  const [measured, setMeasured] = useState<TargetRect[]>([])
  const [escapes, setEscapes] = useState<TargetRect[]>([])
  const liveTargets = active ? measureRects(engineTargets) : []
  /**
   * 目标几何：一律用**渲染期即时测量**。
   * - 选择器列表为空（基础态 / dim 目的地已并入 engineTargets）→ 真取消；
   * - 选择器非空但此刻测不到（元素尚未渲染）→ **不规划**（沿用当前几何），
   *   而不是退化成“取消突显”把洞扩到整页（那正是切换时闪一下的根因）。
   */
  const wantTargets = active && engineTargets.length > 0
  // 渲染期测不到时回退到 effect 测量结果（含延迟重试）；两者都空则“暂不规划”，
  // 等 effect 测量落地后 sig 变化再规划（避免把“尚未渲染”误判为“取消突显”）
  const destRects = wantTargets ? (liveTargets.length > 0 ? liveTargets : measured) : []
  const liveEscapes = active ? measureEscapeRects() : escapes
  const mergedEscapes = liveEscapes.length > 0 ? liveEscapes : escapes

  /** 首帧几何：优先续接上一阶段的洞（跨单元 transfer 起点），否则基础态（洞=整页）——
   *  同步用 window.innerWidth/Height，确保“界面首帧即遮罩就位”，不出现空窗（item 1）。 */
  const initialRects = useMemo<TargetRect[]>(() => {
    const carry = peekSpotlightCarry()
    if (carry && carry.length > 0) return carry
    return [{ left: 0, top: 0, width: W, height: H }]
  }, [W, H])
  /* ---------- 动画引擎状态 ---------- */
  const holeIdRef = useRef(0)
  const animsRef = useRef<AnimHole[]>([])
  const curRef = useRef<TargetRect[]>(initialRects)
  const rafRef = useRef(0)
  const labelRef = useRef<AnimLabel>('none')
  const loopGenRef = useRef(0)
  /** 上一次规划是否已把「气泡矩形」落定（item 2：气泡尺寸变化直接突变跟随，不播动画） */
  const bubbleSettledRef = useRef(false)
  /** 最近一次渲染是否纯 dim（气泡）节点：卸载时决定是否需要跨阶段暂存洞几何 */
  const dimOnlyRef = useRef(dimOnly)
  dimOnlyRef.current = dimOnly
  /** 本实例是否已经历过第一次真实过渡（跨阶段续接只在第一次补齐读取） */
  const carryUsedRef = useRef(false)
  const [frame, setFrame] = useState<{ rects: TargetRect[]; anim: AnimLabel }>({
    rects: initialRects,
    anim: 'none',
  })
  /** 引擎是否已“落定”（动画结束或瞬时落位）：未落定时即便 anim==='none' 也不能渲染纯 dim 暗层，
   *  否则 focus 延迟期间会先整屏压暗、随后又因整页洞而变亮（闪一下）。 */
  const [idle, setIdle] = useState(true)
  const frameRef = useRef(frame)
  frameRef.current = frame

  /** 提交一帧（几何无变化则不触发重渲染） */
  const commit = (rects: TargetRect[], anim: AnimLabel) => {
    const prev = frameRef.current
    const same =
      prev.anim === anim &&
      prev.rects.length === rects.length &&
      prev.rects.every((r, i) => sameRect(r, rects[i]!, 0.4))
    if (same) return
    const next = { rects, anim }
    frameRef.current = next
    setFrame(next)
  }

  /** rAF 逐帧插值 */
  const runLoop = () => {
    // 代次保护：新计划立即取代旧循环；已被取消的陈旧句柄不再堵住后续动画
    const gen = ++loopGenRef.current
    cancelAnimationFrame(rafRef.current)
    const step = () => {
      if (gen !== loopGenRef.current) return
      const now = performance.now()
      const anims = animsRef.current
      let done = true
      const rects = anims.map((a) => {
        const t = Math.min(1, Math.max(0, (now - a.start) / a.dur))
        if (t < 1) done = false
        return lerpRect(a.from, a.to, HOLE_EASE(t))
      })
      let finalRects = rects
      if (done) {
        // 收尾去重：并入同一目标后的重合洞只保留一个（几何 <1px 视为重合）
        finalRects = rects.filter(
          (r, i) => rects.findIndex((o) => sameRect(o, r, 1)) === i,
        )
        curRef.current = finalRects
      } else {
        curRef.current = rects
      }
      commit(finalRects, done ? 'none' : labelRef.current)
      if (done) {
        rafRef.current = 0
        if (dimOnly) bubbleSettledRef.current = true
        setIdle(true)
        return
      }
      void finalRects
      rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
  }

  /** 立即落位（无动画，用于初始化基础态 / 时长 0） */
  const settleAt = (rects: TargetRect[]) => {
    animsRef.current = []
    curRef.current = rects
    commit(rects, 'none')
    setIdle(true)
  }

  /**
   * 过渡规划器：区分 rest→focus / append / transfer / blur-all / 部分移除。
   * @param dest 目标几何（空 = 基础态或 dim 态）
   */
  const plan = (dest: TargetRect[]) => {
    setIdle(false)
    let cur = curRef.current
    const now = performance.now()
    /* ---------- 跨阶段续接补齐（v0.3.17-beta4） ----------
     * 新旧阶段在同一次 commit 内替换：新实例 render 时旧实例尚未卸载，peek 必然为空。
     * 这里在本实例【第一次真实过渡】时补读旧实例卸载时暂存的洞几何，并只取与目标最近的洞作为起点
     * （摆阵页「确认布阵」按钮洞 → 单元3 气泡洞 = transfer），随后立即清空避免重复消费。 */
    if (dest.length > 0 && !carryUsedRef.current) {
      carryUsedRef.current = true
      if (cur.length === 1 && sameRect(cur[0]!, pageRect, 2)) {
        const carried = peekSpotlightCarry()
        if (carried && carried.length > 0) {
          clearSpotlightCarry()
          const anchor = dest[0]!
          const nearest = carried.reduce((a, b) => (dist(a, anchor) <= dist(b, anchor) ? a : b))
          curRef.current = [nearest]
          cur = [nearest]
        }
      }
    }
    // item 2：仅当“上一次已把气泡洞落定”且目标仍是气泡且尺寸变了 → 直接突变跟随（不播动画）。
    // 该判定必须用【旧值】并且不能由本函数提前置 true，否则会误吞正在进行的 focus 动画。
    const bubbleJump =
      dimOnly &&
      bubbleSettledRef.current &&
      cur.length === 1 &&
      dest.length === 1 &&
      !sameRect(cur[0]!, dest[0]!, 0.5)
    if (!bubbleJump) bubbleSettledRef.current = false

    const mk = (from: TargetRect, to: TargetRect, label: AnimLabel): AnimHole => ({
      id: holeIdRef.current++,
      from,
      to,
      start: now,
      dur: HOLE_ANIM_MS,
      label,
    })

    /**
     * item 1 的延迟聚焦：从 seed（整页）延迟 FOCUS_DELAY_MS 后收缩到目标。
     * 若已有一组「同 seed、同目标数量」的 focus 动画仍在飞行（通常是首帧后测量更新导致的重规划），
     * 则**只更新目标矩形、保留原 start**——否则每次重规划都会重置 500ms 静止期（静止期被无限拉长）。
     */
    const delayFocusFrom = (seed: TargetRect, dst: TargetRect[], nowMs: number): AnimHole[] => {
      const pending = animsRef.current
      const reusable =
        pending.length === dst.length &&
        pending.length > 0 &&
        pending.every((a) => a.label === 'focus' && sameRect(a.from, seed, 2))
      if (reusable) return pending.map((a, i) => ({ ...a, to: dst[i]! }))
      return dst.map((t) => ({ ...mk(seed, t, 'focus'), start: nowMs + FOCUS_DELAY_MS }))
    }

    // ① 无当前洞：基础态初始化（无动画）或 rest→focus（从整页/气泡矩形收缩到目标）
    const label0 = (l: AnimLabel) => {
      labelRef.current = l
    }
    if (cur.length === 0) {
      if (dest.length === 0) {
        settleAt([pageRect])
        return
      }
      // rest → 目标：从整页收缩（dim 节点的目标即气泡矩形，天然是“暗→暗”连续）
      const seed = pageRect
      label0('focus')
      // item 1：从整页洞收缩前先静止 FOCUS_DELAY_MS
      animsRef.current = delayFocusFrom(seed, dest, now)
      runLoop()
      return
    }

    // ② 取消：空洞扩大到整页（基础态）；dim 目的地即气泡矩形（已由目标给出）
    if (dest.length === 0) {
      const to = pageRect
      const moving = cur.filter((r) => !sameRect(r, to))
      if (moving.length === 0) {
        settleAt(cur)
        return
      }
      label0('blur')
      animsRef.current = cur.map((r) => mk(r, to, 'blur'))
      runLoop()
      return
    }

    // ②b 基础态（仅一个整页洞）→ 目标：rest→focus（从整页收缩；语义同“光线聚焦”）
    const isBase = cur.length === 1 && sameRect(cur[0]!, pageRect, 2)
    if (isBase) {
      label0('focus')
      // item 1：聚焦前静止 FOCUS_DELAY_MS 再开始收缩（仅此一类过渡加延迟）
      animsRef.current = delayFocusFrom(cur[0]!, dest, now)
      runLoop()
      return
    }

    // ②c 气泡洞（item 2）：目标仍是气泡且气泡矩形变了（换段/换行/字号）→ 立即突变跟随，不播尺寸动画
    if (bubbleJump) {
      settleAt(dest) // settleAt 会保持 bubbleSettled=true
      return
    }

    // ③ 已有洞 → 新目标：最近中心贪心匹配（transfer），多余洞收拢消失（blur-out），新增目标从中心生长（add）
    const matchedCur = new Set<number>()
    const planPairs: Array<{ ci: number; ti: number }> = []
    for (let ti = 0; ti < dest.length; ti++) {
      let best = -1
      let bestD = Infinity
      for (let ci = 0; ci < cur.length; ci++) {
        if (matchedCur.has(ci)) continue
        const d = dist(cur[ci]!, dest[ti]!)
        if (d < bestD) {
          bestD = d
          best = ci
        }
      }
      if (best >= 0) {
        matchedCur.add(best)
        planPairs.push({ ci: best, ti })
      } else {
        planPairs.push({ ci: -1, ti })
      }
    }
    const newAnims: AnimHole[] = []
    let hasAdd = false
    let hasBlur = false
    let hasTransfer = false
    for (const { ci, ti } of planPairs) {
      if (ci >= 0) {
        const from = cur[ci]!
        const to = dest[ti]!
        // 注意：即使几何已一致也必须保留为洞（from==to 的静态动画），
        // 否则该洞会从 anims 列表里消失 → 表现为“只有最后一个目标被突显”。
        newAnims.push(mk(from, to, 'transfer'))
        if (!sameRect(from, to)) hasTransfer = true
      } else {
        // 新目标：从中心向外生长
        newAnims.push(mk(centerRect(dest[ti]!), dest[ti]!, 'add'))
        hasAdd = true
      }
    }
    const removed = []
    for (let ci = 0; ci < cur.length; ci++) {
      if (!matchedCur.has(ci)) removed.push(ci)
    }
    for (const ci of removed) {
      if (planPairs.some((p) => p.ci >= 0)) {
        // 部分移除（仍有保留目标）：被移除的洞**并入最近的保留目标**（视觉上“高光汇聚过去”），
        // 避免原地缩小/扩大造成“洞落在旧位置”的错觉（item 8）；动画结束后去重裁剪。
        let best = -1
        let bestD = Infinity
        for (const p of planPairs) {
          if (p.ci < 0) continue
          const d = dist(cur[ci]!, dest[p.ti]!)
          if (d < bestD) {
            bestD = d
            best = p.ti
          }
        }
        newAnims.push(mk(cur[ci]!, dest[best]!, 'blur'))
      } else {
        // 全部取消 → 扩大到整页（blur-all）
        newAnims.push(mk(cur[ci]!, pageRect, 'blur'))
      }
      hasBlur = true
    }
    if (newAnims.length === 0) {
      settleAt(dest)
      return
    }
    const label: AnimLabel = hasAdd ? 'add' : hasBlur ? 'blur' : hasTransfer ? 'transfer' : 'none'
    label0(label)
    animsRef.current = newAnims.map((a) => ({ ...a, label }))
    runLoop()
  }

  /* ---------- 目标变化 → 规划动画 ---------- */
  const sig = `${active ? 1 : 0}|${dimOnly ? 1 : 0}|${destRects
    .map((r) => `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}`)
    .join(';')}`
  const prevSigRef = useRef('')
  // 布局期规划：场景/目标切换在浏览器绘制前完成规划（首帧即用新几何，避免“旧洞闪一下”）
  useLayoutEffect(() => {
    if (sig === prevSigRef.current) return
    // 目标选择器非空但尚未测到 → 不规划（等测量到位后 sig 变化再规划），避免误判为取消
    if (wantTargets && destRects.length === 0) return
    prevSigRef.current = sig
    plan(destRects)
    // eslint 无 react-hooks 插件：依赖 sig / wantTargets 即可
  }, [sig, wantTargets])

  /* ---------- 测量（ResizeObserver / 延迟重测）；更新时动画到新矩形而非瞬跳 ---------- */
  const targetKey = targets.join('|')
  // 注意：dim 节点的目标由引擎内部指定为气泡（engineTargets），这里必须一致，
  // 否则 effect 侧永远测不到气泡 → 首帧后无重试触发 → 规划器死等
  const effTargetsRef = useRef<string[]>(engineTargets)
  effTargetsRef.current = active ? engineTargets : []
  /** 几何等值判断（避免无谓 setState 触发渲染循环） */
  const sameRectList = (a: TargetRect[], b: TargetRect[]) =>
    a.length === b.length &&
    a.every((r, i) => sameRect(r, b[i]!, 0.5))

  /**
   * 每次提交后重新测量（v0.3.17-beta4）：
   * 气泡换段/换行/字号变化不会改变选择器，若只在 targetKey 变化时测量，dest 会停留在旧矩形
   * （表现为“洞没跟上气泡”）。这里无 deps 的 layout effect 每次提交都测一次，值相同则不 setState。
   */
  useLayoutEffect(() => {
    if (!active) return
    const nextT = measureRects(effTargetsRef.current)
    setMeasured((prev) => (sameRectList(prev, nextT) ? prev : nextT))
    const nextE = measureEscapeRects()
    setEscapes((prev) => (sameRectList(prev, nextE) ? prev : nextE))
  })

  useLayoutEffect(() => {
    const measure = () => {
      setMeasured(measureRects(effTargetsRef.current))
      setEscapes(measureEscapeRects())
    }
    measure()
    const timers = [window.setTimeout(measure, 80), window.setTimeout(measure, 400)]
    const observed = new Set<Element>()
    const ro = new ResizeObserver(() => measure())
    for (const sel of targets) {
      const el = document.querySelector(sel)
      if (el && !observed.has(el)) {
        observed.add(el)
        ro.observe(el)
      }
    }
    window.addEventListener('resize', measure)
    return () => {
      timers.forEach((t) => window.clearTimeout(t))
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
    // eslint 无 react-hooks 插件：deps 用 targetKey（字符串）而非数组字面量，避免每次渲染重跑
  }, [targetKey, measureKey, active, dimOnly, sig])

  // 说明（v0.3.17-beta4）：这里原先在挂载时 clearSpotlightCarry()。
  // 但组件替换发生在同一次 commit：新实例的 render（读 carry）早于旧实例的卸载 cleanup（写 carry），
  // 挂载期清空会把刚写好的几何立刻抹掉 → 跨阶段续接（item 6）永不生效。
  // 现在改为：在【本实例第一次真实过渡】时补读 carry，读完即清（见 plan）。
  useEffect(
    () => () => {
      loopGenRef.current++
      cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
      rememberSpotlightRects(curRef.current, { dimOnly: dimOnlyRef.current })
    },
    [],
  )

  /* ---------- 渲染 ---------- */
  if (modalOpen) {
    return (
      <svg
        className="tutorial-spotlight"
        data-spotlight-mode="holes"
        data-spotlight-anim="none"
        data-spotlight-holes={1}
        data-spotlight-holes-raw={1}
        data-spotlight-block="0"
        width={W}
        height={H}
        aria-hidden="true"
      >
        <path d={`M0 0 H${W} V${H} H0 Z M0 0 H${W} V${H} H0 Z`} fillRule="evenodd" fill={DARK} />
      </svg>
    )
  }

  const rects = frame.rects
  const animating = frame.anim !== 'none'
  const mode: 'dim' | 'holes' | 'hybrid' = dim ? (dimOnly ? 'dim' : 'hybrid') : 'holes'
  /** 纯 dim 且动画静止：渲染整屏暗层（气泡 z 豁免）；过渡期（含切到气泡）由空洞引擎承担 */
  const renderDimLayer = dimOnly && !animating && idle

  const padMerge = (list: TargetRect[]) => {
    const outer = list
      .map((r) => ({
        left: Math.max(0, r.left - PAD),
        top: Math.max(0, r.top - PAD),
        right: Math.min(W, r.left + r.width + PAD),
        bottom: Math.min(H, r.top + r.height + PAD),
      }))
      .map((r) => ({ left: r.left, top: r.top, width: r.right - r.left, height: r.bottom - r.top }))
    return mergeHoleRects(outer)
  }
  // 视觉洞 = 当前动画几何 ∪ 豁免元素（气泡/横幅/退出按钮等既不被压暗也不被阻断）。
  // 用「去重叠分解」而非包围盒合并：并集边界随动画连续变化，融合瞬间不再跳变（item 4）。
  const paddedAll = [...rects, ...mergedEscapes].map((r) => ({
    left: Math.max(0, r.left - PAD),
    top: Math.max(0, r.top - PAD),
    width: Math.min(W, r.left + r.width + PAD) - Math.max(0, r.left - PAD),
    height: Math.min(H, r.top + r.height + PAD) - Math.max(0, r.top - PAD),
  }))
  const visualHoles = disjointHoleRects(paddedAll)
  // 交互洞 = 视觉洞 ∪ 目标（动画途中目标绝不被阻断）
  const interactiveHoles = padMerge([...rects, ...destRects, ...mergedEscapes])

  const framePath = `M0 0 H${W} V${H} H0 Z`
  const holePath = visualHoles
    .map((r) => `M${r.left} ${r.top} H${r.left + r.width} V${r.top + r.height} H${r.left} Z`)
    .join(' ')

  if (renderDimLayer) {
    return (
      <>
        <div
          className="tutorial-spotlight tutorial-spotlight--dim tutorial-spotlight--sheet"
          data-spotlight-mode="dim"
          data-spotlight-anim="none"
          data-spotlight-holes={1}
          data-spotlight-holes-raw={0}
          data-spotlight-dest={destRects
            .map((r) => `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}`)
            .join(';')}
          data-spotlight-sel={engineTargets.join('|')}
          data-spotlight-block={block ? '1' : '0'}
          aria-hidden="true"
        />
        {/* 阻断带 = 「气泡目标洞 + 豁免元素」的补集（用**目标几何**而非当前动画几何：
            首帧 rects 还是整页洞时也能立即得到正确阻断，避免“首帧无阻断”）。
            豁免元素（.tutorial-escape 退出按钮等）所在区域根本不被阻断——不依赖 z-index 比较，
            规避父级 stacking context 把按钮压在阻断带之下 */}
        {block ? (
          <BlockBands holes={padMerge([...destRects, ...mergedEscapes])} W={W} H={H} />
        ) : null}
      </>
    )
  }

  return (
    <>
      <svg
        className={['tutorial-spotlight', dim ? 'tutorial-spotlight--dim' : '']
          .filter(Boolean)
          .join(' ')}

        data-spotlight-mode={mode}
        data-spotlight-anim={frame.anim}
        data-spotlight-holes={visualHoles.length}
        data-spotlight-holes-raw={rects.length}
        data-spotlight-dest={destRects
          .map((r) => `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}`)
          .join(';')}
        data-spotlight-sel={engineTargets.join('|')}
        data-spotlight-block={block ? '1' : '0'}
        width={W}
        height={H}
        aria-hidden="true"
      >
        <path d={`${framePath} ${holePath}`} fillRule="evenodd" fill={DARK} />
      </svg>
      {block ? <BlockBands holes={interactiveHoles} W={W} H={H} /> : null}
    </>
  )
}

/**
 * 阻断带：取【交互洞】的补集（按 x 边界纵向切片，逐片只阻断洞上下方区域）。
 * 逐洞各围四带不可行：一个洞的整幅横带会盖住另一个洞；气泡（z 210）与
 * 豁免元素（.tutorial-escape z 160）高于阻断带（z 150）仍可交互。
 */
function BlockBands({ holes, W, H }: { holes: TargetRect[]; W: number; H: number }) {
  if (holes.length === 0) {
    return <div className="tutorial-block" aria-hidden="true" />
  }
  const xs = Array.from(new Set([0, W, ...holes.flatMap((r) => [r.left, r.left + r.width])])).sort(
    (a, b) => a - b,
  )
  const blocks: Array<{ left: number; top: number; width: number; height: number }> = []
  for (let i = 0; i < xs.length - 1; i++) {
    const x0 = xs[i]!
    const x1 = xs[i + 1]!
    const w = x1 - x0
    if (w <= 0) continue
    const inSlice = holes.filter((r) => r.left < x1 && r.left + r.width > x0)
    if (inSlice.length === 0) {
      blocks.push({ left: x0, top: 0, width: w, height: H })
      continue
    }
    const top = Math.min(...inSlice.map((r) => r.top))
    const bottom = Math.max(...inSlice.map((r) => r.top + r.height))
    blocks.push({ left: x0, top: 0, width: w, height: Math.max(0, top) })
    blocks.push({ left: x0, top: bottom, width: w, height: Math.max(0, H - bottom) })
  }
  // 丢弃零面积带：基础态（洞=整页）不应残留 0 高度的 .tutorial-block 元素
  const visible = blocks.filter((b) => b.width > 0.5 && b.height > 0.5)
  return (
    <>
      {visible.map((b, i) => (
        <div
          key={i}
          className="tutorial-block"
          aria-hidden="true"
          style={{ left: b.left, top: b.top, width: b.width, height: b.height }}
        />
      ))}
    </>
  )
}
