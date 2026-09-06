/**
 * v0.3.6 绝地反击开关测试：
 * 1) counterattack:false（禁用）时，先手全歼 + 自身恰剩 1 架 → 直接 ended、winner=先手，无 counterattack 阶段；
 * 2) 缺省 / 显式 counterattack:true 与现有行为完全一致（进入 counterattack，后手 kill 才胜、否则先手胜）。
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_PLANE_SHAPE, type PlacedPlane } from '@aero/shared'
import { applyShot, createGame, setFleet, type GameState } from '@aero/game-core'

const W = 10
const H = 10

function onePlane(id = 0, origin: { r: number; c: number } = { r: 0, c: 0 }): PlacedPlane {
  return { id, rotation: 0 as const, origin }
}

/** 1v1 开局（p0=先手）；options 控制模式 */
function newGame(options?: { counterattack?: boolean }): GameState {
  let g = createGame(W, H, DEFAULT_PLANE_SHAPE, 1, 0, options)
  const s0 = setFleet(g, 0, [onePlane(0)])
  if (!s0.ok) throw new Error('setFleet p0 失败')
  const s1 = setFleet(s0.state, 1, [onePlane(1)])
  if (!s1.ok) throw new Error('setFleet p1 失败')
  return s1.state
}

describe('v0.3.6 绝地反击开关', () => {
  it('createGame options：counterattack 缺省不写入 mode（缺省 true）；显式 false 写入', () => {
    const classic = createGame(10, 10, DEFAULT_PLANE_SHAPE, 3, 0)
    expect(classic.mode).toEqual({ blitz: false, blind: false })
    const disabled = createGame(10, 10, DEFAULT_PLANE_SHAPE, 3, 0, { counterattack: false })
    expect(disabled.mode).toEqual({ blitz: false, blind: false, counterattack: false })
  })

  it('① counterattack:false：先手全歼 + 剩 1 架 → 直接 ended、winner=先手、无 counterattack 阶段', () => {
    const g = newGame({ counterattack: false })
    const r = applyShot(g, { r: 0, c: 2 }) // 先手打后手唯一机头（p1 机 (0,0) rot0 head(0,2)）
    expect(r.ok).toBe(true)
    expect(r.outcome).toBe('kill')
    expect(r.killedPlaneId).toBe(1)
    expect(r.state!.phase).toBe('ended')
    expect(r.state!.winner).toBe(0)
    expect(r.winner).toBe(0)
    // 后手没有得到额外报点（回合不再被交给后手）
    expect(r.state!.turn).toBe(0)
  })

  it('② 缺省：行为与现有完全一致——先手全歼+剩1 触发 counterattack，后手 kill 才胜', () => {
    const g = newGame() // 不传 options
    expect(g.mode?.counterattack).toBeUndefined()
    const r1 = applyShot(g, { r: 0, c: 2 }) // 先手 kill 后手唯一机
    expect(r1.state!.phase).toBe('counterattack')
    expect(r1.state!.winner).toBeNull()
    // 反击：后手打先手机头 → kill → 后手胜
    const r2 = applyShot(r1.state!, { r: 0, c: 2 })
    expect(r2.outcome).toBe('kill')
    expect(r2.state!.phase).toBe('ended')
    expect(r2.winner).toBe(1)
  })

  it('②b 缺省：反击非 kill（miss）→ 先手胜', () => {
    const g = newGame()
    const r1 = applyShot(g, { r: 0, c: 2 })
    expect(r1.state!.phase).toBe('counterattack')
    const r2 = applyShot(r1.state!, { r: 9, c: 9 }) // 后手打空位
    expect(r2.outcome).toBe('miss')
    expect(r2.state!.phase).toBe('ended')
    expect(r2.winner).toBe(0)
  })

  it('②c 显式 counterattack:true 与缺省一致（仍触发反击）', () => {
    const g = newGame({ counterattack: true })
    const r1 = applyShot(g, { r: 0, c: 2 })
    expect(r1.state!.phase).toBe('counterattack')
  })
})
