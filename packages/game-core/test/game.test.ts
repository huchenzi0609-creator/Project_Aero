/**
 * M1 对局引擎测试：applyShot 全语义 + 绝地反击全分支 + isGameOver / remainingPlanes
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_PLANE_SHAPE, type PlacedPlane } from '@aero/shared'
import {
  applyShot,
  createGame,
  isGameOver,
  remainingPlanes,
  setFleet,
  type GameState,
  type PlayerBoard,
} from '@aero/game-core'

const W = 10
const H = 10

/** 默认形状旋转 0 摆放在指定 origin 的单机 */
function onePlane(id = 0, origin: { r: number; c: number } = { r: 0, c: 0 }): PlacedPlane {
  return { id, rotation: 0, origin }
}

function board(planes: PlacedPlane[], opts: Partial<PlayerBoard> = {}): PlayerBoard {
  return {
    width: W,
    height: H,
    shape: DEFAULT_PLANE_SHAPE,
    planes,
    destroyedPlaneIds: [],
    receivedShots: [],
    shotsFired: [],
    ...opts,
  }
}

function state(opts: Partial<GameState> = {}): GameState {
  return {
    phase: 'playing',
    players: [board([]), board([])],
    turn: 0,
    firstMover: 0,
    turnNo: 1,
    winner: null,
    ...opts,
  }
}

describe('applyShot 基础语义', () => {
  it('placing 阶段报点 → invalid-phase', () => {
    const g = createGame(10, 10, DEFAULT_PLANE_SHAPE, 3, 0)
    const r = applyShot(g, { r: 0, c: 0 })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('invalid-phase')
  })

  it('ended 阶段报点 → invalid-phase', () => {
    const g = state({ phase: 'ended', winner: 0 })
    const r = applyShot(g, { r: 0, c: 0 })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('invalid-phase')
  })

  it('越界 → out-of-bounds', () => {
    const g = state({ players: [board([onePlane()]), board([onePlane()])] })
    expect(applyShot(g, { r: -1, c: 0 }).error).toBe('out-of-bounds')
    expect(applyShot(g, { r: 0, c: -1 }).error).toBe('out-of-bounds')
    expect(applyShot(g, { r: 10, c: 0 }).error).toBe('out-of-bounds')
    expect(applyShot(g, { r: 0, c: 10 }).error).toBe('out-of-bounds')
  })

  it('miss：空位 → miss，写入双方记录，轮换 turn 并 turnNo+1', () => {
    const g = state({ players: [board([onePlane()]), board([onePlane()])] })
    const r = applyShot(g, { r: 9, c: 9 })
    expect(r.ok).toBe(true)
    expect(r.outcome).toBe('miss')
    expect(r.killedPlaneId).toBeUndefined()
    expect(r.winner).toBeUndefined() // 本步未产生胜者
    const s = r.state!
    expect(s.phase).toBe('playing')
    expect(s.turn).toBe(1)
    expect(s.turnNo).toBe(2)
    expect(s.players[0].shotsFired).toHaveLength(1)
    expect(s.players[0].shotsFired[0]).toEqual({ coord: { r: 9, c: 9 }, outcome: 'miss' })
    expect(s.players[1].receivedShots).toHaveLength(1)
    expect(s.players[1].receivedShots[0]).toEqual({ coord: { r: 9, c: 9 }, outcome: 'miss' })
    expect(s.players[1].destroyedPlaneIds).toEqual([])
  })

  it('hit：存活飞机非机头格', () => {
    const g = state({ players: [board([onePlane()]), board([onePlane()])] })
    const r = applyShot(g, { r: 1, c: 0 }) // (1,0) 为默认形状机翼
    expect(r.outcome).toBe('hit')
    expect(r.killedPlaneId).toBeUndefined()
    expect(r.state!.players[1].destroyedPlaneIds).toEqual([])
    expect(r.state!.turn).toBe(1)
  })

  it('kill：机头格 → 击毁并仅暴露机头信息（killedPlaneId）', () => {
    const g = state({ players: [board([onePlane()]), board([onePlane()])] })
    const r = applyShot(g, { r: 0, c: 2 }) // (0,2) 为机头
    expect(r.ok).toBe(true)
    expect(r.outcome).toBe('kill')
    expect(r.killedPlaneId).toBe(0)
    expect(r.state!.players[1].destroyedPlaneIds).toEqual([0])
    // 1 对 1 对局：先手全歼且自身恰剩 1 架 → 绝地反击
    expect(r.state!.phase).toBe('counterattack')
    expect(r.state!.turn).toBe(1)
    expect(r.state!.turnNo).toBe(1)
    expect(r.state!.winner).toBeNull()
  })

  it('无效打击：击毁后打残骸格 → miss', () => {
    const p0 = [onePlane(0)]
    const p1 = [onePlane(0), onePlane(1, { r: 0, c: 5 })]
    const g = state({ players: [board(p0), board(p1)] })
    const r1 = applyShot(g, { r: 0, c: 2 }) // kill 0 号
    expect(r1.outcome).toBe('kill')
    const r2 = applyShot(r1.state!, { r: 9, c: 9 }) // 后手随便打空位
    expect(r2.outcome).toBe('miss')
    const r3 = applyShot(r2.state!, { r: 1, c: 1 }) // 已毁 0 号机的残骸格 (1,1)
    expect(r3.outcome).toBe('miss')
    expect(r3.killedPlaneId).toBeUndefined()
    // 后手 receivedShots：r1 的 kill + r3 的 miss（r2 是后手打先手，记在先手 receivedShots）
    expect(r3.state!.players[1].receivedShots).toHaveLength(2)
    expect(r3.state!.players[1].receivedShots.map((s) => s.outcome)).toEqual(['kill', 'miss'])
    expect(r3.state!.players[0].receivedShots).toHaveLength(1)
  })

  it('重复报点 → already-shot（按射击方 shotsFired 判定）', () => {
    const g = state({ players: [board([onePlane()]), board([onePlane()])] })
    const r1 = applyShot(g, { r: 9, c: 9 }) // 0 号 miss
    const r2 = applyShot(r1.state!, { r: 8, c: 9 }) // 1 号 miss（不同格，合法）
    const r3 = applyShot(r2.state!, { r: 9, c: 9 }) // 0 号重复
    expect(r3.ok).toBe(false)
    expect(r3.error).toBe('already-shot')
    // 对方打同一格不受影响（各自的 shotsFired 独立）
    const r4 = applyShot(r2.state!, { r: 9, c: 9 }) // 从 r2（轮到 0 号）… 实际应轮到 0 号
    expect(r4.error).toBe('already-shot')
  })

  it('回合轮换与 turnNo 递增（连续 4 步）', () => {
    const g = state({ players: [board([onePlane()]), board([onePlane()])] })
    // 各回合打不同空位，避免 already-shot；四角/下角均不在 (0,0) 飞机格内
    const cells = [
      { r: 9, c: 9 },
      { r: 8, c: 9 },
      { r: 9, c: 8 },
      { r: 8, c: 8 },
    ]
    let cur = g
    for (let i = 0; i < 4; i++) {
      const shooter = cur.turn
      const r = applyShot(cur, cells[i]!)
      expect(r.ok).toBe(true)
      expect(r.outcome).toBe('miss')
      expect(r.state!.turn).toBe((1 - shooter) as 0 | 1)
      expect(r.state!.turnNo).toBe(cur.turnNo + 1)
      cur = r.state!
    }
    expect(cur.turnNo).toBe(5)
  })

  it('applyShot 为纯函数：不修改传入 state', () => {
    const g = state({ players: [board([onePlane()]), board([onePlane()])] })
    const snapshot = JSON.stringify(g)
    applyShot(g, { r: 9, c: 9 })
    applyShot(g, { r: 0, c: 2 })
    expect(JSON.stringify(g)).toBe(snapshot)
  })
})

