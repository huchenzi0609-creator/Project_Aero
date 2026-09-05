/**
 * gameStore —— 单机对局会话（M4）。
 *
 * 对局状态一律由 @aero/game-core 纯函数产出【新 state】再存入 store；
 * 严禁任何组件直接修改 state 对象。本 store 只负责持有会话与转发调用。
 * 单机身份固定：我方 = players[0]，电脑 = players[1]；先后手由 createGame 的 firstMover 决定。
 *
 * v0.3.0 规则转发（规则语义一律在 game-core，本 store 不落模式判断）：
 * - begin：把 config.blitz / config.blind 传入 createGame options；
 * - advanceBlitz：超快棋时钟按【当前回合方】推进（单机仅电脑行动期极短，超时只会落在我方回合）；
 * - queuePreFireAt / cancelPreFireAt / takePreFireShot：预报点队列走引擎权威 FIFO（联机才用客户端队列）。
 */
import { create } from 'zustand'
import type { Cell, GridConfig, PlacedPlane } from '@aero/shared'
import {
  advanceBlitzClock,
  applyShot,
  cancelPreFire,
  createEndgameState,
  createGame,
  queuePreFire,
  setFleet,
  takePreFireTurn,
} from '@aero/game-core'
import type { EndgameSeed, GameState, ShotResult } from '@aero/game-core'
import { generateFleet, mulberry32 } from '@aero/game-core/ai'
import type { Rng } from '@aero/game-core/ai'
import { useSettingsStore } from './settingsStore'

export interface GameSession {
  /** 每局自增序号：GameScreen 用它作为 key 重挂载（横幅/动画/计时器随局重置） */
  nonce: number
  config: GridConfig
  state: GameState
  me: 0 | 1
  ai: 0 | 1
  /** AI 报点随机源（随本局固定，保证流程可控） */
  aiRng: Rng
}

/** advanceBlitz 的消费结果（超时即已由引擎置 ended + winner） */
export interface BlitzAdvanceOutcome {
  timedOut: boolean
  winner?: 0 | 1
}

/** queuePreFireAt 结果：与 game-core 错误码一致（null = 当前阶段不可预报，调用方误用） */
export type PreFireAddResult = { ok: true } | { ok: false; error: 'CELL_TAKEN' | 'PRE_FIRE_FULL' }

interface GameStoreState {
  session: GameSession | null
  begin: (
    config: GridConfig,
    myPlanes: PlacedPlane[],
  ) => { ok: true } | { ok: false; errors: string[] }
  /** 教程单元2：沿用玩家阵型开局，强制【我方先手】（经典模式，无 blitz/blind） */
  beginTutorialBattle: (
    config: GridConfig,
    myPlanes: PlacedPlane[],
  ) => { ok: true } | { ok: false; errors: string[] }
  /** 教程单元3：残局开局（我方随机阵型已被击毁一架 + 对方先手），封装 game-core createEndgameState */
  beginTutorialEndgame: (
    config: GridConfig,
    myPlanes: PlacedPlane[],
    opponentPlanes: PlacedPlane[],
    seed: EndgameSeed,
  ) => { ok: true } | { ok: false; errors: string[] }
  /** 以【当前回合方】的身份报点（我方回合/电脑回合均走这里），返回 game-core 原始结果 */
  applyShotAt: (coord: Cell) => ShotResult | null
  /** 超快棋：按当前回合方推进 deltaMs 毫秒（仅 blitz 局有效；phase ended 后不再推进） */
  advanceBlitz: (deltaMs: number) => BlitzAdvanceOutcome | null
  /** 预报点入队（仅 playing 阶段·非我方回合可用）；错误码透传 game-core */
  queuePreFireAt: (coord: Cell) => PreFireAddResult | null
  /** 预报点取消（从引擎队列移除；不存在返回 false） */
  cancelPreFireAt: (coord: Cell) => boolean
  /** 我方回合开始执行预报点 FIFO：取出队首并报点，消耗本回合；空队/阶段不符返回 null */
  takePreFireShot: () => ShotResult | null
  reset: () => void
}

let nonceSeq = 1

