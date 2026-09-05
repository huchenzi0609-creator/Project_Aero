/**
 * v0.3.0 规则测试：超快棋（blitz）计时 / 盲棋（blind）重复报点与可见标记 / 预报点机制
 * 覆盖：blitz 初始时钟与 +1s、blitz 超时判负、经典兼容、blind 重复报点允许、
 * visibleMarks 的最近 3+击毁规则、预报点队列（上限/取消/FIFO 单发/与 shoot 联动）、
 * killEfficiencyStats 不受影响回归。
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_PLANE_SHAPE, type PlacedPlane, type Shot } from '@aero/shared'
import {
  advanceBlitzClock,
  applyShot,
  cancelPreFire,
  createGame,
  killEfficiencyStats,
  queuePreFire,
  remainingPlanes,
  setFleet,
  takePreFireTurn,
  visibleMarks,
  type GameState,
  type PlayerBoard,
} from '@aero/game-core'

const W = 10
const H = 10

/** 引擎序列报点（失败即抛错） */
function gshot(g: GameState, r: number, c: number): GameState {
  const res = applyShot(g, { r, c })
  if (!res.ok || !res.state) throw new Error(`非法报点 (${r},${c}): ${res.error}`)
  return res.state
}

/** 默认形状 rot0 机队 */
function fleet(origins: Array<{ r: number; c: number }>): PlacedPlane[] {
  return origins.map((o, i) => ({ id: i, rotation: 0 as const, origin: o }))
}

/** 开局（先手 0；小型对局 3 架，用于 blitz 初始时钟 10×3 秒；options 控制模式） */
function newGame(
  p0Origins: Array<{ r: number; c: number }>,
  p1Origins: Array<{ r: number; c: number }>,
  options?: { blitz?: boolean; blind?: boolean },
): GameState {
  const g = createGame(W, H, DEFAULT_PLANE_SHAPE, 3, 0, options)
  const s0 = setFleet(g, 0, fleet(p0Origins))
  if (!s0.ok) throw new Error('setFleet p0 失败')
  const s1 = setFleet(s0.state, 1, fleet(p1Origins))
  if (!s1.ok) throw new Error('setFleet p1 失败')
  return s1.state
}

/** 手工构造玩家棋盘（用于 visibleMarks 过滤边界测试） */
function mkBoard(shotsFired: Shot[]): PlayerBoard {
  return {
    width: W,
    height: H,
    shape: DEFAULT_PLANE_SHAPE,
    planes: [],
    destroyedPlaneIds: [],
    receivedShots: [],
    shotsFired,
  }
}

const shot = (r: number, c: number, outcome: Shot['outcome']): Shot => ({ coord: { r, c }, outcome })

