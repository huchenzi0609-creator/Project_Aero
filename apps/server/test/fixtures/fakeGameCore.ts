/**
 * @aero/server 测试夹具 —— 契约一致的 game-core 本地桩。
 *
 * 与 docs/game-core-api.md 逐条对应（尤其 applyShot 的胜负/绝地反击语义）。
 * 用途：M1（真实 game-core）落地前，让 apps/server 集成测试即可端到端跑通；
 * 真实实现落地后，测试自动切换到真实模块（见 ./gameCoreResolver.ts）。
 * 若本桩与真实实现产生语义漂移，集成测试会如实暴露。
 */
import type { Cell, Difficulty, PlaneShape, PlacedPlane, Rotation, Shot, ShotOutcome } from '@aero/shared'
import type { GameState, PlayerBoard, ShotResult } from '@aero/game-core'

export const SHAPE_SIZE = 5

export type Rng = () => number

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 5×5 内顺时针旋转：1 次 (r,c)->(c,4-r) */
export function rotateCell(cell: Cell, times: Rotation): Cell {
  let r = cell.r
  let c = cell.c
  for (let i = 0; i < times; i++) {
    const nr = c
    const nc = 4 - r
    r = nr
    c = nc
  }
  return { r, c }
}

export function inBounds(coord: Cell, width: number, height: number): boolean {
  return coord.r >= 0 && coord.r < height && coord.c >= 0 && coord.c < width
}

export function occupiedCells(plane: PlacedPlane, shape: PlaneShape): Cell[] {
  return shape.cells.map((c) => {
    const rc = rotateCell(c, plane.rotation)
    return { r: rc.r + plane.origin.r, c: rc.c + plane.origin.c }
  })
}

function planeHead(plane: PlacedPlane, shape: PlaneShape): Cell {
  const h = rotateCell(shape.head, plane.rotation)
  return { r: h.r + plane.origin.r, c: h.c + plane.origin.c }
}

