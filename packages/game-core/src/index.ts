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
  PlayerId,
  Rotation,
  Shot,
  ShotOutcome,
} from '@aero/shared'
import {
  BLIND_VISIBLE_RECENT,
  BLITZ_BONUS_MS,
  BLITZ_SECONDS_PER_PLANE,
  PRE_FIRE_LIMIT,
  SHAPE_MAX_CELLS,
  SHAPE_MIN_CELLS,
} from '@aero/shared'

export type {
  Cell,
  PlaneShape,
  PlacedPlane,
  PlayerId,
  Rotation,
  Shot,
  ShotOutcome,
  GridConfig,
  Difficulty,
  TutorialAiOptions,
} from '@aero/shared'

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

/** 对局模式开关：blitz=超快棋、blind=盲棋（两者互不冲突，可组合） */
export interface GameModeFlags {
  blitz: boolean
  blind: boolean
}

/** 创建对局时的模式选项（缺省即经典模式） */
export interface GameOptions {
  blitz?: boolean
  blind?: boolean
}

/** 超快棋时钟（毫秒/方，索引 0=先手 1=后手）；仅 blitz 局存在于 state.blitz */
export interface BlitzClock {
  clocks: [number, number]
}

export interface GameState {
  phase: GamePhase
  players: [PlayerBoard, PlayerBoard] // 0=先手, 1=后手
  turn: 0 | 1 // 当前报点方
  firstMover: 0 | 1
  turnNo: number // 从 1 开始
  winner: 0 | 1 | null
  /** 模式开关；缺失视为经典模式（v0.3.0 起） */
  mode?: GameModeFlags
  /** 超快棋时钟；仅 blitz 局存在（v0.3.0 起） */
  blitz?: BlitzClock
  /** 每方预报点队列（上限 PRE_FIRE_LIMIT=10，FIFO）；缺失视为空队列（v0.3.0 起） */
  preFire?: Record<PlayerId, Cell[]>
}

/** 读取模式（缺省经典） */
const modeOf = (state: GameState): GameModeFlags => state.mode ?? { blitz: false, blind: false }

/** 读取某玩家预报点队列（缺省空） */
const preFireOf = (state: GameState, player: PlayerId): Cell[] => state.preFire?.[player] ?? []

/**
 * 创建对局（经典 / 超快棋 / 盲棋 / 组合）。options 缺省时即为经典模式，向后兼容旧调用。
 * blitz：clocks 初始化为 10×planeCount×1000 ms/方；blind：开启重复报点与 3 标记可见规则。
 */
