/**
 * @aero/server 测试夹具 —— game-core 解析器。
 *
 * M1 落地前 @aero/game-core 是抛错的 WIP 占位：集成测试自动使用
 * 契约一致的本地桩（./fakeGameCore.ts）；M1 落地后自动切换到真实实现，
 * 同一份集成测试即对真实 game-core 端到端验证。
 */
import { DEFAULT_PLANE_SHAPE } from '@aero/shared'
import type { GameCoreApi } from '../../src/gameCore'
import * as real from '@aero/game-core'
import * as realAi from '@aero/game-core/ai'
import * as fake from './fakeGameCore'

/** 探测真实 game-core 是否可用（WIP 占位会抛错） */
function isRealGameCoreUsable(): boolean {
  try {
    real.createGame(10, 10, DEFAULT_PLANE_SHAPE, 1, 0)
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
