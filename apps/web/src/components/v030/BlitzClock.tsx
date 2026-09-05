/**
 * BlitzClock —— 超快棋（blitz）倒计时组件（v0.3.0，供 M4 单机与 M6 联机复用）。
 *
 * Props：
 * - `ms`：剩余毫秒（非负；由调用方按每秒/每帧递减驱动，本组件只做渲染）
 * - `active`：当前是否为该时钟持有方的行动回合（缺省 true）：
 *   行动中高亮，非行动方置灰（视觉区分，不影响计时逻辑）
 *
 * 规则视觉契约（docs/qa-checklist-v030.md §C）：
 * - 剩余 < 10s 时数字标红并轻微闪烁（CSS animation；prefers-reduced-motion 下由 base.css 禁用动画）
 * - 超快棋模式下显示；byo-yomi 每步限时等不在本组件职责内
 *
 * 显示格式：m:ss（如 1:10 / 0:30）；剩余不足 1 分钟也保持 m:ss 便于读秒。
 */
import '../../styles/v030.css'

export interface BlitzClockProps {
  /** 剩余毫秒 */
  ms: number
  /** 是否当前行动方（缺省 true） */
  active?: boolean
  className?: string
}

const BLITZ_DANGER_MS = 10_000

function formatMs(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function BlitzClock({ ms, active = true, className }: BlitzClockProps) {
  const danger = ms >= 0 && ms < BLITZ_DANGER_MS
  const cls = [
    'blitz-clock',
    active ? 'blitz-clock--active' : 'blitz-clock--idle',
    danger ? 'blitz-clock--danger' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <span className={cls} role="timer" aria-live="off">
      {formatMs(ms)}
    </span>
  )
}
