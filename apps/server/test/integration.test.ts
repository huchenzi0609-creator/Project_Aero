/**
 * 联机集成测试（socket.io-client × 两个真实客户端 × 真实 HTTP+Socket.IO 服务器）。
 *
 * 覆盖：
 * - 全流程：auth → 建房 → 入房 → 摆阵 → 就绪 → 轮番报点至终局（shotResult 序列 + gameEnd 双方真实阵型 + 落盘）
 * - 重复报点被拒、非当前轮次报点被拒、投降判负
 * - 断线重连：宽限期内凭 token+gameId 恢复（回放历史、恢复读秒）、断线超时判负
 * - 围棋读秒超时 → 机器永久接管 → 对局继续至终局
 * - 公网匹配：同配置配对、自定义配置拒绝、30s 未匹配超时
 *
 * game-core 说明：M1 落地前使用契约一致的本地桩（fakeGameCore），M1 落地后自动切换真实实现
 * （见 ./fixtures/gameCoreResolver.ts）。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { io as ioClient, type Socket } from 'socket.io-client'
import {
  DEFAULT_PLANE_SHAPE,
  PRESETS,
  type Cell,
  type ClientToServerEvents,
  type GameEndPayload,
  type GamePhase,
  type GridConfig,
  type GuestIdentity,
  type PlacedPlane,
  type RoomSummary,
  type RoomUpdate,
  type ServerToClientEvents,
  type ShotResultPayload,
} from '@aero/shared'
import { startServer, type ServerHandle } from '../src/index'
import { resolveGameCore } from './fixtures/gameCoreResolver'
import type { GameCoreApi } from '../src/gameCore'
import { occupiedCells } from './fixtures/fakeGameCore'

/* ---------------------------------------------------------------- 测试客户端辅助 */

type TestSocket = Socket<ServerToClientEvents, ClientToServerEvents>

class TestClient {
  readonly socket: TestSocket
  private buffers = new Map<string, unknown[]>()
  private disposed = false

  constructor(url: string) {
    // socket.io-client 4.8 的 lookup 签名不带泛型，这里断言为项目协议类型
    this.socket = ioClient(url) as unknown as TestSocket
    this.socket.onAny((event, ...args) => {
      const arr = this.buffers.get(event) ?? []
      arr.push(args.length > 0 ? args[0] : undefined)
      this.buffers.set(event, arr)
    })
  }

  /** 消费缓存中第一个匹配事件；无则等待新事件（超时报错） */
  waitFor<T>(event: keyof ServerToClientEvents, pred?: (v: T) => boolean, timeoutMs = 10_000): Promise<T> {
    const predicate = pred ?? (() => true)
    const deadline = Date.now() + timeoutMs
    return new Promise<T>((resolve, reject) => {
      const tick = (): void => {
        if (this.disposed) {
          reject(new Error(`客户端已断开，等待 ${String(event)} 失败`))
          return
        }
        if (Date.now() > deadline) {
          reject(new Error(`等待事件超时: ${String(event)} (${timeoutMs}ms)`))
          return
        }
        const buf = this.buffers.get(event) ?? []
        const idx = buf.findIndex((v) => predicate(v as T))
        if (idx >= 0) {
          const hit = buf[idx] as T
          buf.splice(idx, 1)
          resolve(hit)
          return
        }
        setTimeout(tick, 25)
      }
      tick()
    })
  }

  /** 已收到的事件历史（不消费） */
  history<T>(event: keyof ServerToClientEvents): T[] {
    return (this.buffers.get(event) ?? []) as T[]
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.socket.disconnect()
  }
}

function emitAck<T>(socket: TestSocket, event: string, payload?: unknown): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`ack 超时: ${event}`)), 10_000)
    const cb = (res: T): void => {
      clearTimeout(timer)
      resolve(res)
    }
    if (payload === undefined) {
      ;(socket.emit as (ev: string, ack: (r: T) => void) => void)(event, cb)
    } else {
      ;(socket.emit as (ev: string, p: unknown, ack: (r: T) => void) => void)(event, payload, cb)
    }
  })
}

