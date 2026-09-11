/**
 * TutorialSpotlight —— 遮罩突显（v0.3.3 重写）。
 *
 * 实现要点：
 * - **无突显目标时渲染 null**（页面完全不被压暗）；"取消当前突显"= 目标 null → 全亮。
 * - **单层遮罩 + 多开洞**：一个铺满视口的半透明 SVG path（fill-rule=evenodd）——
 *   外圈整屏矩形 + 每个突显目标一个洞子路径，多目标（如单元3 T3-3 双目标）
 *   亮度与单目标一致、绝不叠加。
 * - **开洞随目标变化**：对每个目标元素挂 ResizeObserver（气泡分段/锚点变化即时重测）
 *   并保留 window resize 监听。
 * - z-index 低于教程弹窗（.paper-modal 60），弹窗为豁免对象不被压暗。
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
const DARK = 'rgba(58, 46, 28, 0.5)'

/** 求目标矩形；隐藏目标返回 null */
function targetRectOf(selector: string): TargetRect | null {
  const el = document.querySelector(selector)
  if (!el) return null
  const b = el.getBoundingClientRect()
  if (b.width === 0 || b.height === 0) return null
  return { left: b.left, top: b.top, width: b.width, height: b.height }
}

export function TutorialSpotlight({
  target,
  dim = false,
}: {
  target?: string | string[] | null
  /** 整屏压暗、无洞（气泡突显专用：target 忽略）。false 时 target 为空 = 不渲染遮罩 */
  dim?: boolean
}) {
  const targets = Array.isArray(target) ? target : target ? [target] : []
  const [rects, setRects] = useState<TargetRect[]>([])
  const targetsRef = useRef(targets)
  targetsRef.current = targets
  /** 纵深防护（v0.3.13 加固）：任何弹窗打开期间都不渲染阻断带/暗层，弹窗永不被教程层拦截 */
  const modalOpen = useAnyModalOpen()

  useEffect(() => {
    const measure = () => {
      const out: TargetRect[] = []
      for (const sel of targetsRef.current) {
        const r = targetRectOf(sel)
        if (r) out.push(r)
      }
      setRects(out)
    }

    // 直接测量 + 延迟再测（目标可能晚一帧就位）+ 目标尺寸/位置变化即时跟随
    measure()
    const timers = [window.setTimeout(measure, 80), window.setTimeout(measure, 400)]
    const observed = new Set<Element>()
    const ro = new ResizeObserver(() => measure())
    for (const sel of targetsRef.current) {
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
  }, [target])

  // 弹窗打开期间一律不渲染（阻断带/暗层都不出现），弹窗按钮可 100% 真实点击
  if (modalOpen) return null

  // dim：整屏暗层（无洞）——模态语义：整屏阻断交互（气泡/退出按钮 z 更高，仍可点）
  if (dim) {
    return (
      <>
        <div className="tutorial-spotlight tutorial-spotlight--dim" aria-hidden="true" />
        <div className="tutorial-block" aria-hidden="true" />
      </>
    )
  }
  if (targets.length === 0 || rects.length === 0) return null

  // 先对洞矩形（含 PAD 外扩）做并集合并：保证洞互不重叠，evenodd 下单层亮度始终一致
  // （重叠洞子路径在 evenodd 下会被反向填充而变暗 —— v0.3.5 修复）
  const W = window.innerWidth
  const H = window.innerHeight
  const outer = rects
    .map((r) => ({
      left: Math.max(0, r.left - PAD),
      top: Math.max(0, r.top - PAD),
      right: Math.min(W, r.left + r.width + PAD),
      bottom: Math.min(H, r.top + r.height + PAD),
    }))
    .map((r) => ({ left: r.left, top: r.top, width: r.right - r.left, height: r.bottom - r.top }))
  const merged = mergeHoleRects(outer)
  const frame = `M0 0 H${W} V${H} H0 Z`
  const holes = merged
    .map((r) => `M${r.left} ${r.top} H${r.left + r.width} V${r.top + r.height} H${r.left} Z`)
    .join(' ')

  // 模态交互阻断（v0.3.13）：除突显区外不可点/不可拖。
  // 实现：按所有洞的 x 边界做纵向切片，每片只阻断该片内洞上下方的区域
  // （洞之间的小空隙可能被一并阻断，但绝不阻断任何突显目标本身）。
  // 逐洞各围四带不可行：一个洞的整幅横带会盖住另一个洞。
  // 气泡（z 210）与退出按钮（.tutorial-escape z 160）高于阻断带（z 150）仍可交互。
  const xs = Array.from(
    new Set([0, W, ...merged.flatMap((r) => [r.left, r.left + r.width])]),
  ).sort((a, b) => a - b)
  const blocks: Array<{ left: number; top: number; width: number; height: number }> = []
  for (let i = 0; i < xs.length - 1; i++) {
    const x0 = xs[i]!
    const x1 = xs[i + 1]!
    const w = x1 - x0
    if (w <= 0) continue
    const inSlice = merged.filter((r) => r.left < x1 && r.left + r.width > x0)
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
      <svg className="tutorial-spotlight" width={W} height={H} aria-hidden="true">
        <path d={`${frame} ${holes}`} fillRule="evenodd" fill={DARK} />
      </svg>
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