describe('绝地反击与胜负判定', () => {
  it('先手全歼 + 恰剩 1 架 → counterattack；反击 kill → 后手胜', () => {
    const g = state({ players: [board([onePlane()]), board([onePlane()])] })
    const r1 = applyShot(g, { r: 0, c: 2 }) // 先手打后手机头
    expect(r1.outcome).toBe('kill')
    expect(r1.state!.phase).toBe('counterattack')
    expect(r1.state!.turn).toBe(1)
    expect(r1.state!.winner).toBeNull()
    const r2 = applyShot(r1.state!, { r: 0, c: 2 }) // 后手打先手机头
    expect(r2.outcome).toBe('kill')
    expect(r2.killedPlaneId).toBe(0)
    expect(r2.state!.phase).toBe('ended')
    expect(r2.winner).toBe(1)
  })

  it('反击 hit（打存活机非机头）→ 先手胜', () => {
    const g = state({ players: [board([onePlane()]), board([onePlane()])] })
    const r1 = applyShot(g, { r: 0, c: 2 })
    const r2 = applyShot(r1.state!, { r: 1, c: 0 }) // 先手机翼
    expect(r2.outcome).toBe('hit')
    expect(r2.state!.phase).toBe('ended')
    expect(r2.winner).toBe(0)
  })

  it('反击 miss（空位）→ 先手胜', () => {
    const g = state({ players: [board([onePlane()]), board([onePlane()])] })
    const r1 = applyShot(g, { r: 0, c: 2 })
    const r2 = applyShot(r1.state!, { r: 9, c: 9 })
    expect(r2.outcome).toBe('miss')
    expect(r2.state!.phase).toBe('ended')
    expect(r2.winner).toBe(0)
  })

  it('反击打先手残骸（无效打击）→ 先手胜', () => {
    // 先手有 2 架（0 号已毁），后手 1 架
    const b0 = board([onePlane(0), onePlane(1, { r: 0, c: 5 })], { destroyedPlaneIds: [0] })
    const b1 = board([onePlane(0)])
    const g = state({ players: [b0, b1] })
    const r1 = applyShot(g, { r: 0, c: 2 }) // 先手全歼后手，剩 1 架 → counterattack
    expect(r1.state!.phase).toBe('counterattack')
    const r2 = applyShot(r1.state!, { r: 1, c: 1 }) // 0 号机残骸格
    expect(r2.outcome).toBe('miss')
    expect(r2.state!.phase).toBe('ended')
    expect(r2.winner).toBe(0)
  })

  it('先手剩 2 架全歼 → 先手直接胜（不触发反击）', () => {
    const p0 = [onePlane(0), onePlane(1, { r: 0, c: 5 })]
    const p1 = [onePlane(0)]
    const g = state({ players: [board(p0), board(p1)] })
    const r = applyShot(g, { r: 0, c: 2 })
    expect(r.outcome).toBe('kill')
    expect(r.state!.phase).toBe('ended')
    expect(r.winner).toBe(0)
    expect(r.state!.winner).toBe(0)
  })

  it('后手全歼先手机队 → 后手直接胜（不触发反击）', () => {
    const g = state({ players: [board([onePlane()]), board([onePlane()])], turn: 1, firstMover: 0 })
    const r = applyShot(g, { r: 0, c: 2 }) // 后手打先手机头
    expect(r.outcome).toBe('kill')
    expect(r.state!.phase).toBe('ended')
    expect(r.winner).toBe(1)
  })

  it('counterattack 阶段重复报点 → already-shot', () => {
    const g = state({ players: [board([onePlane()]), board([onePlane()])] })
    const r1 = applyShot(g, { r: 0, c: 2 }) // → counterattack，轮到 1 号
    // 构造：后手在进入反击前已打过 (9,9)
    const b1WithShot = board([onePlane()], { shotsFired: [{ coord: { r: 9, c: 9 }, outcome: 'miss' }] })
    const g2 = state({
      players: [board([onePlane()]), b1WithShot],
      phase: 'counterattack',
      turn: 1,
      firstMover: 0,
    })
    void r1
    const r2 = applyShot(g2, { r: 9, c: 9 })
    expect(r2.ok).toBe(false)
    expect(r2.error).toBe('already-shot')
  })
})

