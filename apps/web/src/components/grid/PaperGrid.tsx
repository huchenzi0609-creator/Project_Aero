/**
 * PaperGrid —— 纯展示棋盘（width × height 格）。
 * - cellSize：格宽（px）
 * - 字母列标 / 数字行标（可选）
 * - 点击格回调（供报点高亮）
 * - 已报点格渲染：调用方传 shots 列表，内部用 StampMark 盖章（可用 renderShot 覆盖）
 * - 可选飞机层（PlacedPlane[] + shape）与残骸暗色层（destroyedPlaneIds，机头额外盖 ★）
 * - flash：对方报点 0.8s 高亮动画格（我方网格）
 * - coloredCells：着色图层（可选，渲染在盖章标记下层；缺省不渲染，零开销）
 * - coloring：着色交互（可选，默认关闭不影响现有调用方）：开启后接管棋盘指针事件，
 *   点按染色 / 按住拖拽按路径染色 / 同色擦除，并屏蔽 onCellClick（不触发报点）。
 *   v0.2.1：点击（纯点按松手）走三态（染/擦/覆写），拖拽经过（起点与路径）走两态
 *   （染/覆写，同色保持不变）——手势判定在本组件完成：手势中的染色一律以 drag 触发，
 *   纯点击在松手时若按下前即当前色则补发 click 擦除。
 */
import { useRef } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { Cell, PlaneShape, PlacedPlane, Shot } from '@aero/shared'
import { formatCoord, occupiedCells, rotateShape } from '@aero/game-core'
import { colLetter } from '../../lib/coord'
import { cellsBBox } from '../../lib/shape'
import { useSettingsStore } from '../../store/settingsStore'
import type { ColoredCell, ColoringColor, PaintKind } from './ColoringTool'
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
  /** 对方报点高亮动画格（0.8s 后由调用方清除） */
  flash?: Cell | null
  /** 着色图层：渲染为半透明色块，位于盖章标记下层（缺省不渲染） */
  coloredCells?: ColoredCell[]
  /** 着色交互（可选）：active 时接管棋盘指针（点按/拖拽染色），并屏蔽 onCellClick。
   *  onPaint 的 kind：'drag'=手势中的染色（起点与路径，两态）；'click'=纯点击的擦除修正 */
  coloring?: {
    active: boolean
    color: ColoringColor
    onPaint: (cell: Cell, kind: PaintKind) => void
  }
  /** 自定义已报点格渲染；缺省时使用 StampMark */
  renderShot?: (shot: Shot, cellSize: number) => ReactNode
  /** 反转 ✗/◯ 显示含义；缺省时读取设置 */
  invertMarks?: boolean
  className?: string
  ariaLabel?: string
}

