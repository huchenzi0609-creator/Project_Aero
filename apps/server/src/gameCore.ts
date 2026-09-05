/**
 * @aero/server —— game-core 接口绑定（依赖注入缝隙）。
 *
 * 把 @aero/game-core（对局引擎）与 @aero/game-core/ai（AI）组合成
 * rooms.ts 所依赖的 GameCoreApi。生产环境使用真实实现；
 * 测试可注入契约一致的本地桩（apps/server/test/fixtures/），
 * 使真实实现异常时集成测试仍可跑通。
 */
import * as engine from '@aero/game-core'
import * as ai from '@aero/game-core/ai'
import type { Cell, Difficulty, PlacedPlane, PlaneShape } from '@aero/shared'
import type { BlitzAdvanceResult, GameOptions, GameState, ShotResult } from '@aero/game-core'
import type { Rng, ShotKnowledge } from '@aero/game-core/ai'

/** rooms.ts 需要的 game-core 能力（契约见 docs/game-core-api.md） */
export interface GameCoreApi {
  validateFleet(
    width: number,
    height: number,
    planeCount: number,
    shape: PlaneShape,
    planes: PlacedPlane[],
  ): { ok: true } | { ok: false; errors: string[] }
  createGame(
    width: number,
    height: number,
    shape: PlaneShape,
    planeCount: number,
    firstMover: 0 | 1,
    options?: GameOptions,
  ): GameState
  setFleet(
    state: GameState,
    player: 0 | 1,
    planes: PlacedPlane[],
  ): { ok: true; state: GameState } | { ok: false; errors: string[] }
  applyShot(state: GameState, coord: Cell): ShotResult
  /** v0.3.0：超快棋时钟推进（纯函数；timedOut 时须由调用方走超时判负收尾） */
  advanceBlitzClock(state: GameState, player: 0 | 1, deltaMs: number): BlitzAdvanceResult
  chooseShot(knowledge: ShotKnowledge, difficulty: Difficulty, rng: Rng): Cell
  generateFleet(
    width: number,
    height: number,
    planeCount: number,
    shape: PlaneShape,
    difficulty: Difficulty,
    rng: Rng,
  ): PlacedPlane[]
  mulberry32(seed: number): Rng
}

/** 生产默认：真实 game-core（v0.3.0 权威实现） */
export const realGameCore: GameCoreApi = {
  validateFleet: engine.validateFleet,
  createGame: engine.createGame,
  setFleet: engine.setFleet,
  applyShot: engine.applyShot,
  advanceBlitzClock: engine.advanceBlitzClock,
  chooseShot: ai.chooseShot,
  generateFleet: ai.generateFleet,
  mulberry32: ai.mulberry32,
}

export type { ShotKnowledge, Rng }
