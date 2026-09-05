/**
 * TutorialSpotlight —— 遮罩突显（v0.3.0 / v0.3.2）。
 * - 半透明遮罩铺满窗口，对每个突显目标"开洞"（上/下/左/右四块暗层，洞即目标外扩区）；
 * - 支持同时突显多个目标（target: string | string[]，如单元3 T3-3 参考网格 + 空网格）；
 *   多目标各自独立开洞层渲染（目标不相交时不互相覆盖）。
 * - z-index 低于教程弹窗（.paper-modal），弹窗为豁免对象不被压暗。
 */
import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'

export interface TargetRect {
  left: number
  top: number
  width: number
  height: number
}

/** 根据 DOM selector 求目标矩形（全屏 fixed 层与页面同坐标系）；隐藏目标返回 null */
function targetRectOf(selector: string): TargetRect | null {
  const el = document.querySelector(selector)
  if (!el) return null
  const b = el.getBoundingClientRect()
  if (b.width === 0 || b.height === 0) return null
  return { left: b.left, top: b.top, width: b.width, height: b.height }
}

const PAD = 6 // 开洞外扩（目标呼吸空间）

function HoleLayer({ rect }: { rect: TargetRect }) {
  const L = Math.max(0, rect.left - PAD)
  const T = Math.max(0, rect.top - PAD)
  const R = Math.min(window.innerWidth, rect.left + rect.width + PAD)
  const B = Math.min(window.innerHeight, rect.top + rect.height + PAD)
  const band = (s: CSSProperties): CSSProperties => s
  return (
    <div className="tutorial-spotlight" aria-hidden="true">
      <div style={band({ position: 'absolute', left: 0, top: 0, right: 0, height: T })} />
      <div style={band({ position: 'absolute', left: 0, top: B, right: 0, bottom: 0 })} />
      <div style={band({ position: 'absolute', left: 0, top: T, width: L, height: B - T })} />
      <div style={band({ position: 'absolute', right: 0, top: T, width: Math.max(0, window.innerWidth - R), height: B - T })} />
    </div>
  )
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
    measure()
    const t = window.setTimeout(measure, 80) // 目标可能晚一帧就位
    const t2 = window.setTimeout(measure, 400)
    window.addEventListener('resize', measure)
    return () => {
      window.clearTimeout(t)
      window.clearTimeout(t2)
      window.removeEventListener('resize', measure)
    }
  }, [target])

  if (targets.length === 0) {
    return <div className="tutorial-spotlight tutorial-spotlight--dim" aria-hidden="true" />
  }
  if (rects.length === 0) return null
  return (
    <>
      {rects.map((r, i) => (
        <HoleLayer key={i} rect={r} />
      ))}
    </>
  )
}
