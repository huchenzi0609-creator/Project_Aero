/**
 * TutorialSpotlight —— 遮罩突显（v0.3.3 重写，v0.3.13 模态化，v0.3.14 混合模式，v0.3.16 淡入淡出）。
 *
 * 实现要点：
 * - **无突显目标时渲染 null**（页面完全不被压暗）；"取消当前突显"= 目标 null → 全亮。
 * - **单层遮罩 + 多开洞**：一个铺满视口的半透明 SVG path（fill-rule=evenodd）——
 *   外圈整屏矩形 + 每个突显目标一个洞子路径，多目标亮度与单目标一致、绝不叠加。
 * - **dim 与洞可同时存在**（混合模式）：`dim` = 整屏压暗，`target` = 开洞处露出版面；
 *   两者同时给出即「<突显对话气泡>并且<突显目标>」（气泡 z 210 高于遮罩，豁免可见/可点）。
 * - **交互阻断（模态）**：阻断带 = 交互洞（突显目标 + `.tutorial-escape` 豁免元素）的补集，
 *   洞内可点/可拖、洞外阻断；气泡与退出按钮始终可交互。
 * - **淡入淡出（v0.3.16）**：进入/换目标时用 WAAPI 播 160ms ease-out 淡入；取消突显时组件
 *   自身滞留 170ms 并过渡到 opacity 0（滞留期间不渲染阻断带，语义等同已取消突显），
 *   避免硬切闪烁；`active` 由调用方传入，遮罩元素始终单实例（不重挂载、不残留旧节点）。
 */
import { useEffect, useRef, useState } from 'react'
import { mergeHoleRects } from './spotlightMerge'
import { useAnyModalOpen } from './useAnyModalOpen'

export interface TargetRect {
  left: number
  top: number
  width: number
  height: number
}

const PAD = 6 // 开洞外扩（目标呼吸空间）
const DARK = 'rgba(58, 46, 28, 0.52)'
const FADE_IN_MS = 160
const FADE_OUT_MS = 170

/** 求目标矩形；隐藏目标返回 null */
function targetRectOf(selector: string): TargetRect | null {
  const el = document.querySelector(selector)
  if (!el) return null
  const b = el.getBoundingClientRect()
  if (b.width === 0 || b.height === 0) return null
  return { left: b.left, top: b.top, width: b.width, height: b.height }
}

