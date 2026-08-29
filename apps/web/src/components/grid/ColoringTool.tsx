/**
 * ColoringTool —— 对局工具（v0.2.2，单机 + 联机）：着色 + 样式参考飞机拖拽。
 *
 * - useColoring：着色状态 hook（色块列表 / 模式开关 / 当前颜色 / 调色板开关），
 *   每局独立、新对局由调用方 reset 清空，不持久化。
 *   v0.2.2 画笔语义（覆盖 v0.2.1）：拖拽画笔由【起始格】决定——同色起点 = 擦除画笔（路径每格还原为未染色），
 *   异色/未染色起点 = 染色画笔（路径每格染当前色、覆盖已有色）；点击语义不变（等价于起点单格应用画笔：
 *   同色→擦、异色→覆写、未染色→染）。
 * - ColoringToolButton：仅图标（无任何说明性文字）的着色按钮：
 *   点击 = 切换着色模式；长按（约 500ms）= 弹出调色板（黄/蓝/绿）选择当前颜色，选色后自动进入着色模式；
 * - refShotsFor：样式参考示例标记，随当前旋转自适应：
 *   kill=★ 旋转后机头格；hit=◯ 旋转后任一非机头占位格；miss=✗ 形状外的空格（紧邻包围盒优先）；
 * - useRefPlanes：样式参考飞机拖拽/放置副本（对手棋盘）/旋转/批量着色。
 *   放置副本交互与摆放一致（点击旋转、拖拽吸附、重叠红遮罩、拖回样式参考移除）；
 *   着色模式下点击放置副本：按命中格颜色批量染/擦整机。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Cell, PlaneShape, PlacedPlane, Rotation, Shot } from '@aero/shared'
import { boundingBox, occupiedCells, rotateShape } from '@aero/game-core'
import { cellsBBox } from '../../lib/shape'
import '../../styles/coloring.css'

export type ColoringColor = 'yellow' | 'blue' | 'green'

/** 染色画笔：paint=染当前色（覆盖）；erase=还原为未染色 */
export type PaintBrush = 'paint' | 'erase'

export interface ColoredCell {
  coord: Cell
  color: ColoringColor
}

export const COLORING_COLORS: ReadonlyArray<{ color: ColoringColor; label: string }> = [
  { color: 'yellow', label: '黄色' },
  { color: 'blue', label: '蓝色' },
  { color: 'green', label: '绿色' },
]

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

export interface ColoringState {
  /** 已染色格（渲染到对手棋盘，位于盖章标记下层） */
  coloredCells: ColoredCell[]
  coloringMode: boolean
  currentColor: ColoringColor
  paletteOpen: boolean
  setPaletteOpen: (open: boolean) => void
  /** 选择颜色：设定当前色、进入着色模式并关闭调色板 */
  selectColor: (color: ColoringColor) => void
  toggleMode: () => void
  /** 按画笔染/擦一格：paint=染当前色（覆盖任何已有色）；erase=还原为未染色 */
  paintCell: (coord: Cell, brush: PaintBrush) => void
  /** 整机批量染/擦：hitColor 与当前色相同 → 整机还原为未染色；否则整机染当前色（覆盖） */
  paintPlane: (planeCells: Cell[], hitColor: ColoringColor | null) => void
  /** 新对局清空（每局独立） */
  reset: () => void
}

export function useColoring(): ColoringState {
  const [coloredCells, setColoredCells] = useState<ColoredCell[]>([])
  const [coloringMode, setColoringMode] = useState(false)
  const [currentColor, setCurrentColor] = useState<ColoringColor>('yellow')
  const [paletteOpen, setPaletteOpen] = useState(false)

  const paintCell = (coord: Cell, brush: PaintBrush) => {
    setColoredCells((prev) => {
      const idx = prev.findIndex((c) => c.coord.r === coord.r && c.coord.c === coord.c)
      if (brush === 'erase') {
        return idx === -1 ? prev : prev.filter((_, i) => i !== idx)
      }
      // paint：覆盖任何已有色
      if (idx === -1) return [...prev, { coord, color: currentColor }]
      const next = prev.slice()
      next[idx] = { coord, color: currentColor }
      return next
    })
  }

  const paintPlane = (planeCells: Cell[], hitColor: ColoringColor | null) => {
    setColoredCells((prev) => {
      const inPlane = (c: ColoredCell) =>
        planeCells.some((pc) => pc.r === c.coord.r && pc.c === c.coord.c)
      if (hitColor === currentColor) {
        // 命中格同色 → 整机还原为未染色
        return prev.filter((c) => !inPlane(c))
      }
      // 命中格异色/未染色 → 整机染当前色（覆盖）
      const without = prev.filter((c) => !inPlane(c))
      return [...without, ...planeCells.map((pc) => ({ coord: pc, color: currentColor }))]
    })
  }

  const selectColor = (color: ColoringColor) => {
    setCurrentColor(color)
    setColoringMode(true)
    setPaletteOpen(false)
  }

  const reset = () => {
    setColoredCells([])
    setColoringMode(false)
    setPaletteOpen(false)
  }

  return {
    coloredCells,
    coloringMode,
    currentColor,
    paletteOpen,
    setPaletteOpen,
    selectColor,
    toggleMode: () => setColoringMode((m) => !m),
    paintCell,
    paintPlane,
    reset,
  }
}