async function authClient(client: TestClient, token?: string): Promise<GuestIdentity> {
  const res = await emitAck<{ identity?: GuestIdentity }>(client.socket, 'auth', { token })
  if (!res.identity) throw new Error('auth ack 缺少 identity')
  return res.identity
}

/** 建房 + 入房 + 双方摆阵（不 ready），返回房码与双方座位下标 */
async function setupRoom(
  a: TestClient,
  b: TestClient,
  config: GridConfig,
  fleets: { a: PlacedPlane[]; b: PlacedPlane[] },
): Promise<{ code: string; youA: 0 | 1; youB: 0 | 1 }> {
  const createRes = await emitAck<{ roomCode?: string; error?: string }>(a.socket, 'createRoom', { config })
  if (!createRes.roomCode) throw new Error(`建房失败: ${createRes.error ?? '未知错误'}`)
  const joinRes = await emitAck<{ room?: RoomSummary; error?: string }>(b.socket, 'joinRoom', {
    code: createRes.roomCode,
  })
  if (!joinRes.room) throw new Error(`入房失败: ${joinRes.error ?? '未知错误'}`)
  const pfA = await emitAck<{ errors?: string[] }>(a.socket, 'placeFleet', { planes: fleets.a })
  if ((pfA.errors ?? []).length > 0) throw new Error(`A 摆阵失败: ${pfA.errors!.join(';')}`)
  const pfB = await emitAck<{ errors?: string[] }>(b.socket, 'placeFleet', { planes: fleets.b })
  if ((pfB.errors ?? []).length > 0) throw new Error(`B 摆阵失败: ${pfB.errors!.join(';')}`)
  // 双方就绪后（或入房广播）的 2 人 roomUpdate，确定各自下标
  const ruAP = a.waitFor<RoomUpdate>('roomUpdate', (r) => r.players.length === 2)
  const ruBP = b.waitFor<RoomUpdate>('roomUpdate', (r) => r.players.length === 2)
  const ruA = await ruAP
  const ruB = await ruBP
  return { code: createRes.roomCode, youA: ruA.you, youB: ruB.you }
}

/** 双方就绪 → 对局开始（phaseChange playing） */
async function readyBoth(a: TestClient, b: TestClient): Promise<void> {
  const ruAP = a.waitFor<RoomUpdate>('roomUpdate', (r) => r.players.every((p) => p.ready))
  const rA = await emitAck<{ ok: boolean; error?: string }>(a.socket, 'ready')
  expect(rA.ok).toBe(true)
  const rB = await emitAck<{ ok: boolean; error?: string }>(b.socket, 'ready')
  expect(rB.ok).toBe(true)
  await ruAP
  const ph = await a.waitFor<{ phase: GamePhase }>('phaseChange', (p) => p.phase === 'playing')
  expect(ph.phase).toBe('playing')
}

/** 自动报点驱动：收到本座回合的 turnStart 即报一个未报过的格；返回 kick（处理当前回合） */
function drive(client: TestClient, width: number, height: number, errs: string[]): () => void {
  // 以本座已报过的格初始化（覆盖重连/手动报点后的历史，避免重复报点）
  const shotSet = new Set<string>()
  for (const s of client.history<ShotResultPayload>('shotResult')) {
    if (s.by === 'you') shotSet.add(`${s.coord.r},${s.coord.c}`)
  }
  let lastHandled = ''
  const maybeShoot = (): void => {
    const turns = client.history<{ yourTurn: boolean; turnNo: number; deadline: number }>('turnStart')
    const last = turns[turns.length - 1]
    if (!last || !last.yourTurn) return
    const key = `${last.turnNo}:${last.deadline}`
    if (key === lastHandled) return
    lastHandled = key
    let coord: Cell | null = null
    outer: for (let r = 0; r < height; r++) {
      for (let c = 0; c < width; c++) {
        const k = `${r},${c}`
        if (!shotSet.has(k)) {
          coord = { r, c }
          shotSet.add(k)
          break outer
        }
      }
    }
    if (!coord) return
    client.socket.emit('shoot', { coord }, (res: { ok: boolean; error?: string }) => {
      if (!res.ok) errs.push(`驱动报点被拒(${coord.r},${coord.c}): ${res.error}`)
    })
  }
  client.socket.on('turnStart', maybeShoot)
  return maybeShoot
}

