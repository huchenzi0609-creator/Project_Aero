/**
 * v0.3.0 教程（M8）核心前置测试：
 * 1) 教学 AI（chooseTutorialShot，normal 基底 + avoidHeads）：多局模拟报点集合与我方机头集合交集为空；
 * 2) 残局注入（markPlaneDestroyed / setActiveTurn）：整机已毁 + 对方先手断言。
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_PLANE_SHAPE, type Cell, type PlacedPlane, type Shot } from '@aero/shared'
import { chooseTutorialShot, mulberry32, type ShotKnowledge } from '@aero/game-core/ai'
import {
  applyShot,
  createEndgameState,
  createGame,
  markPlaneDestroyed,
  occupiedCells,
  remainingPlanes,
  rotateShape,
  setActiveTurn,
  setFleet,
  type GameState,
} from '@aero/game-core'

function fleet(origins: Array<{ r: number; c: number }>): PlacedPlane[] {
  return origins.map((o, i) => ({ id: i, rotation: 0 as const, origin: o }))
}

function headCells(fleetPlanes: PlacedPlane[]): Cell[] {
  return fleetPlanes.map((p) => {
    const h = rotateShape(DEFAULT_PLANE_SHAPE, p.rotation).head
    return { r: h.r + p.origin.r, c: h.c + p.origin.c }
  })
}

/** 我方 3 机阵（rot0，互不重叠） */
const MY_FLEET = fleet([
  { r: 0, c: 0 }, // id0，头 (0,2)
  { r: 5, c: 0 }, // id1，头 (5,2)
  { r: 0, c: 8 }, // id2，头 (0,10)
])
const MY_HEAD_CELLS = headCells(MY_FLEET)

/** 15×15 双方 3 机不相交开局（p0=我方），可指定 firstMover */
function newBigGame(firstMover: 0 | 1 = 0): GameState {
  const opponent = fleet([
    { r: 9, c: 5 },
    { r: 9, c: 10 },
    { r: 4, c: 10 },
  ])
  let g = createGame(15, 15, DEFAULT_PLANE_SHAPE, 3, firstMover)
  const s0 = setFleet(g, 0, MY_FLEET)
  if (!s0.ok) throw new Error('setFleet p0 失败')
  const s1 = setFleet(s0.state, 1, opponent)
  if (!s1.ok) throw new Error(`setFleet p1 失败: ${s1.errors.join('；')}`)
  return s1.state
}

describe('v0.3.0 教程·教学 AI（避开机头报点）', () => {
  it('多局模拟：对方报点集合与我方机头集合交集为空，且能命中机身/击空（不越界不重复）', () => {
    const headKey = new Set(MY_HEAD_CELLS.map((h) => `${h.r},${h.c}`))
    const cellMap = new Map<string, string>()
    for (const p of MY_FLEET) {
      for (const c of occupiedCells(p, DEFAULT_PLANE_SHAPE)) {
        cellMap.set(`${c.r},${c.c}`, headKey.has(`${c.r},${c.c}`) ? 'kill' : 'hit')
      }
    }
    let totalShots = 0
    let hitBody = 0
    let sawMiss = false
    const GAMES = 60
    const SHOTS_PER_GAME = 40
    for (let gi = 0; gi < GAMES; gi++) {
      const rng = mulberry32(10_000 + gi)
      const knowledge: ShotKnowledge = { width: 15, height: 15, shots: [], planeShape: DEFAULT_PLANE_SHAPE }
      for (let si = 0; si < SHOTS_PER_GAME; si++) {
        const cell = chooseTutorialShot(knowledge, { avoidHeads: MY_HEAD_CELLS }, rng)
        expect(headKey.has(`${cell.r},${cell.c}`)).toBe(false) // 绝不落机头
        expect(cell.r).toBeGreaterThanOrEqual(0)
        expect(cell.r).toBeLessThan(15)
        expect(cell.c).toBeGreaterThanOrEqual(0)
        expect(cell.c).toBeLessThan(15)
        expect(knowledge.shots.some((s) => s.coord.r === cell.r && s.coord.c === cell.c)).toBe(false)
        const outcome = cellMap.get(`${cell.r},${cell.c}`) ?? 'miss'
        knowledge.shots.push({ coord: { r: cell.r, c: cell.c }, outcome: outcome as Shot['outcome'] })
        if (outcome === 'hit') hitBody++
        if (outcome === 'miss') sawMiss = true
        totalShots++
      }
    }
    expect(totalShots).toBe(GAMES * SHOTS_PER_GAME)
    expect(hitBody).toBeGreaterThan(0) // 确实能命中机翼/机身
    expect(sawMiss).toBe(true) // 也能击空
  })
})

