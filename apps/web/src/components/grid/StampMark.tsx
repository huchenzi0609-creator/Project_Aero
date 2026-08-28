/**
 * 盖章标记：✗ 黑叉（击空）、◯ 深绿空心圈（击中）、★ 深红五角星（击毁）。
 * 墨迹质感 = 全局 turbulence 位移滤镜 + 晕染层 + 按格位确定性的微旋转。
 * 支持“反转 X 与 O”显示偏好（settingsStore）。
 */
import type { Cell, ShotOutcome } from '@aero/shared'

export interface StampMarkProps {
  outcome: ShotOutcome
  /** 像素尺寸（随格宽缩放） */
  size: number
  /** 所在格位，用于确定性的盖章旋转角度 */
  cell?: Cell
  /** 反转 ✗/◯ 显示含义（默认 false，传入 undefined 时由调用方决定） */
  inverted?: boolean
  className?: string
}

type MarkKind = 'cross' | 'ring' | 'star'

function kindFor(outcome: ShotOutcome, inverted: boolean): MarkKind {
  if (inverted) {
    if (outcome === 'miss') return 'ring'
    if (outcome === 'hit') return 'cross'
    return 'star'
  }
  if (outcome === 'miss') return 'cross'
  if (outcome === 'hit') return 'ring'
  return 'star'
}

const STAR_POINTS = (() => {
  const pts: string[] = []
  for (let i = 0; i < 10; i++) {
    const a = ((-90 + i * 36) * Math.PI) / 180
    const r = i % 2 === 0 ? 9 : 3.9
    pts.push(`${(12 + r * Math.cos(a)).toFixed(2)},${(12 + r * Math.sin(a)).toFixed(2)}`)
  }
  return pts.join(' ')
})()

function MarkGlyph({ kind }: { kind: MarkKind }) {
  if (kind === 'cross') {
    return (
      <g stroke="currentColor" strokeWidth={3.6} strokeLinecap="round" fill="none">
        <path d="M6.5 6.5 L17.5 17.5" />
        <path d="M17.5 6.5 L6.5 17.5" />
      </g>
    )
  }
  if (kind === 'ring') {
    return <circle cx="12" cy="12" r="8.4" stroke="currentColor" strokeWidth={3} fill="none" />
  }
  return <path d={`M ${STAR_POINTS} Z`} fill="currentColor" />
}

export function StampMark({ outcome, size, cell, inverted = false, className }: StampMarkProps) {
  const kind = kindFor(outcome, inverted)
  const deg = cell ? ((cell.r * 31 + cell.c * 17) % 11) - 5 : 0
  const colorClass = kind === 'cross' ? 'stamp--miss' : kind === 'ring' ? 'stamp--hit' : 'stamp--kill'
  return (
    <svg
      className={[colorClass, className].filter(Boolean).join(' ')}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{ display: 'block' }}
    >
      <g transform={`rotate(${deg} 12 12)`}>
        {/* 墨迹晕染层 */}
        <g filter="url(#stamp-blur)" opacity="0.3" transform="translate(0.7 0.9)">
          <MarkGlyph kind={kind} />
        </g>
        {/* 主墨迹（边缘轻微不规则） */}
        <g filter="url(#stamp-rough)">
          <MarkGlyph kind={kind} />
        </g>
      </g>
    </svg>
  )
}
