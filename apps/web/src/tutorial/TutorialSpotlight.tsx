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
 *   ①SVG evenodd 挖洞路径（3px 圆角矩形空洞）②交互阻断带（洞外阻断）；
 * 空洞过渡采用 **iOS SpringBoard 风格解析弹簧**（response 0.52s / dampingFraction 0.85，见下方 HOLE_EASE）。
 *
 * 豁免：气泡（z 210）与弹窗（.paper-modal，弹窗打开时本组件整体不渲染）始终高于遮罩；
 * `.tutorial-escape`（左上角退出按钮）的矩形始终并入“交互洞” → 任何模式下都可点。
 *
 * `<突显对话气泡>`（dim）：仍渲染整屏暗层（div，无 path）+ 阻断带，气泡因 z-index 豁免可见/可点；
 * 与目标节点的相互切换会走引擎动画（进入目标节点时从“气泡矩形”morph 过去、进入 dim 时收拢到气泡矩形），
 * 保证过渡期间遮罩始终存在、不闪白。
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { disjointHoleRects, unionOutlinePath } from './spotlightMerge'
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
/**
 * 空洞几何动画时长（ms）：v0.3.18-beta1 由 340 提到 560 —— 解析弹簧存在“长尾缓缓收尾”，
 * 窗口太短会在尾部被硬切成 1（收尾速度不为 0，出现轻微“顿一下”）。560ms ≈ 弹簧 4τ 后收敛到 <1%。
 */
const HOLE_ANIM_MS = 560
/** 空洞四角圆角半径（px，用户指定 3px） */
const HOLE_RADIUS = 3
/** 聚焦前静止期（ms）：基础态/整页洞 → 突显目标 时，先等待再开始收缩（v0.3.17-beta4 item 1） */
const FOCUS_DELAY_MS = 500
/**
 * 空洞几何缓动（v0.3.18-beta1）：**iOS SpringBoard 缩放转场风格**的解析弹簧阶跃响应。
 *
 * 用户反馈 smootherstep（6t⁵−15t⁴+10t³）"过于线性且对称"——它两端速度都为 0 且完全对称，
 * 观感就是「匀速感 + 两端各顿一下」。改为 Apple 弹簧动画语义（SwiftUI 默认
 * `spring(response:dampingFraction:)`）：
 *
 *   x(τ) = 1 − e^(−ζω₀τ)·[cos(ω_d τ) + (ζω₀/ω_d)·sin(ω_d τ)]
 *   ω₀ = 2π / response, ω_d = ω₀·√(1−ζ²)
 *
 * 取 response = 0.52s、ζ = 0.85：起步极快（前 10% 时间已走 ~35%），随后**长尾缓缓收尾**，
 * 理论过冲 exp(−πζ/√(1−ζ²)) ≈ 0.63%（几何回弹 ≤1%，远小于 2px 量级的可见阈值）。
 * 末尾按 x(HOLE_ANIM_MS) 归一化，保证 ease(1) === 1：否则末帧会残留过冲偏移（洞不落在目标上）。
 * 逐 40ms 采样曲线见本轮验证脚本输出。
 */
const SPRING_RESPONSE_S = 0.52
const SPRING_ZETA = 0.85
const SPRING_W0 = (2 * Math.PI) / SPRING_RESPONSE_S
const SPRING_WD = SPRING_W0 * Math.sqrt(1 - SPRING_ZETA * SPRING_ZETA)
const springStep = (tau: number) =>
  1 -
  Math.exp(-SPRING_ZETA * SPRING_W0 * tau) *
    (Math.cos(SPRING_WD * tau) + ((SPRING_ZETA * SPRING_W0) / SPRING_WD) * Math.sin(SPRING_WD * tau))
const SPRING_NORM = springStep(HOLE_ANIM_MS / 1000)
/** t∈[0,1] 归一化弹簧进度（ease(0)=0、ease(1)=1，中段带 ≤1% 回弹） */
const HOLE_EASE = (t: number) => springStep((t * HOLE_ANIM_MS) / 1000) / SPRING_NORM

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