export function normalizeShape(shape: PlaneShape): PlaneShape {
  const seen = new Set<string>()
  const cells = shape.cells.filter((c) => {
    const k = `${c.r},${c.c}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
  const head = cells.some((c) => c.r === shape.head.r && c.c === shape.head.c) ? shape.head : { ...shape.head }
  return { cells, head }
}

export function validateShape(shape: PlaneShape): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = []
  const cells = shape.cells
  for (const c of cells) {
    if (c.r < 0 || c.r > 4 || c.c < 0 || c.c > 4) {
      errors.push('所有格位必须在 5×5 编辑器范围内')
      break
    }
  }
  const seen = new Set<string>()
  for (const c of cells) {
    const k = `${c.r},${c.c}`
    if (seen.has(k)) errors.push('格位重复')
    seen.add(k)
  }
  // 四邻连通（BFS）
  if (cells.length > 0) {
    const start = cells[0] as Cell
    const set = new Set(cells.map((c) => `${c.r},${c.c}`))
    const queue = [start]
    const visited = new Set([`${start.r},${start.c}`])
    while (queue.length > 0) {
      const cur = queue.shift() as Cell
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nr = cur.r + dr
        const nc = cur.c + dc
        const k = `${nr},${nc}`
        if (set.has(k) && !visited.has(k)) {
          visited.add(k)
          queue.push({ r: nr, c: nc })
        }
      }
    }
    if (visited.size !== set.size) errors.push('格位必须四邻连通')
  }
  if (cells.length < 2 || cells.length > 15) errors.push('飞机格数应在 2~15 之间')
  const headCount = cells.filter((c) => c.r === shape.head.r && c.c === shape.head.c).length
  if (headCount !== 1) errors.push('必须恰好有 1 个机头')
  return errors.length > 0 ? { ok: false, errors } : { ok: true }
}

export function rotateShape(shape: PlaneShape, times: Rotation): PlaneShape {
  const cells = shape.cells.map((c) => rotateCell(c, times))
  const head = rotateCell(shape.head, times)
  return { cells, head }
}

export function boundingBox(shape: PlaneShape, rotation: Rotation): { w: number; h: number } {
  const cells = shape.cells.map((c) => rotateCell(c, rotation))
  const rs = cells.map((c) => c.r)
  const cs = cells.map((c) => c.c)
  return { w: Math.max(...cs) - Math.min(...cs) + 1, h: Math.max(...rs) - Math.min(...rs) + 1 }
}

export function parseCoord(input: string): Cell | null {
  const s = input.trim()
  const m = /^([A-Za-z])(\d{1,2})$/.exec(s)
  if (!m) return null
  const c = (m[1] as string).toUpperCase().charCodeAt(0) - 65
  const r = Number(m[2]) - 1
  if (r < 0) return null
  return { r, c }
}

export function formatCoord(coord: Cell): string {
  return `${String.fromCharCode(65 + coord.c)}${coord.r + 1}`
}

export function validateFleet(
  width: number,
  height: number,
  planeCount: number,
  shape: PlaneShape,
  planes: PlacedPlane[],
): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = []
  if (planes.length !== planeCount) {
    errors.push(`飞机数量应为 ${planeCount}，实际 ${planes.length}`)
  }
  const occupied = new Map<string, number>()
  for (const plane of planes) {
    const cells = occupiedCells(plane, shape)
    for (const c of cells) {
      if (!inBounds(c, width, height)) {
        errors.push('有飞机超出棋盘边界')
        break
      }
    }
    for (const c of cells) {
      const k = `${c.r},${c.c}`
      if (occupied.has(k)) errors.push('飞机之间存在重叠')
      occupied.set(k, plane.id)
    }
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true }
}

function makeBoard(width: number, height: number, shape: PlaneShape): PlayerBoard {
  return {
    width,
    height,
    shape,
    planes: [],
    destroyedPlaneIds: [],
    receivedShots: [],
    shotsFired: [],
  }
}

export function createGame(
  width: number,
  height: number,
  shape: PlaneShape,
  planeCount: number,
  firstMover: 0 | 1,
  options?: { blitz?: boolean; blind?: boolean },
): GameState {
  const state: GameState = {
    phase: 'placing',
    players: [makeBoard(width, height, shape), makeBoard(width, height, shape)],
    turn: firstMover,
    firstMover,
    turnNo: 1,
    winner: null,
    mode: { blitz: options?.blitz ?? false, blind: options?.blind ?? false },
  }
  if (options?.blitz) {
    // 与 core 一致：初始限时 = 10 秒 × 飞机架数
    state.blitz = { clocks: [10_000 * planeCount, 10_000 * planeCount] }
  }
  return state
}

export function setFleet(
  state: GameState,
  player: 0 | 1,
  planes: PlacedPlane[],
): { ok: true; state: GameState } | { ok: false; errors: string[] } {
  const board = state.players[player]
  const res = validateFleet(board.width, board.height, planes.length, board.shape, planes)
  if (!res.ok) return res
  const next = structuredClone(state)
  next.players[player].planes = structuredClone(planes)
  return { ok: true, state: next }
}

export function isGameOver(state: GameState): boolean {
  return state.phase === 'ended' || state.winner !== null
}

export function remainingPlanes(board: PlayerBoard): number {
  return board.planes.filter((p) => !board.destroyedPlaneIds.includes(p.id)).length
}

export function applyShot(state: GameState, coord: Cell): ShotResult {
  if (state.phase !== 'playing' && state.phase !== 'counterattack') {
    return { ok: false, error: 'invalid-phase' }
  }
  const { width, height } = state.players[0]
  if (!inBounds(coord, width, height)) return { ok: false, error: 'out-of-bounds' }
  const turn = state.turn
  const target = (1 - turn) as 0 | 1
  const shooterBoard = state.players[turn]
  const blind = state.mode?.blind === true
  // 与 core 一致：非盲棋拦截重复报点；盲棋允许（残骸/空格仍返回 miss）
  if (!blind && shooterBoard.shotsFired.some((s) => s.coord.r === coord.r && s.coord.c === coord.c)) {
    return { ok: false, error: 'already-shot' }
  }
  const targetBoard = state.players[target]

  // 判定命中：存活飞机的部件；已击毁飞机上的格位按「无效打击」计为 miss
  let outcome: ShotOutcome = 'miss'
  let killedPlaneId: number | undefined
  for (const plane of targetBoard.planes) {
    if (targetBoard.destroyedPlaneIds.includes(plane.id)) continue
    const cells = occupiedCells(plane, targetBoard.shape)
    if (cells.some((c) => c.r === coord.r && c.c === coord.c)) {
      const head = planeHead(plane, targetBoard.shape)
      if (head.r === coord.r && head.c === coord.c) {
        outcome = 'kill'
        killedPlaneId = plane.id
      } else {
        outcome = 'hit'
      }
      break
    }
  }

  const next = structuredClone(state)
  next.players[turn].shotsFired.push({ coord, outcome })
  next.players[target].receivedShots.push({ coord, outcome })
  if (outcome === 'kill' && killedPlaneId !== undefined) {
    next.players[target].destroyedPlaneIds.push(killedPlaneId)
  }
  // 与 core 一致：超快棋每次成功报点给射击方 +1s
  if (state.mode?.blitz === true && next.blitz) {
    const clocks: [number, number] = [...next.blitz.clocks]
    clocks[turn] += 1_000
    next.blitz = { clocks }
  }

  const targetDestroyed = next.players[target].planes.every((p) =>
    next.players[target].destroyedPlaneIds.includes(p.id),
  )

  if (targetDestroyed) {
    if (state.phase === 'counterattack') {
      // 后手反击全歼 → 后手胜
      next.winner = turn
      next.phase = 'ended'
    } else {
      const shooterLeft = remainingPlanes(next.players[turn])
      if (turn === next.firstMover && shooterLeft === 1) {
        // 先手绝地反击：后手获一次额外报点
        next.phase = 'counterattack'
        next.turn = (1 - next.firstMover) as 0 | 1
        next.winner = null
      } else {
        next.winner = turn
        next.phase = 'ended'
      }
    }
    return { ok: true, outcome, killedPlaneId, state: next, winner: next.winner }
  }

  if (state.phase === 'counterattack') {
    // 后手反击未全歼 → 先手胜
    next.winner = next.firstMover
    next.phase = 'ended'
    return { ok: true, outcome, killedPlaneId, state: next, winner: next.winner }
  }

  // 正常轮换
  next.turn = (1 - turn) as 0 | 1
  next.turnNo += 1
  return { ok: true, outcome, killedPlaneId, state: next, winner: next.winner }
}

/** 与 core 一致的 advanceBlitzClock：递减指定玩家时钟，归零判负（纯函数，返回新 state） */
export function advanceBlitzClock(
  state: GameState,
  player: 0 | 1,
  deltaMs: number,
): { state: GameState; timedOut: boolean; winner?: 0 | 1 } {
  if (!state.blitz) {
    throw new Error('advanceBlitzClock 仅适用于超快棋（blitz）对局（state.blitz 缺失）')
  }
  if (deltaMs <= 0) return { state, timedOut: false }
  const clocks: [number, number] = [...state.blitz.clocks]
  const remaining = Math.max(0, (clocks[player] ?? 0) - deltaMs)
  clocks[player] = remaining
  if (remaining > 0) {
    return { state: { ...state, blitz: { clocks } }, timedOut: false }
  }
  const winner = (1 - player) as 0 | 1
  return {
    state: { ...state, blitz: { clocks }, phase: 'ended', winner },
    timedOut: true,
    winner,
  }
}

export interface ShotKnowledge {
  width: number
  height: number
  shots: Shot[]
  planeShape: PlaneShape
}

function coordKey(coord: Cell): string {
  return `${coord.r},${coord.c}`
}

/** normal 难度：命中后围杀 4 邻格，否则均匀随机（只用自身知识） */
export function chooseShot(knowledge: ShotKnowledge, difficulty: Difficulty, rng: Rng): Cell {
  void difficulty
  const shotSet = new Set(knowledge.shots.map((s) => coordKey(s.coord)))
  // 围杀：未处理的 hit 的 4 邻格
  if (difficulty === 'normal' || difficulty === 'hard' || difficulty === 'hell') {
    for (const s of knowledge.shots) {
      if (s.outcome !== 'hit') continue
      const { r, c } = s.coord
      const neighbors: Cell[] = [
        { r: r - 1, c },
        { r: r + 1, c },
        { r, c: c - 1 },
        { r, c: c + 1 },
      ]
      for (const n of neighbors) {
        if (inBounds(n, knowledge.width, knowledge.height) && !shotSet.has(coordKey(n))) return n
      }
    }
  }
  // 均匀随机未报点格
  const candidates: Cell[] = []
  for (let r = 0; r < knowledge.height; r++) {
    for (let c = 0; c < knowledge.width; c++) {
      const cell = { r, c }
      if (!shotSet.has(coordKey(cell))) candidates.push(cell)
    }
  }
  if (candidates.length === 0) throw new Error('无可用报点格（内部错误）')
  return candidates[Math.floor(rng() * candidates.length)] as Cell
}

/** 生成合法机队（随机摆放，不重叠；必须通过 validateFleet） */
export function generateFleet(
  width: number,
  height: number,
  planeCount: number,
  shape: PlaneShape,
  difficulty: Difficulty,
  rng: Rng,
): PlacedPlane[] {
  void difficulty
  const planes: PlacedPlane[] = []
  const occupied = new Set<string>()
  for (let id = 0; id < planeCount; id++) {
    let placed = false
    for (let attempt = 0; attempt < 2000 && !placed; attempt++) {
      const rotation = Math.floor(rng() * 4) as Rotation
      const cells = shape.cells.map((c) => rotateCell(c, rotation))
      const rs = cells.map((c) => c.r)
      const cs = cells.map((c) => c.c)
      const h = Math.max(...rs) - Math.min(...rs) + 1
      const w = Math.max(...cs) - Math.min(...cs) + 1
      const origin: Cell = {
        r: Math.floor(rng() * (height - h + 1)),
        c: Math.floor(rng() * (width - w + 1)),
      }
      const abs = cells.map((c) => ({ r: c.r + origin.r, c: c.c + origin.c }))
      if (abs.some((c) => occupied.has(coordKey(c)))) continue
      for (const c of abs) occupied.add(coordKey(c))
      planes.push({ id, rotation, origin })
      placed = true
    }
    if (!placed) throw new Error(`无法在 ${width}x${height} 内摆放第 ${id + 1} 架飞机`)
  }
  return planes
}