/* ============================================================
   样式参考示例标记（v0.2.2 任务 1）
   ============================================================ */

/**
 * 由当前旋转后的形状动态计算示例标记（5×5 编辑器坐标）：
 * - kill：旋转后机头格（★）
 * - hit：旋转后形状的任一非机头占位格（◯）
 * - miss：形状外的一个空格，紧邻包围盒（✗）；任意形状/任意旋转下均正确
 */
export function refShotsFor(shape: PlaneShape, rotation: Rotation): Shot[] {
  const rotated = rotateShape(shape, rotation)
  const cells = rotated.cells
  const head = rotated.head
  const isCell = (r: number, c: number) => cells.some((p) => p.r === r && p.c === c)

  const kill: Shot = { coord: { r: head.r, c: head.c }, outcome: 'kill' }

  const body = cells.find((p) => !(p.r === head.r && p.c === head.c))
  const hit: Shot = {
    coord: body ? { r: body.r, c: body.c } : { r: head.r, c: head.c },
    outcome: 'hit',
  }

  let miss: Cell | null = null
  let bestDist = Infinity
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      if (isCell(r, c)) continue
      let d = Infinity
      for (const p of cells) d = Math.min(d, Math.abs(p.r - r) + Math.abs(p.c - c))
      if (d < bestDist) {
        bestDist = d
        miss = { r, c }
      }
    }
  }
  const missShot: Shot = { coord: miss ?? { r: 0, c: 0 }, outcome: 'miss' }

  return [missShot, hit, kill]
}

/* ============================================================
   样式参考飞机拖拽（v0.2.2 任务 4）
   ============================================================ */

export interface RefPlaneDragState {
  /** 参考本体 = -1；放置副本 = 其 id */
  id: number
  rotation: Rotation
  source: 'ref' | 'placed'
  /** 当前吸附 origin（对手棋盘）；不在棋盘上为 null */
  origin: Cell | null
  pointer: { x: number; y: number }
  /** 指针相对飞机可视左上角的偏移（对手棋盘格单位） */
  grabOffset: { r: number; c: number }
  /** placed 来源：拖拽前原 origin（取消拖拽还原） */
  fromOrigin?: Cell
}

export interface RefPlanesInput {
  width: number
  height: number
  shape: PlaneShape
  /** 对手棋盘格宽（mainCell） */
  cellSize: number
  /** 对手棋盘 DOM（由对手 PaperGrid 的 onBoardRef 提供） */
  oppBoardRef: React.RefObject<HTMLDivElement | null>
  /** 样式参考卡片容器（拖回移除判定） */
  refAreaRef: React.RefObject<HTMLElement | null>
  /** 是否允许拖拽（config.allowMoveRefPlane ?? settingsStore，默认 true）；点击旋转始终允许 */
  allowMove: boolean
  coloring: {
    isColoring: boolean
    currentColor: ColoringColor
    coloredCells: ColoredCell[]
    paintPlane: (planeCells: Cell[], hitColor: ColoringColor | null) => void
  }
}

export interface RefPlanesState {
  /** 样式参考本体旋转 */
  refRotation: Rotation
  /** 已放置到对手棋盘上的参考飞机副本 */
  placed: PlacedPlane[]
  /** 对手棋盘实际渲染的飞机（放置副本 + 拖拽中的本体位移/落点预览） */
  shownPlanes: PlacedPlane[]
  drag: RefPlaneDragState | null
  /** 重叠（红遮罩）的飞机 id 集合（-1 = 拖拽中的落点预览重叠） */
  overlappedIds: number[]
  startRefDrag: (e: React.PointerEvent<HTMLDivElement>) => void
  startPlacedDrag: (e: React.PointerEvent<HTMLDivElement>, plane: PlacedPlane) => void
  /** 新对局清空 */
  reset: () => void
}

