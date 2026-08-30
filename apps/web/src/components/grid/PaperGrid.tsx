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
 *   并屏蔽 onCellClick（不触发报点）。v0.2.2 画笔由【起始格】决定：
 *   同色起点=擦除画笔（路径每格还原为未染色），异色/未染色起点=染色画笔（路径每格染当前色）；
 *   纯点击等价于起点单格应用该画笔（三态结果自然成立）。
 * - planesLayer：飞机层特殊渲染（可选）——ghost 半透明虚线 / onTop 置于格层与印章之上 /
 *   overlayIds 红色遮罩 / onPlanePointerDown 启用飞机层指针交互（供样式参考拖拽与放置副本）；
 * - onBoardRef：把棋盘 DOM 上报给调用方（参考飞机拖拽的坐标换算用）。
 */
import { useRef } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { Cell, PlaneShape, PlacedPlane, Shot } from '@aero/shared'
import { formatCoord, occupiedCells, rotateShape } from '@aero/game-core'
import { colLetter } from '../../lib/coord'
import { cellsBBox } from '../../lib/shape'
import { useSettingsStore } from '../../store/settingsStore'
import type { ColoredCell, ColoringColor, PaintBrush } from './ColoringTool'
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
   *  onPaint 的 brush：paint=染当前色（覆盖）；erase=还原为未染色 */
  coloring?: {
    active: boolean
    color: ColoringColor
    onPaint: (cell: Cell, brush: PaintBrush) => void
  }
  /** 飞机层特殊渲染（可选，默认不影响现有调用方） */
  planesLayer?: {
    /** 半透明虚线变体（样式参考放置副本 / 拖拽预览） */
    ghost?: boolean
    /** 置于棋盘格层与印章之上 */
    onTop?: boolean
    /** 需要红色遮罩的飞机 id（重叠提示） */
    overlayIds?: number[]
    /** 启用飞机层指针交互（参考飞机拖拽） */
    onPlanePointerDown?: (plane: PlacedPlane, e: React.PointerEvent<HTMLDivElement>) => void
  }
  /** 上报棋盘 DOM（参考飞机拖拽坐标换算） */
  onBoardRef?: (el: HTMLDivElement | null) => void
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
  planesLayer,
  onBoardRef,
  renderShot,
  invertMarks,
  className,
  ariaLabel,
}: PaperGridProps) {
  const storeInvert = useSettingsStore((s) => s.invertMarks)
  const invert = invertMarks ?? storeInvert

  const coloringActive = coloring?.active ?? false
  const boardRef = useRef<HTMLDivElement | null>(null) as React.MutableRefObject<HTMLDivElement | null>
  const paintRef = useRef<{ down: boolean; last: Cell | null; brush: PaintBrush }>({
    down: false,
    last: null,
    brush: 'paint',
  })

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

  /* ---------- 着色交互（v0.2.2：画笔由起始格决定） ---------- */

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
    // 起始格决定画笔：同色 → 擦除；异色/未染色 → 染色（点击单格即得三态结果）
    const brush: PaintBrush = cell && colorAt(cell) === coloring?.color ? 'erase' : 'paint'
    paintRef.current = { down: true, last: cell, brush }
    if (cell) coloring?.onPaint(cell, brush)
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
    // 路径插值：快速拖拽也不留缝；整条路径沿用起点决定的画笔
    for (const p of lineCells(last, cell)) {
      if (p.r !== last.r || p.c !== last.c) coloring?.onPaint(p, paintRef.current.brush)
    }
    paintRef.current.last = cell
  }

  const endPaint = () => {
    paintRef.current = { down: false, last: null, brush: 'paint' }
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
          ref={(el) => {
            boardRef.current = el
            onBoardRef?.(el)
          }}
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

          {/* 飞机层（planesLayer 可启用交互/幽灵/置顶/红色遮罩） */}
          {planes && shape
            ? planes.map((plane) => {
                const abs = occupiedCells(plane, shape)
                const b = cellsBBox(abs)
                if (!b) return null
                const wrecked = destroyedPlaneIds.includes(plane.id)
                const interactive = Boolean(planesLayer?.onPlanePointerDown)
                const ghost = planesLayer?.ghost ?? false
                const onTop = planesLayer?.onTop ?? false
                const overlaid = planesLayer?.overlayIds?.includes(plane.id) ?? false
                return (
                  <div
                    key={plane.id}
                    data-plane-id={plane.id}
                    className={[
                      'paper-grid__plane',
                      interactive ? 'paper-grid__plane--interactive' : '',
                      ghost ? 'paper-grid__plane--ghost' : '',
                      onTop ? 'paper-grid__plane--ontop' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    style={{
                      left: b.c0 * cellSize,
                      top: b.r0 * cellSize,
                      width: (b.c1 - b.c0 + 1) * cellSize,
                      height: (b.r1 - b.r0 + 1) * cellSize,
                      // v0.2.7：交互时容器不接收指针，命中由【本体占位格命中片】承担，
                      // 包围盒空白格点击穿透给下方棋盘（着色/报点等交互不受阻断）
                      pointerEvents: interactive ? 'none' : undefined,
                    }}
                  >
                    <PlaneGlyph
                      shape={shape}
                      rotation={plane.rotation}
                      wrecked={wrecked}
                      ghost={ghost}
                    />
                    {overlaid ? <div className="paper-grid__plane-overlay" aria-hidden="true" /> : null}
                    {/* 本体命中片：仅实际占据格触发旋转/拖拽/批量着色 */}
                    {interactive
                      ? abs.map((c) => (
                          <div
                            key={`hit-${plane.id}-${c.r}-${c.c}`}
                            data-cell={`${c.r},${c.c}`}
                            className="paper-grid__plane-hit"
                            style={{
                              position: 'absolute',
                              left: (c.c - b.c0) * cellSize,
                              top: (c.r - b.r0) * cellSize,
                              width: cellSize,
                              height: cellSize,
                              pointerEvents: 'auto',
                              cursor: 'grab',
                              touchAction: 'none',
                            }}
                            onPointerDown={(e) => planesLayer?.onPlanePointerDown?.(plane, e)}
                          />
                        ))
                      : null}
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
