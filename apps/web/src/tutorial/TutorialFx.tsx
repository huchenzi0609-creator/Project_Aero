/**
 * TutorialFx —— 教程通用提示（v0.3.13；v0.3.18-beta1 重新设计）。
 *
 * <成功提示>：网页四周边缘亮起深绿**光带**（快速点亮 / 缓缓熄灭）+ playSfx('success')；
 * <失败提示>：同样亮起深红光带 + playSfx('failure')。
 *
 * v0.3.18-beta1 视觉规格（用户逐条要求）：
 * - 边带**加宽**：BW = 16px（原 5px 实心条）；
 * - **内四角 3px 圆角**：四条带用 path 绘制，只在朝向画面内部的角上做 3px 圆角（外侧为屏幕边，无需圆角），
 *   与遮罩空洞的 3px 圆角语言一致；
 * - **由外到内透明度非线性升高**：每条带用一条 linearGradient，外侧最实、向内柔和淡出
 *   （停靠点 0% .95 / 28% .5 / 62% .16 / 100% 0，模拟灯光漫反射）；
 * - **快速点亮、缓缓熄灭**：CSS 过渡（点亮 110ms ease-out / 熄灭 820ms ease-in-out，见 tutorial.css）；
 * - **整体时长变长**：--on 保持 1250ms（原 700ms），加上熄灭过渡总可见时长 ≈ 2.0s。
 *
 * class 契约不变：`.tutorial-fx` / `.tutorial-fx--success` / `.tutorial-fx--failure` / `.tutorial-fx--on`；
 * 一轮提示 = 一次 --on 上升沿（e2e 的幂等计数依赖此语义）。
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { audioService } from '../lib/audioService'

export type FxKind = 'success' | 'failure'

export interface TutorialFxHandle {
  kind: FxKind | null
  seq: number
}

/** --on 保持时长（ms）：需覆盖“点亮 + 保持”，熄灭由 CSS 过渡在 on=false 后完成 */
const FX_ON_MS = 1250
/** 边带宽度（px，向外发散的可见带） */
const FX_BAND = 16
/** 内四角圆角半径（px，与空洞 3px 语言一致） */
const FX_RADIUS = 3

export function useTutorialFx(): { fx: TutorialFxHandle; flash: (kind: FxKind) => void } {
  const [fx, setFx] = useState<TutorialFxHandle>({ kind: null, seq: 0 })
  const flash = useCallback((kind: FxKind) => {
    setFx((prev) => ({ kind, seq: prev.seq + 1 }))
    audioService.playSfx(kind)
  }, [])
  return { fx, flash }
}

/** 光带四条 path：外侧贴屏幕边（直角），朝向画面内部的角做 3px 圆角 */
function bandPaths(w: number, h: number, bw: number, k: number) {
  const r = Math.max(0, Math.min(k, bw / 2, w / 2, h / 2))
  const x1 = w - bw
  const y1 = h - bw
  return {
    top: `M0 0 H${w} V${bw} H0 Z`,
    bottom: `M0 ${y1} H${w} V${h} H0 Z`,
    // 左侧带：上/下内角圆角（向右下 / 向左下转入内部）
    left: `M0 ${bw} H${bw - r} A${r} ${r} 0 0 1 ${bw} ${bw + r} V${y1 - r} A${r} ${r} 0 0 1 ${bw - r} ${y1} H0 Z`,
    // 右侧带：内角方向相反（sweep=0）
    right: `M${w} ${bw} H${x1 + r} A${r} ${r} 0 0 0 ${x1} ${bw + r} V${y1 - r} A${r} ${r} 0 0 0 ${x1 + r} ${y1} H${w} Z`,
  }
}

interface GradientsProps {
  id: string
}

/** 四条带各自的「由外到内逐渐变淡」渐变（objectBoundingBox，随元素 bbox 自适应） */
function FxGradients({ id }: GradientsProps) {
  const stops = (
    <>
      <stop offset="0%" stopColor="currentColor" stopOpacity="0.95" />
      <stop offset="28%" stopColor="currentColor" stopOpacity="0.5" />
      <stop offset="62%" stopColor="currentColor" stopOpacity="0.16" />
      <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
    </>
  )
  return (
    <defs>
      <linearGradient id={`${id}-top`} x1="0" y1="0" x2="0" y2="1">
        {stops}
      </linearGradient>
      <linearGradient id={`${id}-bottom`} x1="0" y1="1" x2="0" y2="0">
        {stops}
      </linearGradient>
      <linearGradient id={`${id}-left`} x1="0" y1="0" x2="1" y2="0">
        {stops}
      </linearGradient>
      <linearGradient id={`${id}-right`} x1="1" y1="0" x2="0" y2="0">
        {stops}
      </linearGradient>
    </defs>
  )
}

/** 边带提示渲染（由 fx.seq 变化触发一次「快速点亮 → 缓缓熄灭」） */
export function TutorialFxBand({ fx }: { fx: TutorialFxHandle }) {
  const [on, setOn] = useState(false)
  const [size, setSize] = useState(() => ({
    w: typeof window !== 'undefined' ? window.innerWidth : 0,
    h: typeof window !== 'undefined' ? window.innerHeight : 0,
  }))
  const timerRef = useRef(0)
  const gid = useId().replace(/[^a-zA-Z0-9_-]/g, '')

  useEffect(() => {
    if (!fx.kind || fx.seq === 0) return
    setOn(true)
    window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => setOn(false), FX_ON_MS)
    return () => window.clearTimeout(timerRef.current)
  }, [fx.seq, fx.kind])

  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  if (!fx.kind) return null
  const cls = ['tutorial-fx', `tutorial-fx--${fx.kind}`, on ? 'tutorial-fx--on' : ''].filter(Boolean).join(' ')
  const p = bandPaths(size.w, size.h, FX_BAND, FX_RADIUS)
  return (
    <div className={cls} aria-hidden="true" data-fx-band={FX_BAND} data-fx-radius={FX_RADIUS}>
      <svg className="tutorial-fx__svg" viewBox={`0 0 ${size.w} ${size.h}`} preserveAspectRatio="none">
        <FxGradients id={gid} />
        <path d={p.top} fill={`url(#${gid}-top)`} />
        <path d={p.bottom} fill={`url(#${gid}-bottom)`} />
        <path d={p.left} fill={`url(#${gid}-left)`} />
        <path d={p.right} fill={`url(#${gid}-right)`} />
      </svg>
    </div>
  )
}
