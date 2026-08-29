/**
 * components/placement/FleetPlacementBoard —— 摆阵交互棋盘（单机/联机共用）。
 *
 * 从 M4 Placement 抽取：待选牌组（扑克牌叠放：竖版横向交叠 / 横版纵向交叠，露出编号识别条；
 * 点击旋转/拖拽）、棋盘（拖拽吸附/旋转/重叠越界红遮罩）、浮游幽灵。
 * planes 为受控状态（父级持有），拖拽/旋转变化经 onPlanesChange 回传；
 * 托盘旋转记录在组件内部，飞机从网格拖回托盘后保持旋转。
 *
 * 父级职责：头部（标题/清空/随机/确认）、底部校验清单与状态、退出确认。
 */
import { useMemo, useRef, useState } from 'react'
import type { Cell, GridConfig, PlaneShape, PlacedPlane, Rotation } from '@aero/shared'
import { boundingBox, inBounds, occupiedCells, rotateShape } from '@aero/game-core'
import { useEffectiveOrientation, useViewport } from '../../hooks/useOrientation'
import { colLetter } from '../../lib/coord'
import { cellsBBox } from '../../lib/shape'
import { PlaneGlyph } from '../grid/PlaneGlyph'

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

/** 旋转后 cells 的最小行列（编辑器坐标）：origin 不是可视左上角，可视左上角 = origin + min */
function rotatedMin(shape: PlaneShape, rotation: Rotation): { r: number; c: number } {
  const b = cellsBBox(rotateShape(shape, rotation).cells)
  return b ? { r: b.r0, c: b.c0 } : { r: 0, c: 0 }
}

interface TrayItem {
  id: number
  rotation: Rotation
}

interface DragState {
  id: number
  rotation: Rotation
  source: 'tray' | 'grid'
  /** 当前吸附的 origin；指针不在棋盘上时为 null */
  origin: Cell | null
  /** 指针（client 坐标），用于浮游幽灵 */
  pointer: { x: number; y: number }
  /** 指针所在格 - 飞机可视左上角格（拖拽偏移） */
  grabOffset: { r: number; c: number }
  /** grid 来源：拖拽前的原 origin（取消拖拽时还原） */
  fromOrigin?: Cell
}

/** 牌组每张卡露出的识别条宽度（px）：竖版横向叠放时露出左侧条、横版纵向叠放时露出顶部条 */
const DECK_STRIP = 22

export interface FleetBoardProps {
  config: GridConfig
  planes: PlacedPlane[]
  onPlanesChange: (planes: PlacedPlane[]) => void
}

/** 重叠/越界机 id 集合（父级校验清单与棋盘红遮罩共用） */
export function fleetInvalidFlags(
  planes: PlacedPlane[],
  shape: PlaneShape,
  width: number,
  height: number,
): { outOfBoundsIds: Set<number>; overlapIds: Set<number> } {
  const outOfBoundsIds = new Set<number>()
  const overlapIds = new Set<number>()
  const occ = new Map<string, number>()
  for (const p of planes) {
    const cells = occupiedCells(p, shape)
    if (cells.some((c) => !inBounds(c, width, height))) outOfBoundsIds.add(p.id)
    for (const c of cells) {
      const key = `${c.r},${c.c}`
      const prev = occ.get(key)
      if (prev !== undefined) {
        overlapIds.add(prev)
        overlapIds.add(p.id)
      } else {
        occ.set(key, p.id)
      }
    }
  }
  return { outOfBoundsIds, overlapIds }
}

/** 摆阵校验三要素（数量/越界/重叠），供父级常驻清单使用 */
export function fleetCheckState(planes: PlacedPlane[], config: GridConfig) {
  const { width, height, planeCount, shape } = config
  const flags = fleetInvalidFlags(planes, shape, width, height)
  const countOk = planes.length === planeCount
  const boundsOk = flags.outOfBoundsIds.size === 0
  const overlapOk = flags.overlapIds.size === 0
  return { countOk, boundsOk, overlapOk, ok: countOk && boundsOk && overlapOk, flags }
}

