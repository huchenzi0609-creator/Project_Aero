/**
 * ColoringTool —— 对局工具（v0.2.2，单机 + 联机）：着色 + 样式参考飞机拖拽。
 * v0.3.0：新增幽灵飞机（ghostRects）着色支持 —— useColoring(opts) 增补 `paintAt` 入口
 * （整机批量染/擦 + 快捷着色回调 onGhostBatch，组件只发事件，页面回收幽灵）。
 * v0.3.4：着色【仅点击批量】—— paintAt 不再对拖拽路径中的幽灵格做整机批染：
 *   只有「点击」（pointerdown 与 pointerup 位移 ≤ 拖拽阈值 6px，且按下格命中幽灵飞机）
 *   才整机批染并（开启快捷着色时）回调 onGhostBatch；
 *   真实拖拽路径擦过幽灵格按普通路径格染色（不批量、不回调）。
 *   判定依赖页面以 capture 监听棋盘 pointerdown/move/up 并转发
 *   gestureStart(x,y) / gestureMove(x,y) / gestureEnd()（详见 ColoringState）。
 * v0.3.4：useRefPlanes 新增 removePlaced(id: string) —— 把幽灵飞机（放置副本）从
 *   placed 数组真移除（含拖拽中残留同步清理），移除后原位置即可重新放置。
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
import { useSettingsStore } from '../../store/settingsStore'
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

/* ============================================================
   幽灵飞机（v0.3.0）：ghostRects / quickColor / onGhostBatch
   ============================================================ */

/** 幽灵飞机：id + 占据的全部棋盘格位（含机身与机头；生命周期由页面端维护，组件只读） */
export interface GhostRect {
  id: string
  cells: Cell[]
}

/** useColoring 的 v0.3.0 幽灵着色选项（页面端传入） */
export interface GhostColoringOptions {
  /** 当前在场的幽灵飞机占据格列表（可选；缺省关闭幽灵着色逻辑） */
  ghostRects?: readonly GhostRect[]
  /** 快捷着色：整机被着色后是否请求页面回收幽灵；缺省读 settingsStore.quickColor（默认 true） */
  quickColor?: boolean
  /**
   * 幽灵飞机被整机批量【着色】后的回调（组件只发事件）。
   * 页面据此退出着色模式并消灭该幽灵飞机（v0.3.4：建议调 useRefPlanes.removePlaced(id) 真移除）。
   * 注意：仅「点击命中幽灵且整机被着色」触发；拖拽路径擦过幽灵、或整机【擦除】还原为未染色时【不】触发。
   */
  onGhostBatch?: (id: string, cells: Cell[]) => void
}

/** 点击 vs 拖拽的位移阈值（px，与摆放/拖拽手势一致） */
export const COLORING_CLICK_DRAG_THRESHOLD_PX = 6

/** 返回覆盖该格位的幽灵飞机（无则 null） */
export function ghostRectAt(
  ghostRects: readonly GhostRect[] | undefined,
  coord: Cell,
): GhostRect | null {
  if (!ghostRects) return null
  for (const g of ghostRects) {
    if (g.cells.some((c) => c.r === coord.r && c.c === coord.c)) return g
  }
  return null
}

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
  /**
   * v0.3.0 / v0.3.4 着色入口（建议作为 PaperGrid `coloring.onPaint` 的实参）。
   *
   * 整机批量染/擦（paintPlane 语义）【仅点击】触发：
   * - 点击 = pointerdown 与 pointerup 位移 ≤ COLORING_CLICK_DRAG_THRESHOLD_PX（6px），
   *   且按下格命中幽灵飞机（ghostRects）。
   * - 点击幽灵：整机批量染/擦；若快捷着色开启且整机被着色，再回调 onGhostBatch(id, cells)
   *   （页面据此退出着色模式并回收幽灵）。
   * - 真实拖拽路径经过幽灵格：按普通路径格染色（不整机批量、不触发 onGhostBatch）。
   * - 未命中幽灵时与 paintCell 完全一致。
   *
   * ⚠ 点击判定依赖页面喂入手势事件（本 hook 无法从 PaperGrid 的单格 onPaint 流中分辨点击/拖拽）：
   * 在着色棋盘容器上以 capture 监听 pointerdown/pointermove/pointerup|pointercancel，
   * 按下期间转发 gestureStart(x, y) / gestureMove(x, y)，结束时调用 gestureEnd()。
   * （pointerdown 的 capture 先于 PaperGrid 的染色调用执行，顺序天然正确。）
   * 若页面未喂入手势事件（gesture.active=false），本函数保守退化为普通单格染色——不误伤拖拽，
   * 但也不会做幽灵整机批染；接入三个手势方法后即获得完整语义。
   */
  paintAt: (coord: Cell, brush: PaintBrush) => void
  /**
   * v0.3.4 手势开始：页面在着色棋盘上用 capture 监听 pointerdown 后调用
   * （须先于 PaperGrid 对按下格发起的 onPaint）。x/y 为视口坐标（用于位移判定）。
   */
  gestureStart: (x: number, y: number) => void
  /** v0.3.4 手势移动：capture 监听 pointermove（按下期间）调用；位移超过阈值即标记拖拽 */
  gestureMove: (x: number, y: number) => void
  /** v0.3.4 手势结束：capture 监听 pointerup / pointercancel 调用；点击时结算暂存的幽灵整机批染 */
  gestureEnd: () => void
  /** 新对局清空（每局独立） */
  reset: () => void
}

