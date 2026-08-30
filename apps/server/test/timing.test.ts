/**
 * 围棋读秒制纯逻辑单测（timing.ts）。
 * 覆盖：机会消耗、20s→10s 降档、机器接管触发、断线宽限冻结/恢复。
 */
import { describe, expect, it } from 'vitest'
import {
  createTimingState,
  currentTurnLimitMs,
  DEFAULT_TIMING_CONFIG,
  freeze,
  handleTimeout,
  remainingMs,
  resume,
  startTurn,
} from '../src/timing'
import { OVERTIME_CHANCES, RECONNECT_GRACE_MS, REDUCED_TURN_LIMIT_MS, TURN_LIMIT_MS } from '@aero/shared'

// 与共享常量一致的默认配置
const T = {
  turnLimitMs: TURN_LIMIT_MS,
  overtimeChances: OVERTIME_CHANCES,
  reducedTurnLimitMs: REDUCED_TURN_LIMIT_MS,
}

const NOW = 1_000_000_000_000

describe('围棋读秒（timing.ts）', () => {
  it('默认配置与 shared 常量一致', () => {
    expect(DEFAULT_TIMING_CONFIG).toEqual(T)
    expect(RECONNECT_GRACE_MS).toBe(60_000)
  })

  it('初始状态：3 次机会、未降档、未接管、时限 20s', () => {
    const s = createTimingState(T)
    expect(s.chancesLeft).toBe(3)
    expect(s.reduced).toBe(false)
    expect(s.machine).toBe(false)
    expect(s.deadline).toBeNull()
    expect(currentTurnLimitMs(s, T)).toBe(TURN_LIMIT_MS)
  })

  it('开始回合：deadline = now + 当前时限', () => {
    const s = startTurn(createTimingState(T), NOW, T)
    expect(s.deadline).toBe(NOW + TURN_LIMIT_MS)
    expect(remainingMs(s.deadline, NOW + 5_000)).toBe(TURN_LIMIT_MS - 5_000)
    expect(remainingMs(s.deadline, NOW + TURN_LIMIT_MS + 1_000)).toBe(0) // 不取负
  })

  it('超时消耗机会并重置本回合读秒（继续由本人走，不轮换）', () => {
    let s = startTurn(createTimingState(T), NOW, T)
    for (let i = 0; i < 3; i++) {
      const d = handleTimeout(s, T, (s.deadline as number) + 1)
      expect(d.kind).toBe('consume')
      if (d.kind !== 'consume') return
      expect(d.next.chancesLeft).toBe(2 - i)
      // 读秒重置：deadline 顺延一个时限
      expect(d.next.deadline).toBe((s.deadline as number) + 1 + (d.next.reduced ? REDUCED_TURN_LIMIT_MS : TURN_LIMIT_MS))
      s = d.next
    }
    // 3 次机会耗尽后进入降档
    expect(s.chancesLeft).toBe(0)
    expect(s.reduced).toBe(true)
    expect(s.machine).toBe(false)
  })

  it('机会耗尽后每回合降档为 10s（20s→10s）', () => {
    // 构造一个已耗尽机会、未接管的席位
    let s = createTimingState(T)
    for (let i = 0; i < 3; i++) {
      const d = handleTimeout(s, T, (s.deadline ?? NOW) + 1)
      if (d.kind === 'consume') s = d.next
    }
    expect(s.reduced).toBe(true)
    // 新一轮回合按 10s 计时
    const s2 = startTurn(s, NOW, T)
    expect(s2.deadline).toBe(NOW + REDUCED_TURN_LIMIT_MS)
    expect(currentTurnLimitMs(s2, T)).toBe(REDUCED_TURN_LIMIT_MS)
  })

  it('降档后首次超时 → 机器永久接管；接管后不再超时', () => {
    let s = createTimingState(T)
    for (let i = 0; i < 3; i++) {
      const d = handleTimeout(s, T, (s.deadline ?? NOW) + 1)
      if (d.kind === 'consume') s = d.next
    }
    expect(s.reduced).toBe(true)
    // 降档后首次超时 → takeover
    const d = handleTimeout(s, T, NOW + 50_000)
    expect(d.kind).toBe('takeover')
    if (d.kind !== 'takeover') return
    expect(d.next.machine).toBe(true)
    expect(d.next.deadline).toBeNull()
    // 接管后：无时限、超时事件返回 none
    expect(currentTurnLimitMs(d.next, T)).toBeNull()
    const after = handleTimeout(d.next, T, NOW + 999_999)
    expect(after.kind).toBe('none')
    expect(after.next.machine).toBe(true)
  })

  it('断线宽限：冻结剩余时间、重连恢复 deadline（读秒暂停）', () => {
    const s = startTurn(createTimingState(T), NOW, T)
    // 断线发生在回合开始 5s 后 → 冻结剩余（TURN_LIMIT_MS - 5s）
    const f = freeze(s, NOW + 5_000)
    expect(f.frozenRemainingMs).toBe(TURN_LIMIT_MS - 5_000)
    expect(f.state.deadline).toBeNull()
    // 断线 10s 后重连 → deadline = now + 冻结剩余（剩余时间不因断线流逝）
    const r = resume(f.state, NOW + 15_000, f.frozenRemainingMs)
    expect(r.deadline).toBe(NOW + 15_000 + (TURN_LIMIT_MS - 5_000))
    // 无冻结值 → 重新开始完整回合（deadline null，由调用方 startTurn）
    const r2 = resume(f.state, NOW + 20_000, null)
    expect(r2.deadline).toBeNull()
  })

  it('机器席位冻结/恢复不改变机器状态', () => {
    const s = startTurn({ ...createTimingState(T), machine: true }, NOW, T)
    expect(s.deadline).toBeNull()
    const f = freeze(s, NOW + 5_000)
    expect(f.frozenRemainingMs).toBeNull()
    const r = resume(f.state, NOW + 10_000, f.frozenRemainingMs)
    expect(r.deadline).toBeNull()
    expect(r.machine).toBe(true)
  })
})
