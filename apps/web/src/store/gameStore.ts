/**
 * gameStore —— 单机对局会话（M4）。
 *
 * 对局状态一律由 @aero/game-core 纯函数产出【新 state】再存入 store；
 * 严禁任何组件直接修改 state 对象。本 store 只负责持有会话与转发调用。
 * 单机身份固定：我方 = players[0]，电脑 = players[1]；先后手由 createGame 的 firstMover 决定。
 */
import { create } from 'zustand'
import type { Cell, GridConfig, PlacedPlane } from '@aero/shared'
import { applyShot, createGame, setFleet } from '@aero/game-core'
import type { GameState, ShotResult } from '@aero/game-core'
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

interface GameStoreState {
  session: GameSession | null
  begin: (
    config: GridConfig,
    myPlanes: PlacedPlane[],
  ) => { ok: true } | { ok: false; errors: string[] }
  /** 以【当前回合方】的身份报点（我方回合/电脑回合均走这里），返回 game-core 原始结果 */
  applyShotAt: (coord: Cell) => ShotResult | null
  reset: () => void
}

let nonceSeq = 1

export const useGameStore = create<GameStoreState>()((set, get) => ({
  session: null,

  begin: (config, myPlanes) => {
    // 等概率随机先后手：0=我方先手，1=电脑先手
    const firstMover: 0 | 1 = Math.random() < 0.5 ? 0 : 1
    let state = createGame(config.width, config.height, config.shape, config.planeCount, firstMover)

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

  applyShotAt: (coord) => {
    const { session } = get()
    if (!session) return null
    const res = applyShot(session.state, coord)
    if (res.ok && res.state) {
      set({ session: { ...session, state: res.state } })
    }
    return res
  },

  reset: () => set({ session: null }),
}))
