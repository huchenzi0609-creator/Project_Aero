/**
 * v0.2.9 击杀效率统计测试：killEfficiencyStats
 * 覆盖：直接爆头 0 步 / hit 后击杀 / 多机混合平均 / 无击毁 null / 双方各有击杀 / 四舍五入 / 纯函数性
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_PLANE_SHAPE, type PlacedPlane } from '@aero/shared'
import { applyShot, createGame, killEfficiencyStats, setFleet, type GameState } from '@aero/game-core'

/** 引擎序列：报点并返回新状态（失败即抛错） */
function shoot(g: GameState, r: number, c: number): GameState {
  const res = applyShot(g, { r, c })
  if (!res.ok || !res.state) throw new Error(`非法报点 (${r},${c}): ${res.error}`)
  return res.state
}

/** 默认形状 rot0 机队：origin 列表 → PlacedPlane[]（id 从 0 起） */
function fleet(origins: Array<{ r: number; c: number }>): PlacedPlane[] {
  return origins.map((o, i) => ({ id: i, rotation: 0 as const, origin: o }))
}

/** 开局：p0/p1 各自机队就绪进入 playing */
function newGame(p0: PlacedPlane[], p1: PlacedPlane[], firstMover: 0 | 1 = 0): GameState {
  const g = createGame(10, 10, DEFAULT_PLANE_SHAPE, Math.max(p0.length, p1.length), firstMover)
  const s0 = setFleet(g, 0, p0)
  if (!s0.ok) throw new Error(`setFleet p0 失败: ${s0.errors.join('；')}`)
  const s1 = setFleet(s0.state, 1, p1)
  if (!s1.ok) throw new Error(`setFleet p1 失败: ${s1.errors.join('；')}`)
  return s1.state
}

