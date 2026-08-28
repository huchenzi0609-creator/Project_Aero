/**
 * 形状展示辅助（仅 UI 定位 / 编辑器锚定用）。
 * 规则相关函数（rotateShape / boundingBox / occupiedCells / validateShape / normalizeShape 等）
 * 统一使用 @aero/game-core 契约实现，见 docs/game-core-api.md。
 */
import type { Cell, PlaneShape } from '@aero/shared'

/** 格位列表的包围盒（含最小/最大行列）；空列表返回 null */
export function cellsBBox(cells: Cell[]): { r0: number; c0: number; r1: number; c1: number } | null {
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

/**
 * 将 cells 平移到 (0,0) 起点的锚定坐标（编辑器绘制辅助）。
 * game-core 的 rotateShape 不做平移，编辑器里先把形状锚定到左上角，
 * 保证旋转/包围盒语义直观且与默认形状一致。
 */
export function anchorShape(shape: PlaneShape): PlaneShape {
  if (shape.cells.length === 0) return shape
  const minR = Math.min(...shape.cells.map((p) => p.r))
  const minC = Math.min(...shape.cells.map((p) => p.c))
  const shift = (p: Cell): Cell => ({ r: p.r - minR, c: p.c - minC })
  return { cells: shape.cells.map(shift), head: shift(shape.head) }
}