/** 目标洞 + 其**身份键**（= 目标选择器，v0.3.18-beta3 根因 A）：配对按身份而不是按最近几何。 */
interface PairRect {
  key: string
  rect: TargetRect
}
function measurePairs(list: string[]): PairRect[] {
  const out: PairRect[] = []
  for (const sel of list) {
    const r = targetRectOf(sel)
    if (r) out.push({ key: sel, rect: r })
  }
  return out
}
const samePairList = (a: PairRect[], b: PairRect[]) =>
  a.length === b.length && a.every((p, i) => p.key === b[i]!.key && sameRect(p.rect, b[i]!.rect, 0.5))

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
  /**
   * 引擎内的实际目标（v0.3.18-beta2 item 5）：
   * 气泡是**被突显对象**（要被看到/可点），因此 dim 模式下它作为引擎目标开洞；
   * 而 .tutorial-escape（退出按钮/横幅卡片）改为**结构化置顶**（TutorialEscape/TutorialTopLayer），
   * 不再参与开洞——可见性由层级保证，洞几何只保留真正的突显对象。
   */
  const engineTargets = useMemo(
    () => (dim ? ['.tutorial-bubble', ...targets] : targets),
    [dim, targets],
  )

  /* ---------- 渲染期即时测量（切换同帧即有几何） ---------- */
  const W = typeof window !== 'undefined' ? window.innerWidth : 0
  const H = typeof window !== 'undefined' ? window.innerHeight : 0
  const pageRect = useMemo<TargetRect>(() => ({ left: 0, top: 0, width: W, height: H }), [W, H])
  const [measuredPairs, setMeasuredPairs] = useState<PairRect[]>([])
  const [escapes, setEscapes] = useState<TargetRect[]>([])
  const livePairs = active ? measurePairs(engineTargets) : []
  /**
   * 目标几何：一律用**渲染期即时测量**。
   * - 选择器列表为空（基础态 / dim 目的地已并入 engineTargets）→ 真取消；
   * - 选择器非空但此刻测不到（元素尚未渲染）→ **不规划**（沿用当前几何），
   *   而不是退化成“取消突显”把洞扩到整页（那正是切换时闪一下的根因）。
   */
  const wantTargets = active && engineTargets.length > 0
  // 渲染期测不到时回退到 effect 测量结果（含延迟重试）；两者都空则“暂不规划”，
  // 等 effect 测量落地后 sig 变化再规划（避免把“尚未渲染”误判为“取消突显”）
  const destPairs: PairRect[] = wantTargets ? (livePairs.length > 0 ? livePairs : measuredPairs) : []
  const destRects = destPairs.map((p) => p.rect)
  const destKeys = destPairs.map((p) => p.key)
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
  /**
   * 与 curRef 平行的**洞身份键**（= 该洞对应的目标选择器；null = 无身份，如跨阶段续接/carry 洞）。
   * v0.3.18-beta3 根因 A：目标增删时按身份配对，持续存在的目标洞原地不动，新增原地长出、移除原地缩小。
   */
  const curKeysRef = useRef<(string | null)[]>(initialRects.map(() => null))
  /** 本次动画要写入的身份键（与 animsRef 平行）；由 runLoop 在写入 rects 的同一帧同步到 curKeysRef，
   *  避免“同一帧内二次规划”时 curKeysRef 已更新而 curRef 还是旧几何 → 索引错位。 */
  const pendingKeysRef = useRef<(string | null)[]>([])
  const rafRef = useRef(0)
  const labelRef = useRef<AnimLabel>('none')
  const loopGenRef = useRef(0)
  /**
   * focus 静止期截止时刻（performance.now 基准，v0.3.18-beta2 追加修复）。
   * 多目标「从基础态聚焦」会在首帧后经历多次重规划（dest 1→2 个目标、气泡换文案重排……）：
   * 每次重规划都必须**沿用同一截止时间**，既不能丢失静止期（旧实现按 cur.length===1 判基础态，
   * 洞变成 2 个整页洞后落入 transfer 分支 → 无延迟），也不能把静止期不断重置/延长。
   */
  const focusHoldUntilRef = useRef(0)
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
        const keep = rects.map((r, i) => rects.findIndex((o) => sameRect(o, r, 1)) === i)
        const keysNow = pendingKeysRef.current
        // v0.3.18-beta3：被移除的洞「原地缩小至消失」→ 落定时裁掉零尺寸洞（及其身份键）
        const alive = rects.map((r, i) => keep[i] && r.width > 0.5 && r.height > 0.5)
        finalRects = rects.filter((_, i) => alive[i])
        curRef.current = finalRects
        curKeysRef.current = keysNow.filter((_, i) => alive[i])
      } else {
        curRef.current = rects
        curKeysRef.current = pendingKeysRef.current
      }
      commit(finalRects, done ? 'none' : labelRef.current)
      if (done) {
        rafRef.current = 0
        setIdle(true)
        return
      }
      void finalRects
      rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
  }

  /** 立即落位（无动画，用于初始化基础态 / 时长 0） */
  const settleAt = (rects: TargetRect[], keys?: (string | null)[]) => {
    animsRef.current = []
    curRef.current = rects
    curKeysRef.current = keys ?? rects.map(() => null)
    pendingKeysRef.current = [...curKeysRef.current]
    commit(rects, 'none')
    setIdle(true)
  }

  /**
   * 过渡规划器：区分 rest→focus / append / transfer / blur-all / 部分移除。
   * @param dest 目标几何（空 = 基础态或 dim 态）
   */
  const plan = (destPairsIn: PairRect[]) => {
    setIdle(false)
    const dest = destPairsIn.map((p) => p.rect)
    const destKeysIn = destPairsIn.map((p) => p.key)
    let cur = curRef.current
    // 防御（v0.3.18-beta3）：身份键与当前洞必须一一对应；长度不一致时按“无身份”处理，
    // 避免 cur[ci] 越界（curKeys 短暂领先 rects 只可能出现在同一帧二次规划时）。
    if (curKeysRef.current.length !== cur.length) {
      curKeysRef.current = cur.map(() => null)
    }
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
    // v0.3.18-beta2 item 3：删除 beta4 的「气泡洞尺寸变化直接瞬移（settleAt）」路径——
    // 洞位移到气泡时形状突变即由此产生。现在一律走统一的连续插值（③ transfer 分支）到位，
    // 目标矩形取渲染期**即时测量**的气泡矩形，因此到位后与气泡实测矩形一致（无补测跳变）。

    const mk = (from: TargetRect, to: TargetRect, label: AnimLabel): AnimHole => ({
      id: holeIdRef.current++,
      from,
      to,
      start: now,
      dur: HOLE_ANIM_MS,
      label,
    })

    /**
     * item 1 的延迟聚焦：从 seed（整页）延迟到「静止期截止时刻」后收缩到目标。
     * 截止时间保存在 focusHoldUntilRef：
     *  - 首次从基础态聚焦 → now + FOCUS_DELAY_MS；
     *  - 之后的任何重规划（目标数 1→2、气泡换文案/尺寸重排……）→ **沿用原截止时间**（不重置、不延长）；
     *  - 非基础态过渡（②blur / ③transfer）会把截止时间清零，使下一次“从基础态聚焦”重新获得完整静止期。
     */
    const delayFocusFrom = (seed: TargetRect, dst: TargetRect[], nowMs: number): AnimHole[] => {
      const pending = focusHoldUntilRef.current
      let holdUntil: number
      if (pending > nowMs) {
        // 静止期未结束前的一切重规划（目标数 1→2、气泡换文案/尺寸、甚至切到下一个节点）都沿用同一截止时间：
        // 既不会丢失静止期（QA 复现：洞数 1→2 后落到 transfer 分支 → 无延迟），也不会把静止期反复重置/延长
        // （旧实现按「目标数量相同」复用，数量变化就丢；若按「新节点新计时」则会在整页静止期间多加一段）。
        holdUntil = pending
      } else if (pending > 0) {
        // 本轮静止期已过、但洞仍 ≈ 整页（收缩刚开始的头几帧）→ 立即开始，不重启
        holdUntil = nowMs
      } else {
        holdUntil = nowMs + FOCUS_DELAY_MS // 全新一轮（上一次已回到基础态并被 ② 分支清零）
      }
      focusHoldUntilRef.current = holdUntil
      return dst.map((t) => ({ ...mk(seed, t, 'focus'), start: holdUntil }))
    }

    // ① 无当前洞：基础态初始化（无动画）或 rest→focus（从整页/气泡矩形收缩到目标）
    const label0 = (l: AnimLabel) => {
      labelRef.current = l
    }
    if (cur.length === 0) {
      if (dest.length === 0) {
        settleAt([pageRect], [null])
        return
      }
      // rest → 目标：从整页收缩（dim 节点的目标即气泡矩形，天然是“暗→暗”连续）
      const seed = pageRect
      label0('focus')
      // item 1：从整页洞收缩前先静止 FOCUS_DELAY_MS
      pendingKeysRef.current = [...destKeysIn]
      animsRef.current = delayFocusFrom(seed, dest, now)
      runLoop()
      return
    }

    // ② 取消：空洞扩大到整页（基础态）；dim 目的地即气泡矩形（已由目标给出）
    if (dest.length === 0) {
      focusHoldUntilRef.current = 0 // 回到基础态 → 下一次“从基础态聚焦”重新计时
      const to = pageRect
      const moving = cur.filter((r) => !sameRect(r, to))
      if (moving.length === 0) {
        settleAt(cur, curKeysRef.current)
        return
      }
      label0('blur')
      pendingKeysRef.current = cur.map(() => null)
      animsRef.current = cur.map((r) => mk(r, to, 'blur'))
      runLoop()
      return
    }

    // ②b 基础态 → 目标：rest→focus（从整页收缩；语义同“光线聚焦”）
    // v0.3.18-beta2 追加修复：判据从「恰好 1 个整页洞」放宽为「**所有**洞都 ≈ 整页」——
    // 多目标聚焦时引擎会先产生 2 个整页洞（raw=2，仅一个目标已测量），旧判据判否 → 落入 ③ transfer
    // → mk() 的 start=now（无 FOCUS_DELAY_MS）→ 500ms 静止期被丢弃（QA 复现：基础态→p1 实测 134ms）。
    const isBase = cur.length > 0 && cur.every((r) => sameRect(r, pageRect, 2))
    if (isBase) {
      label0('focus')
      // item 1：聚焦前静止 FOCUS_DELAY_MS 再开始收缩（仅此一类过渡加延迟）
      pendingKeysRef.current = [...destKeysIn]
      animsRef.current = delayFocusFrom(cur[0]!, dest, now)
      runLoop()
      return
    }

    // ③ 已有洞 → 新目标（v0.3.18-beta3 根因 A：**按目标身份配对**，而非按最近几何）
    focusHoldUntilRef.current = 0 // 非基础态过渡 → 截止时间作废
    const curKeys = curKeysRef.current
    const usedCur = new Set<number>()
    const matchedDest = new Set<number>()
    const planPairs: Array<{ ci: number; ti: number }> = []
    // (1) 身份配对：同一个目标选择器 → 同一个洞（持续存在的目标洞原地保持/仅做自身几何插值）
    for (let ti = 0; ti < dest.length; ti++) {
      const k = destKeysIn[ti]
      if (k == null) continue
      const ci = curKeys.findIndex((ck, i) => ck != null && ck === k && !usedCur.has(i))
      if (ci >= 0) {
        usedCur.add(ci)
        matchedDest.add(ti)
        planPairs.push({ ci, ti })
      }
    }
    /**
     * (2) 无任何身份交集（整组替换：单元3 i2→i3 我方网格→参考网格、spotlightCarry 跨阶段续接、
     * carry 洞 key=null 等）→ 回退到既有「最近中心匹配 + transfer」语义（e2e 的 transfer/首帧非整页断言依赖）。
     */
    const useNearest = planPairs.length === 0 && cur.length > 0 && dest.length > 0
    if (useNearest) {
      for (let ti = 0; ti < dest.length; ti++) {
        let best = -1
        let bestD = Infinity
        for (let ci = 0; ci < cur.length; ci++) {
          if (usedCur.has(ci)) continue
          const d = dist(cur[ci]!, dest[ti]!)
          if (d < bestD) {
            bestD = d
            best = ci
          }
        }
        if (best >= 0) {
          usedCur.add(best)
          matchedDest.add(ti)
          planPairs.push({ ci: best, ti })
        }
      }
    }
    const newAnims: AnimHole[] = []
    const newKeys: (string | null)[] = []
    let hasAdd = false
    let hasBlur = false
    let hasTransfer = false
    for (const { ci, ti } of planPairs) {
      // 注意：即使几何已一致也必须保留为洞（from==to 的静态动画），
      // 否则该洞会从 anims 列表里消失 → 表现为“只有最后一个目标被突显”。
      newAnims.push(mk(cur[ci]!, dest[ti]!, 'transfer'))
      newKeys.push(destKeysIn[ti] ?? null)
      if (!sameRect(cur[ci]!, dest[ti]!)) hasTransfer = true
    }
    // (3) 新增目标：在**自身位置**从中心向外生长（不得从其它目标处飞来）
    for (let ti = 0; ti < dest.length; ti++) {
      if (matchedDest.has(ti)) continue
      newAnims.push(mk(centerRect(dest[ti]!), dest[ti]!, 'add'))
      newKeys.push(destKeysIn[ti] ?? null)
      hasAdd = true
    }
    // (4) 未配对的旧洞：
    //   · 身份模式 → **原地**缩小至消失（不得移动去补新增目标）；
    //   · 完全替换（无身份交集）→ 保留既有「并入最近保留目标」的 transfer 语义。
    for (let ci = 0; ci < cur.length; ci++) {
      if (usedCur.has(ci)) continue
      if (useNearest && planPairs.some((p) => p.ci >= 0)) {
        let best = -1
        let bestD = Infinity
        for (const p of planPairs) {
          const d = dist(cur[ci]!, dest[p.ti]!)
          if (d < bestD) {
            bestD = d
            best = p.ti
          }
        }
        newAnims.push(mk(cur[ci]!, dest[best]!, 'blur'))
        newKeys.push(destKeysIn[best] ?? null)
      } else {
        newAnims.push(mk(cur[ci]!, centerRect(cur[ci]!), 'blur'))
        newKeys.push(null)
      }
      hasBlur = true
    }
    if (newAnims.length === 0) {
      settleAt(dest, destKeysIn)
      return
    }
    const label: AnimLabel = hasAdd ? 'add' : hasBlur ? 'blur' : hasTransfer ? 'transfer' : 'none'
    label0(label)
    pendingKeysRef.current = newKeys
    animsRef.current = newAnims.map((a) => ({ ...a, label }))
    runLoop()
  }

  /* ---------- 目标变化 → 规划动画 ---------- */
  const sig = `${active ? 1 : 0}|${dimOnly ? 1 : 0}|${modalOpen ? 1 : 0}|${destPairs
    .map((p) => `${p.key}@${Math.round(p.rect.left)},${Math.round(p.rect.top)},${Math.round(p.rect.width)},${Math.round(p.rect.height)}`)
    .join(';')}`
  const prevSigRef = useRef('')
  // 布局期规划：场景/目标切换在浏览器绘制前完成规划（首帧即用新几何，避免“旧洞闪一下”）
  useLayoutEffect(() => {
    if (sig === prevSigRef.current) return
    // 目标选择器非空但尚未测到 → 不规划（等测量到位后 sig 变化再规划），避免误判为取消
    if (wantTargets && destRects.length === 0) return
    // v0.3.18-beta3 根因 B：弹窗期**冻结**上一份几何（不发布“无目标+整页洞”的中间帧），
    // 关闭弹窗时 sig 因 modalOpen 变化而重新触发规划。
    if (modalOpen) {
      prevSigRef.current = sig
      return
    }
    prevSigRef.current = sig
    plan(destPairs)
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
    const nextT = measurePairs(effTargetsRef.current)
    setMeasuredPairs((prev) => (samePairList(prev, nextT) ? prev : nextT))
    const nextE = measureEscapeRects()
    setEscapes((prev) => (sameRectList(prev, nextE) ? prev : nextE))
  })

  useLayoutEffect(() => {
    const measure = () => {
      setMeasuredPairs(measurePairs(effTargetsRef.current))
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
  const rects = frame.rects
  const animating = frame.anim !== 'none'
  /** 阻断层是否生效：遮罩激活（active）且调用方允许阻断（block）。
   *  v0.3.18-beta2 item 1：只要 active，**任何一帧**（含基础态洞=整页、focus 静止期、过渡帧、
   *  dim/bubble-only）都必须有阻断层覆盖非豁免区；基础态/自由对局（active=false）完全不阻断。 */
  const blockActive = active && block && !modalOpen
  const mode: 'dim' | 'holes' | 'hybrid' = dim ? (dimOnly ? 'dim' : 'hybrid') : 'holes'
  /** 纯 dim 且动画静止：渲染整屏暗层（气泡 z 豁免）；过渡期（含切到气泡）由空洞引擎承担 */
  const renderDimLayer = dimOnly && !animating && idle

  /** 统一加 PAD（外扩 6px 呼吸空间） */
  const padRect = (r: TargetRect): TargetRect => ({
    left: Math.max(0, r.left - PAD),
    top: Math.max(0, r.top - PAD),
    width: Math.min(W, r.left + r.width + PAD) - Math.max(0, r.left - PAD),
    height: Math.min(H, r.top + r.height + PAD) - Math.max(0, r.top - PAD),
  })
  // v0.3.18-beta2 item 5：**洞几何只含被突显对象**（引擎动画几何），不再并入 .tutorial-escape：
  // 退出按钮/横幅卡片的可见性与可点性改由「结构化置顶」(TutorialEscape → 顶层 portal, z 240) 保证，
  // 因此无需再为它们开洞（也让多来源的亚像素差异不再进入洞几何，见 item 6）。
  const paddedAll = rects.map(padRect)
  // 用「去重叠分解」而非包围盒合并：并集边界随动画连续变化，融合瞬间不再跳变（item 4）。
  const visualHoles = disjointHoleRects(paddedAll)

  /**
   * 阻断带补集（item 1 修复）：**一律按「最终目标 ∪ 豁免元素」计算，而不是按当前动画几何**。
   * 旧实现用 `rects`（动画几何）——focus 静止期内 rects 还是整页洞，补集被算成空 → 一个
   * `.tutorial-block` 都不剩（37/49 帧无阻断，遮罩下元素可点）。现在：
   *  - 目标（destRects）与豁免元素永不阻断（动画途中目标也可点）；
   *  - 其余区域恒被阻断；`active=false`（基础态/自由对局）时才完全不阻断。
   */
  // 注意：这里**不做 mergeHoleRects**——合并会把多个目标吞成一个大包围盒，
  // 把目标之间本应阻断的空隙也点亮（漏阻断）。BlockBands 内部按 y 区间并集求补集，天然支持重叠。
  const blockHoles = [...destRects, ...mergedEscapes].map(padRect)

  const framePath = `M0 0 H${W} V${H} H0 Z`
  // v0.3.18-beta1：空洞改为 3px 圆角矩形。先由切片还原「并集边界」，再对边界顶点圆角 ——
  // 切片之间的内部接缝没有顶点，因此不会出现“糖葫芦”式缺口/缝隙（详见 spotlightMerge.unionOutlinePath）。
  const holePath = unionOutlinePath(visualHoles, { width: W, height: H, radius: HOLE_RADIUS })
  const rectsToAttr = (list: TargetRect[]) =>
    list
      .map(
        (r) =>
          `${Math.round(r.left * 10) / 10},${Math.round(r.top * 10) / 10},${Math.round(r.width * 10) / 10},${Math.round(r.height * 10) / 10}`,
      )
      .join(';')
  /** 供 e2e/QA 读取的「视觉洞矩形（去重叠切片，未圆角）」列表 —— 面积口径与旧 path 解析一致，
   *  v0.3.18-beta1 空洞改为圆角路径后，path 不再由 `M…H…V…H…Z` 构成，度量请改读本属性。 */
  const rectsAttr = rectsToAttr(visualHoles)
  /** v0.3.18-beta3：洞 ↔ 目标的身份键（与 -rects 的洞、与 -dest 的目标同序），供 e2e 验证“原地保持” */
  const holeKeysAttr = curKeysRef.current.map((k) => k ?? '-').join('|')
  const destKeysAttr = destKeys.join('|')
  /** 供 e2e 校验缓动曲线：**动画插值中的原始洞矩形**（未加 PAD、未并入豁免、未圆角） */
  const animRectsAttr = rectsToAttr(rects)

  // v0.3.18-beta3：弹窗期仍渲染遮罩（QA：弹窗期遮罩需在位且含 path），但：
  //  · **沿用当前（冻结的）几何** —— 不再发布「无目标 + 整页洞」的中间帧（根因 B）；
  //  · `-block=0` 且不渲染阻断带（QA：弹窗期阻断带为 0）。
  // 规划在弹窗期被跳过（见 plan 的 layout effect），因此这里的几何就是弹窗打开前的那一份。
  if (modalOpen) {
    return (
      <svg
        className={['tutorial-spotlight', dim ? 'tutorial-spotlight--dim' : ''].filter(Boolean).join(' ')}
        data-spotlight-mode={mode}
        data-spotlight-anim={frame.anim}
        data-spotlight-holes={visualHoles.length}
        data-spotlight-holes-raw={rects.length}
        data-spotlight-rects={rectsAttr}
        data-spotlight-anim-rects={animRectsAttr}
        data-spotlight-hole-keys={holeKeysAttr}
        data-spotlight-dest-keys={destKeysAttr}
        data-spotlight-dest={destRects
          .map((r) => `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}`)
          .join(';')}
        data-spotlight-sel={engineTargets.join('|')}
        data-spotlight-block="0"
        width={W}
        height={H}
        aria-hidden="true"
      >
        <path d={`${framePath} ${holePath}`} fillRule="evenodd" fill={DARK} />
      </svg>
    )
  }

  if (renderDimLayer) {
    return (
      <>
        <div
          className="tutorial-spotlight tutorial-spotlight--dim tutorial-spotlight--sheet"
          data-spotlight-mode="dim"
          data-spotlight-anim="none"
          data-spotlight-holes={1}
          data-spotlight-holes-raw={0}
          data-spotlight-rects={rectsAttr}
          data-spotlight-anim-rects={animRectsAttr}
        data-spotlight-hole-keys={holeKeysAttr}
        data-spotlight-dest-keys={destKeysAttr}
          data-spotlight-dest={destRects
            .map((r) => `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}`)
            .join(';')}
          data-spotlight-sel={engineTargets.join('|')}
          data-spotlight-block={blockActive ? '1' : '0'}
          aria-hidden="true"
        />
        {/* 阻断带 = 「目标洞 + 豁免元素」的补集（恒按目标几何，见 blockHoles 注释）。
            豁免元素（.tutorial-escape 退出按钮等）所在区域不被阻断，且它们结构性置顶（z 240），
            因此即便祖先带 transform 也不会被阻断带/遮罩挡住。 */}
        {blockActive ? <BlockBands holes={blockHoles} W={W} H={H} /> : null}
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
        data-spotlight-rects={rectsAttr}
        data-spotlight-anim-rects={animRectsAttr}
        data-spotlight-hole-keys={holeKeysAttr}
        data-spotlight-dest-keys={destKeysAttr}
        data-spotlight-dest={destRects
          .map((r) => `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}`)
          .join(';')}
        data-spotlight-sel={engineTargets.join('|')}
        data-spotlight-block={blockActive ? '1' : '0'}
        width={W}
        height={H}
        aria-hidden="true"
      >
        <path d={`${framePath} ${holePath}`} fillRule="evenodd" fill={DARK} />
      </svg>
      {blockActive ? <BlockBands holes={blockHoles} W={W} H={H} /> : null}
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
    // v0.3.18-beta2 item 1：本片内**把所有洞的 y 区间并起来**，再输出其补集。
    // 旧实现只取 [min(top), max(bottom)] 一条“洞带”，当同一片里有多个高度不同的洞
    // （单元2 待选栏 + 网格、单元3 气泡 + 空网格）时，洞与洞之间的空隙既没开洞也没阻断 → 可点漏区。
    const spans = inSlice
      .map((r) => [Math.max(0, r.top), Math.min(H, r.top + r.height)] as [number, number])
      .sort((a, b) => a[0] - b[0])
    let cursor = 0
    for (const [top, bottom] of spans) {
      if (top > cursor) blocks.push({ left: x0, top: cursor, width: w, height: top - cursor })
      cursor = Math.max(cursor, bottom)
    }
    if (cursor < H) blocks.push({ left: x0, top: cursor, width: w, height: H - cursor })
  }
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
