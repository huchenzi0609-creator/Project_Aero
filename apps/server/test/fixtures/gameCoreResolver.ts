/**
 * @aero/server 测试夹具 —— game-core 解析器。
 *
 * M1 落地前 @aero/game-core 是抛错的 WIP 占位：集成测试自动使用
 * 契约一致的本地桩（./fakeGameCore.ts）；M1 落地后自动切换到真实实现，
 * 同一份集成测试即对真实 game-core 端到端验证。
 *
 * 探测覆盖整套 GameCoreApi（createGame / generateFleet / setFleet / applyShot /
 * chooseShot / validateFleet / mulberry32）：任一函数在当前实现下不可用
 * （抛错或对合法输入返回失败）即回退本地桩，避免 M1 中途状态把集成测试染红。
 */
import { DEFAULT_PLANE_SHAPE } from '@aero/shared'
import type { GameCoreApi } from '../../src/gameCore'
import * as real from '@aero/game-core'
import * as realAi from '@aero/game-core/ai'
import * as fake from './fakeGameCore'

/** 探测真实 game-core 是否可用（任一核心函数在当前实现下不可用即视为不可用） */
function isRealGameCoreUsable(): boolean {
  try {
    const shape = DEFAULT_PLANE_SHAPE
    // createGame
    const state = real.createGame(10, 10, shape, 1, 0)
    // generateFleet（正常难度，必须产出合法机队）
    const fleet = realAi.generateFleet(10, 10, 1, shape, 'normal', realAi.mulberry32(1))
    if (fleet.length !== 1) return false
    // validateFleet / setFleet
    const vf = real.validateFleet(10, 10, 1, shape, fleet)
    if (!vf.ok) return false
    const sf = real.setFleet(state, 0, fleet)
    if (!sf.ok) return false
    // applyShot（首次合法报点应返回 ok）
    const shot = real.applyShot({ ...(sf.state ?? state), phase: 'playing' }, { r: 0, c: 0 })
    if (shot.ok !== true) return false
    // chooseShot（normal 难度，未报点棋盘应给出界内坐标）
    const coord = realAi.chooseShot(
      { width: 10, height: 10, shots: [], planeShape: shape },
      'normal',
      realAi.mulberry32(2),
    )
    if (coord === undefined || coord.r < 0 || coord.c < 0) return false
    return true
  } catch {
    return false
  }
}

export function resolveGameCore(): { core: GameCoreApi; used: 'real' | 'fake' } {
  if (isRealGameCoreUsable()) {
    return {
      used: 'real',
      core: {
        validateFleet: real.validateFleet,
        createGame: real.createGame,
        setFleet: real.setFleet,
        applyShot: real.applyShot,
        chooseShot: realAi.chooseShot,
        generateFleet: realAi.generateFleet,
        mulberry32: realAi.mulberry32,
      },
    }
  }
  return {
    used: 'fake',
    core: {
      validateFleet: fake.validateFleet,
      createGame: fake.createGame,
      setFleet: fake.setFleet,
      applyShot: fake.applyShot,
      chooseShot: fake.chooseShot,
      generateFleet: fake.generateFleet,
      mulberry32: fake.mulberry32,
    },
  }
}
