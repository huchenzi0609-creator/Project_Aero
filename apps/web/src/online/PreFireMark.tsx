/**
 * PreFireMark —— 预报点「?」标记（v0.3.0，临时占位实现）。
 *
 * ⚠️ M3 将在 apps/web/src/components/v030/ 提供正式共享组件（props 约定相同），
 * 落地后请把本组件的 import 路径改到 v030 并删除本文件。
 *
 * props 约定：{ coord: {r,c}, cellSize: number }；深红「?」。
 * 使用方负责把它放进棋盘层的绝对定位容器。
 */
import type { Cell } from '@aero/shared'

export interface PreFireMarkProps {
  coord: Cell
  cellSize: number
  /** 是否处于「选中待确认」态（高亮提示可取消） */
  selected?: boolean
}

export function PreFireMark({ coord, cellSize, selected = false }: PreFireMarkProps) {
  const size = cellSize * 0.72
  return (
    <div
      className="prefire-mark"
      aria-label={`预报点 ${String.fromCharCode(65 + coord.c)}${coord.r + 1}`}
      style={{
        position: 'absolute',
        left: coord.c * cellSize,
        top: coord.r * cellSize,
        width: cellSize,
        height: cellSize,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
        zIndex: 6,
      }}
    >
      <span
        style={{
          width: size,
          height: size,
          lineHeight: `${size}px`,
          textAlign: 'center',
          borderRadius: '50%',
          color: '#fff',
          fontWeight: 700,
          fontFamily: 'var(--font-mono, monospace)',
          fontSize: size * 0.62,
          background: 'rgba(168, 54, 47, 0.92)',
          boxShadow: selected ? '0 0 0 2px #a8362f, 0 0 0 4px rgba(255,255,255,0.85)' : undefined,
          border: '1.5px dashed rgba(255, 255, 255, 0.7)',
        }}
      >
        ?
      </span>
    </div>
  )
}
