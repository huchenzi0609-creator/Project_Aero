/**
 * online/prefire —— 预报点队列（纯逻辑，联机/单机可复用）。
 *
 * 规则（docs/qa-checklist-v030.md §E）：
 * - 上限 10 个；点击空网格（无既有标记）创建；
 * - FIFO：我方回合开始时每回合自动上报队首一个作为普通 shot，直到队列空；
 * - 点选已创建的预报点可单独取消。
 */
import type { Cell } from '@aero/shared'

export const PREFIRE_LIMIT = 10

export function sameCell(a: Cell, b: Cell): boolean {
  return a.r === b.r && a.c === b.c
}

/** 尝试追加一个预报点；满则拒绝 */
export function prefireAdd(
  list: Cell[],
  cell: Cell,
): { list: Cell[]; ok: boolean; full: boolean } {
  if (list.some((c) => sameCell(c, cell))) return { list, ok: false, full: false }
  if (list.length >= PREFIRE_LIMIT) return { list, ok: false, full: true }
  return { list: [...list, cell], ok: true, full: false }
}

/** 移除指定预报点 */
export function prefireRemove(list: Cell[], cell: Cell): Cell[] {
  return list.filter((c) => !sameCell(c, cell))
}

/** 队首（不弹出） */
export function prefirePeek(list: Cell[]): Cell | null {
  return list.length > 0 ? (list[0] ?? null) : null
}

/** 弹出队首（自动上报一个） */
export function prefireShift(list: Cell[]): { list: Cell[]; head: Cell | null } {
  if (list.length === 0) return { list, head: null }
  return { list: list.slice(1), head: list[0] ?? null }
}