/** 默认形状 rot0 关键格（相对 origin）：机头 (0,2)；机身示例 (1,0)/(1,3)/(3,2) */
describe('killEfficiencyStats', () => {
  it('① 直接爆头击杀 → 该方效率 0，对方无击毁 → null', () => {
    // p1 两架：(5,0) 与 (5,5)，p0 直接打 A1 机头 (5,2)
    const g = newGame(fleet([{ r: 0, c: 0 }, { r: 0, c: 5 }]), fleet([{ r: 5, c: 0 }, { r: 5, c: 5 }]))
    const g2 = shoot(g, 5, 2) // kill A1（f=k=0 → 0 步）
    expect(g2.players[1].destroyedPlaneIds).toEqual([0])
    expect(killEfficiencyStats(g2)).toEqual({ player0: 0, player1: null })
  })

  it('② 先 hit 2 枪再 kill（k−f=2）→ 2.0', () => {
    const g = newGame(fleet([{ r: 0, c: 0 }, { r: 0, c: 5 }]), fleet([{ r: 5, c: 0 }, { r: 5, c: 5 }]))
    let cur = shoot(g, 6, 0) // hit A1 机身 (1,0)+(5,0)  → p0 idx0
    cur = shoot(cur, 9, 9) // p1 打空位
    cur = shoot(cur, 6, 4) // hit A1 机身 (1,4)+(5,0) → p0 idx1
    cur = shoot(cur, 9, 8) // p1 打空位
    cur = shoot(cur, 5, 2) // kill A1 机头 → p0 idx2（k−f = 2−0 = 2）
    expect(killEfficiencyStats(cur)).toEqual({ player0: 2, player1: null })
  })

  it('③ 多机混合：0 步 + 1 步 → 平均 0.5', () => {
    const g = newGame(fleet([{ r: 0, c: 0 }, { r: 0, c: 5 }]), fleet([{ r: 5, c: 0 }, { r: 5, c: 5 }]))
    let cur = shoot(g, 5, 2) // kill A1 直接爆头（0 步）
    cur = shoot(cur, 9, 9)
    cur = shoot(cur, 6, 5) // hit B1 机身 (1,0)+(5,5)
    cur = shoot(cur, 9, 8)
    cur = shoot(cur, 5, 7) // kill B1 机头（f=idx1, k=idx2 → 1 步）→ p1 全灭
    expect(cur.phase).toBe('ended')
    expect(killEfficiencyStats(cur)).toEqual({ player0: 0.5, player1: null })
  })

  it('④ 无击毁 → 双方均为 null', () => {
    const g = newGame(fleet([{ r: 0, c: 0 }]), fleet([{ r: 5, c: 0 }]))
    let cur = shoot(g, 9, 9) // p0 miss
    cur = shoot(cur, 9, 9) // p1 miss（对 p0 棋盘空位）
    cur = shoot(cur, 8, 8) // p0 miss
    expect(killEfficiencyStats(cur)).toEqual({ player0: null, player1: null })
  })

  it('⑤ 双方各有击杀 → 两侧数值各自正确', () => {
    const g = newGame(fleet([{ r: 0, c: 0 }, { r: 0, c: 5 }]), fleet([{ r: 5, c: 0 }, { r: 5, c: 5 }]))
    let cur = shoot(g, 6, 0) // p0 hit A1 机身（p0 idx0）
    cur = shoot(cur, 1, 0) // p1 hit A0 机身（p1 idx0）
    cur = shoot(cur, 5, 2) // p0 kill A1 机头（p0 idx1 → 1 步）
    cur = shoot(cur, 0, 2) // p1 kill A0 机头（p1 idx1 → 1 步）
    const stats = killEfficiencyStats(cur)
    expect(stats).toEqual({ player0: 1, player1: 1 })
  })

  it('⑥ 多架平均四舍五入到 1 位小数：0/1/3 步 → 1.3', () => {
    // p0 1 架 vs p1 3 架：(5,0) 直接爆头 0 步；(5,5) hit1 枪 1 步；(0,5) hit3 枪 3 步
    const g = newGame(fleet([{ r: 0, c: 0 }]), fleet([{ r: 5, c: 0 }, { r: 5, c: 5 }, { r: 0, c: 5 }]))
    let cur = shoot(g, 5, 2) // kill A1（0 步）
    cur = shoot(cur, 9, 9)
    cur = shoot(cur, 6, 5) // hit B1 机身
    cur = shoot(cur, 9, 8)
    cur = shoot(cur, 5, 7) // kill B1（1 步）
    cur = shoot(cur, 9, 7)
    cur = shoot(cur, 1, 5) // hit C1 机身 (1,0)+(0,5)
    cur = shoot(cur, 9, 6)
    cur = shoot(cur, 1, 8) // hit C1 机身 (1,3)+(0,5)
    cur = shoot(cur, 9, 5)
    cur = shoot(cur, 3, 7) // hit C1 机身 (3,2)+(0,5)
    cur = shoot(cur, 9, 4)
    cur = shoot(cur, 0, 7) // kill C1 机头（3 步）→ p1 全灭，p0 剩 1 架 → counterattack
    expect(cur.phase).toBe('counterattack')
    expect(killEfficiencyStats(cur)).toEqual({ player0: 1.3, player1: null })
  })

  it('⑦ 纯函数：不修改传入 state，多次调用结果一致', () => {
    const g = newGame(fleet([{ r: 0, c: 0 }, { r: 0, c: 5 }]), fleet([{ r: 5, c: 0 }, { r: 5, c: 5 }]))
    const g2 = shoot(shoot(g, 6, 0), 9, 9)
    const g3 = shoot(shoot(g2, 5, 2), 9, 8)
    const snapshot = JSON.stringify(g3)
    const a = killEfficiencyStats(g3)
    expect(JSON.stringify(g3)).toBe(snapshot) // 未被修改
    expect(killEfficiencyStats(g3)).toEqual(a) // 确定性
    expect(a).toEqual({ player0: 1, player1: null })
  })
})
