/**
 * M1 摆阵校验与 setFleet 测试：validateFleet / createGame / setFleet
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_PLANE_SHAPE, type PlacedPlane } from '@aero/shared'
import { createGame, setFleet, validateFleet } from '@aero/game-core'

/** 10×10 上三架不重叠的合法机队（默认形状） */
function validFleet(): PlacedPlane[] {
  return [
    { id: 0, rotation: 0, origin: { r: 0, c: 0 } }, // 行 0..3 列 0..4
    { id: 1, rotation: 0, origin: { r: 5, c: 0 } }, // 行 5..8 列 0..4
    { id: 2, rotation: 1, origin: { r: 0, c: 5 } }, // 旋转后 行 0..4 列 6..9
  ]
}

describe('validateFleet', () => {
  it('合法机队通过', () => {
    expect(validateFleet(10, 10, 3, DEFAULT_PLANE_SHAPE, validFleet())).toEqual({ ok: true })
  })

  it('数量不符', () => {
    const res = validateFleet(10, 10, 3, DEFAULT_PLANE_SHAPE, validFleet().slice(0, 2))
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.errors.join('；')).toContain('数量')
  })

  it('数量过多', () => {
    const extra: PlacedPlane[] = [...validFleet(), { id: 3, rotation: 0, origin: { r: 0, c: 9 } }]
    const res = validateFleet(10, 10, 3, DEFAULT_PLANE_SHAPE, extra)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.errors.join('；')).toContain('数量')
  })

  it('越界', () => {
    const planes = validFleet()
    planes[2] = { id: 2, rotation: 0, origin: { r: 8, c: 5 } } // 行 8..11 > 9
    const res = validateFleet(10, 10, 3, DEFAULT_PLANE_SHAPE, planes)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.errors.join('；')).toContain('边界')
  })

  it('重叠', () => {
    const planes = validFleet()
    planes[1] = { id: 1, rotation: 0, origin: { r: 0, c: 0 } } // 与 0 号重叠
    const res = validateFleet(10, 10, 3, DEFAULT_PLANE_SHAPE, planes)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.errors.join('；')).toContain('重叠')
  })
})

describe('createGame', () => {
  it('初始状态：placing、空机队、turn=firstMover、turnNo=1', () => {
    const g = createGame(10, 10, DEFAULT_PLANE_SHAPE, 3, 1)
    expect(g.phase).toBe('placing')
    expect(g.turn).toBe(1)
    expect(g.firstMover).toBe(1)
    expect(g.turnNo).toBe(1)
    expect(g.winner).toBeNull()
    expect(g.players[0].planes).toEqual([])
    expect(g.players[1].planes).toEqual([])
    expect(g.players[0].destroyedPlaneIds).toEqual([])
    expect(g.players[0].receivedShots).toEqual([])
    expect(g.players[0].shotsFired).toEqual([])
    expect(g.players[0].width).toBe(10)
    expect(g.players[0].height).toBe(10)
  })
})

describe('setFleet', () => {
  it('一方就绪后仍为 placing，双方就绪后进入 playing', () => {
    const g = createGame(10, 10, DEFAULT_PLANE_SHAPE, 3, 0)
    const r0 = setFleet(g, 0, validFleet())
    expect(r0.ok).toBe(true)
    if (r0.ok) {
      expect(r0.state.phase).toBe('placing')
      expect(r0.state.players[0].planes).toHaveLength(3)
      expect(r0.state.players[0].planes[0]).toEqual(validFleet()[0])
      expect(r0.state.players[1].planes).toEqual([])
    }
    const r1 = setFleet(r0.ok ? r0.state : g, 1, validFleet())
    expect(r1.ok).toBe(true)
    if (r1.ok) {
      expect(r1.state.phase).toBe('playing')
      expect(r1.state.players[1].planes).toHaveLength(3)
      expect(r1.state.turn).toBe(0)
      expect(r1.state.turnNo).toBe(1)
    }
  })

  it('重复设置 = 覆盖（双方就绪前）', () => {
    const g = createGame(10, 10, DEFAULT_PLANE_SHAPE, 3, 0)
    const r1 = setFleet(g, 0, validFleet())
    // 第二次设置 0 号玩家：把 0 号飞机换成旋转 1 放 (0,0)（不与其它两架重叠）
    const second = validFleet()
    second[0] = { id: 0, rotation: 1, origin: { r: 0, c: 0 } }
    const r2 = setFleet(r1.ok ? r1.state : g, 0, second)
    expect(r2.ok).toBe(true)
    if (r2.ok) {
      expect(r2.state.players[0].planes[0]).toEqual({ id: 0, rotation: 1, origin: { r: 0, c: 0 } })
      expect(r2.state.players[0].planes).toHaveLength(3)
    }
  })

  it('双方就绪后不可再设置', () => {
    let g = createGame(10, 10, DEFAULT_PLANE_SHAPE, 3, 0)
    const r0 = setFleet(g, 0, validFleet())
    if (r0.ok) g = r0.state
    const r1 = setFleet(g, 1, validFleet())
    expect(r1.ok).toBe(true)
    if (r1.ok) {
      const r2 = setFleet(r1.state, 0, validFleet())
      expect(r2.ok).toBe(false)
      if (!r2.ok) expect(r2.errors.join('；')).toContain('阶段')
    }
  })

  it('非法机队被拒绝（重叠）', () => {
    const g = createGame(10, 10, DEFAULT_PLANE_SHAPE, 3, 0)
    const bad = validFleet()
    bad[1] = { id: 1, rotation: 0, origin: { r: 0, c: 0 } }
    const r = setFleet(g, 0, bad)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join('；')).toContain('重叠')
  })

  it('非法机队被拒绝（越界）', () => {
    const g = createGame(10, 10, DEFAULT_PLANE_SHAPE, 3, 0)
    const bad = validFleet()
    bad[2] = { id: 2, rotation: 0, origin: { r: 8, c: 5 } }
    const r = setFleet(g, 0, bad)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join('；')).toContain('边界')
  })

  it('setFleet 为纯函数：不修改传入 state', () => {
    const g = createGame(10, 10, DEFAULT_PLANE_SHAPE, 3, 0)
    const snapshot = JSON.stringify(g)
    setFleet(g, 0, validFleet())
    expect(JSON.stringify(g)).toBe(snapshot)
  })
})
