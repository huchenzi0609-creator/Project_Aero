/**
 * Placement —— 单机摆阵页（M4 交付物 1）。
 *
 * 交互：
 * - 托盘（竖版上 / 横版左）放 n 架同形状飞机（PlaneGlyph 可旋转）；
 * - 指针按下后位移 <6px 且 <300ms 松开 = 点击 → 顺时针旋转 90°（托盘与网格内均可）；
 * - 否则为拖拽 → 松手吸附最近格（可视左上角取整后夹取保证在界内）；可拖回托盘回收；
 * - "清空重摆" / "随机摆阵"（game-core generateFleet，难度 = settings.difficulty）；
 * - 重叠 / 越界飞机叠加中等透明度红色遮罩；常驻校验清单（数量/越界/重叠），
 *   全部通过才亮"确认"；未通过时点确认弹 Toast 列出未满足项。
 *
 * 确认后：gameStore.begin() → createGame + setFleet(0, 我方) + AI generateFleet + setFleet(1)。
 */
import { useMemo, useRef, useState } from 'react'
import type { Cell, PlaneShape, PlacedPlane, Rotation } from '@aero/shared'
import { boundingBox, inBounds, occupiedCells, rotateShape, validateFleet } from '@aero/game-core'
import { generateFleet, mulberry32 } from '@aero/game-core/ai'
import { useAppStore } from '../store/appStore'
import { useSettingsStore } from '../store/settingsStore'
import { useToastStore } from '../store/toastStore'
import { useGameStore } from '../store/gameStore'
import { audioService } from '../lib/audioService'
import { useEffectiveOrientation, useViewport } from '../hooks/useOrientation'
import { PaperButton } from '../components/ui/PaperButton'
import { PaperModal } from '../components/ui/PaperModal'
import { PlaneGlyph } from '../components/grid/PlaneGlyph'
import { cellsBBox } from '../lib/shape'
import { colLetter } from '../lib/coord'

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

const DIFFICULTY_LABEL: Record<string, string> = {
  easy: '简单',
  normal: '正常',
  hard: '困难',
  hell: '地狱',
}

