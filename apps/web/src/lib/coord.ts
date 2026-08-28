/**
 * 坐标工具：字母列 + 数字行（A1 起），解析时容错大小写与空白。
 */
import type { Cell } from '@aero/shared'

export function colLetter(c: number): string {
  return String.fromCharCode(65 + c)
}

export function formatCoord(cell: Cell): string {
  return `${colLetter(cell.c)}${cell.r + 1}`
}

export interface ParsedCoord {
  cell: Cell
}

/**
 * 解析“字母+数字”，容忍大小写与空格（如 A5 / a 5）。
 * 返回 null 表示格式错误；越界由调用方依据棋盘尺寸判断。
 */
export function parseCoord(input: string): ParsedCoord | null {
  const m = /^\s*([A-Za-z])\s*(\d{1,2})\s*$/.exec(input)
  if (!m) return null
  const col = m[1]!.toUpperCase().charCodeAt(0) - 65
  const row = Number(m[2]) - 1
  if (col < 0 || row < 0) return null
  return { cell: { r: row, c: col } }
}
