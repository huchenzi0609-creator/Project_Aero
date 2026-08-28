/**
 * 轻量形状工具（仅 UI 展示与本地校验用，避免在 M1 完成前 import game-core 的 WIP 抛错函数）。
 * 旋转 / 包围盒 / 连通性 BFS / 校验清单 / 随机摆阵（对局页演示桩）。
 */
import type { Cell, PlaneShape, PlacedPlane, Rotation } from '@aero/shared'
import { SHAPE_MAX_CELLS, SHAPE_MIN_CELLS, SHAPE_SIZE } from '@aero/shared'

export const EDITOR_SIZE = SHAPE_SIZE

/** 90° 顺时针旋转一格（在 5×5 编辑器坐标系内） */
function rotateCellCW90(c: Cell): Cell {
  return { r: c.c, c: SHAPE_SIZE - 1 - c.r }
}

/** 将 cells 平移到 (0,0) 起始的规范化坐标 */
export function normalizeShape(shape: PlaneShape): PlaneShape {
  if (shape.cells.length === 0) return shape
  const minR = Math.min(...shape.cells.map((p) => p.r))
  const minC = Math.min(...shape.cells.map((p) => p.c))
  const shift = (p: Cell): Cell => ({ r: p.r - minR, c: p.c - minC })
  return { cells: shape.cells.map(shift), head: shift(shape.head) }
}

/** 旋转 shape（旋转后自动规范化） */
export function rotateShape(shape: PlaneShape, times: Rotation): PlaneShape {
  let cells = shape.cells
  let head = shape.head
  for (let i = 0; i < times; i++) {
    cells = cells.map(rotateCellCW90)
    head = rotateCellCW90(head)
  }
  return normalizeShape({ cells, head })
}

/** 包围盒（含最小/最大行列） */
export function shapeBBox(cells: Cell[]): { r0: number; c0: number; r1: number; c1: number } | null {
  if (cells.length === 0) return null
  let r0 = Infinity
  let c0 = Infinity
  let r1 = -Infinity
  let c1 = -Infinity
  for (const p of cells) {
    r0 = Math.min(r0, p.r)
    c0 = Math.min(c0, p.c)
    r1 = Math.max(r1, p.r)
    c1 = Math.max(c1, p.c)
  }
  return { r0, c0, r1, c1 }
}

/** 摆放后的飞机实际占据的棋盘格位（旋转 + 平移） */
export function placedCells(plane: PlacedPlane, shape: PlaneShape): Cell[] {
  const rotated = rotateShape(shape, plane.rotation)
  return rotated.cells.map((p) => ({ r: p.r + plane.origin.r, c: p.c + plane.origin.c }))
}

/** 四邻连通性 BFS */
export function shapeIsConnected(cells: Cell[]): boolean {
  if (cells.length === 0) return false
  const set = new Set(cells.map((p) => `${p.r},${p.c}`))
  const start = cells[0]!
  const seen = new Set<string>([`${start.r},${start.c}`])
  const queue: Cell[] = [start]
  while (queue.length > 0) {
    const cur = queue.shift()!
    for (const [dr, dc] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const key = `${cur.r + dr},${cur.c + dc}`
      if (set.has(key) && !seen.has(key)) {
        seen.add(key)
        queue.push({ r: cur.r + dr, c: cur.c + dc })
      }
    }
  }
  return seen.size === cells.length
}

export interface ShapeCheck {
  connected: boolean
  cellCount: number
  headCount: number
}

/** 常驻校验清单数据（连通性 / 格数 / 机头数） */
export function checkShape(shape: PlaneShape): ShapeCheck {
  const cellCount = shape.cells.length
  const headCount = shape.cells.filter((p) => p.r === shape.head.r && p.c === shape.head.c).length
  return { connected: shapeIsConnected(shape.cells), cellCount, headCount }
}

export function shapeIsValid(check: ShapeCheck): boolean {
  return (
    check.connected &&
    check.cellCount >= SHAPE_MIN_CELLS &&
    check.cellCount <= SHAPE_MAX_CELLS &&
    check.headCount === 1
  )
}

/* ---------- 演示用确定性随机摆阵（M4 之前仅供占位页展示） ---------- */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 随机合法摆放（演示桩）；失败返回 null */
export function placeFleetStub(
  width: number,
  height: number,
  planeCount: number,
  shape: PlaneShape,
): PlacedPlane[] | null {
  const rand = mulberry32(20250801)
  const planes: PlacedPlane[] = []
  let guard = 0
  while (planes.length < planeCount && guard < 5000) {
    guard++
    const rotation = Math.floor(rand() * 4) as Rotation
    const rotated = rotateShape(shape, rotation)
    const b = shapeBBox(rotated.cells)
    if (!b) continue
    const bw = b.c1 - b.c0 + 1
    const bh = b.r1 - b.r0 + 1
    if (bw > width || bh > height) continue
    const origin: Cell = {
      r: Math.floor(rand() * (height - bh + 1)),
      c: Math.floor(rand() * (width - bw + 1)),
    }
    const candidate: PlacedPlane = { id: planes.length, rotation, origin }
    const cells = placedCells(candidate, shape)
    const occupied = new Set<string>()
    for (const p of planes) {
      for (const c of placedCells(p, shape)) occupied.add(`${c.r},${c.c}`)
    }
    if (cells.some((c) => occupied.has(`${c.r},${c.c}`))) continue
    planes.push(candidate)
  }
  return planes.length === planeCount ? planes : null
}
