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

export function TutorialSpotlight({ target }: { target?: string | string[] | null }) {
  const targets = Array.isArray(target) ? target : target ? [target] : []
  const [rects, setRects] = useState<TargetRect[]>([])
  const targetsRef = useRef(targets)
  targetsRef.current = targets

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

  if (targets.length === 0 || rects.length === 0) return null

  // 单层 SVG：外圈矩形 + evenodd 挖洞（多洞不叠加亮度）
  const W = window.innerWidth
  const H = window.innerHeight
  const frame = `M0 0 H${W} V${H} H0 Z`
  const holes = rects
    .map((r) => {
      const l = Math.max(0, r.left - PAD)
      const t = Math.max(0, r.top - PAD)
      const rr = Math.min(W, r.left + r.width + PAD)
      const b = Math.min(H, r.top + r.height + PAD)
      return `M${l} ${t} H${rr} V${b} H${l} Z`
    })
    .join(' ')

  return (
    <svg className="tutorial-spotlight" width={W} height={H} aria-hidden="true">
      <path d={`${frame} ${holes}`} fillRule="evenodd" fill={DARK} />
    </svg>
  )
}
