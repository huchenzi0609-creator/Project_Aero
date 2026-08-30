/**
 * @aero/game-core —— M1 规则引擎
 *
 * 按 docs/game-core-api.md 契约实现。所有函数为纯函数：不修改传入对象，一律返回新对象。
 * 坐标约定：Cell { r, c } 均为 0-based，棋盘 (0,0) 在左上；
 * 文字坐标：列=字母（A=0），行=数字（1-based）。
 */
import type {
  Cell,
  PlaneShape,
  PlacedPlane,
  Rotation,
  Shot,
  ShotOutcome,
} from '@aero/shared'
import { SHAPE_MAX_CELLS, SHAPE_MIN_CELLS } from '@aero/shared'

export type { Cell, PlaneShape, PlacedPlane, Rotation, Shot, ShotOutcome, GridConfig, Difficulty } from '@aero/shared'

/** 编辑器坐标系边长（5×5） */
export const SHAPE_SIZE = 5

/* ---------------- 基础工具 ---------------- */

const cellKey = (r: number, c: number): string => `${r},${c}`

const cellsEqual = (a: Cell, b: Cell): boolean => a.r === b.r && a.c === b.c

/** 拷贝形状（cells 逐格拷贝，避免与调用方共享引用） */
const copyShape = (shape: PlaneShape): PlaneShape => ({
  cells: shape.cells.map((cell) => ({ r: cell.r, c: cell.c })),
  head: { r: shape.head.r, c: shape.head.c },
})

/* ---------------- 形状工具 ---------------- */

/** 规范化：去重 cells、校验 head 在 cells 内（非法返回原样 + 由 validateShape 判定） */
export function normalizeShape(shape: PlaneShape): PlaneShape {
  const seen = new Set<string>()
  const cells: Cell[] = []
  for (const cell of shape.cells) {
    const key = cellKey(cell.r, cell.c)
    if (!seen.has(key)) {
      seen.add(key)
      cells.push({ r: cell.r, c: cell.c })
    }
  }
  // head 不在 cells 内：非法，返回原样，交由 validateShape 判定
  if (!cells.some((cell) => cellsEqual(cell, shape.head))) {
    return { cells: shape.cells.map((cell) => ({ ...cell })), head: { ...shape.head } }
  }
  return { cells, head: { r: shape.head.r, c: shape.head.c } }
}

/** 顺时针旋转 times 次（0..3），在 5×5 内旋转：(r,c) -> (c, 4-r) */
export function rotateShape(shape: PlaneShape, times: Rotation): PlaneShape {
  const t = ((times % 4) + 4) % 4
  let cells: Cell[] = shape.cells.map((cell) => ({ ...cell }))
  let head: Cell = { ...shape.head }
  for (let i = 0; i < t; i++) {
    cells = cells.map((cell) => ({ r: cell.c, c: SHAPE_SIZE - 1 - cell.r }))
    head = { r: head.c, c: SHAPE_SIZE - 1 - head.r }
  }
  return { cells, head }
}

/** 旋转后包围盒尺寸 */
export function boundingBox(shape: PlaneShape, rotation: Rotation): { w: number; h: number } {
  const rotated = rotateShape(shape, rotation)
  if (rotated.cells.length === 0) return { w: 0, h: 0 }
  let minR = Infinity
  let maxR = -Infinity
  let minC = Infinity
  let maxC = -Infinity
  for (const cell of rotated.cells) {
    if (cell.r < minR) minR = cell.r
    if (cell.r > maxR) maxR = cell.r
    if (cell.c < minC) minC = cell.c
    if (cell.c > maxC) maxC = cell.c
  }
  return { w: maxC - minC + 1, h: maxR - minR + 1 }
}

/** 摆放后占据的绝对格位（旋转 + origin 平移） */
export function occupiedCells(plane: PlacedPlane, shape: PlaneShape): Cell[] {
  const rotated = rotateShape(shape, plane.rotation)
  return rotated.cells.map((cell) => ({ r: cell.r + plane.origin.r, c: cell.c + plane.origin.c }))
}

export function inBounds(coord: Cell, width: number, height: number): boolean {
  return coord.r >= 0 && coord.r < height && coord.c >= 0 && coord.c < width
}

/** "A5" -> Cell；大小写/首尾空格容错；非法返回 null */
export function parseCoord(input: string): Cell | null {
  const m = /^\s*([A-Za-z])(\d{1,2})\s*$/.exec(input)
  if (!m) return null
  const col = m[1]!.toUpperCase().charCodeAt(0) - 65
  const row = parseInt(m[2]!, 10)
  if (row < 1) return null
  return { r: row - 1, c: col }
}