describe('v0.3.0 超快棋（blitz）', () => {
  it('初始时钟 = 10×n 秒/方（n=飞机架数）；经典模式缺省无 blitz 字段', () => {
    const blitz3 = newGame([{ r: 0, c: 0 }], [{ r: 5, c: 0 }], { blitz: true })
    expect(blitz3.blitz?.clocks).toEqual([30_000, 30_000]) // 10×3×1000
    const blitz1 = createGame(10, 10, DEFAULT_PLANE_SHAPE, 1, 0, { blitz: true })
    expect(blitz1.blitz?.clocks).toEqual([10_000, 10_000])
    const classic = createGame(10, 10, DEFAULT_PLANE_SHAPE, 3, 0)
    expect(classic.blitz).toBeUndefined()
    expect(classic.mode).toEqual({ blitz: false, blind: false })
    expect(classic.preFire).toEqual({ 0: [], 1: [] })
  })

  it('己方成功报点一次 +1 秒（+1000ms），不影响对方时钟', () => {
    const g = newGame([{ r: 0, c: 0 }], [{ r: 5, c: 0 }, { r: 5, c: 5 }], { blitz: true })
    const before0 = g.blitz!.clocks[0]
    const before1 = g.blitz!.clocks[1]
    const g2 = gshot(g, 9, 9) // p0 miss → +1s
    expect(g2.blitz!.clocks[0]).toBe(before0 + 1000)
    expect(g2.blitz!.clocks[1]).toBe(before1)
    const g3 = gshot(g2, 9, 8) // p1 miss → +1s
    expect(g3.blitz!.clocks[1]).toBe(before1 + 1000)
  })

  it('时钟递减：未超时仅扣减；超时判负（phase ended、winner=对方、时钟归零）', () => {
    const g = newGame([{ r: 0, c: 0 }], [{ r: 5, c: 0 }], { blitz: true })
    // 未超时
    const r1 = advanceBlitzClock(g, 0, 5_000)
    expect(r1.timedOut).toBe(false)
    expect(r1.state.blitz!.clocks[0]).toBe(25_000)
    expect(r1.state.phase).toBe('playing')
    // 超时（把剩余 25s 全部扣掉）
    const r2 = advanceBlitzClock(r1.state, 0, 25_000)
    expect(r2.timedOut).toBe(true)
    expect(r2.winner).toBe(1)
    expect(r2.state.phase).toBe('ended')
    expect(r2.state.winner).toBe(1)
    expect(r2.state.blitz!.clocks[0]).toBe(0)
  })

  it('非 blitz 局调用 advanceBlitzClock 抛错（调用方误用）', () => {
    const g = newGame([{ r: 0, c: 0 }], [{ r: 5, c: 0 }])
    expect(() => advanceBlitzClock(g, 0, 1000)).toThrow()
  })
})

describe('v0.3.0 盲棋（blind）', () => {
  it('blind 允许对已报点格重复报点（返回正常裁决而非 already-shot）；经典模式仍拦截', () => {
    const gb = newGame([{ r: 0, c: 0 }], [{ r: 5, c: 0 }, { r: 5, c: 5 }], { blind: true })
    const b1 = gshot(gb, 9, 9) // p0 打空位 miss
    const b2 = gshot(b1, 9, 8) // p1 打空位
    const b3 = gshot(b2, 9, 9) // p0 重复报 (9,9) → blind 允许，仍 miss
    expect(b3.players[0].shotsFired).toHaveLength(2)
    expect(b3.players[0].shotsFired.map((s) => s.outcome)).toEqual(['miss', 'miss'])

    const gc = newGame([{ r: 0, c: 0 }], [{ r: 5, c: 0 }, { r: 5, c: 5 }])
    const c1 = gshot(gc, 9, 9)
    const c2 = gshot(c1, 9, 8)
    const c3 = applyShot(c2, { r: 9, c: 9 }) // 经典重复 → already-shot
    expect(c3.ok).toBe(false)
    expect(c3.error).toBe('already-shot')
  })

  it('blind 对残骸格重复报点仍按 miss（无效打击）', () => {
    const g = newGame([{ r: 0, c: 0 }, { r: 0, c: 5 }], [{ r: 5, c: 0 }, { r: 5, c: 5 }], { blind: true })
    let cur = gshot(g, 5, 2) // p0 kill p1 的 A1 机头
    cur = gshot(cur, 9, 9) // p1 miss
    cur = gshot(cur, 6, 0) // p0 打 A1 残骸格（(1,0)+(5,0)）→ miss（无效打击）
    cur = gshot(cur, 9, 8) // p1 miss
    cur = gshot(cur, 6, 0) // p0 对同一残骸格重复报点：blind 允许 → 仍 miss
    const last = cur.players[1].receivedShots.at(-1)!
    expect(last).toEqual({ coord: { r: 6, c: 0 }, outcome: 'miss' })
    expect(cur.players[0].shotsFired.filter((s) => s.coord.r === 6 && s.coord.c === 0)).toHaveLength(2)
  })
})