export function createGame(
  width: number,
  height: number,
  shape: PlaneShape,
  planeCount: number,
  firstMover: 0 | 1,
  options?: GameOptions,
): GameState {
  const blitzFlag = options?.blitz ?? false
  const blindFlag = options?.blind ?? false
  const mkBoard = (): PlayerBoard => ({
    width,
    height,
    shape: copyShape(shape),
    planes: [],
    destroyedPlaneIds: [],
    receivedShots: [],
    shotsFired: [],
  })
  const state: GameState = {
    phase: 'placing',
    players: [mkBoard(), mkBoard()],
    turn: firstMover,
    firstMover,
    turnNo: 1,
    winner: null,
    mode: { blitz: blitzFlag, blind: blindFlag },
    preFire: { 0: [], 1: [] },
  }
  if (blitzFlag) {
    // 初始限时：10×n 秒/方（n = 飞机架数）
    const ms = BLITZ_SECONDS_PER_PLANE * planeCount * 1000
    state.blitz = { clocks: [ms, ms] }
  }
  return state
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
 * 2) 越界 → 'out-of-bounds'；
 * 3) 非盲棋（blind=false）：重复报点 → 'already-shot'；盲棋允许对已报点格再次报点
 *   （含残骸格，仍返回 miss 误导对手），跳过本拦截；
 * 4) 目标格判定：无飞机/已击毁飞机（无效打击）→ miss；存活飞机非机头 → hit；机头 → kill；
 * 5) 报点写入双方记录；
 * 6) 超快棋（blitz）：射击方每次成功报点 +1 秒时钟；
 * 7) 胜负与绝地反击判定；8) counterattack 阶段按 outcome 定胜负。
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

  // 3) 已报过（当前报点方的 shotsFired）——仅经典模式拦截；盲棋允许重复报点
  const { blind } = modeOf(state)
  if (!blind && shooterBoard.shotsFired.some((s) => cellsEqual(s.coord, coord))) {
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

  // 6) 超快棋：射击方成功报点 +1 秒
  let blitzNext: BlitzClock | undefined = state.blitz
  const { blitz: blitzFlag } = modeOf(state)
  if (blitzFlag && state.blitz) {
    const clocks: [number, number] = [...state.blitz.clocks] as [number, number]
    clocks[shooter] += BLITZ_BONUS_MS
    blitzNext = { clocks }
  }

  // 7) 胜负与绝地反击
  let phase: GamePhase = state.phase
  let turn = state.turn
  let turnNo = state.turnNo
  let winner: 0 | 1 | null = state.winner

  if (state.phase === 'counterattack') {
    // 8) 绝地反击的唯一一次报点：kill 则后手胜，否则先手胜
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

  const newState: GameState = {
    ...state,
    players,
    phase,
    turn,
    turnNo,
    winner,
    blitz: blitzNext,
  }
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

/* ================= v0.3.0：超快棋 / 盲棋 / 预报点 ================= */

export interface BlitzAdvanceResult {
  state: GameState
  timedOut: boolean
  winner?: PlayerId
}

/**
 * 超快棋（blitz）时钟推进（纯函数）：递减指定玩家时钟 deltaMs 毫秒。
 * - 仅 blitz 局可调用（state.blitz 缺失时抛错，属调用方误用）；
 * - 递减至 ≤0 → 该玩家超时立即判负：phase='ended'、winner=对方；
 * - 其余情况仅返回扣减后的新 state（winner 沿用原值）。
 * 注：返回中额外携带新 state（引擎为纯函数、调用方需应用新时钟）；任务原签名未含 state，
 * 此处为使其可消费而补上，语义（递减+超时判负）不变——见交付说明。
 */
export function advanceBlitzClock(state: GameState, player: PlayerId, deltaMs: number): BlitzAdvanceResult {
  if (!state.blitz) {
    throw new Error('advanceBlitzClock 仅适用于超快棋（blitz）对局（state.blitz 缺失）')
  }
  if (deltaMs <= 0) {
    return { state, timedOut: false }
  }
  const clocks: [number, number] = [...state.blitz.clocks]
  const remaining = Math.max(0, clocks[player]! - deltaMs)
  clocks[player] = remaining
  if (remaining > 0) {
    return { state: { ...state, blitz: { clocks } }, timedOut: false }
  }
  const winner = (1 - player) as PlayerId
  return {
    state: { ...state, blitz: { clocks }, phase: 'ended', winner },
    timedOut: true,
    winner,
  }
}

/** 可见标记表：player0/player1 = 各自在"对手网格"上应显示的标记（本人射击结果） */
export interface VisibleMarks {
  player0: Shot[]
  player1: Shot[]
}

const copyShot = (s: Shot): Shot => ({ coord: { r: s.coord.r, c: s.coord.c }, outcome: s.outcome })

/**
 * 各玩家在对手网格上应显示的标记（纯函数，供 UI 渲染）：
 * - 经典模式：全部报点标记（shotsFired 全量）；
 * - 盲棋：只保留最近 BLIND_VISIBLE_RECENT(=3) 个非击毁标记（FIFO，先进先淘汰）
 *   + 全部击毁标记（永不消失、不计入 3 个名额）；返回列表保持原报点顺序。
 */
export function visibleMarks(state: GameState): VisibleMarks {
  const { blind } = modeOf(state)
  const build = (player: PlayerId): Shot[] => {
    const fired = state.players[player].shotsFired
    if (!blind) return fired.map(copyShot)
    // 盲棋：非击毁只保留时间上最近的 3 个
    const recentNonKillIdx = new Set<number>()
    let seen = 0
    for (let i = fired.length - 1; i >= 0 && seen < BLIND_VISIBLE_RECENT; i--) {
      const s = fired[i]!
      if (s.outcome === 'kill') continue
      recentNonKillIdx.add(i)
      seen++
    }
    const out: Shot[] = []
    for (let i = 0; i < fired.length; i++) {
      const s = fired[i]!
      if (s.outcome === 'kill' || recentNonKillIdx.has(i)) out.push(copyShot(s))
    }
    return out
  }
  return { player0: build(0), player1: build(1) }
}

/**
 * 预报点（所有模式通用）：将坐标加入 player 的预报点队列（上限 PRE_FIRE_LIMIT=10，FIFO）。
 * 校验失败返回错误码：
 * - 'CELL_TAKEN'：该格已有可见标记（按 visibleMarks 对 player 的规则）或已在该玩家预报点中；
 * - 'PRE_FIRE_FULL'：队列已满（上限 10）。
 * 纯函数：成功返回新 state，失败返回原 state 与错误码。
 */
export function queuePreFire(
  state: GameState,
  player: PlayerId,
  coord: Cell,
): { ok: true; state: GameState } | { ok: false; error: 'CELL_TAKEN' | 'PRE_FIRE_FULL' } {
  const queue = preFireOf(state, player)
  // 该格已有可见标记（按盲棋规则过滤后 player 在对手网格上的标记）
  const marks = visibleMarks(state)[player === 0 ? 'player0' : 'player1']
  if (marks.some((s) => cellsEqual(s.coord, coord)) || queue.some((c) => cellsEqual(c, coord))) {
    return { ok: false, error: 'CELL_TAKEN' }
  }
  if (queue.length >= PRE_FIRE_LIMIT) {
    return { ok: false, error: 'PRE_FIRE_FULL' }
  }
  const next: Record<PlayerId, Cell[]> = {
    0: [...preFireOf(state, 0)],
    1: [...preFireOf(state, 1)],
  }
  next[player] = [...queue, { r: coord.r, c: coord.c }]
  return { ok: true, state: { ...state, preFire: next } }
}

/**
 * 取消预报点（纯函数）：从 player 队列移除指定坐标；不存在时返回原 state。
 */
export function cancelPreFire(state: GameState, player: PlayerId, coord: Cell): GameState {
  const queue = preFireOf(state, player)
  const idx = queue.findIndex((c) => cellsEqual(c, coord))
  if (idx === -1) return state
  const nextQueue = queue.filter((c) => !cellsEqual(c, coord))
  const next: Record<PlayerId, Cell[]> = {
    0: [...preFireOf(state, 0)],
    1: [...preFireOf(state, 1)],
  }
  next[player] = nextQueue
  return { ...state, preFire: next }
}

/**
 * 预报点回合执行：轮到 player 时调用（需 state.turn === player）。
 * 队列非空 → 取出队首（FIFO）执行一次正常报点并返回其 ShotResult（每回合只上报一个）；
 * 队列空 → 返回 null（走正常回合）。
 */
export function takePreFireTurn(state: GameState, player: PlayerId): ShotResult | null {
  if (state.turn !== player) {
    throw new Error('takePreFireTurn 需在该玩家回合（state.turn）调用')
  }
  const queue = preFireOf(state, player)
  if (queue.length === 0) return null
  const [head, ...rest] = queue
  const next: Record<PlayerId, Cell[]> = {
    0: [...preFireOf(state, 0)],
    1: [...preFireOf(state, 1)],
  }
  next[player] = rest
  const stateWithoutHead: GameState = { ...state, preFire: next }
  return applyShot(stateWithoutHead, head!)
}

/**
 * 残局注入原语（教程单元3 等使用；纯函数）：
 * 将 victim 方第 planeIndex 架飞机整机标记为"已被对手击毁"——等效对手已完成该击毁：
 * - 该机 id 加入 victim.destroyedPlaneIds；
 * - 其全部占位格补记历史：非机头格 outcome 'hit'、机头格 'kill'，写入
 *   victim.receivedShots 与对手 shotsFired（已在记录中的坐标不重复追加）。
 * 应在对局开始前调用（对手尚无真实射击、phase 为 placing/playing 皆可）。
 * 若该机已在 destroyedPlaneIds 中 → 原样返回（幂等）。
 */
export function markPlaneDestroyed(state: GameState, victim: PlayerId, planeIndex: number): GameState {
  const board = state.players[victim]
  const plane = board.planes[planeIndex]
  if (!plane) return state // 越界下标：无可标记
  if (board.destroyedPlaneIds.includes(plane.id)) return state // 幂等
  const shape = board.shape
  const absHead = rotateShape(shape, plane.rotation).head
  const headAbs = { r: absHead.r + plane.origin.r, c: absHead.c + plane.origin.c }
  const existing = new Set(board.receivedShots.map((s) => cellKey(s.coord.r, s.coord.c)))
  const shots: Shot[] = []
  for (const cell of occupiedCells(plane, shape)) {
    if (existing.has(cellKey(cell.r, cell.c))) continue
    shots.push({
      coord: { r: cell.r, c: cell.c },
      outcome: cell.r === headAbs.r && cell.c === headAbs.c ? 'kill' : 'hit',
    })
  }
  const opponent = (1 - victim) as PlayerId
  const oppExisting = new Set(state.players[opponent].shotsFired.map((s) => cellKey(s.coord.r, s.coord.c)))
  const oppShots = shots.filter((s) => !oppExisting.has(cellKey(s.coord.r, s.coord.c)))
  const players: [PlayerBoard, PlayerBoard] =
    victim === 0
      ? [
          { ...board, receivedShots: [...board.receivedShots, ...shots], destroyedPlaneIds: [...board.destroyedPlaneIds, plane.id] },
          { ...state.players[1], shotsFired: [...state.players[1].shotsFired, ...oppShots] },
        ]
      : [
          { ...state.players[0], shotsFired: [...state.players[0].shotsFired, ...oppShots] },
          { ...board, receivedShots: [...board.receivedShots, ...shots], destroyedPlaneIds: [...board.destroyedPlaneIds, plane.id] },
        ]
  return { ...state, players }
}

/**
 * 设定当前行动方（纯函数）：覆盖 state.turn 为 player（残局注入用，如把首回合交给对方）。
 * 不改变 firstMover/phase/winner；调用方如需要首回合语义一致，请在 createGame 时指定 firstMover。
 */
export function setActiveTurn(state: GameState, player: PlayerId): GameState {
  if (state.turn === player) return state
  return { ...state, turn: player }
}
