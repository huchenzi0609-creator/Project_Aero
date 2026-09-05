/**
 * PreFireMark —— 预报点「?」盖章标记组件（v0.3.0，供 M4 单机与 M6 联机复用）。
 *
 * 规则视觉契约（docs/qa-checklist-v030.md §E）：
 * - 非我方回合点击空网格 → 深红色「?」预报点；上限 10 个
 * - 再次单击可选中并取消该预报点
 *
 * Props：
 * - `coord`：所在棋盘格位（{ r, c }，0-based）；用于格位标识（如 data 属性预留）
 * - `size`：像素尺寸，随格宽缩放
 *
 * 纸感实现：深红「?」+ 复用全局盖章滤镜（#stamp-rough 墨迹粗糙 + 晕染），
 * 与 StampMark 同一视觉语言。纯展示组件（aria-hidden），交互由调用方棋盘层处理。
 */
import type { CSSProperties } from 'react'
import type { Cell } from '@aero/shared'
import '../../styles/v030.css'

export interface PreFireMarkProps {
  coord: Cell
  /** 像素尺寸（随格宽缩放） */
  size: number
  className?: string
}

export function PreFireMark({ coord, size, className }: PreFireMarkProps) {
  return (
    <svg
      className={['prefire-mark', className].filter(Boolean).join(' ')}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      data-cell={`${coord.r},${coord.c}`}
      style={{ display: 'block' } as CSSProperties}
    >
      <g transform="translate(0.7 0.9)" filter="url(#stamp-blur)" opacity="0.3">
        <text x="12" y="16.6" textAnchor="middle" fontSize="18" fill="currentColor" fontWeight="700">
          ?
        </text>
      </g>
      <g filter="url(#stamp-rough)">
        <text x="12" y="16.6" textAnchor="middle" fontSize="18" fill="currentColor" fontWeight="700">
          ?
        </text>
      </g>
    </svg>
  )
}