export function useRefPlanes(input: RefPlanesInput): RefPlanesState {
  const { width, height, shape, cellSize, oppBoardRef, refAreaRef, allowMove, coloring } = input

  const [refRotation, setRefRotation] = useState<Rotation>(0)
  const [placed, setPlaced] = useState<PlacedPlane[]>([])
  const [drag, setDrag] = useState<RefPlaneDragState | null>(null)
  const dragRef = useRef<RefPlaneDragState | null>(null)
  const nextIdRef = useRef(1)

  const updateDrag = (d: RefPlaneDragState | null) => {
    dragRef.current = d
    setDrag(d)
  }

  /* ---------- 几何辅助（与摆放页一致：origin=旋转后包围盒左上角） ---------- */

  const rotatedMin = (rotation: Rotation): { r: number; c: number } => {
    const b = cellsBBox(rotateShape(shape, rotation).cells)
    return b ? { r: b.r0, c: b.c0 } : { r: 0, c: 0 }
  }

  const cellFromPointer = (clientX: number, clientY: number): Cell | null => {
    const rect = oppBoardRef.current?.getBoundingClientRect()
    if (!rect) return null
    const r = Math.floor((clientY - rect.top) / cellSize)
    const c = Math.floor((clientX - rect.left) / cellSize)
    if (r < 0 || r >= height || c < 0 || c >= width) return null
    return { r, c }
  }

  const isInRect = (x: number, y: number, rect: DOMRect) =>
    x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom

  /** 按可视左上角（float 格位）吸附 origin：取整后夹取到界内 */
  const snapOrigin = (visR: number, visC: number, rotation: Rotation): Cell => {
    const b = boundingBox(shape, rotation)
    const min = rotatedMin(rotation)
    const vr = clamp(Math.round(visR), 0, height - b.h)
    const vc = clamp(Math.round(visC), 0, width - b.w)
    return { r: vr - min.r, c: vc - min.c }
  }

  /** 旋转后夹取 origin，保证仍全部在界内 */
  const clampOrigin = (origin: Cell, rotation: Rotation): Cell => {
    const b = boundingBox(shape, rotation)
    const min = rotatedMin(rotation)
    const vr = clamp(origin.r + min.r, 0, height - b.h)
    const vc = clamp(origin.c + min.c, 0, width - b.w)
    return { r: vr - min.r, c: vc - min.c }
  }

  /** 该 origin 是否与已放置副本重叠（excludeId 排除自身/预览） */
  const overlapAt = (origin: Cell, rotation: Rotation, excludeId: number): boolean => {
    const cand = occupiedCells({ id: excludeId, rotation, origin }, shape)
    return placed.some((p) => {
      if (p.id === excludeId) return false
      const cells = occupiedCells(p, shape)
      return cand.some((c) => cells.some((c2) => c2.r === c.r && c2.c === c.c))
    })
  }

  const colorAt = (cell: Cell): ColoringColor | null => {
    const found = coloring.coloredCells.find((c) => c.coord.r === cell.r && c.coord.c === cell.c)
    return found ? found.color : null
  }

  const movePlane = (id: number, origin: Cell) => {
    setPlaced((prev) => prev.map((p) => (p.id === id ? { ...p, origin } : p)))
  }

  /* ---------- 手势（点击/拖拽，与摆放页一致的阈值） ---------- */

  const startGesture = (
    e: React.PointerEvent,
    opts: { id: number; rotation: Rotation; source: 'ref' | 'placed'; fromOrigin?: Cell },
  ) => {
    e.preventDefault()
    e.stopPropagation()
    const el = (e.target as HTMLElement).closest('.paper-grid__plane')
    const rect = el?.getBoundingClientRect()
    const grabOffset = rect
      ? { r: (e.clientY - rect.top) / cellSize, c: (e.clientX - rect.left) / cellSize }
      : { r: 0, c: 0 }
    const down = { x: e.clientX, y: e.clientY, t: performance.now() }
    let moved = false

    const onMove = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - down.x, ev.clientY - down.y) >= 6) moved = true
      if (!allowMove) return // 不可拖拽：不跟踪，仅保留点击判定
      const boardRect = oppBoardRef.current?.getBoundingClientRect()
      const pc = boardRect ? cellFromPointer(ev.clientX, ev.clientY) : null
      const overBoard = boardRect ? isInRect(ev.clientX, ev.clientY, boardRect) : false
      const origin =
        pc && overBoard ? snapOrigin(pc.r - grabOffset.r, pc.c - grabOffset.c, opts.rotation) : null
      updateDrag({
        id: opts.id,
        rotation: opts.rotation,
        source: opts.source,
        origin,
        pointer: { x: ev.clientX, y: ev.clientY },
        grabOffset,
        fromOrigin: opts.fromOrigin,
      })
    }

    const onUp = (ev: PointerEvent) => {
      cleanup()
      const dist = Math.hypot(ev.clientX - down.x, ev.clientY - down.y)
      const dur = performance.now() - down.t
      const d = dragRef.current
      const dOrigin = d?.origin

      if (!moved && dist < 6 && dur < 300) {
        // 点击：参考本体 → 旋转 90°；放置副本 → 着色模式批量染/擦，否则旋转 90°
        if (opts.source === 'ref') {
          setRefRotation((r) => ((r + 1) % 4) as Rotation)
        } else if (coloring.isColoring && opts.fromOrigin) {
          const hitCell = cellFromPointer(ev.clientX, ev.clientY)
          const hitColor = hitCell ? colorAt(hitCell) : null
          const planeCells = occupiedCells(
            { id: opts.id, rotation: opts.rotation, origin: opts.fromOrigin },
            shape,
          )
          coloring.paintPlane(planeCells, hitColor)
        } else if (opts.fromOrigin) {
          const rot = ((opts.rotation + 1) % 4) as Rotation
          setPlaced((prev) =>
            prev.map((p) =>
              p.id === opts.id ? { ...p, rotation: rot, origin: clampOrigin(p.origin, rot) } : p,
            ),
          )
        }
        updateDrag(null)
        return
      }

      if (opts.source === 'ref') {
        // 放置：吸附在界内（已夹取）且不与已放置副本重叠 → 成功；否则回弹
        if (dOrigin && !overlapAt(dOrigin, opts.rotation, -1)) {
          const id = nextIdRef.current++
          setPlaced((prev) => [...prev, { id, rotation: opts.rotation, origin: dOrigin }])
        }
      } else if (dOrigin) {
        movePlane(opts.id, dOrigin)
      } else {
        // 拖离棋盘：落在样式参考区域 → 移除该放置副本；否则还原原位
        const areaRect = refAreaRef.current?.getBoundingClientRect()
        if (areaRect && isInRect(ev.clientX, ev.clientY, areaRect)) {
          setPlaced((prev) => prev.filter((p) => p.id !== opts.id))
        } else if (opts.fromOrigin) {
          movePlane(opts.id, opts.fromOrigin)
        }
      }
      updateDrag(null)
    }

    const onCancel = () => {
      cleanup()
      updateDrag(null)
    }

    const cleanup = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
  }

  /* ---------- 展示几何 ---------- */

  const shownPlanes = useMemo(() => {
    const list: PlacedPlane[] = []
    for (const p of placed) {
      if (drag && drag.source === 'placed' && drag.id === p.id) {
        if (drag.origin) list.push({ ...p, origin: drag.origin })
        // origin===null：拖离棋盘，本体隐藏（浮游幽灵跟随指针）
      } else {
        list.push(p)
      }
    }
    // ref 拖拽中的落点预览（id=-1，ghost 样式）
    if (drag && drag.source === 'ref' && drag.origin) {
      list.push({ id: -1, rotation: drag.rotation, origin: drag.origin })
    }
    return list
  }, [placed, drag])

  const overlappedIds = useMemo(() => {
    const ids = new Set<number>()
    const real = shownPlanes.filter((p) => p.id !== -1)
    for (const a of real) {
      const cellsA = occupiedCells(a, shape)
      for (const b of real) {
        if (a.id === b.id) continue
        const cellsB = occupiedCells(b, shape)
        if (cellsA.some((c) => cellsB.some((c2) => c2.r === c.r && c2.c === c.c))) {
          ids.add(a.id)
          ids.add(b.id)
        }
      }
    }
    // 落点预览与已放置重叠 → 预览红遮罩（松手时该位置也会被拒绝）
    if (drag && drag.source === 'ref' && drag.origin && overlapAt(drag.origin, drag.rotation, -1)) {
      ids.add(-1)
    }
    return Array.from(ids)
  }, [shownPlanes, placed, drag, shape])

  const reset = () => {
    setRefRotation(0)
    setPlaced([])
    nextIdRef.current = 1
    updateDrag(null)
  }

  return {
    refRotation,
    placed,
    shownPlanes,
    drag,
    overlappedIds,
    startRefDrag: (e) => startGesture(e, { id: -1, rotation: refRotation, source: 'ref' }),
    startPlacedDrag: (e, plane) =>
      startGesture(e, {
        id: plane.id,
        rotation: plane.rotation,
        source: 'placed',
        fromOrigin: plane.origin,
      }),
    reset,
  }
}