export function Placement() {
  const config = useAppStore((s) => s.gridConfig)
  const setView = useAppStore((s) => s.setView)
  const placementOrigin = useAppStore((s) => s.placementOrigin)
  const toast = useToastStore((s) => s.push)
  const begin = useGameStore((s) => s.begin)

  const orientation = useEffectiveOrientation()
  const viewport = useViewport()
  const difficulty = useSettingsStore((s) => s.difficulty)

  const { width, height, planeCount, shape } = config

  const [tray, setTray] = useState<TrayItem[]>(() =>
    Array.from({ length: planeCount }, (_, i) => ({ id: i, rotation: 0 as Rotation })),
  )
  const [grid, setGrid] = useState<PlacedPlane[]>([])
  const [drag, setDrag] = useState<DragState | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const boardRef = useRef<HTMLDivElement>(null)
  const trayRef = useRef<HTMLDivElement>(null)
  const [exitOpen, setExitOpen] = useState(false)

  const updateDrag = (d: DragState | null) => {
    dragRef.current = d
    setDrag(d)
  }

  /* ---------- 尺寸 ---------- */

  const cellSize = useMemo(() => {
    if (orientation === 'landscape') {
      // 托盘在左（约 6 格宽），顶部留 120px，底部控制条 60px
      const availW = viewport.width - 380
      const availH = viewport.height - 170
      return clamp(Math.floor(Math.min(availW / width, availH / height)), 10, 34)
    }
    // 竖版：托盘在上，棋盘占余下高度
    const availW = viewport.width - 24
    const availH = viewport.height - 330
    return clamp(Math.floor(Math.min(availW / width, availH / height)), 8, 26)
  }, [orientation, viewport, width, height])

  /* ---------- 摆放几何 ---------- */

  /** 飞机可视左上角（棋盘格坐标，可含小数由调用方取整） */
  const visualTopLeft = (p: PlacedPlane) => {
    const min = rotatedMin(shape, p.rotation)
    return { r: p.origin.r + min.r, c: p.origin.c + min.c }
  }

  /** 按可视左上角格位（float）吸附 origin：取整后夹取到界内 */
  const snapOrigin = (visR: number, visC: number, rotation: Rotation): Cell => {
    const b = boundingBox(shape, rotation)
    const min = rotatedMin(shape, rotation)
    const vr = clamp(Math.round(visR), 0, height - b.h)
    const vc = clamp(Math.round(visC), 0, width - b.w)
    return { r: vr - min.r, c: vc - min.c }
  }

  /** 旋转后夹取 origin，保证旋转后仍全部在界内 */
  const clampOriginForRotation = (origin: Cell, rotation: Rotation): Cell => {
    const b = boundingBox(shape, rotation)
    const min = rotatedMin(shape, rotation)
    const vr = clamp(origin.r + min.r, 0, height - b.h)
    const vc = clamp(origin.c + min.c, 0, width - b.w)
    return { r: vr - min.r, c: vc - min.c }
  }

  /* ---------- 校验 ---------- */

  const invalidFlags = useMemo(() => {
    const outOfBoundsIds = new Set<number>()
    const overlapIds = new Set<number>()
    const occ = new Map<string, number>()
    for (const p of grid) {
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
  }, [grid, shape, width, height])

  const countOk = grid.length === planeCount
  const boundsOk = invalidFlags.outOfBoundsIds.size === 0
  const overlapOk = invalidFlags.overlapIds.size === 0
  const canConfirm = countOk && boundsOk && overlapOk

  /* ---------- 操作 ---------- */

  const pointToCell = (clientX: number, clientY: number): { r: number; c: number } | null => {
    const rect = boardRef.current?.getBoundingClientRect()
    if (!rect) return null
    return { r: (clientY - rect.top) / cellSize, c: (clientX - rect.left) / cellSize }
  }

  const isInRect = (x: number, y: number, rect: DOMRect) =>
    x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom

  const rotateTrayItem = (id: number) => {
    setTray((prev) =>
      prev.map((t) => (t.id === id ? { ...t, rotation: ((t.rotation + 1) % 4) as Rotation } : t)),
    )
  }

  const rotateGridPlane = (id: number) => {
    setGrid((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p
        const rotation = ((p.rotation + 1) % 4) as Rotation
        return { ...p, rotation, origin: clampOriginForRotation(p.origin, rotation) }
      }),
    )
  }

  const addToGrid = (id: number, rotation: Rotation, origin: Cell) => {
    setGrid((prev) => [...prev, { id, rotation, origin }])
    setTray((prev) => prev.filter((t) => t.id !== id))
  }

  const moveGridPlane = (id: number, origin: Cell) => {
    setGrid((prev) => prev.map((p) => (p.id === id ? { ...p, origin } : p)))
  }

  const removeFromGridToTray = (id: number, rotation: Rotation) => {
    setGrid((prev) => prev.filter((p) => p.id !== id))
    setTray((prev) => [...prev, { id, rotation }])
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
      const plane = grid.find((p) => p.id === id)
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
        // 网格来源：落在托盘 → 回收；落在空白 → 还原
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

  const clearAll = () => {
    setTray((prev) => [
      ...prev,
      ...grid.map((p) => ({ id: p.id, rotation: p.rotation })),
    ])
    setGrid([])
  }

  const randomFleet = () => {
    const difficulty = useSettingsStore.getState().difficulty
    const rng = mulberry32(((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0) || 1)
    try {
      const fleet = generateFleet(width, height, planeCount, shape, difficulty, rng)
      setGrid(fleet)
      setTray([])
      toast(`已按「${DIFFICULTY_LABEL[difficulty] ?? difficulty}」难度随机摆阵`, 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : '随机摆阵失败，请手动摆放', 'error')
    }
  }

  const confirm = () => {
    if (!canConfirm) {
      const v = validateFleet(width, height, planeCount, shape, grid)
      const errors = v.ok
        ? [
            ...(!countOk ? [`飞机数量不足：${grid.length}/${planeCount} 架`] : []),
            ...(!boundsOk ? ['有飞机超出边界'] : []),
            ...(!overlapOk ? ['存在飞机重叠'] : []),
          ]
        : v.errors
      toast(`摆阵未通过：${errors.join('；')}`, 'error')
      return
    }
    const res = begin(config, grid)
    if (!res.ok) {
      toast(res.errors.join('；'), 'error')
      return
    }
    audioService.playSfx('page-flip')
    setView('game')
  }

  const back = () => {
    setView(placementOrigin === 'custom' ? 'custom' : 'single')
  }

  /* ---------- 渲染几何 ---------- */

  const dragBox = drag ? boundingBox(shape, drag.rotation) : null
  const dragMin = drag ? rotatedMin(shape, drag.rotation) : null
  const ghostLeft = drag ? drag.pointer.x - drag.grabOffset.c * cellSize : 0
  const ghostTop = drag ? drag.pointer.y - drag.grabOffset.r * cellSize : 0

  const traySlot = (item: TrayItem) => {
    const b = boundingBox(shape, item.rotation)
    return (
      <div
        key={item.id}
        className={['placement__slot', drag?.id === item.id ? 'placement__slot--dim' : '']
          .filter(Boolean)
          .join(' ')}
        style={{ width: b.w * cellSize, height: b.h * cellSize }}
        onPointerDown={(e) => startDrag(e, item.id, item.rotation, 'tray')}
        title="点击旋转 90°，拖拽到棋盘摆放"
        role="button"
        aria-label={`托盘中的第 ${item.id + 1} 架飞机，点击旋转，拖拽摆放`}
      >
        <PlaneGlyph shape={shape} rotation={item.rotation} />
      </div>
    )
  }

  const checkItems = [
    { key: 'count', label: '数量', pass: countOk, detail: `${grid.length} / ${planeCount} 架` },
    { key: 'bounds', label: '越界', pass: boundsOk, detail: `${invalidFlags.outOfBoundsIds.size} 架` },
    { key: 'overlap', label: '重叠', pass: overlapOk, detail: `${invalidFlags.overlapIds.size} 架` },
  ]

  return (
    <div className={`placement placement--${orientation}`}>
      <header className="placement__head">
        <PaperButton size="sm" variant="ghost" onClick={() => setExitOpen(true)}>
          ← 返回
        </PaperButton>
        <div>
          <h1 className="page__title" style={{ fontSize: 22 }}>
            摆阵 · 单人对局
          </h1>
          <p className="page__subtitle" style={{ fontSize: 13 }}>
            {width}×{height} · {planeCount} 架飞机 · 难度：{DIFFICULTY_LABEL[difficulty] ?? '正常'}
            <span className="placement__hint"> 点击飞机旋转 · 拖拽摆放 · 拖回托盘回收</span>
          </p>
        </div>
        <div className="placement__controls">
          <PaperButton size="sm" variant="ghost" onClick={clearAll} disabled={grid.length === 0}>
            清空重摆
          </PaperButton>
          <PaperButton size="sm" variant="ghost" onClick={randomFleet} disabled={grid.length === planeCount}>
            随机摆阵
          </PaperButton>
          <PaperButton
            size="sm"
            variant="primary"
            className={canConfirm ? '' : 'placement__confirm--pending'}
            onClick={confirm}
          >
            确认布阵
          </PaperButton>
        </div>
      </header>

      <div className="placement__body">
        {/* 托盘 */}
        <section ref={trayRef} className="placement__tray" aria-label="飞机托盘">
          {tray.map(traySlot)}
          {tray.length === 0 ? <span className="placement__tray-empty">全部飞机已上棋盘</span> : null}
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
                    <div key={`${r}-${c}`} className="paper-grid__cell" style={{ gridColumn: c + 1, gridRow: r + 1 }} />
                  )),
                )}

                {/* 已摆放飞机 */}
                {grid.map((p) => {
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
      </div>

      {/* 底部：常驻校验清单 */}
      <footer className="placement__foot">
        <ul className="checklist placement__checklist">
          {checkItems.map((item) => (
            <li key={item.key} className="checklist__item">
              <span className={['checklist__mark', item.pass ? 'checklist__mark--ok' : 'checklist__mark--no'].join(' ')}>
                {item.pass ? '✓' : '✗'}
              </span>
              <span>{item.label}</span>
              <span className="checklist__detail">{item.detail}</span>
            </li>
          ))}
        </ul>
        <span className="placement__status" role="status" aria-live="polite">
          {canConfirm ? '校验通过，可以确认布阵！' : '校验未通过，请调整飞机位置'}
        </span>
      </footer>

      {/* 浮游幽灵（指针跟随；网格内拖拽时飞机本体已实时吸附，不重复渲染） */}
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

      <PaperModal
        open={exitOpen}
        title="退出摆阵？"
        onClose={() => setExitOpen(false)}
        footer={
          <>
            <PaperButton variant="ghost" onClick={() => setExitOpen(false)}>
              继续摆阵
            </PaperButton>
            <PaperButton variant="danger" onClick={back}>
              确认退出
            </PaperButton>
          </>
        }
      >
        返回后当前摆放将丢失，尚未开始的单人对局不会记录。
      </PaperModal>
    </div>
  )
}
