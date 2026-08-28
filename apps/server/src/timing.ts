/**
 * @aero/server —— 围棋读秒制计时（纯逻辑，可单测）。
 *
 * 规则（docs/design.md §5 计时）：
 * 1. 每回合 TURN_LIMIT_MS（默认 20s）；超时 → 消耗 1 次全局机会（OVERTIME_CHANCES，默认 3），
 *    本回合读秒重置，继续由本人走（不轮换）。
 * 2. 机会耗尽后进入降档：此后每回合 REDUCED_TURN_LIMIT_MS（默认 10s）。
 * 3. 降档后首次超时 → 机器永久接管该席位（machine = true），此后该席位不再超时判负。
 *
 * 本模块只做「决策」，不持有 setTimeout——计时器由 rooms.ts 事件驱动地创建/取消。
 * 所有函数都是纯函数，时间戳由调用方传入，便于单测。
 */
import { OVERTIME_CHANCES, REDUCED_TURN_LIMIT_MS, TURN_LIMIT_MS } from '@aero/shared'

export interface TimingConfig {
  /** 正常回合时限（ms） */
  turnLimitMs: number
  /** 每位玩家的全局读秒机会次数 */
  overtimeChances: number
  /** 机会耗尽后的降档时限（ms） */
  reducedTurnLimitMs: number
}

export const DEFAULT_TIMING_CONFIG: TimingConfig = {
  turnLimitMs: TURN_LIMIT_MS,
  overtimeChances: OVERTIME_CHANCES,
  reducedTurnLimitMs: REDUCED_TURN_LIMIT_MS,
}

/** 单个席位（玩家）的读秒状态 */
export interface TimingState {
  /** 剩余全局机会 */
  chancesLeft: number
  /** 机会是否已耗尽（进入 10s 降档） */
  reduced: boolean
  /** 是否已被机器永久接管 */
  machine: boolean
  /** 当前回合截止时间戳（ms）；机器回合或无计时回合为 null */
  deadline: number | null
}

export function createTimingState(config: TimingConfig): TimingState {
  return { chancesLeft: config.overtimeChances, reduced: false, machine: false, deadline: null }
}

/** 当前回合的时限；机器接管后无时限（null） */
export function currentTurnLimitMs(state: TimingState, config: TimingConfig): number | null {
  if (state.machine) return null
  return state.reduced ? config.reducedTurnLimitMs : config.turnLimitMs
}

/** 剩余毫秒；deadline 为 null 时返回 null（无计时） */
export function remainingMs(deadline: number | null, now: number): number | null {
  if (deadline === null) return null
  return Math.max(0, deadline - now)
}

/** 开始一个新回合（含机会消耗后的读秒重置）：deadline = now + 时限 */
export function startTurn(state: TimingState, now: number, config: TimingConfig): TimingState {
  const limit = currentTurnLimitMs(state, config)
  return { ...state, deadline: limit === null ? null : now + limit }
}

/** 断线时冻结当前回合剩余时间（暂停读秒），返回冻结值供重连恢复 */
export function freeze(state: TimingState, now: number): { state: TimingState; frozenRemainingMs: number | null } {
  const rem = remainingMs(state.deadline, now)
  return { state: { ...state, deadline: null }, frozenRemainingMs: rem }
}

/** 重连后恢复被冻结的剩余时间（deadline = now + 冻结值）；null 表示无冻结 → 重新开始完整回合 */
export function resume(state: TimingState, now: number, frozenRemainingMs: number | null): TimingState {
  if (frozenRemainingMs === null) return { ...state, deadline: null }
  return { ...state, deadline: now + frozenRemainingMs }
}

export type TimeoutDecision =
  | { kind: 'consume'; next: TimingState } // 消耗 1 次机会，本回合读秒重置继续由本人走
  | { kind: 'takeover'; next: TimingState } // 机会耗尽后首次超时：机器永久接管
  | { kind: 'none'; next: TimingState } // 机器接管后不再有超时

/**
 * 读秒超时事件 → 处置决策。
 * 注意：最后一次机会被消耗后立即进入降档，本回合按降档时限重置。
 */
export function handleTimeout(state: TimingState, config: TimingConfig, now: number): TimeoutDecision {
  if (state.machine) return { kind: 'none', next: state }
  if (state.chancesLeft > 0) {
    const chancesLeft = state.chancesLeft - 1
    const reduced = chancesLeft === 0
    const next = startTurn({ ...state, chancesLeft, reduced }, now, config)
    return { kind: 'consume', next }
  }
  // 机会已耗尽（降档模式）后的首次超时 → 机器接管
  return { kind: 'takeover', next: { ...state, machine: true, deadline: null } }
}