export interface ColoringToolButtonProps {
  /** 当前是否处于着色模式 */
  active: boolean
  color: ColoringColor
  paletteOpen: boolean
  /** 调色板展开方向（footer 处向上，避免被底部裁切） */
  paletteDir?: 'up' | 'down'
  onToggle: () => void
  onOpenPalette: () => void
  onClosePalette: () => void
  onSelectColor: (color: ColoringColor) => void
  className?: string
}

/** 长按判定阈值（ms） */
const LONG_PRESS_MS = 500

export function ColoringToolButton({
  active,
  color,
  paletteOpen,
  paletteDir = 'down',
  onToggle,
  onOpenPalette,
  onClosePalette,
  onSelectColor,
  className,
}: ColoringToolButtonProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const pressTimer = useRef(0)
  const longPressFired = useRef(false)

  // 调色板打开时：点击外部 / Esc 关闭。
  // 注意：页面会同时渲染横/竖两个按钮实例（按方向隐藏其一），两个实例都注册了本监听；
  // 因此"外部"必须按全局判定（目标不在任何 .coloring-tool 内），否则另一实例的监听
  // 会把本实例调色板里的点击误判为外部点击而提前关闭。
  useEffect(() => {
    if (!paletteOpen) return
    const onDown = (e: PointerEvent) => {
      const target = e.target as Element | null
      if (!target || !target.closest('.coloring-tool')) onClosePalette()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClosePalette()
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [paletteOpen, onClosePalette])

  const cancelPress = () => window.clearTimeout(pressTimer.current)

  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault()
    longPressFired.current = false
    cancelPress()
    pressTimer.current = window.setTimeout(() => {
      longPressFired.current = true
      onOpenPalette()
    }, LONG_PRESS_MS)
  }

  const handlePointerUp = () => {
    cancelPress()
    if (longPressFired.current) return // 长按已弹出调色板：松开不再切换模式
    onToggle()
  }

  return (
    <div ref={rootRef} className={['coloring-tool', className].filter(Boolean).join(' ')}>
      <button
        type="button"
        className={['coloring-btn', active ? 'coloring-btn--active' : ''].filter(Boolean).join(' ')}
        aria-label="着色工具"
        aria-pressed={active}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerLeave={cancelPress}
        onPointerCancel={cancelPress}
      >
        <PaletteIcon color={color} />
      </button>
      {paletteOpen ? (
        <div
          className={`coloring-palette coloring-palette--${paletteDir}`}
          role="group"
          aria-label="选择着色颜色"
        >
          {COLORING_COLORS.map(({ color: c, label }) => (
            <button
              key={c}
              type="button"
              className={[
                'coloring-swatch',
                `coloring-swatch--${c}`,
                c === color ? 'coloring-swatch--current' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              aria-label={label}
              aria-pressed={c === color}
              onClick={() => onSelectColor(c)}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

/** 调色盘图标（当前颜色圆点带描边环指示） */
function PaletteIcon({ color }: { color: ColoringColor }) {
  const dot = color === 'yellow' ? [8.3, 9.2] : color === 'blue' ? [12.6, 6.9] : [16.1, 10.3]
  return (
    <svg
      className="coloring-icon"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      aria-hidden="true"
    >
      <path
        d="M12 2.5a9.5 9.5 0 1 0 0 19c1.7 0 2.7-1.2 2-2.5-.4-.8-.2-1.5.3-2 .6-.5 1.5-.4 2.1.1.6.5 1.4.6 2.2.2.9-.5 1.4-1.4 1.4-2.5 0-6.6-4.3-12.3-10-12.3z"
        fill="var(--paper-sheet)"
        stroke="var(--ink)"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <circle className="coloring-icon__dot--yellow" cx="8.3" cy="9.2" r="1.8" />
      <circle className="coloring-icon__dot--blue" cx="12.6" cy="6.9" r="1.8" />
      <circle className="coloring-icon__dot--green" cx="16.1" cy="10.3" r="1.8" />
      <circle className="coloring-icon__ring" cx={dot[0]} cy={dot[1]} r="2.5" />
    </svg>
  )
}