export function FleetPlacementBoard({ config, planes, onPlanesChange }: FleetBoardProps) {
  const { width, height, planeCount, shape } = config
  const orientation = useEffectiveOrientation()
  const viewport = useViewport()

  const [drag, setDrag] = useState<DragState | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const [trayRot, setTrayRot] = useState<Record<number, Rotation>>({})
  const boardRef = useRef<HTMLDivElement>(null)
  const trayRef = useRef<HTMLDivElement>(null)

  const updateDrag = (d: DragState | null) => {
    dragRef.current = d
    setDrag(d)
  }

  /* ---------- 尺寸 ---------- */

  const cellSize = useMemo(() => {
    if (orientation === 'landscape') {
      const availW = viewport.width - 380
      const availH = viewport.height - 170
      return clamp(Math.floor(Math.min(availW / width, availH / height)), 10, 34)
    }
    const availW = viewport.width - 24
    const availH = viewport.height - 330
    return clamp(Math.floor(Math.min(availW / width, availH / height)), 8, 26)
  }, [orientation, viewport, width, height])

  /** 牌组卡片缩放（比棋盘格小，叠放后整体紧凑） */
  const deckCell = clamp(Math.floor(cellSize * 0.6), 10, 18)

  /* ---------- 托盘与校验 ---------- */

  const trayItems = useMemo<TrayItem[]>(() => {
    const placed = new Set(planes.map((p) => p.id))
    const items: TrayItem[] = []
    for (let id = 0; id < planeCount; id++) {
      if (!placed.has(id)) items.push({ id, rotation: trayRot[id] ?? 0 })
    }
    return items
  }, [planes, planeCount, trayRot])

  const invalidFlags = useMemo(
    () => fleetInvalidFlags(planes, shape, width, height),
    [planes, shape, width, height],
  )

  /* ---------- 摆放几何 ---------- */

  const visualTopLeft = (p: PlacedPlane) => {
    const min = rotatedMin(shape, p.rotation)
    return { r: p.origin.r + min.r, c: p.origin.c + min.c }
  }

  const snapOrigin = (visR: number, visC: number, rotation: Rotation): Cell => {
    const b = boundingBox(shape, rotation)
    const min = rotatedMin(shape, rotation)
    const vr = clamp(Math.round(visR), 0, height - b.h)
    const vc = clamp(Math.round(visC), 0, width - b.w)
    return { r: vr - min.r, c: vc - min.c }
  }

  const clampOriginForRotation = (origin: Cell, rotation: Rotation): Cell => {
    const b = boundingBox(shape, rotation)
    const min = rotatedMin(shape, rotation)
    const vr = clamp(origin.r + min.r, 0, height - b.h)
    const vc = clamp(origin.c + min.c, 0, width - b.w)
    return { r: vr - min.r, c: vc - min.c }
  }

  /* ---------- 操作 ---------- */

  const pointToCell = (clientX: number, clientY: number): { r: number; c: number } | null => {
    const rect = boardRef.current?.getBoundingClientRect()
    if (!rect) return null
    return { r: (clientY - rect.top) / cellSize, c: (clientX - rect.left) / cellSize }
  }

  const isInRect = (x: number, y: number, rect: DOMRect) =>
    x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom

  const rotateTrayItem = (id: number) => {
    setTrayRot((prev) => ({ ...prev, [id]: (((prev[id] ?? 0) + 1) % 4) as Rotation }))
  }

  const rotateGridPlane = (id: number) => {
    onPlanesChange(
      planes.map((p) => {
        if (p.id !== id) return p
        const rotation = ((p.rotation + 1) % 4) as Rotation
        return { ...p, rotation, origin: clampOriginForRotation(p.origin, rotation) }
      }),
    )
    setTrayRot((prev) => ({ ...prev, [id]: (((prev[id] ?? 0) + 1) % 4) as Rotation }))
  }

  const addToGrid = (id: number, rotation: Rotation, origin: Cell) => {
    onPlanesChange([...planes, { id, rotation, origin }])
  }

  const moveGridPlane = (id: number, origin: Cell) => {
    onPlanesChange(planes.map((p) => (p.id === id ? { ...p, origin } : p)))
  }

  const removeFromGridToTray = (id: number, rotation: Rotation) => {
    onPlanesChange(planes.filter((p) => p.id !== id))
    setTrayRot((prev) => ({ ...prev, [id]: rotation }))
  }

  const startDrag = (
    e: React.PointerEvent,
    id: number,
    rotation: Rotation,
    source: 'tray' | 'grid',
  ) => {
    e.preventDefault()
    e.stopPropagation()
    const boardRect = boardRef.current?.getBoundingClientRect()
    const trayRect = trayRef.current?.getBoundingClientRect()
    const down = { x: e.clientX, y: e.clientY, t: performance.now() }
    let moved = false

    let grabOffset = { r: 0, c: 0 }
    let fromOrigin: Cell | undefined
    if (source === 'grid') {
      const plane = planes.find((p) => p.id === id)
      const pc = boardRect ? pointToCell(e.clientX, e.clientY) : null
      if (plane && pc) {
        const vis = visualTopLeft(plane)
        grabOffset = { r: pc.r - vis.r, c: pc.c - vis.c }
      }
      fromOrigin = plane?.origin
    }

    const onMove = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - down.x, ev.clientY - down.y) >= 6) moved = true
      const pc = boardRect ? pointToCell(ev.clientX, ev.clientY) : null
      const overBoard = boardRect ? isInRect(ev.clientX, ev.clientY, boardRect) : false
      const origin = pc && overBoard ? snapOrigin(pc.r - grabOffset.r, pc.c - grabOffset.c, rotation) : null
      updateDrag({
        id,
        rotation,
        source,
        origin,
        pointer: { x: ev.clientX, y: ev.clientY },
        grabOffset,
        fromOrigin,
      })
    }

    const onUp = (ev: PointerEvent) => {
      cleanup()
      const dist = Math.hypot(ev.clientX - down.x, ev.clientY - down.y)
      const dur = performance.now() - down.t
      const d = dragRef.current

      // 点击 → 顺时针旋转 90°
      if (!moved && dist < 6 && dur < 300) {
        if (source === 'tray') rotateTrayItem(id)
        else rotateGridPlane(id)
        updateDrag(null)
        return
      }

      if (source === 'tray') {
        if (d?.origin) addToGrid(id, rotation, d.origin)
        // 否则留在托盘
      } else if (d?.origin) {
        moveGridPlane(id, d.origin)
      } else {
        const overTray = trayRect ? isInRect(ev.clientX, ev.clientY, trayRect) : false
        if (overTray) removeFromGridToTray(id, rotation)
        else if (fromOrigin) moveGridPlane(id, fromOrigin)
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

  /* ---------- 渲染几何 ---------- */

  const dragBox = drag ? boundingBox(shape, drag.rotation) : null
  const dragMin = drag ? rotatedMin(shape, drag.rotation) : null
  const ghostLeft = drag ? drag.pointer.x - drag.grabOffset.c * cellSize : 0
  const ghostTop = drag ? drag.pointer.y - drag.grabOffset.r * cellSize : 0

  /* ---------- 待选牌组（扑克牌叠放） ---------- */

  const deck = useMemo(() => {
    if (trayItems.length === 0) return null
    const dims = trayItems.map((t) => {
      const b = boundingBox(shape, t.rotation)
      return { w: b.w * deckCell, h: b.h * deckCell }
    })
    const maxW = Math.max(...dims.map((d) => d.w))
    const maxH = Math.max(...dims.map((d) => d.h))
    const n = trayItems.length
    return {
      items: trayItems,
      dims,
      width: orientation === 'landscape' ? maxW : (n - 1) * DECK_STRIP + maxW,
      height: orientation === 'landscape' ? (n - 1) * DECK_STRIP + maxH : maxH,
    }
  }, [trayItems, shape, deckCell, orientation])

  const deckCard = (item: TrayItem, index: number, dim: { w: number; h: number }) => (
    <div
      key={item.id}
      className={['placement__deck-card', drag?.id === item.id ? 'placement__deck-card--dim' : '']
        .filter(Boolean)
        .join(' ')}
      style={{
        width: dim.w,
        height: dim.h,
        left: orientation === 'landscape' ? 0 : index * DECK_STRIP,
        top: orientation === 'landscape' ? index * DECK_STRIP : 0,
        zIndex: index + 1,
      }}
      onPointerDown={(e) => startDrag(e, item.id, item.rotation, 'tray')}
      title="点击旋转 90°，拖拽到棋盘摆放"
      role="button"
      aria-label={`托盘中的第 ${item.id + 1} 架飞机，点击旋转，拖拽摆放`}
    >
      <PlaneGlyph shape={shape} rotation={item.rotation} />
      <span className="placement__deck-no" aria-hidden="true">
        {item.id + 1}
      </span>
    </div>
  )

  return (
    <div className="placement__body">
      {/* 待选牌组（竖版横向叠放于棋盘上方 / 横版纵向叠放于棋盘左侧） */}
      <section ref={trayRef} className="placement__tray" aria-label="飞机托盘">
        {deck ? (
          <div
            className={`placement__deck placement__deck--${orientation}`}
            style={{ width: deck.width, height: deck.height }}
          >
            {deck.items.map((item, i) => deckCard(item, i, deck.dims[i]!))}
          </div>
        ) : (
          <span className="placement__tray-empty">全部飞机已上棋盘</span>
        )}
      </section>

      {/* 棋盘 */}
      <section className="placement__board-wrap">
        <div className="paper-grid">
          <div className="paper-grid__cols" style={{ marginLeft: 20, height: 15 }}>
            {Array.from({ length: width }, (_, c) => (
              <span key={c} className="paper-grid__col" style={{ width: cellSize }}>
                {colLetter(c)}
              </span>
            ))}
          </div>
          <div className="paper-grid__body">
            <div className="paper-grid__rows" style={{ width: 20 }}>
              {Array.from({ length: height }, (_, r) => (
                <span key={r} className="paper-grid__row" style={{ height: cellSize }}>
                  {r + 1}
                </span>
              ))}
            </div>
            <div
              ref={boardRef}
              className="paper-grid__board placement__board"
              role="group"
              aria-label={`${width}×${height} 摆阵棋盘`}
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${width}, ${cellSize}px)`,
                gridTemplateRows: `repeat(${height}, ${cellSize}px)`,
                width: width * cellSize,
                height: height * cellSize,
              }}
            >
              {Array.from({ length: height }, (_, r) =>
                Array.from({ length: width }, (_, c) => (
                  <div
                    key={`${r}-${c}`}
                    className="paper-grid__cell"
                    style={{ gridColumn: c + 1, gridRow: r + 1 }}
                  />
                )),
              )}

              {/* 已摆放飞机 */}
              {planes.map((p) => {
                const isDragged = drag?.id === p.id && drag.source === 'grid'
                const shown = isDragged && drag?.origin ? { ...p, origin: drag.origin } : p
                const b = cellsBBox(occupiedCells(shown, shape))
                if (!b) return null
                const invalid =
                  invalidFlags.outOfBoundsIds.has(p.id) || invalidFlags.overlapIds.has(p.id)
                const hidden = isDragged && drag !== null && drag.origin === null
                return (
                  <div
                    key={p.id}
                    className={[
                      'placement__plane',
                      invalid ? 'placement__plane--invalid' : '',
                      isDragged ? 'placement__plane--dragging' : '',
                      hidden ? 'placement__plane--hidden' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    style={{
                      left: b.c0 * cellSize,
                      top: b.r0 * cellSize,
                      width: (b.c1 - b.c0 + 1) * cellSize,
                      height: (b.r1 - b.r0 + 1) * cellSize,
                    }}
                    onPointerDown={(e) => startDrag(e, p.id, p.rotation, 'grid')}
                    title="点击旋转 90°，拖拽移动，拖回托盘回收"
                    role="button"
                    aria-label={`第 ${p.id + 1} 号飞机，点击旋转，拖拽移动`}
                  >
                    <PlaneGlyph shape={shape} rotation={shown.rotation} />
                    {invalid ? <div className="placement__plane-overlay" aria-hidden="true" /> : null}
                  </div>
                )
              })}

              {/* 托盘来源拖拽的落点预览 */}
              {drag && drag.source === 'tray' && drag.origin && dragBox && dragMin ? (
                <div
                  className="placement__plane placement__plane--preview"
                  style={{
                    left: (drag.origin.c + dragMin.c) * cellSize,
                    top: (drag.origin.r + dragMin.r) * cellSize,
                    width: dragBox.w * cellSize,
                    height: dragBox.h * cellSize,
                  }}
                  aria-hidden="true"
                >
                  <PlaneGlyph shape={shape} rotation={drag.rotation} />
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      {/* 浮游幽灵（指针跟随） */}
      {drag && dragBox && dragMin && (drag.source === 'tray' || drag.origin === null) ? (
        <div
          className="placement__ghost"
          style={{
            left: ghostLeft,
            top: ghostTop,
            width: dragBox.w * cellSize,
            height: dragBox.h * cellSize,
          }}
          aria-hidden="true"
        >
          <PlaneGlyph shape={shape} rotation={drag.rotation} />
        </div>
      ) : null}
    </div>
  )
}