export function formatCoord(coord: Cell): string {
  return String.fromCharCode(65 + coord.c) + String(coord.r + 1)
}

/* ---------------- 校验 ---------------- */

/** 形状校验：cells 均在 5×5 内且无重复；四邻连通；2..15 格；恰 1 机头 */
export function validateShape(shape: PlaneShape): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = []
  const cells = shape.cells

  // 1) 均在 5×5 内且无重复
  let outOfRange = 0
  const seen = new Set<string>()
  let hasDuplicate = false
  for (const cell of cells) {
    if (cell.r < 0 || cell.r >= SHAPE_SIZE || cell.c < 0 || cell.c >= SHAPE_SIZE) {
      outOfRange++
    } else {
      const key = cellKey(cell.r, cell.c)
      if (seen.has(key)) hasDuplicate = true
      seen.add(key)
    }
  }
  if (outOfRange > 0) errors.push(`存在超出 5×5 编辑器的方格（共 ${outOfRange} 个）`)
  if (hasDuplicate) errors.push('存在重复的方格')

  // 2) 四邻连通（单连通分量）
  const uniqueKeys = [...seen]
  if (uniqueKeys.length > 0) {
    const start = uniqueKeys[0]!
    const visited = new Set<string>([start])
    const stack = [start]
    while (stack.length > 0) {
      const key = stack.pop()!
      const comma = key.indexOf(',')
      const r = Number(key.slice(0, comma))
      const c = Number(key.slice(comma + 1))
      const neighbors = [cellKey(r - 1, c), cellKey(r + 1, c), cellKey(r, c - 1), cellKey(r, c + 1)]
      for (const nk of neighbors) {
        if (seen.has(nk) && !visited.has(nk)) {
          visited.add(nk)
          stack.push(nk)
        }
      }
    }
    if (visited.size < uniqueKeys.length) errors.push('存在孤立的方格，所有方格必须边相连')
  }

  // 3) 总格数 2..15
  const count = uniqueKeys.length
  if (count > SHAPE_MAX_CELLS) {
    errors.push(`方格数不能超过 ${SHAPE_MAX_CELLS} 个（当前 ${count} 个）`)
  } else if (count < SHAPE_MIN_CELLS) {
    errors.push(`方格数至少为 ${SHAPE_MIN_CELLS} 个（当前 ${count} 个）`)
  }

  // 4) 恰 1 个机头
  let headCount = 0
  for (const cell of cells) {
    if (cellsEqual(cell, shape.head)) headCount++
  }
  if (headCount === 0) {
    errors.push('缺少机头：必须且只能有 1 个机头')
  } else if (headCount > 1) {
    errors.push(`机头只能有 1 个（当前 ${headCount} 个）`)
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true }
}

/** 摆阵校验：数量 === planeCount；全部在界内；任意两机无重叠 */
export function validateFleet(
  width: number,
  height: number,
  planeCount: number,
  shape: PlaneShape,
  planes: PlacedPlane[],
): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = []
  if (planes.length !== planeCount) {
    errors.push(`飞机数量错误：应为 ${planeCount} 架，实际 ${planes.length} 架`)
  }
  // 每机全部格在界内
  for (const plane of planes) {
    for (const cell of occupiedCells(plane, shape)) {
      if (!inBounds(cell, width, height)) {
        errors.push(`第 ${plane.id} 号飞机超出棋盘边界`)
        break
      }
    }
  }
  // 任意两机无重叠
  const occupied = new Map<string, number>()
  for (const plane of planes) {
    for (const cell of occupiedCells(plane, shape)) {
      const key = cellKey(cell.r, cell.c)
      const prev = occupied.get(key)
      if (prev !== undefined) {
        errors.push(`第 ${prev} 号与第 ${plane.id} 号飞机重叠`)
      } else {
        occupied.set(key, plane.id)
      }
    }
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true }
}

/* ---------------- 对局引擎 ---------------- */

export interface PlayerBoard {
  width: number
  height: number
  shape: PlaneShape
  planes: PlacedPlane[] // 本机机队（保密数据）
  destroyedPlaneIds: number[] // 已被击毁的飞机 id
  receivedShots: Shot[] // 对方打我方的报点记录
  shotsFired: Shot[] // 我方打对方的报点记录（用于禁重复报点）
}

export type GamePhase = 'placing' | 'playing' | 'counterattack' | 'ended'

export interface GameState {
  phase: GamePhase
  players: [PlayerBoard, PlayerBoard] // 0=先手, 1=后手
  turn: 0 | 1 // 当前报点方
  firstMover: 0 | 1
  turnNo: number // 从 1 开始
  winner: 0 | 1 | null
}