export function TutorialSpotlight({
  /** 是否处于突显状态；false 时若处于淡出滞留窗口内仍会渲染淡出，之后返回 null */
  active = true,
  target,
  dim = false,
  block = true,
  measureKey,
}: {
  active?: boolean
  target?: string | string[] | null
  /** 整屏压暗、无洞（气泡突显专用：target 忽略）。false 时 target 为空 = 不渲染遮罩 */
  dim?: boolean
  /**
   * 是否附加模态交互阻断带（默认 true）。dim 场景下若玩家仍需操作页面
   * （如摆阵「thanks / 阵形非法」气泡期间要挪动或旋转飞机），传 block={false}：只压暗、不阻断。
   */
  block?: boolean
  /** 目标元素尺寸/位置随场景变化但选择器不变时（如 5×5 ↔ 10×10 同为 `.u1-grid`），
   *  传入变化值即可强制重新测量（不重挂载组件）。 */
  measureKey?: string | number
}) {
  const targets = Array.isArray(target) ? target : target ? [target] : []
  const [rects, setRects] = useState<TargetRect[]>([])
  const [escapeRects, setEscapeRects] = useState<TargetRect[]>([])
  /** 纵深防护（v0.3.13 加固）：任何弹窗打开期间都不渲染阻断带/暗层，弹窗永不被教程层拦截 */
  const modalOpen = useAnyModalOpen()

  /* ---------- 淡出滞留（v0.3.16） ----------
     用「state 渲染位 + 状态机」而非 render 期改 ref：StrictMode 双渲染下 render 期改 ref 会让
     取消突显的那一帧直接不渲染（DOM 被卸载 → CSS 过渡失效）。此处 rendered 在 active 变 false 时
     仍为 true（同一 DOM 节点），故 `.tutorial-spotlight--leaving` 能真正从 opacity 1 过渡到 0；
     FADE_OUT_MS 后再卸载。 */
  const [rendered, setRendered] = useState(active)
  useEffect(() => {
    if (active) {
      setRendered(true)
      return
    }
    if (!rendered) return
    const t = window.setTimeout(() => setRendered(false), FADE_OUT_MS)
    return () => window.clearTimeout(t)
  }, [active, rendered])
  const leaving = !active && rendered
  const show = rendered

  /** 淡出期间沿用最后一次激活的形态（目标 / 是否 dim），避免掉洞或整屏黑一下 */
  const lastShapeRef = useRef<{ targets: string[]; dim: boolean }>({ targets, dim })
  if (active) lastShapeRef.current = { targets, dim }
  const effTargets = active ? targets : lastShapeRef.current.targets
  const effDim = active ? dim : lastShapeRef.current.dim
  const effTargetsRef = useRef(effTargets)
  effTargetsRef.current = effTargets

  /* ---------- 目标测量（含豁免元素） ---------- */
  useEffect(() => {
    if (!show) return
    const measure = () => {
      const out: TargetRect[] = []
      for (const sel of effTargetsRef.current) {
        const r = targetRectOf(sel)
        if (r) out.push(r)
      }
      setRects(out)
      // 豁免元素（左上角退出按钮等，标识 .tutorial-escape）永远不参与阻断：
      // 其矩形作为“交互洞”并入阻断补集（v0.3.14 item 3：dim / 混合 / 挖洞三种模式一律放行）
      const es: TargetRect[] = []
      for (const el of Array.from(document.querySelectorAll('.tutorial-escape'))) {
        const b = el.getBoundingClientRect()
        if (b.width > 0 && b.height > 0) {
          es.push({ left: b.left, top: b.top, width: b.width, height: b.height })
        }
      }
      setEscapeRects(es)
    }

    // 直接测量 + 延迟再测（目标可能晚一帧就位）+ 目标尺寸/位置变化即时跟随
    measure()
    const timers = [window.setTimeout(measure, 80), window.setTimeout(measure, 400)]
    const observed = new Set<Element>()
    const ro = new ResizeObserver(() => measure())
    for (const sel of effTargetsRef.current) {
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
  }, [active, show, target, measureKey])

  /* ---------- 淡入：首次 / 换模式 / 换洞时播一次 ease-out（不重挂载） ---------- */
  const rootRef = useRef<HTMLElement | null>(null)
  const fadeKey = `${effDim ? 'dim' : 'holes'}|${rects
    .map((r) => `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}`)
    .join(';')}`
  useEffect(() => {
    const el = rootRef.current
    if (!el || !active || leaving || typeof el.animate !== 'function') return
    const anim = el.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: FADE_IN_MS,
      easing: 'ease-out',
    })
    return () => anim.cancel()
  }, [fadeKey, active, leaving])

  // 弹窗打开期间一律不渲染（阻断带/暗层都不出现），弹窗按钮可 100% 真实点击
  if (modalOpen || !show) return null

  /** 目标洞（含 PAD 外扩 + 并集合并）：evenodd 下单层亮度一致（重叠洞会反向填充变暗 —— v0.3.5） */
  const W = window.innerWidth
  const H = window.innerHeight
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
  const visualHoles = rects.length > 0 ? padMerge(rects) : []
  /** 交互洞 = 突显目标 + 豁免元素（豁免元素永不被阻断） */
  const interactiveHoles = padMerge([...rects, ...escapeRects])
  // 淡出期间目标已消失（旧选择器不再命中）→ 直接隐藏，避免整屏压暗闪一下
  if (leaving && visualHoles.length === 0 && !effDim) return null

  const rootClass = ['tutorial-spotlight', leaving ? 'tutorial-spotlight--leaving' : '']
    .filter(Boolean)
    .join(' ')

  // dim 且无突显目标 = 纯气泡突显：整屏暗层（无视觉洞）
  if (effDim && visualHoles.length === 0) {
    return (
      <>
        <div
          ref={rootRef as React.RefObject<HTMLDivElement>}
          className={`${rootClass} tutorial-spotlight--dim`}
          data-spotlight-mode="dim"
          aria-hidden="true"
        />
        {block && active && !leaving ? <BlockBands holes={interactiveHoles} W={W} H={H} /> : null}
      </>
    )
  }
  if (visualHoles.length === 0) return null

  // 其余两种：<突显目标>（挖洞）/ 混合模式（整屏压暗 + 开洞）
  const frame = `M0 0 H${W} V${H} H0 Z`
  const holes = visualHoles
    .map((r) => `M${r.left} ${r.top} H${r.left + r.width} V${r.top + r.height} H${r.left} Z`)
    .join(' ')

  return (
    <>
      <svg
        ref={rootRef as React.RefObject<SVGSVGElement>}
        className={rootClass}
        data-spotlight-mode={effDim ? 'hybrid' : 'holes'}
        width={W}
        height={H}
        aria-hidden="true"
      >
        <path d={`${frame} ${holes}`} fillRule="evenodd" fill={DARK} />
      </svg>
      {block && active && !leaving ? <BlockBands holes={interactiveHoles} W={W} H={H} /> : null}
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
  return (
    <>
      {blocks.map((b, i) => (
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