describe('v0.3.0 visibleMarks', () => {
  it('经典模式返回全部报点标记', () => {
    const g = newGame([{ r: 0, c: 0 }], [{ r: 5, c: 0 }, { r: 5, c: 5 }])
    const g2 = gshot(gshot(g, 9, 9), 9, 8)
    const marks = visibleMarks(g2)
    expect(marks.player0).toEqual([{ coord: { r: 9, c: 9 }, outcome: 'miss' }])
    expect(marks.player1).toEqual([{ coord: { r: 9, c: 8 }, outcome: 'miss' }])
  })

  it('blind：只保留最近 3 个非击毁标记 + 全部击毁标记（保持报点顺序）', () => {
    // 手工构造 player0 的射击历史：kill, miss×5, kill（击毁 2 个永久保留；非击毁只留最近 3）
    const b = mkBoard([
      shot(0, 0, 'kill'),
      shot(1, 0, 'miss'),
      shot(1, 1, 'miss'),
      shot(1, 2, 'hit'),
      shot(1, 3, 'miss'),
      shot(1, 4, 'miss'),
      shot(2, 2, 'kill'),
    ])
    const state: GameState = {
      phase: 'ended',
      players: [b, mkBoard([])],
      turn: 0,
      firstMover: 0,
      turnNo: 1,
      winner: 0,
      mode: { blitz: false, blind: true },
      preFire: { 0: [], 1: [] },
    }
    const marks = visibleMarks(state).player0
    // kill×2 永久 + 最近 3 个非 kill（(1,2)hit、(1,3)miss、(1,4)miss）；最早两个 miss 被淘汰
    expect(marks).toEqual([
      { coord: { r: 0, c: 0 }, outcome: 'kill' },
      { coord: { r: 1, c: 2 }, outcome: 'hit' },
      { coord: { r: 1, c: 3 }, outcome: 'miss' },
      { coord: { r: 1, c: 4 }, outcome: 'miss' },
      { coord: { r: 2, c: 2 }, outcome: 'kill' },
    ])
  })

  it('blind：击毁标记不计入 3 个名额', () => {
    const b = mkBoard([shot(0, 0, 'kill'), shot(1, 0, 'kill'), shot(2, 0, 'miss'), shot(2, 1, 'hit'), shot(2, 2, 'kill'), shot(2, 3, 'kill')])
    const state: GameState = {
      phase: 'ended',
      players: [b, mkBoard([])],
      turn: 0,
      firstMover: 0,
      turnNo: 1,
      winner: 0,
      mode: { blitz: false, blind: true },
      preFire: { 0: [], 1: [] },
    }
    // 4 个 kill + 最近 3 个名额里只有 2 个非 kill → 全量显示
    expect(visibleMarks(state).player0).toHaveLength(6)
  })
})