/** 双方机队都不占用的格（保证 miss，对局不会提前结束） */
function findEmptyCell(
  fleet0: PlacedPlane[],
  fleet1: PlacedPlane[],
  shape: GridConfig['shape'],
  width: number,
  height: number,
): Cell {
  const occ = new Set<string>()
  for (const f of [fleet0, fleet1]) {
    for (const p of f) {
      for (const c of occupiedCells(p, shape)) occ.add(`${c.r},${c.c}`)
    }
  }
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      if (!occ.has(`${r},${c}`)) return { r, c }
    }
  }
  throw new Error('棋盘没有空格（不应发生）')
}

/* ---------------------------------------------------------------- 测试 */

describe('联机全流程（真实服务器 × 双客户端）', () => {
  let server: ServerHandle
  let core: GameCoreApi

  beforeAll(async () => {
    const resolved = resolveGameCore()
    core = resolved.core
    server = await startServer({ port: 0, dataDir: ':memory:', roomManagerOptions: { core } })
    // eslint-disable-next-line no-console
    console.log(`[integration] game-core 实现：${resolved.used}`)
  })
  afterAll(async () => {
    await server.close()
  })

  it('auth→建房→入房→摆阵→就绪→轮番报点至终局：shotResult 序列、gameEnd 双方真实阵型、落盘与战绩', async () => {
    const a = new TestClient(server.url)
    const b = new TestClient(server.url)
    try {
      const idA = await authClient(a)
      const idB = await authClient(b)
      expect(idA.name).toMatch(/^游客\d{5}$/)
      expect(idA.name).not.toBe(idB.name)

      const config = PRESETS.large // 20×20×7
      const fleetA = core.generateFleet(config.width, config.height, config.planeCount, config.shape, 'normal', core.mulberry32(123))
      const fleetB = core.generateFleet(config.width, config.height, config.planeCount, config.shape, 'normal', core.mulberry32(456))
      const { code, youA } = await setupRoom(a, b, config, { a: fleetA, b: fleetB })
      expect(code).toMatch(/^[A-Z0-9]{6}$/)
      void youA

      // 先挂驱动再就绪，确保初始 turnStart 不丢
      const errs: string[] = []
      const stopA = drive(a, config.width, config.height, errs)
      const stopB = drive(b, config.width, config.height, errs)
      await readyBoth(a, b)

      // 初始回合信息（先手唯一）
      const tsA = a.history<{ yourTurn: boolean; turnNo: number; chancesLeft: number }>('turnStart')[0] as
        | { yourTurn: boolean; turnNo: number; chancesLeft: number }
        | undefined
      const tsB = b.history<{ yourTurn: boolean; turnNo: number; chancesLeft: number }>('turnStart')[0] as
        | { yourTurn: boolean; turnNo: number; chancesLeft: number }
        | undefined
      expect(tsA).toBeDefined()
      expect(tsA!.turnNo).toBe(1)
      expect(tsA!.chancesLeft).toBe(3)
      expect(tsA!.yourTurn).not.toBe(tsB!.yourTurn)

      // 打到终局
      const endAP = a.waitFor<GameEndPayload>('gameEnd', undefined, 30_000)
      const endBP = b.waitFor<GameEndPayload>('gameEnd', undefined, 30_000)
      const [endA, endB] = await Promise.all([endAP, endBP])
      stopA()
      stopB()
      expect(errs).toEqual([])

      // 双方终局载荷一致：胜者、原因、双方真实阵型、统计
      expect(endA.winner).toBe(endB.winner)
      expect(endA.reason).toBe(endB.reason)
      expect(['all-destroyed', 'counterattack']).toContain(endA.reason)
      expect(endA.layouts.player0).toEqual(fleetA)
      expect(endA.layouts.player1).toEqual(fleetB)
      expect(endB.layouts.player0).toEqual(fleetA)
      expect(endB.layouts.player1).toEqual(fleetB)
      expect(endA.stats.killCount).toBeGreaterThanOrEqual(config.planeCount)
      expect(endA.stats.hitCount).toBeGreaterThanOrEqual(endA.stats.killCount)
      expect(endA.stats.shotsFired).toBe(endA.stats.turnCount)
      expect(endA.stats.shotsFired).toBeGreaterThan(0)

      // shotResult 序列：每次报点双方各收到一条（by you/opponent），序列互补且一致
      const shotsA = a.history<ShotResultPayload>('shotResult')
      const shotsB = b.history<ShotResultPayload>('shotResult')
      expect(shotsA.length).toBe(shotsB.length)
      expect(shotsA.length).toBe(endA.stats.shotsFired)
      const strip = (s: ShotResultPayload): { coord: Cell; outcome: ShotResultPayload['outcome'] } => ({
        coord: s.coord,
        outcome: s.outcome,
      })
      expect(shotsA.filter((s) => s.by === 'you').map(strip)).toEqual(
        shotsB.filter((s) => s.by === 'opponent').map(strip),
      )
      expect(shotsB.filter((s) => s.by === 'you').map(strip)).toEqual(
        shotsA.filter((s) => s.by === 'opponent').map(strip),
      )

      // 本座报点不重复
      const fired = new Set<string>()
      for (const s of shotsA.filter((s) => s.by === 'you')) {
        const k = `${s.coord.r},${s.coord.c}`
        expect(fired.has(k)).toBe(false)
        fired.add(k)
      }

      // 落盘：games 行 + 战绩
      const games = server.store.allGames()
      expect(games).toHaveLength(1)
      const game = games[0] as NonNullable<(typeof games)[0]>
      expect(game.room_code).toBe(code)
      expect(game.result).toBe(String(endA.winner))
      const moves = JSON.parse(game.moves_json as string) as unknown[]
      expect(moves.length).toBe(endA.stats.shotsFired)
      const users = server.store.allUsers()
      const winnerIsA = endA.winner === youA
      const winnerUser = users.find((u) => u.id === Number(winnerIsA ? idA.id : idB.id))
      const loserUser = users.find((u) => u.id === Number(winnerIsA ? idB.id : idA.id))
      expect(winnerUser?.wins).toBe(1)
      expect(loserUser?.losses).toBe(1)
      expect(winnerUser?.games).toBe(1)
      expect(loserUser?.games).toBe(1)
    } finally {
      a.dispose()
      b.dispose()
    }
  })

  it('重复报点被拒、非当前轮次报点被拒、投降判负（残骸/阵型保密到终局）', async () => {
    const a = new TestClient(server.url)
    const b = new TestClient(server.url)
    try {
      await authClient(a)
      await authClient(b)
      const config = PRESETS.small // 10×10×3
      const fleetA = core.generateFleet(config.width, config.height, config.planeCount, config.shape, 'normal', core.mulberry32(7))
      const fleetB = core.generateFleet(config.width, config.height, config.planeCount, config.shape, 'normal', core.mulberry32(8))
      const { youA, youB } = await setupRoom(a, b, config, { a: fleetA, b: fleetB })
      await readyBoth(a, b)

      // 先手判定
      const tsA = await a.waitFor<{ yourTurn: boolean }>('turnStart')
      const tsB = await b.waitFor<{ yourTurn: boolean }>('turnStart')
      const first = tsA.yourTurn ? a : b
      const second = tsA.yourTurn ? b : a
      const firstYou = tsA.yourTurn ? youA : youB

      // 选一个双方都不占用的格（保证 miss）
      const empty = findEmptyCell(fleetA, fleetB, config.shape, config.width, config.height)

      // 先手报空格 → ok
      const shoot1 = await emitAck<{ ok: boolean; error?: string }>(first.socket, 'shoot', { coord: empty })
      expect(shoot1.ok).toBe(true)

      // 先手立刻再报（非当前轮次）→ 拒绝
      const outOfTurn = await emitAck<{ ok: boolean; error?: string }>(first.socket, 'shoot', {
        coord: { r: (empty.r + 1) % config.height, c: (empty.c + 1) % config.width },
      })
      expect(outOfTurn.ok).toBe(false)
      expect(outOfTurn.error).toContain('未轮到')

      // 后手等到自己的回合 → 报空格
      await second.waitFor<{ yourTurn: boolean }>('turnStart', (p) => p.yourTurn)
      const shoot2 = await emitAck<{ ok: boolean; error?: string }>(second.socket, 'shoot', {
        coord: { r: (empty.r + 2) % config.height, c: (empty.c + 2) % config.width },
      })
      expect(shoot2.ok).toBe(true)

      // 先手下一回合重复报同一格 → already-shot
      await first.waitFor<{ yourTurn: boolean }>('turnStart', (p) => p.yourTurn)
      const dup = await emitAck<{ ok: boolean; error?: string }>(first.socket, 'shoot', { coord: empty })
      expect(dup.ok).toBe(false)
      expect(dup.error).toBe('already-shot')

      // 后手投降 → 先手胜（reason resign）
      const endAP = a.waitFor<GameEndPayload>('gameEnd', undefined, 10_000)
      const endBP = b.waitFor<GameEndPayload>('gameEnd', undefined, 10_000)
      second.socket.emit('resign')
      const [endA, endB] = await Promise.all([endAP, endBP])
      expect(endA.reason).toBe('resign')
      expect(endA.winner).toBe(firstYou)
      expect(endB.reason).toBe('resign')
      expect(endB.winner).toBe(firstYou)
      expect(endA.layouts.player0).toEqual(fleetA)
      expect(endA.layouts.player1).toEqual(fleetB)
    } finally {
      a.dispose()
      b.dispose()
    }
  })
})