/** 两格之间的整数直线（Bresenham），含两端（快速拖拽不留缝） */
function lineCells(a: Cell, b: Cell): Cell[] {
  const out: Cell[] = []
  let r = a.r
  let c = a.c
  const dr = Math.abs(b.r - a.r)
  const dc = Math.abs(b.c - a.c)
  const sr = a.r < b.r ? 1 : -1
  const sc = a.c < b.c ? 1 : -1
  let err = dr - dc
  for (;;) {
    out.push({ r, c })
    if (r === b.r && c === b.c) break
    const e2 = 2 * err
    if (e2 > -dc) {
      err -= dc
      r += sr
    }
    if (e2 < dr) {
      err += dr
      c += sc
    }
  }
  return out
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
  flash,
  coloredCells,
  coloring,
  renderShot,
  invertMarks,
  className,
  ariaLabel,
}: PaperGridProps) {
  const storeInvert = useSettingsStore((s) => s.invertMarks)
  const invert = invertMarks ?? storeInvert

  const coloringActive = coloring?.active ?? false
  const boardRef = useRef<HTMLDivElement>(null)
  const paintRef = useRef<{
    down: boolean
    last: Cell | null
    /** 手势中是否发生过路径染色（有位移 = 拖拽，区别于纯点击） */
    moved: boolean
    start: Cell | null
    /** 按下前起点格的颜色（供纯点击的同色擦除判定） */
    startColor: ColoringColor | null
  }>({ down: false, last: null, moved: false, start: null, startColor: null })

  const labelW = showLabels ? 20 : 0
  const labelH = showLabels ? 15 : 0

  // 被击毁机头位置（供暗色层 ★ 定位；若该格已有 kill 章则不再重复盖）
  const wreckStars: Array<{ r: number; c: number }> = []
  if (planes && shape) {
    for (const plane of planes) {
      if (!destroyedPlaneIds.includes(plane.id)) continue
      const rotatedHead = rotateShape(shape, plane.rotation).head
      const head = { r: rotatedHead.r + plane.origin.r, c: rotatedHead.c + plane.origin.c }
      const hasKillMark = shots.some(
        (s) => s.coord.r === head.r && s.coord.c === head.c && s.outcome === 'kill',
      )
      if (!hasKillMark) wreckStars.push(head)
    }
  }

  /* ---------- 着色交互（点按 / 长按拖拽路径染色；v0.2.1 区分点击与拖拽） ---------- */

  const cellFromEvent = (clientX: number, clientY: number): Cell | null => {
    const rect = boardRef.current?.getBoundingClientRect()
    if (!rect) return null
    const r = Math.floor((clientY - rect.top) / cellSize)
    const c = Math.floor((clientX - rect.left) / cellSize)
    if (r < 0 || r >= height || c < 0 || c >= width) return null
    return { r, c }
  }

  /** 某格当前颜色（无 → null） */
  const colorAt = (cell: Cell): ColoringColor | null => {
    const found = coloredCells?.find((c) => c.coord.r === cell.r && c.coord.c === cell.c)
    return found ? found.color : null
  }

  const onBoardPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!coloringActive) return
    e.preventDefault()
    boardRef.current?.setPointerCapture(e.pointerId)
    const cell = cellFromEvent(e.clientX, e.clientY)
    paintRef.current = {
      down: true,
      last: cell,
      moved: false,
      start: cell,
      startColor: cell ? colorAt(cell) : null,
    }
    // 按下即按"拖拽经过"两态处理（同色保持不变，不误擦）；纯点击的擦除在松手时补发
    if (cell) coloring?.onPaint(cell, 'drag')
  }

  const onBoardPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!coloringActive || !paintRef.current.down) return
    const cell = cellFromEvent(e.clientX, e.clientY)
    const last = paintRef.current.last
    if (!cell) return
    if (!last) {
      paintRef.current.last = cell
      return
    }
    if (cell.r === last.r && cell.c === last.c) return
    // 路径插值：快速拖拽也不留缝；每格按"拖拽经过"两态处理（同色保持，异色更新，无色填充）
    for (const p of lineCells(last, cell)) {
      if (p.r !== last.r || p.c !== last.c) {
        paintRef.current.moved = true
        coloring?.onPaint(p, 'drag')
      }
    }
    paintRef.current.last = cell
  }

  const endPaint = () => {
    const p = paintRef.current
    // 纯点击（无位移）：起点按下前即当前色 → 补发 click 擦除（三态中的"擦"）
    if (p.down && !p.moved && p.start && p.startColor === coloring?.color) {
      coloring?.onPaint(p.start, 'click')
    }
    paintRef.current = { down: false, last: null, moved: false, start: null, startColor: null }
  }

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
          ref={boardRef}
          className={['paper-grid__board', coloringActive ? 'paper-grid__board--coloring' : '']
            .filter(Boolean)
            .join(' ')}
          role="group"
          aria-label={ariaLabel}
          style={
            {
              display: 'grid',
              gridTemplateColumns: `repeat(${width}, ${cellSize}px)`,
              gridTemplateRows: `repeat(${height}, ${cellSize}px)`,
              width: width * cellSize,
              height: height * cellSize,
              touchAction: coloringActive ? 'none' : undefined,
            } as CSSProperties
          }
          onPointerDown={onBoardPointerDown}
          onPointerMove={onBoardPointerMove}
          onPointerUp={endPaint}
          onPointerCancel={endPaint}
        >
          {Array.from({ length: height }, (_, r) =>
            Array.from({ length: width }, (_, c) => {
              const coord: Cell = { r, c }
              const clickable = Boolean(onCellClick) || coloringActive
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
                  onClick={() => {
                    // 着色模式下不触发报点
                    if (!coloringActive) onCellClick?.(coord)
                  }}
                />
              )
            }),
          )}

          {/* 着色图层（位于盖章标记下层） */}
          {coloredCells?.map((cc) => (
            <div
              key={`colored-${cc.coord.r}-${cc.coord.c}`}
              data-coord={formatCoord(cc.coord)}
              className={['paper-grid__colored', `paper-grid__colored--${cc.color}`].join(' ')}
              style={{
                left: cc.coord.c * cellSize,
                top: cc.coord.r * cellSize,
                width: cellSize,
                height: cellSize,
              }}
            />
          ))}

          {/* 飞机层 */}
          {planes && shape
            ? planes.map((plane) => {
                const abs = occupiedCells(plane, shape)
                const b = cellsBBox(abs)
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

          {/* 被击毁飞机：机头 ★（暗色层之上，仅我方棋盘） */}
          {wreckStars.map((head) => (
            <div
              key={`wreckstar-${head.r}-${head.c}`}
              className="paper-grid__wreckstar"
              style={{
                left: head.c * cellSize,
                top: head.r * cellSize,
                width: cellSize,
                height: cellSize,
              }}
            >
              <StampMark outcome="kill" size={cellSize * 0.82} cell={head} />
            </div>
          ))}

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

          {/* 报点高亮（选格） */}
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

          {/* 对方报点 0.8s 高亮动画 */}
          {flash ? (
            <div
              className="paper-grid__aiflash"
              style={{
                left: flash.c * cellSize,
                top: flash.r * cellSize,
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
