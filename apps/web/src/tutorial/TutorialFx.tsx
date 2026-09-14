/**
 * TutorialFx —— 教程通用提示（v0.3.13；v0.3.18-beta1 重新设计）。
 *
 * <成功提示>：网页四周边缘亮起深绿**光带**（快速点亮 / 缓缓熄灭）+ playSfx('success')；
 * <失败提示>：同样亮起深红光带 + playSfx('failure')。
 *
 * v0.3.18-beta1 视觉规格（用户逐条要求）：
 * - 边带**加宽**：BW = 16px（原 5px 实心条）；
 * - **连通环形（item 2）**：一条 evenodd 环形路径 = 外圈屏幕矩形 + 内圈内缩 16px 的**圆角**矩形，
 *   作为 clipPath 裁剪四条渐变带 → 四角平滑连接、内框四角 3px 圆角，无台阶/缺口；
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

/**
 * 环形路径（v0.3.18-beta2 item 2）：**一条连通路径** = 外圈屏幕矩形（贴边直角）
 * + 内圈内缩 bw、圆角 r 的圆角矩形，`fill-rule=evenodd` 单路径填充。
 * 旧实现用「顶部通栏直条 + 侧带从 y=bw 起」拼四条带，角部出现硬台阶/缺口；
 * 现在四条边由同一条环自然连接，且内框四角为圆角。
 */
function ringPath(w: number, h: number, bw: number, r: number): string {
  const k = Math.max(0, Math.min(r, bw / 2, w / 2, h / 2))
  const x0 = bw
  const y0 = bw
  const x1 = Math.max(x0, w - bw)
  const y1 = Math.max(y0, h - bw)
  // 内圈圆角矩形（顺时针，与 evenodd 无关；换向也安全）
  const inner = [
    `M${x0 + k} ${y0}`,
    `H${x1 - k}`,
    `A${k} ${k} 0 0 1 ${x1} ${y0 + k}`,
    `V${y1 - k}`,
    `A${k} ${k} 0 0 1 ${x1 - k} ${y1}`,
    `H${x0 + k}`,
    `A${k} ${k} 0 0 1 ${x0} ${y1 - k}`,
    `V${y0 + k}`,
    `A${k} ${k} 0 0 1 ${x0 + k} ${y0}`,
    'Z',
  ].join(' ')
  return `M0 0 H${w} V${h} H0 Z ${inner}`
}

/** 四条带各自的「由外到内逐渐变淡」渐变（objectBoundingBox，随元素 bbox 自适应） */
function FxGradients({ id }: { id: string }) {
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
  const ring = ringPath(size.w, size.h, FX_BAND, FX_RADIUS)
  return (
    <div className={cls} aria-hidden="true" data-fx-band={FX_BAND} data-fx-radius={FX_RADIUS}>
      <svg className="tutorial-fx__svg" viewBox={`0 0 ${size.w} ${size.h}`} preserveAspectRatio="none">
        <defs>
          <FxGradients id={gid} />
          <clipPath id={`${gid}-clip`} clipRule="evenodd">
            <path d={ring} />
          </clipPath>
        </defs>
        {/* 四条带**全长覆盖**（上/下通栏、左/右通高），再由环形 clip 裁掉内框：
            角部由两条带的 alpha 叠加平滑过渡（无台阶/无缺口），内框四角因 clip 而圆角 */}
        <g clipPath={`url(#${gid}-clip)`}>
          <rect x="0" y="0" width={size.w} height={FX_BAND} fill={`url(#${gid}-top)`} />
          <rect x="0" y={size.h - FX_BAND} width={size.w} height={FX_BAND} fill={`url(#${gid}-bottom)`} />
          <rect x="0" y="0" width={FX_BAND} height={size.h} fill={`url(#${gid}-left)`} />
          <rect x={size.w - FX_BAND} y="0" width={FX_BAND} height={size.h} fill={`url(#${gid}-right)`} />
        </g>
      </svg>
    </div>
  )
}
