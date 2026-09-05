/**
 * BlindMarks —— 盲棋（blind）标记纯工具（v0.3.0，供 M4 单机与 M6 联机复用）。
 *
 * 规则契约（docs/qa-checklist-v030.md §D）：
 * - 盲棋下对手网格【只显示最近 N 个非击毁报点标记】（FIFO 淘汰）
 * - 击毁（★）标记永久保留，且不占用 N 个名额
 * - 盲棋允许重复报点（对已报点格再次报点被接受，残骸仍返回"击空"），
 *   因此窗口按【出现顺序】而非按格位去重
 *
 * 本模块只做纯计算，不含任何 React/状态；调用方按需调用并自行渲染。
 */
import type { Shot } from '@aero/shared'

/** 默认窗口：非击毁标记最多保留的最近个数 */
export const BLIND_NON_KILL_WINDOW = 3

/** 是否为击毁标记（★，永久保留） */
export function isKillShot(shot: Shot): boolean {
  return shot.outcome === 'kill'
}

/**
 * 计算盲棋视野内应显示的标记列表：
 * 全部击毁标记 + 按时间顺序最后 `limit` 个非击毁标记，整体按原出现顺序返回。
 * 输入可为任意顺序的报点历史（含重复格）。
 */
export function blindVisibleMarks(
  shots: readonly Shot[],
  limit: number = BLIND_NON_KILL_WINDOW,
): Shot[] {
  const window = Math.max(0, Math.floor(limit))
  if (shots.length === 0 || window === 0) return shots.filter(isKillShot)
  // 从后向前收集不超过 window 个非击毁标记（击毁全部保留）
  const picked: Array<{ idx: number; shot: Shot }> = []
  let rest = 0
  for (let i = shots.length - 1; i >= 0; i--) {
    const shot = shots[i]!
    if (isKillShot(shot)) {
      picked.push({ idx: i, shot })
    } else if (rest < window) {
      picked.push({ idx: i, shot })
      rest++
    }
  }
  picked.sort((a, b) => a.idx - b.idx)
  return picked.map((p) => p.shot)
}

/**
 * 增量版：往盲棋视野维护的列表追加一个报点（等价于盲棋对局内每次报点后的状态）：
 * 击毁永久入列；非击毁入列后若超出窗口则淘汰最旧的一个非击毁。
 * 返回新数组（不修改入参）。
 */
export function blindAppendShot(
  list: readonly Shot[],
  shot: Shot,
  limit: number = BLIND_NON_KILL_WINDOW,
): Shot[] {
  const window = Math.max(0, Math.floor(limit))
  if (isKillShot(shot)) return [...list, shot]
  const next = [...list, shot]
  if (window === 0) return next.filter(isKillShot)
  let rest = 0
  return next.filter((s) => {
    if (isKillShot(s)) return true
    rest++
    return rest <= window
  })
}

/** 盲棋下某列表内非击毁标记个数（窗口占用数，可用于 UI 提示剩余可显名额） */
export function blindWindowUsage(list: readonly Shot[]): number {
  return list.reduce((n, s) => n + (isKillShot(s) ? 0 : 1), 0)
}