describe('v0.3.0 教程·残局状态注入', () => {
  it('markPlaneDestroyed：整机已毁、补记 9 hit + 1 kill（仅 receivedShots，对方 shotsFired 保持干净）、幂等', () => {
    const g = newBigGame(0)
    const injected = markPlaneDestroyed(g, 0, 1) // 我方 id1 机（(5,0)，头 (5,2)）
    expect(injected.players[0].destroyedPlaneIds).toEqual([1])
    expect(remainingPlanes(injected.players[0])).toBe(2)
    const received = injected.players[0].receivedShots
    expect(received).toHaveLength(10) // 默认形状 10 格
    expect(received.filter((s) => s.outcome === 'kill')).toHaveLength(1)
    expect(received.filter((s) => s.outcome === 'hit')).toHaveLength(9)
    expect(received.find((s) => s.outcome === 'kill')!.coord).toEqual({ r: 5, c: 2 })
    // 对方射击历史不被注入污染 → 后续打残骸格返回 miss（而非 already-shot）
    expect(injected.players[1].shotsFired).toHaveLength(0)
    expect(markPlaneDestroyed(injected, 0, 1)).toEqual(injected) // 幂等
  })

  it('markPlaneDestroyed 对越界下标安全返回；纯函数不改原 state', () => {
    const g = newBigGame(0)
    expect(markPlaneDestroyed(g, 0, 99)).toEqual(g) // no-op
    const snapshot = JSON.stringify(g)
    markPlaneDestroyed(g, 0, 2)
    expect(JSON.stringify(g)).toBe(snapshot)
  })

  it('setActiveTurn：把当前回合交给对方（对方先手），不改 phase/firstMover', () => {
    const g = newBigGame(0)
    expect(g.turn).toBe(0)
    const flipped = setActiveTurn(g, 1)
    expect(flipped.turn).toBe(1)
    expect(flipped.phase).toBe('playing')
    expect(flipped.firstMover).toBe(0)
    expect(setActiveTurn(flipped, 1)).toBe(flipped) // 同值返回原引用
  })

  it('组合残局：我方被击毁一架 + 对方先手，对方教学 AI 报点不碰我方剩余机头', () => {
    const g = newBigGame(0)
    const injected = setActiveTurn(markPlaneDestroyed(g, 0, 2), 1)
    expect(injected.players[0].destroyedPlaneIds).toEqual([2])
    expect(injected.turn).toBe(1)
    const aliveHeads = MY_HEAD_CELLS.filter((_, i) => i !== 2)
    const aliveHeadKey = new Set(aliveHeads.map((h) => `${h.r},${h.c}`))
    const cellMap = new Map<string, string>()
    for (const p of MY_FLEET) {
      for (const c of occupiedCells(p, DEFAULT_PLANE_SHAPE)) {
        cellMap.set(`${c.r},${c.c}`, aliveHeadKey.has(`${c.r},${c.c}`) ? 'kill' : 'hit')
      }
    }
    const rng = mulberry32(77)
    const knowledge: ShotKnowledge = { width: 15, height: 15, shots: [], planeShape: DEFAULT_PLANE_SHAPE }
    for (let i = 0; i < 30; i++) {
      const cell = chooseTutorialShot(knowledge, { avoidHeads: aliveHeads }, rng)
      expect(aliveHeadKey.has(`${cell.r},${cell.c}`)).toBe(false)
      const outcome = cellMap.get(`${cell.r},${cell.c}`) ?? 'miss'
      knowledge.shots.push({ coord: { r: cell.r, c: cell.c }, outcome: outcome as Shot['outcome'] })
    }
  })

  it('注入后 applyShot 引擎正常继续（对方先手开枪、命中、轮换）', () => {
    const g = newBigGame(0)
    const cur = setActiveTurn(markPlaneDestroyed(g, 0, 1), 1)
    const r1 = applyShot(cur, { r: 1, c: 0 }) // 对方打我方 id0 机机身
    expect(r1.ok).toBe(true)
    expect(r1.outcome).toBe('hit')
    expect(r1.state!.turn).toBe(0)
    const r2 = applyShot(r1.state!, { r: 14, c: 14 })
    expect(r2.ok).toBe(true)
    expect(r2.outcome).toBe('miss')
    expect(r2.state!.turn).toBe(1)
  })

  it('createEndgameState 工厂：我方毁一架 + 对方先手 + 初始状态完整', () => {
    const opponent = fleet([
      { r: 9, c: 5 },
      { r: 9, c: 10 },
      { r: 4, c: 10 },
    ])
    const r = createEndgameState(15, 15, DEFAULT_PLANE_SHAPE, 3, MY_FLEET, opponent, {
      preKill: { side: 'me', planeIndex: 1 },
      firstTurn: 'them',
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      const g = r.state
      expect(g.phase).toBe('playing')
      expect(g.turn).toBe(1) // 对方先手
      expect(g.players[0].destroyedPlaneIds).toEqual([1])
      expect(remainingPlanes(g.players[0])).toBe(2)
      const received = g.players[0].receivedShots
      expect(received).toHaveLength(10)
      expect(received.find((s) => s.outcome === 'kill')!.coord).toEqual({ r: 5, c: 2 }) // 我方 id1 机头
      expect(g.players[1].shotsFired).toHaveLength(0) // 注入不写对方射击历史
    }
    // 越界 planeIndex → ok:false
    const bad = createEndgameState(15, 15, DEFAULT_PLANE_SHAPE, 3, MY_FLEET, opponent, {
      preKill: { side: 'me', planeIndex: 9 },
      firstTurn: 'them',
    })
    expect(bad.ok).toBe(false)
    // 非法摆阵（单方内部重叠）→ ok:false
    const overlapMine = fleet([
      { r: 0, c: 0 },
      { r: 0, c: 0 }, // 与上一架重叠
      { r: 9, c: 5 },
    ])
    const overlap = createEndgameState(15, 15, DEFAULT_PLANE_SHAPE, 3, overlapMine, opponent, {
      preKill: { side: 'me', planeIndex: 0 },
      firstTurn: 'them',
    })
    expect(overlap.ok).toBe(false)
  })

  it('被注入击毁的飞机：后续对其任意残骸格报点返回 miss（无效打击）', () => {
    const opponent = fleet([
      { r: 9, c: 5 },
      { r: 9, c: 10 },
      { r: 4, c: 10 },
    ])
    const r = createEndgameState(15, 15, DEFAULT_PLANE_SHAPE, 3, MY_FLEET, opponent, {
      preKill: { side: 'me', planeIndex: 0 }, // 我方 id0 机（(0,0)，头 (0,2)）
      firstTurn: 'them',
    })
    if (!r.ok) throw new Error('factory fail')
    let cur = r.state
    // 对方（先手）打已毁 id0 机的残骸格（机身 (1,0)）→ miss（不 kill 不 hit）
    const s1 = applyShot(cur, { r: 1, c: 0 })
    expect(s1.ok).toBe(true)
    expect(s1.outcome).toBe('miss')
    cur = s1.state!
    // 再打其机头残骸格 (0,2) → 仍 miss
    const s2 = applyShot(cur, { r: 0, c: 2 })
    expect(s2.ok).toBe(true)
    expect(s2.outcome).toBe('miss')
    expect(s2.state!.players[0].destroyedPlaneIds).toEqual([0]) // 未被再次击毁
  })
})