describe('断线重连与超时判负（reconnectGraceMs=400ms）', () => {
  let server: ServerHandle
  let core: GameCoreApi

  beforeAll(async () => {
    const resolved = resolveGameCore()
    core = resolved.core
    server = await startServer({
      port: 0,
      dataDir: ':memory:',
      roomManagerOptions: { core, reconnectGraceMs: 400 },
    })
  })
  afterAll(async () => {
    await server.close()
  })

  it(
    '断线后凭 token+gameId 重连恢复：回放历史、恢复读秒、对手收到 opponentReconnected',
    { timeout: 20_000 },
    async () => {
      const a = new TestClient(server.url)
      const b = new TestClient(server.url)
      let b2: TestClient | null = null
      try {
        const idA = await authClient(a)
      const idB = await authClient(b)
      const config = PRESETS.small
      const fleetA = core.generateFleet(config.width, config.height, config.planeCount, config.shape, 'normal', core.mulberry32(21))
      const fleetB = core.generateFleet(config.width, config.height, config.planeCount, config.shape, 'normal', core.mulberry32(22))
      const { code, youA, youB } = await setupRoom(a, b, config, { a: fleetA, b: fleetB })
      await readyBoth(a, b)

      const tsA = await a.waitFor<{ yourTurn: boolean }>('turnStart')
      const tsB = await b.waitFor<{ yourTurn: boolean }>('turnStart')
      const firstIsA = tsA.yourTurn

      // 若先手是 A：A 走一步（空格，保证 miss），把回合推进到 B
      if (firstIsA) {
        const empty = findEmptyCell(fleetA, fleetB, config.shape, config.width, config.height)
        const r = await emitAck<{ ok: boolean; error?: string }>(a.socket, 'shoot', { coord: empty })
        expect(r.ok).toBe(true)
      }
      // 若先手是 B：B 正处于自己回合（随后断线会被冻结）

      // B 断线
      const discP = a.waitFor<{ reconnectGraceMs: number }>('opponentDisconnected')
      b.dispose()
      const disc = await discP
      expect(disc.reconnectGraceMs).toBe(400)

      // B 重连（新 socket，凭 token+gameId）
      b2 = new TestClient(server.url)
      const rec = await emitAck<{ ok: boolean; error?: string }>(b2.socket, 'reconnect', {
        token: idB.token,
        gameId: code,
      })
      expect(rec.ok).toBe(true)

      // A 收到 opponentReconnected；B2 收到完整回放（roomUpdate + shotResult + turnStart）
      await a.waitFor<void>('opponentReconnected')
      const ru = await b2.waitFor<RoomUpdate>('roomUpdate', (r) => r.players.length === 2)
      expect(ru.you).toBe(youB)
      // 断线前 A 可能打过一发（先手 A 时）：回放应包含该 shotResult
      expect(b2.history<ShotResultPayload>('shotResult').length).toBe(firstIsA ? 1 : 0)

      // 现在是 B2 的回合：kick 驱动 + 双驱动打到终局
      const errs: string[] = []
      const stopA = drive(a, config.width, config.height, errs)
      const kickB = drive(b2, config.width, config.height, errs)
      kickB()
      const endAP = a.waitFor<GameEndPayload>('gameEnd', undefined, 30_000)
      const endBP = b2.waitFor<GameEndPayload>('gameEnd', undefined, 30_000)
      const [endA, endB] = await Promise.all([endAP, endBP])
      stopA()
      expect(errs).toEqual([])
      expect(endA.winner).toBe(endB.winner)
      expect(endA.layouts.player0).toEqual(fleetA)
      expect(endA.layouts.player1).toEqual(fleetB)
      expect(endB.layouts.player0).toEqual(fleetA)
      // 重连后 B 确实继续对局（B2 侧有本座报点记录）
      const b2YouShots = b2.history<ShotResultPayload>('shotResult').filter((s) => s.by === 'you')
      expect(b2YouShots.length).toBeGreaterThan(0)
      void youA
    } finally {
      a.dispose()
      b.dispose()
      b2?.dispose()
    }
  })

  it('断线超时（宽限期 400ms）判负 gameEnd(disconnect)', async () => {
    const a = new TestClient(server.url)
    const b = new TestClient(server.url)
    try {
      await authClient(a)
      await authClient(b)
      const config = PRESETS.small
      const fleetA = core.generateFleet(config.width, config.height, config.planeCount, config.shape, 'normal', core.mulberry32(31))
      const fleetB = core.generateFleet(config.width, config.height, config.planeCount, config.shape, 'normal', core.mulberry32(32))
      const { youB } = await setupRoom(a, b, config, { a: fleetA, b: fleetB })
      await readyBoth(a, b)

      const endBP = b.waitFor<GameEndPayload>('gameEnd', undefined, 5_000)
      a.dispose() // A 断线且不重连
      const endB = await endBP
      expect(endB.reason).toBe('disconnect')
      expect(endB.winner).toBe(youB)
      expect(endB.layouts.player0).toEqual(fleetA)
      expect(endB.layouts.player1).toEqual(fleetB)
    } finally {
      a.dispose()
      b.dispose()
    }
  })
})