export function createGame(
  width: number,
  height: number,
  shape: PlaneShape,
  planeCount: number,
  firstMover: 0 | 1,
): GameState {
  const mkBoard = (): PlayerBoard => ({
    width,
    height,
    shape: copyShape(shape),
    planes: [],
    destroyedPlaneIds: [],
    receivedShots: [],
    shotsFired: [],
  })
  void planeCount // planeCount 为对局级配置，由 validateFleet/setFleet 侧校验，状态中不落该字段
  return {
    phase: 'placing',
    players: [mkBoard(), mkBoard()],
    turn: firstMover,
    firstMover,
    turnNo: 1,
    winner: null,
  }
}

/**
 * 摆阵：仅在 placing 阶段、双方都就绪前可用（每人一次，重复设置 = 覆盖）。
 * 对局状态未记录 planeCount，故数量以传入数量自洽校验；界内与重叠仍严格校验。
 */
export function setFleet(
  state: GameState,
  player: 0 | 1,
  planes: PlacedPlane[],
): { ok: true; state: GameState } | { ok: false; errors: string[] } {
  if (state.phase !== 'placing') {
    return { ok: false, errors: ['当前阶段不允许设置机队'] }
  }
  const board = state.players[player]
  const check = validateFleet(board.width, board.height, planes.length, board.shape, planes)
  if (!check.ok) return { ok: false, errors: check.errors }

  const copyPlanes = planes.map((p) => ({ ...p }))
  const players: [PlayerBoard, PlayerBoard] =
    player === 0
      ? [{ ...state.players[0], planes: copyPlanes }, state.players[1]]
      : [state.players[0], { ...state.players[1], planes: copyPlanes }]
  const bothReady = players[0].planes.length > 0 && players[1].planes.length > 0
  return { ok: true, state: { ...state, players, phase: bothReady ? 'playing' : 'placing' } }
}

export function isGameOver(state: GameState): boolean {
  return state.phase === 'ended'
}

export function remainingPlanes(board: PlayerBoard): number {
  return board.planes.length - board.destroyedPlaneIds.length
}

export interface ShotResult {
  ok: boolean
  error?: string // 'invalid-phase' | 'out-of-bounds' | 'already-shot'
  outcome?: ShotOutcome
  killedPlaneId?: number // outcome==='kill' 时给出（仅机头信息，不公开残骸）
  state?: GameState
  winner?: 0 | 1 | null // 本步之后若产生胜者
}

/**
 * 报点裁决（纯函数）：
 * 1) 仅 playing / counterattack 阶段合法；
 * 2) 越界 → 'out-of-bounds'；3) 重复报点 → 'already-shot'；
 * 4) 目标格判定：无飞机/已击毁飞机（无效打击）→ miss；存活飞机非机头 → hit；机头 → kill；
 * 5) 报点写入双方记录；6) 胜负与绝地反击判定；7) counterattack 阶段按 outcome 定胜负。
 */