export const useGameStore = create<GameStoreState>()((set, get) => ({
  session: null,

  begin: (config, myPlanes) => {
    // 等概率随机先后手：0=我方先手，1=电脑先手
    const firstMover: 0 | 1 = Math.random() < 0.5 ? 0 : 1
    // v0.3.0：把超快棋 / 盲棋规则标记传入引擎（始终写入：false 即关闭经典模式）
    let state = createGame(config.width, config.height, config.shape, config.planeCount, firstMover, {
      blitz: config.blitz,
      blind: config.blind,
    })

    const mine = setFleet(state, 0, myPlanes)
    if (!mine.ok) return { ok: false, errors: mine.errors }
    state = mine.state

    const difficulty = useSettingsStore.getState().difficulty
    const aiRng = mulberry32(((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0) || 1)
    let aiFleet: PlacedPlane[]
    try {
      aiFleet = generateFleet(
        config.width,
        config.height,
        config.planeCount,
        config.shape,
        difficulty,
        aiRng,
      )
    } catch (err) {
      return { ok: false, errors: [err instanceof Error ? err.message : 'AI 摆阵失败'] }
    }
    const theirs = setFleet(state, 1, aiFleet)
    if (!theirs.ok) return { ok: false, errors: theirs.errors }

    set({
      session: {
        nonce: nonceSeq++,
        config,
        state: theirs.state,
        me: 0,
        ai: 1,
        aiRng,
      },
    })
    return { ok: true }
  },

  // 教程单元2：与 begin 同流程，仅强制先手 = 我方（createGame firstMover 0），经典模式
  beginTutorialBattle: (config, myPlanes) => {
    let state = createGame(config.width, config.height, config.shape, config.planeCount, 0)
    const mine = setFleet(state, 0, myPlanes)
    if (!mine.ok) return { ok: false, errors: mine.errors }
    state = mine.state
    const difficulty = useSettingsStore.getState().difficulty
    const aiRng = mulberry32(((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0) || 1)
    let aiFleet: PlacedPlane[]
    try {
      aiFleet = generateFleet(config.width, config.height, config.planeCount, config.shape, difficulty, aiRng)
    } catch (err) {
      return { ok: false, errors: [err instanceof Error ? err.message : 'AI 摆阵失败'] }
    }
    const theirs = setFleet(state, 1, aiFleet)
    if (!theirs.ok) return { ok: false, errors: theirs.errors }
    set({
      session: {
        nonce: nonceSeq++,
        config,
        state: theirs.state,
        me: 0,
        ai: 1,
        aiRng,
      },
    })
    return { ok: true }
  },

  // 教程单元3：残局开局（我方一架已被击毁 + 对方先手），规则标记一律经典
  beginTutorialEndgame: (config, myPlanes, opponentPlanes, seed) => {
    const aiRng = mulberry32(((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0) || 1)
    const res = createEndgameState(
      config.width,
      config.height,
      config.shape,
      config.planeCount,
      myPlanes,
      opponentPlanes,
      seed,
    )
    if (!res.ok) return { ok: false, errors: res.errors }
    set({
      session: {
        nonce: nonceSeq++,
        config,
        state: res.state,
        me: 0,
        ai: 1,
        aiRng,
      },
    })
    return { ok: true }
  },

  applyShotAt: (coord) => {
    const { session } = get()
    if (!session) return null
    const res = applyShot(session.state, coord)
    if (res.ok && res.state) {
      set({ session: { ...session, state: res.state } })
    }
    return res
  },

  advanceBlitz: (deltaMs) => {
    const { session } = get()
    if (!session) return null
    const state = session.state
    if (!state.blitz || state.phase === 'ended') return null
    // 象棋钟语义：只有【当前回合方】的钟在走
    const res = advanceBlitzClock(state, state.turn, deltaMs)
    if (res.state !== state) {
      set({ session: { ...session, state: res.state } })
    }
    return { timedOut: res.timedOut, winner: res.winner }
  },

  queuePreFireAt: (coord) => {
    const { session } = get()
    if (!session) return null
    const state = session.state
    // 预报点仅在 playing 阶段的【非我方回合】可用（我方=0 固定；误用直接拒绝）
    if (state.phase !== 'playing' || state.turn === 0) return null
    const res = queuePreFire(state, 0, coord)
    if (res.ok) {
      set({ session: { ...session, state: res.state } })
    }
    return res.ok ? { ok: true } : { ok: false, error: res.error }
  },

  cancelPreFireAt: (coord) => {
    const { session } = get()
    if (!session) return false
    const next = cancelPreFire(session.state, 0, coord)
    if (next === session.state) return false
    set({ session: { ...session, state: next } })
    return true
  },

  takePreFireShot: () => {
    const { session } = get()
    if (!session) return null
    const state = session.state
    // 只在【我方回合 + playing】执行（绝地反击的最后一次报点不交给预报点，需玩家自选）
    if (state.turn !== 0 || state.phase !== 'playing') return null
    const res = takePreFireTurn(state, 0)
    if (res && res.ok && res.state) {
      set({ session: { ...session, state: res.state } })
    }
    return res
  },

  reset: () => set({ session: null }),
}))