/** 手势追踪内部状态（点击/拖拽判定） */
interface GestureTrack {
  active: boolean
  downX: number
  downY: number
  /** 手势内第一个被着色的格（PaperGrid 在 pointerdown 时先行染色 → 即按下格） */
  startCell: Cell | null
  /** 位移已超过拖拽阈值或已出现第二格 → 本次为拖拽，路径格一律普通染色 */
  dragged: boolean
  /** 点击候选：按下格命中幽灵，等待 gestureEnd 结算为整机批染 */
  pending:
    | { ghost: GhostRect; coord: Cell; hit: ColoringColor | null; brush: PaintBrush }
    | null
}

export function useColoring(options?: GhostColoringOptions): ColoringState {
  const settingsQuickColor = useSettingsStore((s) => s.quickColor)
  const { ghostRects, quickColor = settingsQuickColor, onGhostBatch } = options ?? {}
  const [coloredCells, setColoredCells] = useState<ColoredCell[]>([])
  const [coloringMode, setColoringMode] = useState(false)
  const [currentColor, setCurrentColor] = useState<ColoringColor>('yellow')
  const [paletteOpen, setPaletteOpen] = useState(false)

  /** 手势追踪：供 paintAt 分辨「点击」与「拖拽路径」（由页面 capture 转发指针事件） */
  const gestureRef = useRef<GestureTrack>({
    active: false,
    downX: 0,
    downY: 0,
    startCell: null,
    dragged: false,
    pending: null,
  })

  /** 拖拽被确认时：把暂存的"点击候选"按普通路径格结算（按下格普通单格染色） */
  const flushPendingAsPlain = () => {
    const g = gestureRef.current
    const p = g.pending
    g.pending = null
    if (p) paintCell(p.coord, p.brush)
  }

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

  /** 整机批量染/擦核心（与 paintPlane 同一语义，供放置副本与幽灵共用） */
  const applyPlane = (prev: ColoredCell[], planeCells: Cell[], hitColor: ColoringColor | null): ColoredCell[] => {
    const inPlane = (c: ColoredCell) =>
      planeCells.some((pc) => pc.r === c.coord.r && pc.c === c.coord.c)
    if (hitColor === currentColor) {
      // 命中格同色 → 整机还原为未染色
      return prev.filter((c) => !inPlane(c))
    }
    // 命中格异色/未染色 → 整机染当前色（覆盖）
    const without = prev.filter((c) => !inPlane(c))
    return [...without, ...planeCells.map((pc) => ({ coord: pc, color: currentColor }))]
  }

  const paintPlane = (planeCells: Cell[], hitColor: ColoringColor | null) => {
    setColoredCells((prev) => applyPlane(prev, planeCells, hitColor))
  }

  const paintAt = (coord: Cell, brush: PaintBrush) => {
    const g = gestureRef.current
    // 手势开始后首个被染色的格 = 按下格（PaperGrid 在 pointerdown 先染起始格）
    if (g.active && g.startCell === null) g.startCell = coord
    // 出现第二格（或位移超阈值）→ 本次实为拖拽：先结算暂存候选为普通格
    if (g.pending && !(g.startCell && g.startCell.r === coord.r && g.startCell.c === coord.c)) {
      flushPendingAsPlain()
      g.dragged = true
    }
    // 点击候选：按下格命中幽灵飞机 → 暂存整机批染，待 gestureEnd 结算
    if (g.active && !g.dragged && !g.pending) {
      const startHit = g.startCell && g.startCell.r === coord.r && g.startCell.c === coord.c
      if (startHit) {
        const ghost = ghostRectAt(ghostRects, coord)
        if (ghost) {
          const hit = coloredCells.find((c) => c.coord.r === coord.r && c.coord.c === coord.c)?.color ?? null
          g.pending = { ghost, coord, hit, brush }
          return // 暂存：本格不立即染色
        }
      }
    }
    paintCell(coord, brush)
  }

  /** 手势开始（页面 capture pointerdown 转发；须先于 PaperGrid 染起始格） */
  const gestureStart = (x: number, y: number) => {
    gestureRef.current = {
      active: true,
      downX: x,
      downY: y,
      startCell: null,
      dragged: false,
      pending: null,
    }
  }

  /** 手势移动（页面 capture pointermove 转发；按下期间）：位移超阈值 → 判定拖拽 */
  const gestureMove = (x: number, y: number) => {
    const g = gestureRef.current
    if (!g.active) return
    if (Math.hypot(x - g.downX, y - g.downY) >= COLORING_CLICK_DRAG_THRESHOLD_PX) {
      g.dragged = true
      flushPendingAsPlain()
    }
  }

  /** 手势结束（页面 capture pointerup / pointercancel 转发）：点击 → 结算整机批染 */
  const gestureEnd = () => {
    const g = gestureRef.current
    if (!g.active) return
    g.active = false
    const p = g.pending
    g.pending = null
    if (p && !g.dragged) {
      // 点击命中幽灵：整机批量染/擦（paintPlane 语义）
      const painting = p.brush === 'paint' && p.hit !== currentColor
      setColoredCells((prev) => applyPlane(prev, p.ghost.cells, p.hit))
      // 快捷着色：整机被着色 → 通知页面回收幽灵（擦除不回收）
      if (quickColor && painting && onGhostBatch) {
        onGhostBatch(p.ghost.id, p.ghost.cells)
      }
    }
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
    gestureRef.current = {
      active: false,
      downX: 0,
      downY: 0,
      startCell: null,
      dragged: false,
      pending: null,
    }
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
    paintAt,
    gestureStart,
    gestureMove,
    gestureEnd,
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
  /**
   * v0.3.4 幽灵真消灭：把 id 对应的放置副本（幽灵飞机）从 placed 数组【真实移除】，
   * 移除后该位置即可重新放置；若该副本正处于拖拽中则同步结束拖拽（清理残留预览）。
   * id 按字符串比较（放置副本 id 为自增数字，传入 String(id) 即可；页面端幽灵
   * GhostRect.id 即 String(placed.id)，可直接透传）。
   */
  removePlaced: (id: string) => void
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
    // v0.2.7：仅【飞机本体占位格】命中才响应（旋转/拖拽/批量着色）；
    // 包围盒空白格点击不消耗事件（穿透给下方棋盘：着色/报点等交互不受阻断）
    const hitKey = (e.target as HTMLElement).closest('[data-cell]')?.getAttribute('data-cell')
    const hitMatch = hitKey ? /^(\d+),(\d+)$/.exec(hitKey) : null
    const hitCell = hitMatch ? { r: Number(hitMatch[1]), c: Number(hitMatch[2]) } : null
    const bodyCells = occupiedCells(
      { id: opts.id, rotation: opts.rotation, origin: opts.fromOrigin ?? { r: 0, c: 0 } },
      shape,
    )
    if (!hitCell || !bodyCells.some((c) => c.r === hitCell.r && c.c === hitCell.c)) return

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

  /** v0.3.4：真移除放置副本（幽灵飞机）；若正处于拖拽中同步结束拖拽 */
  const removePlaced = (id: string) => {
    setPlaced((prev) => prev.filter((p) => String(p.id) !== id))
    const d = dragRef.current
    if (d && d.source === 'placed' && String(d.id) === id) updateDrag(null)
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
    removePlaced,
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
