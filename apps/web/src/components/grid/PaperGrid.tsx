/**
 * PaperGrid —— 纯展示棋盘（width × height 格）。
 * - cellSize：格宽（px）
 * - 字母列标 / 数字行标（可选）
 * - 点击格回调（供报点高亮）
 * - 已报点格渲染：调用方传 shots 列表，内部用 StampMark 盖章（可用 renderShot 覆盖）
 * - 可选飞机层（PlacedPlane[] + shape）与残骸暗色层（destroyedPlaneIds）
 */
import type { CSSProperties, ReactNode } from 'react'
import type { Cell, PlaneShape, PlacedPlane, Shot } from '@aero/shared'
import { colLetter, formatCoord } from '../../lib/coord'
import { placedCells, shapeBBox } from '../../lib/shape'
import { useSettingsStore } from '../../store/settingsStore'
import { PlaneGlyph } from './PlaneGlyph'
import { StampMark } from './StampMark'

export interface PaperGridProps {
  width: number
  height: number
  cellSize: number
  showLabels?: boolean
  onCellClick?: (cell: Cell) => void
  onCellHover?: (cell: Cell | null) => void
  shots?: Shot[]
  planes?: PlacedPlane[]
  shape?: PlaneShape
  destroyedPlaneIds?: number[]
  highlight?: Cell | null
  /** 自定义已报点格渲染；缺省时使用 StampMark */
  renderShot?: (shot: Shot, cellSize: number) => ReactNode
  /** 反转 ✗/◯ 显示含义；缺省时读取设置 */
  invertMarks?: boolean
  className?: string
  ariaLabel?: string
}

export function PaperGrid({
  width,
  height,
  cellSize,
  showLabels = false,
  onCellClick,
  onCellHover,
  shots = [],
  planes,
  shape,
  destroyedPlaneIds = [],
  highlight,
  renderShot,
  invertMarks,
  className,
  ariaLabel,
}: PaperGridProps) {
  const storeInvert = useSettingsStore((s) => s.invertMarks)
  const invert = invertMarks ?? storeInvert

  const labelW = showLabels ? 20 : 0
  const labelH = showLabels ? 15 : 0

  return (
    <div className={['paper-grid', className].filter(Boolean).join(' ')}>
      {showLabels ? (
        <div className="paper-grid__cols" style={{ marginLeft: labelW, height: labelH }}>
          {Array.from({ length: width }, (_, c) => (
            <span key={c} className="paper-grid__col" style={{ width: cellSize }}>
              {colLetter(c)}
            </span>
          ))}
        </div>
      ) : null}
      <div className="paper-grid__body">
        {showLabels ? (
          <div className="paper-grid__rows" style={{ width: labelW }}>
            {Array.from({ length: height }, (_, r) => (
              <span key={r} className="paper-grid__row" style={{ height: cellSize }}>
                {r + 1}
              </span>
            ))}
          </div>
        ) : null}
        <div
          className="paper-grid__board"
          role="group"
          aria-label={ariaLabel}
          style={
            {
              display: 'grid',
              gridTemplateColumns: `repeat(${width}, ${cellSize}px)`,
              gridTemplateRows: `repeat(${height}, ${cellSize}px)`,
              width: width * cellSize,
              height: height * cellSize,
            } as CSSProperties
          }
        >
          {Array.from({ length: height }, (_, r) =>
            Array.from({ length: width }, (_, c) => {
              const coord: Cell = { r, c }
              const clickable = Boolean(onCellClick)
              return (
                <button
                  key={`${r}-${c}`}
                  type="button"
                  className={['paper-grid__cell', clickable ? 'paper-grid__cell--clickable' : '']
                    .filter(Boolean)
                    .join(' ')}
                  style={{ gridColumn: c + 1, gridRow: r + 1 }}
                  aria-label={formatCoord(coord)}
                  disabled={!clickable}
                  onMouseEnter={() => onCellHover?.(coord)}
                  onMouseLeave={() => onCellHover?.(null)}
                  onFocus={() => onCellHover?.(coord)}
                  onBlur={() => onCellHover?.(null)}
                  onClick={() => onCellClick?.(coord)}
                />
              )
            }),
          )}

          {/* 飞机层 */}
          {planes && shape
            ? planes.map((plane) => {
                const cells = placedCells(plane, shape)
                const b = shapeBBox(cells)
                if (!b) return null
                const wrecked = destroyedPlaneIds.includes(plane.id)
                return (
                  <div
                    key={plane.id}
                    className="paper-grid__plane"
                    style={{
                      left: b.c0 * cellSize,
                      top: b.r0 * cellSize,
                      width: (b.c1 - b.c0 + 1) * cellSize,
                      height: (b.r1 - b.r0 + 1) * cellSize,
                    }}
                  >
                    <PlaneGlyph shape={shape} rotation={plane.rotation} wrecked={wrecked} />
                  </div>
                )
              })
            : null}

          {/* 已报点格渲染 */}
          {shots.map((shot) => (
            <div
              key={`${shot.coord.r}-${shot.coord.c}`}
              className="paper-grid__stamp"
              style={{
                left: shot.coord.c * cellSize,
                top: shot.coord.r * cellSize,
                width: cellSize,
                height: cellSize,
              }}
            >
              {renderShot ? (
                renderShot(shot, cellSize)
              ) : (
                <StampMark outcome={shot.outcome} size={cellSize * 0.82} cell={shot.coord} inverted={invert} />
              )}
            </div>
          ))}

          {/* 报点高亮 */}
          {highlight ? (
            <div
              className="paper-grid__highlight"
              style={{
                left: highlight.c * cellSize,
                top: highlight.r * cellSize,
                width: cellSize,
                height: cellSize,
              }}
            />
          ) : null}
        </div>
      </div>
    </div>
  )
}
