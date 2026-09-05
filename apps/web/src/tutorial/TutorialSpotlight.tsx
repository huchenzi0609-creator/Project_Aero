/**
 * TutorialSpotlight —— 遮罩突显（v0.3.0，docs/tutorial-spec-v030.md §4/§6）。
 * - 半透明遮罩铺满窗口，目标区域"开洞"（上/下/左/右四块暗层，洞即目标外扩区）；
 * - 目标定位：selector → getBoundingClientRect（步目标变化/视口变化时重算）；
 * - target=null 时整层暗化（对话步弱化背景但不挡操作）。
 */
import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'

export interface TargetRect {
  left: number
  top: number
  width: number
  height: number
}

/** 根据 DOM selector 求目标矩形（全屏 fixed 层与页面同坐标系） */
function targetRectOf(selector: string | null): TargetRect | null {
  if (!selector) return null
  const el = document.querySelector(selector)
  if (!el) return null
  const b = el.getBoundingClientRect()
  if (b.width === 0 || b.height === 0) return null
  return { left: b.left, top: b.top, width: b.width, height: b.height }
}

const PAD = 6 // 开洞外扩（目标呼吸空间）

export function TutorialSpotlight({ target }: { target: string | null }) {
  const [rect, setRect] = useState<TargetRect | null>(null)
  const targetRef = useRef(target)
  targetRef.current = target

  useEffect(() => {
    const measure = () => setRect(targetRectOf(targetRef.current))
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

  if (!target) return <div className="tutorial-spotlight tutorial-spotlight--dim" aria-hidden="true" />
  if (!rect) return null

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