describe('isGameOver / remainingPlanes', () => {
  it('remainingPlanes = 总数 - 已毁数', () => {
    const b = board([onePlane(0), onePlane(1, { r: 0, c: 5 })], { destroyedPlaneIds: [0] })
    expect(remainingPlanes(b)).toBe(1)
    expect(remainingPlanes(board([onePlane()]))).toBe(1)
    expect(remainingPlanes(board([]))).toBe(0)
  })

  it('isGameOver 只看 phase', () => {
    expect(isGameOver(state({ phase: 'ended', winner: 0 }))).toBe(true)
    expect(isGameOver(state())).toBe(false)
    expect(isGameOver(state({ phase: 'counterattack' }))).toBe(false)
  })
})

describe('完整对局流程（脚本化报点）', () => {
  it('setFleet → playing → 对局至终局（0 号胜）', () => {
    let g = createGame(10, 10, DEFAULT_PLANE_SHAPE, 1, 0)
    const fleet = [onePlane(0, { r: 5, c: 5 })]
    const r0 = setFleet(g, 0, fleet)
    if (r0.ok) g = r0.state
    const r1 = setFleet(g, 1, [onePlane(0, { r: 0, c: 0 })])
    if (r1.ok) g = r1.state
    expect(g.phase).toBe('playing')

    // 0 号（先手）打 1 号机头 (0,2) → kill；1 对 1 → 触发绝地反击
    const s1 = applyShot(g, { r: 0, c: 2 })
    expect(s1.state!.phase).toBe('counterattack')
    // 1 号反击打 0 号机翼 (6,5)（0 号机位于 (5,5)，机头 (5,7)，机翼如 (6,5)）
    const s2 = applyShot(s1.state!, { r: 6, c: 5 })
    expect(s2.outcome).toBe('hit')
    expect(s2.state!.phase).toBe('ended')
    expect(s2.winner).toBe(0)
    expect(isGameOver(s2.state!)).toBe(true)
  })
})