describe('v0.3.0 预报点', () => {
  it('queue/cancel 基础：加入成功；取消后可重新加入', () => {
    const g = newGame([{ r: 0, c: 0 }], [{ r: 5, c: 0 }], { blind: true })
    const q1 = queuePreFire(g, 0, { r: 5, c: 2 })
    expect(q1.ok).toBe(true)
    if (q1.ok) {
      expect(q1.state.preFire?.[0]).toEqual([{ r: 5, c: 2 }])
      const q2 = queuePreFire(q1.state, 0, { r: 5, c: 0 })
      expect(q2.ok).toBe(true)
      const afterCancel = cancelPreFire(q2.ok ? q2.state : q1.state, 0, { r: 5, c: 2 })
      expect(afterCancel.preFire?.[0]).toEqual([{ r: 5, c: 0 }])
      // 取消后坐标可重新加入
      const q3 = queuePreFire(afterCancel, 0, { r: 5, c: 2 })
      expect(q3.ok).toBe(true)
    }
  })

  it('CELL_TAKEN：该格已有可见标记或已在该玩家预报点中', () => {
    const g = newGame([{ r: 0, c: 0 }], [{ r: 5, c: 0 }])
    const g2 = gshot(g, 9, 9) // p0 已打 (9,9) → 经典下它是 p0 的可见标记
    const g3 = gshot(g2, 9, 8) // p1 行动，回 p0
    const r1 = queuePreFire(g3, 0, { r: 9, c: 9 })
    expect(r1.ok).toBe(false)
    if (!r1.ok) expect(r1.error).toBe('CELL_TAKEN')
    const q = queuePreFire(g3, 0, { r: 5, c: 2 })
    expect(q.ok).toBe(true)
    const dup = queuePreFire(q.ok ? q.state : g3, 0, { r: 5, c: 2 })
    expect(dup.ok).toBe(false)
    if (!dup.ok) expect(dup.error).toBe('CELL_TAKEN')
  })

  it('PRE_FIRE_FULL：队列上限 10，满后再加被拒', () => {
    const g = newGame([{ r: 0, c: 0 }], [{ r: 5, c: 0 }])
    let cur = g
    // 用前 6 行空格占满 10 个（避开已打格）
    for (let i = 0; i < 10; i++) {
      const r = queuePreFire(cur, 0, { r: Math.floor(i / 5), c: (i % 5) + 5 })
      expect(r.ok).toBe(true)
      if (r.ok) cur = r.state
    }
    expect(cur.preFire?.[0]).toHaveLength(10)
    const overflow = queuePreFire(cur, 0, { r: 9, c: 0 })
    expect(overflow.ok).toBe(false)
    if (!overflow.ok) expect(overflow.error).toBe('PRE_FIRE_FULL')
  })

  it('FIFO 单发：每回合取队首执行一次正常报点；空队列返回 null', () => {
    const g = newGame([{ r: 0, c: 0 }], [{ r: 5, c: 0 }, { r: 5, c: 5 }])
    // p0 预报 (6,0) 机身 → (5,2) 机头
    const q1 = queuePreFire(g, 0, { r: 6, c: 0 })
    if (!q1.ok) throw new Error('queue fail')
    const q2 = queuePreFire(q1.state, 0, { r: 5, c: 2 })
    if (!q2.ok) throw new Error('queue fail')
    let cur = q2.state
    // 队首 (6,0)：hit
    const t1 = takePreFireTurn(cur, 0)
    expect(t1).not.toBeNull()
    expect(t1!.ok).toBe(true)
    expect(t1!.outcome).toBe('hit')
    expect(t1!.state!.preFire?.[0]).toEqual([{ r: 5, c: 2 }]) // 队首已出队
    expect(t1!.state!.players[0].shotsFired).toHaveLength(1)
    // p1 行动
    cur = gshot(t1!.state!, 9, 9)
    // 队首 (5,2)：kill
    const t2 = takePreFireTurn(cur, 0)
    expect(t2!.ok).toBe(true)
    expect(t2!.outcome).toBe('kill')
    expect(t2!.state!.preFire?.[0]).toEqual([])
    // 空队列 → null
    cur = gshot(t2!.state!, 9, 8)
    expect(takePreFireTurn(cur, 0)).toBeNull()
  })

  it('takePreFireTurn 需在该玩家回合调用（turn 校验）', () => {
    const g = newGame([{ r: 0, c: 0 }], [{ r: 5, c: 0 }], { blind: true })
    const q = queuePreFire(g, 1, { r: 9, c: 9 }) // p1 预报，但当前回合是 p0
    expect(q.ok).toBe(true)
    if (q.ok) expect(() => takePreFireTurn(q.state, 1)).toThrow()
  })
})

describe('v0.3.0 回归', () => {
  it('killEfficiencyStats 不受新字段影响（blitz 局同样可算）', () => {
    const g = newGame([{ r: 0, c: 0 }, { r: 0, c: 5 }], [{ r: 5, c: 0 }, { r: 5, c: 5 }], { blitz: true })
    let cur = gshot(g, 6, 0) // hit A1
    cur = gshot(cur, 9, 9)
    cur = gshot(cur, 5, 2) // kill A1（1 步）
    expect(remainingPlanes(cur.players[1])).toBe(1)
    expect(killEfficiencyStats(cur)).toEqual({ player0: 1, player1: null })
  })
})