describe('围棋读秒 → 机器接管（快速计时）', () => {
  let server: ServerHandle
  let core: GameCoreApi

  beforeAll(async () => {
    const resolved = resolveGameCore()
    core = resolved.core
    server = await startServer({
      port: 0,
      dataDir: ':memory:',
      roomManagerOptions: {
        core,
        timings: { turnLimitMs: 60, overtimeChances: 1, reducedTurnLimitMs: 40 },
        machineDelay: { min: 15, max: 30 },
      },
    })
  })
  afterAll(async () => {
    await server.close()
  })

  it('超时消耗机会 → 机会耗尽降档 → 首次降档超时机器接管 → 对局继续至终局', async () => {
    const a = new TestClient(server.url) // 被接管方：永不报点
    const b = new TestClient(server.url) // 正常报点
    try {
      await authClient(a)
      await authClient(b)
      const config = PRESETS.small
      const fleetA = core.generateFleet(config.width, config.height, config.planeCount, config.shape, 'normal', core.mulberry32(41))
      const fleetB = core.generateFleet(config.width, config.height, config.planeCount, config.shape, 'normal', core.mulberry32(42))
      const { youA, youB } = await setupRoom(a, b, config, { a: fleetA, b: fleetB })
      await readyBoth(a, b)

      // B 驱动报点；A 不报点
      const errs: string[] = []
      const stopB = drive(b, config.width, config.height, errs)

      // 双方都收到 machineTakeover（player = A 的下标）
      const takeAP = a.waitFor<{ player: 0 | 1 }>('machineTakeover', undefined, 15_000)
      const takeBP = b.waitFor<{ player: 0 | 1 }>('machineTakeover', undefined, 15_000)
      const [takeA, takeB] = await Promise.all([takeAP, takeBP])
      expect(takeA.player).toBe(youA)
      expect(takeB.player).toBe(youA)

      // A 的计时器轨迹：机会被消耗（chancesLeft 出现过 1→0）
      const timerUpdates = a.history<{ player: 0 | 1; remainingMs: number; chancesLeft: number }>('timerUpdate')
      const chances = timerUpdates.filter((t) => t.player === youA).map((t) => t.chancesLeft)
      expect(chances).toContain(1)
      expect(chances).toContain(0)

      // 接管后机器代打，对局继续直至终局
      const endAP = a.waitFor<GameEndPayload>('gameEnd', undefined, 30_000)
      const endBP = b.waitFor<GameEndPayload>('gameEnd', undefined, 30_000)
      const [endA, endB] = await Promise.all([endAP, endBP])
      stopB()
      expect(errs).toEqual([])
      expect(endA.winner).toBe(endB.winner)
      expect(endA.layouts.player0).toEqual(fleetA)
      expect(endA.layouts.player1).toEqual(fleetB)
      // 机器确实为 A 代打过：A 侧存在本座报点（by:'you'）
      const aShots = a.history<ShotResultPayload>('shotResult')
      expect(aShots.some((s) => s.by === 'you')).toBe(true)
      // 若 B 获胜（败方是被接管的 A）→ reason 应为 timeout-takeover
      if (endA.winner === youB) expect(endA.reason).toBe('timeout-takeover')
    } finally {
      a.dispose()
      b.dispose()
    }
  })
})