export function applyShot(state: GameState, coord: Cell): ShotResult {
  // 1) 阶段合法性
  if (state.phase !== 'playing' && state.phase !== 'counterattack') {
    return { ok: false, error: 'invalid-phase' }
  }
  const shooter = state.turn
  const target = (1 - shooter) as 0 | 1
  const shooterBoard = state.players[shooter]
  const targetBoard = state.players[target]

  // 2) 越界
  if (!inBounds(coord, targetBoard.width, targetBoard.height)) {
    return { ok: false, error: 'out-of-bounds' }
  }

  // 3) 已报过（当前报点方的 shotsFired）
  if (shooterBoard.shotsFired.some((s) => cellsEqual(s.coord, coord))) {
    return { ok: false, error: 'already-shot' }
  }

  // 4) 判定结果
  const shape = targetBoard.shape
  const destroyedIds = targetBoard.destroyedPlaneIds
  let outcome: ShotOutcome = 'miss'
  let killedPlaneId: number | undefined

  // 已击毁飞机的残骸格 → 无效打击（与空格不可区分，按 miss 处理）
  const wreckage = new Set<string>()
  for (const plane of targetBoard.planes) {
    if (!destroyedIds.includes(plane.id)) continue
    for (const cell of occupiedCells(plane, shape)) wreckage.add(cellKey(cell.r, cell.c))
  }
  if (wreckage.has(cellKey(coord.r, coord.c))) {
    outcome = 'miss'
  } else {
    outer: for (const plane of targetBoard.planes) {
      if (destroyedIds.includes(plane.id)) continue
      const cells = occupiedCells(plane, shape)
      for (const cell of cells) {
        if (cellsEqual(cell, coord)) {
          const rotatedHead = rotateShape(shape, plane.rotation).head
          const absHead = { r: rotatedHead.r + plane.origin.r, c: rotatedHead.c + plane.origin.c }
          if (cellsEqual(absHead, coord)) {
            outcome = 'kill'
            killedPlaneId = plane.id
          } else {
            outcome = 'hit'
          }
          break outer
        }
      }
    }
  }

  // 5) 报点记录：写入射击方 shotsFired 与目标方 receivedShots
  const shot: Shot = { coord: { r: coord.r, c: coord.c }, outcome }
  const newShooter: PlayerBoard = { ...shooterBoard, shotsFired: [...shooterBoard.shotsFired, shot] }
  const newTarget: PlayerBoard = {
    ...targetBoard,
    receivedShots: [...targetBoard.receivedShots, shot],
    destroyedPlaneIds: killedPlaneId !== undefined ? [...destroyedIds, killedPlaneId] : destroyedIds,
  }
  const players: [PlayerBoard, PlayerBoard] =
    shooter === 0 ? [newShooter, newTarget] : [newTarget, newShooter]

  // 6) 胜负与绝地反击
  let phase: GamePhase = state.phase
  let turn = state.turn
  let turnNo = state.turnNo
  let winner: 0 | 1 | null = state.winner

  if (state.phase === 'counterattack') {
    // 7) 绝地反击的唯一一次报点：kill 则后手胜，否则先手胜
    winner = outcome === 'kill' ? shooter : state.firstMover
    phase = 'ended'
  } else {
    const targetFleetDestroyed = remainingPlanes(newTarget) === 0
    if (targetFleetDestroyed) {
      const shooterLeft = remainingPlanes(newShooter)
      if (shooter === state.firstMover && shooterLeft === 1) {
        // 先手全歼且自身恰剩 1 架 → 进入绝地反击，交给后手恰好一次
        phase = 'counterattack'
        turn = (1 - state.firstMover) as 0 | 1
        winner = null
      } else {
        // 非先手全歼，或先手剩 ≥2 架 → 直接判胜
        phase = 'ended'
        winner = shooter
      }
    } else {
      // 正常轮换
      turn = (1 - turn) as 0 | 1
      turnNo += 1
    }
  }

  const newState: GameState = { ...state, players, phase, turn, turnNo, winner }
  const result: ShotResult = { ok: true, outcome, state: newState }
  if (killedPlaneId !== undefined) result.killedPlaneId = killedPlaneId
  if (winner !== null) result.winner = winner
  return result
}

/**
 * 双方平均击杀效率：对每位玩家，统计其击毁的每架敌机"从首次命中到击毁"的报点步数并取平均；
 * 无击毁时对应项为 null。
 *
 * 步数定义：该玩家 shotsFired 中 kill 那一枪的下标 − 首次命中该机（任一占位格）那一枪的下标
 * （"直接爆头"= 0 步）。结果四舍五入保留 1 位小数。纯函数，不修改 state。
 */
export function killEfficiencyStats(state: GameState): { player0: number | null; player1: number | null } {
  const result: { player0: number | null; player1: number | null } = { player0: null, player1: null }
  for (const shooter of [0, 1] as const) {
    const target = (1 - shooter) as 0 | 1
    const shooterBoard = state.players[shooter]
    const targetBoard = state.players[target]
    const destroyedIds = targetBoard.destroyedPlaneIds
    if (destroyedIds.length === 0) continue // 无击毁 → null

    const steps: number[] = []
    for (const pid of destroyedIds) {
      const plane = targetBoard.planes.find((p) => p.id === pid)
      if (!plane) continue
      const cells = occupiedCells(plane, targetBoard.shape)
      let firstHitIdx = -1
      let killIdx = -1
      for (let i = 0; i < shooterBoard.shotsFired.length; i++) {
        const s = shooterBoard.shotsFired[i]!
        const onPlane = cells.some((c) => c.r === s.coord.r && c.c === s.coord.c)
        if (!onPlane) continue
        if (firstHitIdx === -1) firstHitIdx = i
        if (s.outcome === 'kill') killIdx = i
      }
      // kill 枪本身也在该机占位格上（机头），故 firstHitIdx 必然 ≤ killIdx；防御性跳过异常
      if (firstHitIdx !== -1 && killIdx !== -1) steps.push(killIdx - firstHitIdx)
    }
    if (steps.length > 0) {
      const avg = steps.reduce((a, b) => a + b, 0) / steps.length
      const rounded = Math.round(avg * 10) / 10
      if (shooter === 0) result.player0 = rounded
      else result.player1 = rounded
    }
  }
  return result
}