describe('公网匹配（matchmakingTimeoutMs=400ms）', () => {
  let server: ServerHandle
  let core: GameCoreApi

  beforeAll(async () => {
    const resolved = resolveGameCore()
    core = resolved.core
    server = await startServer({
      port: 0,
      dataDir: ':memory:',
      roomManagerOptions: { core, matchmakingTimeoutMs: 400 },
    })
  })
  afterAll(async () => {
    await server.close()
  })

  it('同配置入队自动配对成房，配对后正常对局', async () => {
    const a = new TestClient(server.url)
    const b = new TestClient(server.url)
    try {
      await authClient(a)
      await authClient(b)
      const config = PRESETS.small

      // A 先入队 → queued
      const queuedAP = a.waitFor<{ status: 'queued' | 'matched' | 'timeout' }>('matchmakingStatus')
      const creA = await emitAck<{ roomCode?: string }>(a.socket, 'createRoom', { config, match: true })
      expect(creA.roomCode).toBeUndefined()
      expect((await queuedAP).status).toBe('queued')

      // B 入队 → 立即配对：双方 matched + 同一房码
      const statusBP = b.waitFor<{ status: 'queued' | 'matched' | 'timeout' }>('matchmakingStatus')
      const matchedAP = a.waitFor<{ status: 'queued' | 'matched' | 'timeout' }>(
        'matchmakingStatus',
        (s) => s.status === 'matched',
      )
      const creB = await emitAck<{ roomCode?: string }>(b.socket, 'createRoom', { config, match: true })
      expect(creB.roomCode).toBeUndefined()
      expect((await statusBP).status).toBe('matched')
      expect((await matchedAP).status).toBe('matched')

      const ruA = await a.waitFor<RoomUpdate>('roomUpdate', (r) => r.players.length === 2)
      const ruB = await b.waitFor<RoomUpdate>('roomUpdate', (r) => r.players.length === 2)
      expect(ruA.code).toBe(ruB.code)
      expect(ruA.code).toMatch(/^[A-Z0-9]{6}$/)

      // 配对成功后正常对局（摆阵→就绪→投降快速收尾）
      const fleetA = core.generateFleet(config.width, config.height, config.planeCount, config.shape, 'normal', core.mulberry32(51))
      const fleetB = core.generateFleet(config.width, config.height, config.planeCount, config.shape, 'normal', core.mulberry32(52))
      const pfA = await emitAck<{ errors?: string[] }>(a.socket, 'placeFleet', { planes: fleetA })
      const pfB = await emitAck<{ errors?: string[] }>(b.socket, 'placeFleet', { planes: fleetB })
      expect(pfA.errors ?? []).toEqual([])
      expect(pfB.errors ?? []).toEqual([])
      const rA = await emitAck<{ ok: boolean; error?: string }>(a.socket, 'ready')
      const rB = await emitAck<{ ok: boolean; error?: string }>(b.socket, 'ready')
      expect(rA.ok).toBe(true)
      expect(rB.ok).toBe(true)
      await a.waitFor<{ phase: GamePhase }>('phaseChange', (p) => p.phase === 'playing')
      const endAP = a.waitFor<GameEndPayload>('gameEnd', undefined, 10_000)
      const endBP = b.waitFor<GameEndPayload>('gameEnd', undefined, 10_000)
      a.socket.emit('resign')
      const [endA, endB] = await Promise.all([endAP, endBP])
      expect(endA.reason).toBe('resign')
      expect(endB.reason).toBe('resign')
      expect(endA.winner).toBe(ruB.you) // A 投降 → B 胜
      expect(endA.layouts.player0).toEqual(fleetA)
      expect(endA.layouts.player1).toEqual(fleetB)
    } finally {
      a.dispose()
      b.dispose()
    }
  })

  it('自定义配置不进匹配池', async () => {
    const c = new TestClient(server.url)
    try {
      await authClient(c)
      const custom: GridConfig = { width: 12, height: 12, planeCount: 3, shape: DEFAULT_PLANE_SHAPE }
      const res = await emitAck<{ roomCode?: string; error?: string }>(c.socket, 'createRoom', {
        config: custom,
        match: true,
      })
      expect(res.roomCode).toBeUndefined()
      expect(res.error).toContain('自定义配置')
    } finally {
      c.dispose()
    }
  })

  it('30s（测试 400ms）未匹配 → matchmakingStatus timeout', async () => {
    const c = new TestClient(server.url)
    try {
      await authClient(c)
      const t = c.waitFor<{ status: 'queued' | 'matched' | 'timeout' }>(
        'matchmakingStatus',
        (s) => s.status === 'timeout',
        3_000,
      )
      const res = await emitAck<{ roomCode?: string }>(c.socket, 'createRoom', { config: PRESETS.medium, match: true })
      expect(res.roomCode).toBeUndefined()
      expect((await t).status).toBe('timeout')
    } finally {
      c.dispose()
    }
  })
})
