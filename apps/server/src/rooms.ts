/**
 * @aero/server —— 房间注册表与对局状态机（服务端权威）。
 *
 * 状态机：waiting（1 人，等对手）→ placing（双方就绪/摆阵）→ playing（回合制）
 *        → ended。waiting 在对外协议中映射为 shared 的 'placing'（客户端以
 *        players.length 区分：1 人 = 等待对手）。
 *
 * 关键纪律：
 * - 阵型只存服务端；客户端只发报点、只收裁决（shotResult 仅含 by/coord/outcome，
 *   绝不泄露被击毁飞机的残骸格位）。
 * - 所有裁决（轮次/坐标合法性、胜负、绝地反击）都由 game-core applyShot 判定。
 * - 断线 60s 内凭 token+gameId 重连恢复；超时判负 gameEnd('disconnect')；
 *   摆阵阶段断线 60s 房间解散。
 * - 围棋读秒：超时消耗全局机会并重置本回合继续由本人走；机会耗尽降档 10s；
 *   此后首次超时机器永久接管（normal 难度 AI 代打）。
 */
import { randomInt } from 'node:crypto'
import type { Server, Socket } from 'socket.io'
import { z } from 'zod'
import {
  cellSchema,
  DEFAULT_PLANE_SHAPE,
  gridConfigSchema,
  MACHINE_TAKEOVER_DIFFICULTY,
  placedPlaneSchema,
  PRESETS,
  RECONNECT_GRACE_MS,
  ROOM_CODE_LENGTH,
  TURN_LIMIT_MS,
  UNLIMITED_TURN_LIMIT_MS,
  type Cell,
  type ClientToServerEvents,
  type GameEndPayload,
  type GamePhase,
  type GridConfig,
  type PlacedPlane,
  type RoomSummary,
  type RoomUpdate,
  type ServerToClientEvents,
  type ShotOutcome,
} from '@aero/shared'
import type { GameState } from '@aero/game-core'
import {
  createTimingState,
  DEFAULT_TIMING_CONFIG,
  handleTimeout,
  remainingMs,
  resume,
  startTurn,
  type TimingConfig,
  type TimingState,
} from './timing'
import { realGameCore, type GameCoreApi, type Rng } from './gameCore'
import type { Store } from './db'

export interface SocketData {
  userId?: string
  userName?: string
}

export type ServerIO = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>
export type ClientSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>

type RoomPhase = 'waiting' | 'placing' | 'playing' | 'counterattack' | 'ended'

/* ---------------------------------------------------------------- v0.3.0 常量（shared / game-core 已落地契约） */

/** 超快棋时钟推进间隔（~250ms） */
const BLITZ_TICK_MS = 250
/** 超快棋初始时限默认值：每架飞机 10s（core createGame 内建同值；服务器可按基准覆写以便测试注入） */
const BLITZ_DEFAULT_BASE_MS_PER_PLANE = 10_000

/** 快速匹配（match:quick）支持的档位网格边长 → 该网格下合法的飞机数上限 */
const QUICK_GRID_SIZES = [10, 15, 20] as const

/** match:quick 中一个待配条目（等待池） */
interface QuickEntry {
  socketId: string
  userId: string
  name: string
  /** 勾选的档位组合键集合（combo 指纹） */
  keys: Set<string>
}

interface Seat {
  index: 0 | 1
  userId: string
  name: string
  socketId: string | null
  connected: boolean
  ready: boolean
  fleet: PlacedPlane[] | null
  timing: TimingState
  rng: Rng
  machine: boolean
  machineTimer: NodeJS.Timeout | null
  disconnectTimer: NodeJS.Timeout | null
  /** 断线时冻结的本回合剩余毫秒（重连恢复读秒用） */
  frozenRemainingMs: number | null
}

interface ShotLogEntry {
  by: 0 | 1
  coord: Cell
  outcome: ShotOutcome
}

interface Room {
  code: string
  config: GridConfig
  /** 本房间每步限时（ms；UNLIMITED_TURN_LIMIT_MS=0 表示不限时），来自 config.turnLimitMs ?? TURN_LIMIT_MS */
  turnLimitMs: number
  seats: [Seat, Seat]
  phase: RoomPhase
  game: GameState | null
  turnTimer: NodeJS.Timeout | null
  turnDeadline: number | null
  shotLog: ShotLogEntry[]
  takeovers: Array<0 | 1>
  wasCounterattack: boolean
  fromMatch: boolean
  gameStartedAt: number | null
  gameEndedAt: number | null
  endPayload: GameEndPayload | null
  /** 终局广播事件种类：'gameEnd'（常规）| 'gameOver'（v0.3.0 blitz 时钟判负），重连回放按此选择 */
  endKind: 'gameEnd' | 'gameOver'
  destroyTimer: NodeJS.Timeout | null
  blitzTimer: NodeJS.Timeout | null
  /** 上次时钟推进时间戳（ms） */
  blitzLastAt: number
  /** 上次向双方广播的整秒值（广播节流用）；blitz 房间才有意义 */
  blitzSecShown: [number, number]
}

interface MatchEntry {
  socketId: string
  userId: string
  name: string
  key: string
  timer: NodeJS.Timeout | null
}

export interface RoomManagerOptions {
  core?: GameCoreApi
  timings?: Partial<TimingConfig>
  reconnectGraceMs?: number
  matchmakingTimeoutMs?: number
  machineDelay?: { min: number; max: number }
  store?: Store
  /** 超快棋初始每架时限（ms），默认 10_000；测试可注入小值加速判负 */
  blitzBaseMsPerPlane?: number
}

const ROOM_CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

export class RoomManager {
  private readonly io: ServerIO
  private readonly core: GameCoreApi
  private readonly timings: TimingConfig
  private readonly reconnectGraceMs: number
  private readonly matchmakingTimeoutMs: number
  private readonly machineDelay: { min: number; max: number }
  private readonly blitzBaseMsPerPlane: number
  private readonly store?: Store
  private readonly rooms = new Map<string, Room>()
  private readonly matchQueue = new Map<string, MatchEntry[]>()
  /** v0.3.0 快速匹配等待池（match:quick） */
  private readonly quickPool: QuickEntry[] = []

  constructor(io: ServerIO, options: RoomManagerOptions = {}) {
    this.io = io
    this.core = options.core ?? realGameCore
    this.timings = { ...DEFAULT_TIMING_CONFIG, ...options.timings }
    this.reconnectGraceMs = options.reconnectGraceMs ?? RECONNECT_GRACE_MS
    this.matchmakingTimeoutMs = options.matchmakingTimeoutMs ?? 30_000
    this.machineDelay = options.machineDelay ?? { min: 500, max: 1200 }
    this.blitzBaseMsPerPlane = options.blitzBaseMsPerPlane ?? BLITZ_DEFAULT_BASE_MS_PER_PLANE
    this.store = options.store
  }

  /* ---------------------------------------------------------------- 工具 */

  private emitToSeat(seat: Seat, event: string, payload?: unknown): void {
    if (!seat.socketId) return
    const socket = this.io.sockets.sockets.get(seat.socketId)
    if (!socket) return
    if (payload === undefined) {
      socket.emit(event as keyof ServerToClientEvents)
    } else {
      ;(socket.emit as (ev: string, ...args: unknown[]) => void)(event, payload)
    }
  }

  private emitToSocket(socketId: string, event: string, payload?: unknown): void {
    const socket = this.io.sockets.sockets.get(socketId)
    if (!socket) return
    if (payload === undefined) {
      socket.emit(event as keyof ServerToClientEvents)
    } else {
      ;(socket.emit as (ev: string, ...args: unknown[]) => void)(event, payload)
    }
  }

  private broadcast(room: Room, event: string, payload: unknown): void {
    for (const seat of room.seats) this.emitToSeat(seat, event, payload)
  }

  /** 用户当前所在的活跃房间 */
  private roomOfUser(userId: string): Room | undefined {
    for (const room of this.rooms.values()) {
      if (room.phase === 'ended') continue
      if (room.seats.some((s) => s.userId === userId)) return room
    }
    return undefined
  }

  private seatOfUser(room: Room, userId: string): Seat {
    const seat = room.seats.find((s) => s.userId === userId)
    if (!seat) throw new Error('用户不在该房间内（内部错误）')
    return seat
  }

  private findRoomBySocket(socketId: string): { room: Room; seat: Seat } | null {
    for (const room of this.rooms.values()) {
      for (const seat of room.seats) {
        if (seat.socketId === socketId) return { room, seat }
      }
    }
    return null
  }

  private uniqueCode(): string {
    for (;;) {
      let code = ''
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
        code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)]
      }
      if (!this.rooms.has(code)) return code
    }
  }

  private newSeat(index: 0 | 1): Seat {
    return {
      index,
      userId: '',
      name: '',
      socketId: null,
      connected: false,
      ready: false,
      fleet: null,
      timing: createTimingState(this.timings),
      rng: this.core.mulberry32(randomInt(0, 2 ** 31)),
      machine: false,
      machineTimer: null,
      disconnectTimer: null,
      frozenRemainingMs: null,
    }
  }

  private mapPhase(room: Room): GamePhase {
    if (room.phase === 'waiting') return 'placing'
    return room.phase
  }

  private roomSummary(room: Room): RoomSummary {
    return {
      code: room.code,
      config: room.config,
      players: room.seats.map((s) => ({
        index: s.index,
        name: s.name,
        ready: s.ready,
        connected: s.connected,
      })),
      phase: this.mapPhase(room),
    }
  }

  /** 向双方推送 RoomUpdate（含各自 you 下标） */
  private broadcastRoomUpdate(room: Room): void {
    for (const seat of room.seats) {
      this.emitToSeat(seat, 'roomUpdate', {
        ...this.roomSummary(room),
        you: seat.index,
      } satisfies RoomUpdate)
    }
  }

  /** 通知房间内剩余 socket「房间已解散」（协议无专属事件，约定 players=[] 表示房间关闭） */
  private notifyRoomClosed(room: Room): void {
    const closed: RoomUpdate = { code: room.code, config: room.config, players: [], phase: 'placing', you: 0 }
    for (const seat of room.seats) this.emitToSeat(seat, 'roomUpdate', closed)
  }

  private clearRoomTimers(room: Room): void {
    if (room.turnTimer) {
      clearTimeout(room.turnTimer)
      room.turnTimer = null
    }
    if (room.destroyTimer) {
      clearTimeout(room.destroyTimer)
      room.destroyTimer = null
    }
    if (room.blitzTimer) {
      clearInterval(room.blitzTimer)
      room.blitzTimer = null
    }
    for (const seat of room.seats) {
      if (seat.machineTimer) {
        clearTimeout(seat.machineTimer)
        seat.machineTimer = null
      }
      if (seat.disconnectTimer) {
        clearTimeout(seat.disconnectTimer)
        seat.disconnectTimer = null
      }
    }
  }

  /* ---------------------------------------------------------------- 房间操作 */

  /** 房间是否超快棋（blitz）：config.blitz === true */
  private isBlitz(room: Room): boolean {
    return room.config.blitz === true
  }

  /** 房间是否盲棋（blind）：config.blind === true */
  private isBlind(room: Room): boolean {
    return room.config.blind === true
  }

  /** 建空房间；createRoom / 匹配配对 / match:quick 共用 */
  private buildRoom(code: string, config: GridConfig, fromMatch: boolean): Room {
    return {
      code,
      config,
      turnLimitMs: config.turnLimitMs ?? TURN_LIMIT_MS,
      seats: [this.newSeat(0), this.newSeat(1)],
      phase: 'waiting',
      game: null,
      turnTimer: null,
      turnDeadline: null,
      shotLog: [],
      takeovers: [],
      wasCounterattack: false,
      fromMatch,
      gameStartedAt: null,
      gameEndedAt: null,
      endPayload: null,
      endKind: 'gameEnd',
      destroyTimer: null,
      blitzTimer: null,
      blitzLastAt: 0,
      blitzSecShown: [0, 0],
    }
  }

  /**
   * 兜底释放残留房间（客户端异常退出导致用户仍挂在 waiting/placing 阶段的房间）。
   * 清理计时器、通知房间内另一玩家解散（roomUpdate players=[]）、从 rooms 删除。
   * 对局中（playing/counterattack）不释放，返回 false。
   */
  private releaseStaleRoomOf(userId: string): boolean {
    const room = this.roomOfUser(userId)
    if (!room) return false
    if (room.phase === 'playing' || room.phase === 'counterattack') return false
    this.clearRoomTimers(room)
    this.notifyRoomClosed(room)
    this.rooms.delete(room.code)
    return true
  }

  createRoom(
    userId: string,
    name: string,
    socketId: string,
    config: GridConfig,
  ): { ok: true; code: string } | { ok: false; error: string } {
    // shared gridConfigSchema 已含 blitz/blind 布尔开关，字段类型非法即拒绝
    const parsed = gridConfigSchema.safeParse(config)
    if (!parsed.success) return { ok: false, error: '棋盘配置非法' }
    // 兜底：若用户残留一个 waiting/placing 阶段的房间，先自动释放再建房；
    // 对局中（playing/counterattack）仍拒绝
    if (!this.releaseStaleRoomOf(userId)) {
      if (this.roomOfUser(userId)) return { ok: false, error: '您已在其他对局中，请先退出' }
    }
    const code = this.uniqueCode()
    const room = this.buildRoom(code, parsed.data, false)
    this.rooms.set(code, room)
    this.occupySeat(room, 0, userId, name, socketId)
    this.emitToSeat(room.seats[0], 'roomUpdate', { ...this.roomSummary(room), you: 0 } satisfies RoomUpdate)
    return { ok: true, code }
  }

  joinRoom(
    userId: string,
    name: string,
    socketId: string,
    code: string,
  ): { ok: true } | { ok: false; error: string } {
    const room = this.rooms.get(code)
    if (!room) return { ok: false, error: '房间不存在' }
    if (room.phase === 'ended') return { ok: false, error: '对局已结束' }
    if (room.phase === 'playing') return { ok: false, error: '对局已开始' }
    // 兜底：若用户残留 waiting/placing 阶段的房间，先自动释放再入房；
    // 对局中仍拒绝；重复 join 自己所在的房间直接报错
    const stale = this.roomOfUser(userId)
    if (stale) {
      if (stale === room) return { ok: false, error: '您已在该房间中' }
      if (stale.phase === 'playing' || stale.phase === 'counterattack') {
        return { ok: false, error: '您已在其他对局中，请先退出' }
      }
      this.clearRoomTimers(stale)
      this.notifyRoomClosed(stale)
      this.rooms.delete(stale.code)
    }
    const freeIndex = room.seats.findIndex((s) => !s.userId)
    if (freeIndex === -1) return { ok: false, error: '房间已满' }
    this.occupySeat(room, freeIndex as 0 | 1, userId, name, socketId)
    if (room.phase === 'waiting' && room.seats[0].userId && room.seats[1].userId) {
      room.phase = 'placing'
    }
    this.broadcastRoomUpdate(room)
    return { ok: true }
  }

  private occupySeat(room: Room, index: 0 | 1, userId: string, name: string, socketId: string): void {
    const seat = room.seats[index]
    seat.userId = userId
    seat.name = name
    seat.socketId = socketId
    seat.connected = true
  }

  /** 供 joinRoom ack 使用：按房码取 RoomSummary（不存在返回 undefined） */
  roomSummaryOfCode(code: string): RoomSummary | undefined {
    const room = this.rooms.get(code)
    return room ? this.roomSummary(room) : undefined
  }

  /** 显式离开：对局中视为投降；摆阵/等待阶段解散房间 */
  leaveRoom(socketId: string): void {
    const found = this.findRoomBySocket(socketId)
    if (!found) return
    const { room, seat } = found
    if (seat.socketId !== socketId) return
    if (room.phase === 'ended') return
    if (room.phase === 'playing' || room.phase === 'counterattack') {
      this.finishGame(room, (1 - seat.index) as 0 | 1, 'resign')
      return
    }
    this.clearRoomTimers(room)
    this.notifyRoomClosed(room)
    this.rooms.delete(room.code)
  }

  placeFleet(userId: string, planes: unknown): { ok: true } | { ok: false; error: string } {
    const room = this.roomOfUser(userId)
    if (!room) return { ok: false, error: '您不在任何房间中' }
    if (room.phase !== 'waiting' && room.phase !== 'placing') return { ok: false, error: '当前阶段不能摆阵' }
    const parsed = z.array(placedPlaneSchema).safeParse(planes)
    if (!parsed.success) return { ok: false, error: '阵型数据非法' }
    const { width, height, planeCount, shape } = room.config
    const res = this.core.validateFleet(width, height, planeCount, shape, parsed.data)
    if (!res.ok) return { ok: false, error: res.errors.join('；') }
    const seat = this.seatOfUser(room, userId)
    seat.fleet = parsed.data
    return { ok: true }
  }

  ready(userId: string): { ok: true } | { ok: false; error: string } {
    const room = this.roomOfUser(userId)
    if (!room) return { ok: false, error: '您不在任何房间中' }
    const seat = this.seatOfUser(room, userId)
    if (room.phase === 'playing' || room.phase === 'counterattack') return { ok: false, error: '对局已开始' }
    if (!seat.fleet) return { ok: false, error: '请先完成摆阵' }
    seat.ready = true
    this.broadcastRoomUpdate(room)
    if (room.phase === 'placing' && room.seats.every((s) => s.ready && s.fleet)) {
      this.startGame(room)
    }
    return { ok: true }
  }

  resign(userId: string): void {
    const room = this.roomOfUser(userId)
    if (!room) return
    const seat = this.seatOfUser(room, userId)
    if (room.phase !== 'playing' && room.phase !== 'counterattack') return
    this.finishGame(room, (1 - seat.index) as 0 | 1, 'resign')
  }

  /** 报点（裁决入口）：校验轮次/坐标后交 game-core applyShot，只广播射击结果 */
  shoot(userId: string, coord: unknown): { ok: true } | { ok: false; error: string } {
    const room = this.roomOfUser(userId)
    if (!room) return { ok: false, error: '您不在任何房间中' }
    const seat = this.seatOfUser(room, userId)
    if (room.phase !== 'playing' && room.phase !== 'counterattack') return { ok: false, error: '对局尚未开始' }
    const parsed = cellSchema.safeParse(coord)
    if (!parsed.success) return { ok: false, error: '坐标非法' }
    return this.shootInternal(room, seat.index, parsed.data)
  }

  /** 服务端权威报点：共用路径（人类报点与机器走棋都走这里） */
  private shootInternal(room: Room, player: 0 | 1, coord: Cell): { ok: true } | { ok: false; error: string } {
    const game = room.game
    if (!game || game.phase === 'ended') return { ok: false, error: '对局已结束' }
    if (game.turn !== player) return { ok: false, error: '未轮到该玩家报点' }
    // 盲棋：core applyShot 天然允许重复报点（含残骸格返回 miss），服务端不做任何预检/旁路；
    // 绝地反击阶段的重复报点语义以 core applyShot 结果为准。
    const res = this.core.applyShot(game, coord)
    if (!res.ok) return { ok: false, error: res.error ?? '无效报点' }
    const next = res.state ?? game
    room.game = next
    const outcome = res.outcome ?? 'miss'
    room.shotLog.push({ by: player, coord, outcome })
    // 只广播射击结果（by/coord/outcome）；被击毁飞机的残骸格位绝不公开
    for (const s of room.seats) {
      this.emitToSeat(s, 'shotResult', {
        by: s.index === player ? 'you' : 'opponent',
        coord,
        outcome,
      })
    }
    // 超快棋：core applyShot 已给报点方 +1s（state.blitz.clocks 更新），此处仅同步广播时钟
    if (this.isBlitz(room)) this.broadcastBlitzClock(room, true)
    if (next.winner !== null || next.phase === 'ended') {
      const winner = next.winner !== null ? next.winner : ((1 - player) as 0 | 1)
      this.finishGame(room, winner, this.resolveEndReason(room, next))
      return { ok: true }
    }
    if (next.phase === 'counterattack') {
      room.wasCounterattack = true
      room.phase = 'counterattack'
      this.broadcast(room, 'phaseChange', { phase: 'counterattack' })
      this.startTurnFor(room, next.turn)
      return { ok: true }
    }
    this.startTurnFor(room, next.turn)
    return { ok: true }
  }

  /** 终局原因：绝地反击 > 超时被接管方落败 > 正常全歼 */
  private resolveEndReason(room: Room, game: GameState): GameEndPayload['reason'] {
    if (room.wasCounterattack) return 'counterattack'
    if (game.winner !== null) {
      const loser = (1 - game.winner) as 0 | 1
      if (room.seats[loser].machine) return 'timeout-takeover'
    }
    return 'all-destroyed'
  }

  /* ---------------------------------------------------------------- 对局流程 */

  private startGame(room: Room): void {
    const firstMover = randomInt(2) as 0 | 1
    // v0.3.0：模式开关（blitz/blind）作为 options 交给 core createGame 权威初始化
    let game = this.core.createGame(
      room.config.width,
      room.config.height,
      room.config.shape,
      room.config.planeCount,
      firstMover,
      { blitz: this.isBlitz(room), blind: this.isBlind(room) },
    )
    for (const seat of room.seats) {
      const res = this.core.setFleet(game, seat.index, seat.fleet as PlacedPlane[])
      if (!res.ok) {
        // 摆阵阶段已用 validateFleet 校验，此处不应失败；兜底直接终止
        this.finishGame(room, (1 - seat.index) as 0 | 1, 'disconnect')
        return
      }
      game = res.state ?? game
    }
    // createGame 返回的阶段为 placing，双方就绪后显式进入 playing（applyShot 仅允许 playing/counterattack）
    game = { ...game, phase: 'playing' }
    // 超快棋初始时钟：core 默认 10s×n；服务器可按 blitzBaseMsPerPlane 基准覆写（默认值一致，测试注入小值用）
    if (this.isBlitz(room)) {
      const base = this.blitzBaseMsPerPlane * room.config.planeCount
      game = { ...game, blitz: { clocks: [base, base] } }
    }
    room.game = game
    room.phase = 'playing'
    room.gameStartedAt = Date.now()
    room.turnDeadline = null
    this.broadcast(room, 'phaseChange', { phase: 'playing' })
    this.broadcastRoomUpdate(room)
    if (this.isBlitz(room)) this.startBlitzClock(room)
    this.startTurnFor(room, game.turn)
  }

  /**
   * 为某位玩家开启回合（含计时器/机器走棋调度）。
   * 断线中的座位不启动计时，重连时恢复。
   * blitz 房间忽略 byo-yomi（机会/超时代打/机器接管均不生效），时钟由 blitz tick 单独推进。
   */
  private startTurnFor(room: Room, player: 0 | 1): void {
    const game = room.game
    if (!game || game.phase === 'ended') return
    const seat = room.seats[player]
    if (room.turnTimer) {
      clearTimeout(room.turnTimer)
      room.turnTimer = null
    }
    if (seat.machineTimer) {
      clearTimeout(seat.machineTimer)
      seat.machineTimer = null
    }
    if (this.isBlitz(room)) {
      // 超快棋：不设 byo-yomi deadline/定时器（机会与超时代打不适用）；回合切换只广播状态 + 时钟
      room.turnDeadline = null
      this.emitTurnState(room, player)
      this.broadcastBlitzClock(room, true)
      return
    }
    if (seat.machine) {
      // 机器接管席位：500~1200ms 后自动走棋
      room.turnDeadline = null
      const delay = this.machineDelay.min + Math.random() * (this.machineDelay.max - this.machineDelay.min)
      seat.machineTimer = setTimeout(() => this.machineMove(room, player), delay)
      this.emitTurnState(room, player)
      return
    }
    if (!seat.connected) {
      // 断线中：不启动计时，重连时恢复
      room.turnDeadline = null
      return
    }
    if (room.turnLimitMs === UNLIMITED_TURN_LIMIT_MS) {
      // 不限时房间：不设 deadline、不启动超时定时器、不消耗机会、永不机器接管
      room.turnDeadline = null
      this.emitTurnState(room, player) // turnStart.deadline = 0，客户端据此隐藏计时
      return
    }
    seat.timing = startTurn(seat.timing, Date.now(), this.timingConfigFor(room))
    room.turnDeadline = seat.timing.deadline
    this.emitTurnState(room, player)
    room.turnTimer = setTimeout(
      () => this.onTurnTimeout(room, player),
      Math.max(0, (seat.timing.deadline as number) - Date.now()),
    )
  }

  /** 房间级计时配置：每步限时以房间为准（config.turnLimitMs ?? TURN_LIMIT_MS），机会数/降档沿用全局 */
  private timingConfigFor(room: Room): TimingConfig {
    return { ...this.timings, turnLimitMs: room.turnLimitMs }
  }

  /** 向双方推送 turnStart / timerUpdate（时钟显示同步） */
  private emitTurnState(room: Room, player: 0 | 1): void {
    const game = room.game
    if (!game) return
    const seat = room.seats[player]
    const deadline = room.turnDeadline
    const now = Date.now()
    for (const s of room.seats) {
      this.emitToSeat(s, 'turnStart', {
        yourTurn: s.index === player,
        deadline: deadline ?? 0,
        turnNo: game.turnNo,
        chancesLeft: seat.timing.chancesLeft,
      })
      this.emitToSeat(s, 'timerUpdate', {
        player,
        remainingMs: deadline === null ? 0 : Math.max(0, deadline - now),
        chancesLeft: seat.timing.chancesLeft,
      })
    }
  }

  /** 读秒超时：机会消耗（系统代走一步并轮换）/ 机器接管 */
  private onTurnTimeout(room: Room, player: 0 | 1): void {
    room.turnTimer = null
    if (room.turnLimitMs === UNLIMITED_TURN_LIMIT_MS) return // 不限时房间不应有超时定时器（防御）
    const game = room.game
    if (!game || game.phase === 'ended') return
    if (game.turn !== player) return // 过期计时器
    const seat = room.seats[player]
    if (!seat.connected) return // 断线期间计时已暂停，不应触发
    const decision = handleTimeout(seat.timing, this.timingConfigFor(room), Date.now())
    seat.timing = decision.next
    if (decision.kind === 'consume') {
      // 新语义（用户反馈）：超时并消耗 1 次机会 → 系统立即代走一步（即超时方本回合行动），
      // 随后由 shootInternal 正常广播 shotResult、轮换回合、判定胜负并启动对手计时器。
      // 先广播一次机会消耗，供前端展示剩余机会数。
      this.broadcast(room, 'timerUpdate', { player, remainingMs: 0, chancesLeft: seat.timing.chancesLeft })
      const coord = this.chooseShotFor(room, player)
      this.shootInternal(room, player, coord)
      // 注意：若代走一步直接终局（全灭/绝地反击），finishGame 已清理全部计时器，此处无需也不得再启动计时。
      return
    }
    if (decision.kind === 'takeover') {
      // 机会耗尽（降档）后首次超时 → 机器永久接管
      seat.machine = true
      room.turnDeadline = null
      room.takeovers.push(player)
      this.broadcast(room, 'machineTakeover', { player })
      this.startTurnFor(room, player)
      return
    }
    // kind === 'none'：机器席位不应有超时
  }

  /** 系统/机器代走：构造该席位自身的报点知识（只用报点历史与反馈，绝不读对方阵型）并给出一个报点 */
  private chooseShotFor(room: Room, player: 0 | 1): Cell {
    const game = room.game
    if (!game) throw new Error('对局不存在（内部错误）')
    const board = game.players[player]
    const knowledge = {
      width: board.width,
      height: board.height,
      shots: board.shotsFired,
      planeShape: board.shape,
    }
    return this.core.chooseShot(knowledge, MACHINE_TAKEOVER_DIFFICULTY, room.seats[player].rng)
  }

  /** 机器走棋：复用 chooseShotFor 选点后走 shootInternal */
  private machineMove(room: Room, player: 0 | 1): void {
    const seat = room.seats[player]
    seat.machineTimer = null
    const game = room.game
    if (!game || game.phase === 'ended') return
    if (game.turn !== player) return // 过期调度
    const coord = this.chooseShotFor(room, player)
    this.shootInternal(room, player, coord)
  }

  /** 终局：广播 gameEnd（双方真实阵型 + 统计）、落盘、更新战绩 */
  private finishGame(room: Room, winner: 0 | 1, reason: GameEndPayload['reason']): void {
    if (room.phase === 'ended') return
    room.phase = 'ended'
    room.gameEndedAt = Date.now()
    this.stopBlitzClock(room)
    this.clearRoomTimers(room)
    const payload: GameEndPayload = {
      winner,
      reason,
      layouts: {
        player0: room.seats[0].fleet ?? [],
        player1: room.seats[1].fleet ?? [],
      },
      stats: this.computeStats(room),
    }
    room.endKind = 'gameEnd'
    room.endPayload = payload
    for (const s of room.seats) this.emitToSeat(s, 'gameEnd', payload)
    this.persistGame(room, winner, reason)
    // 房间保留一段时间供重连查看结果，随后删除
    room.destroyTimer = setTimeout(() => {
      this.rooms.delete(room.code)
    }, this.reconnectGraceMs)
  }

  /** blitz 时钟归零判负：广播 v0.3.0 事件 gameOver { winner, reason:'blitz-timeout', layouts, stats }，
   *  清理计时器、落盘（reason 'blitz-timeout'，与 shared 类型一致） */
  private finishBlitzTimeout(room: Room, loser: 0 | 1): void {
    if (room.phase === 'ended') return
    const winner = (1 - loser) as 0 | 1
    room.phase = 'ended'
    room.gameEndedAt = Date.now()
    this.stopBlitzClock(room)
    this.clearRoomTimers(room)
    const payload: GameEndPayload = {
      winner,
      reason: 'blitz-timeout',
      layouts: {
        player0: room.seats[0].fleet ?? [],
        player1: room.seats[1].fleet ?? [],
      },
      stats: this.computeStats(room),
    }
    room.endKind = 'gameOver'
    room.endPayload = payload
    for (const s of room.seats) this.emitToSeat(s, 'gameOver', payload)
    this.persistGame(room, winner, 'blitz-timeout')
    room.destroyTimer = setTimeout(() => {
      this.rooms.delete(room.code)
    }, this.reconnectGraceMs)
  }

  /* ---------------------------------------------------------------- 超快棋（blitz）时钟 */

  /** 读当前游戏时钟（room.game.blitz.clocks；缺失返回 null） */
  private blitzClocks(room: Room): [number, number] | null {
    const clocks = room.game?.blitz?.clocks
    if (!clocks) return null
    return clocks
  }

  /** 开启 blitz 时钟：初始值已由 createGame 写入 state.blitz.clocks；这里只启动 ~250ms 推进定时器 */
  private startBlitzClock(room: Room): void {
    room.blitzLastAt = Date.now()
    const clocks = this.blitzClocks(room)
    room.blitzSecShown = [clocks ? Math.ceil(clocks[0] / 1000) : 0, clocks ? Math.ceil(clocks[1] / 1000) : 0]
    if (room.blitzTimer) clearInterval(room.blitzTimer)
    room.blitzTimer = setInterval(() => this.tickBlitz(room), BLITZ_TICK_MS)
    // 时钟开局即广播一次（双方看到初始剩余）
    this.broadcastBlitzClock(room, true)
  }

  /** 时钟推进（core 权威）：当前回合方时钟扣减真实流逝；timedOut → blitz 超时判负 */
  private tickBlitz(room: Room): void {
    if (room.phase === 'ended' || !this.blitzClocks(room)) {
      this.stopBlitzClock(room)
      return
    }
    const game = room.game
    if (!game || game.phase === 'ended') {
      this.stopBlitzClock(room)
      return
    }
    const now = Date.now()
    const dt = Math.max(0, now - room.blitzLastAt)
    room.blitzLastAt = now
    const cur = game.turn
    // core 递减并判超时；写回返回的 state（含新时钟；timedOut 时 phase=ended、winner=对方）
    const result = this.core.advanceBlitzClock(game, cur, dt)
    room.game = result.state
    if (result.timedOut) {
      this.finishBlitzTimeout(room, cur)
      return
    }
    this.broadcastBlitzClock(room, false)
  }

  private stopBlitzClock(room: Room): void {
    if (room.blitzTimer) {
      clearInterval(room.blitzTimer)
      room.blitzTimer = null
    }
  }

  /**
   * 广播双方剩余时钟（数据源 = room.game.blitz.clocks，core 权威）：对每个座位发两条
   * clock:update（{player:'me'} 自己、{player:'them'} 对方），ms 为剩余毫秒精确值。
   * 节流：仅在整秒值变化时广播（force=true 强制，用于开局/报点奖励/回合切换/重连同步）。
   */
  private broadcastBlitzClock(room: Room, force: boolean): void {
    const clocks = this.blitzClocks(room)
    if (!clocks || room.phase === 'ended') return
    for (const seat of room.seats) {
      const idx = seat.index
      const sec = Math.max(0, Math.ceil(clocks[idx] / 1000))
      if (!force && sec === room.blitzSecShown[idx]) continue
      room.blitzSecShown[idx] = sec
      const other = (1 - idx) as 0 | 1
      this.emitToSeat(seat, 'clock:update', { player: 'me', ms: Math.max(0, clocks[idx]) })
      this.emitToSeat(seat, 'clock:update', { player: 'them', ms: Math.max(0, clocks[other]) })
    }
  }

  /** 终局统计：回合数/总报点数/命中数（非 miss 即 hit 或 kill）/击毁架数 */
  private computeStats(room: Room): GameEndPayload['stats'] {
    const shotsFired = room.shotLog.length
    const hitCount = room.shotLog.filter((e) => e.outcome !== 'miss').length
    const killCount = room.shotLog.filter((e) => e.outcome === 'kill').length
    return { turnCount: shotsFired, shotsFired, hitCount, killCount }
  }

  private persistGame(room: Room, winner: 0 | 1, reason: string): void {
    if (!this.store) return
    const startedAt = room.gameStartedAt ?? room.gameEndedAt ?? Date.now()
    this.store.insertGame({
      roomCode: room.code,
      configJson: JSON.stringify(room.config),
      fleet0Json: room.seats[0].fleet ? JSON.stringify(room.seats[0].fleet) : null,
      fleet1Json: room.seats[1].fleet ? JSON.stringify(room.seats[1].fleet) : null,
      movesJson: JSON.stringify(room.shotLog),
      result: String(winner),
      reason,
      startedAt,
      endedAt: room.gameEndedAt,
    })
    const loser = (1 - winner) as 0 | 1
    for (const seat of room.seats) {
      const won = seat.index === winner ? 1 : 0
      const lost = seat.index === loser ? 1 : 0
      this.store.updateStats(Number(seat.userId), won, lost, 1)
    }
  }

  /* ---------------------------------------------------------------- 断线 / 重连 */

  onDisconnect(socketId: string): void {
    // 若在匹配队列/快速匹配等待池中则移出
    this.removeFromMatchQueue(socketId)
    this.removeFromQuickPool(socketId)
    const found = this.findRoomBySocket(socketId)
    if (!found) return
    const { room, seat } = found
    if (seat.socketId !== socketId) return // 已被更新的重连取代，忽略旧 socket
    seat.socketId = null
    seat.connected = false
    if (room.phase === 'ended') return
    if (room.phase === 'waiting') {
      // 单人房间直接解散
      this.clearRoomTimers(room)
      this.rooms.delete(room.code)
      return
    }
    if (room.phase === 'placing') {
      // 摆阵阶段断线：宽限期内未重连则解散房间
      this.broadcastRoomUpdate(room)
      seat.disconnectTimer = setTimeout(() => {
        if (!seat.connected && room.phase !== 'ended') {
          this.clearRoomTimers(room)
          this.notifyRoomClosed(room)
          this.rooms.delete(room.code)
        }
      }, this.reconnectGraceMs)
      return
    }
    // playing / counterattack
    if (room.game && room.game.turn === seat.index) {
      // 冻结当前回合读秒，重连后恢复 deadline
      const rem = remainingMs(room.turnDeadline, Date.now())
      seat.frozenRemainingMs = rem
      if (room.turnTimer) {
        clearTimeout(room.turnTimer)
        room.turnTimer = null
      }
      room.turnDeadline = null
    }
    this.broadcastRoomUpdate(room)
    const opp = room.seats[(1 - seat.index) as 0 | 1]
    this.emitToSeat(opp, 'opponentDisconnected', { reconnectGraceMs: this.reconnectGraceMs })
    // 机器接管席位不再因断线判负（机器继续代打）
    if (seat.machine) return
    seat.disconnectTimer = setTimeout(() => {
      if (!seat.connected && room.phase !== 'ended') {
        this.finishGame(room, (1 - seat.index) as 0 | 1, 'disconnect')
      }
    }, this.reconnectGraceMs)
  }

  /** 凭 token+gameId 重连恢复；回放历史事件重建客户端棋盘 */
  reconnect(
    userId: string,
    gameId: string,
    socketId: string,
  ): { ok: true; you: 0 | 1 } | { ok: false; error: string } {
    const room = this.rooms.get(gameId)
    if (!room) return { ok: false, error: '对局不存在或已解散' }
    const seat = room.seats.find((s) => s.userId === userId)
    if (!seat) return { ok: false, error: '您不属于该对局' }
    seat.socketId = socketId
    seat.connected = true
    if (seat.disconnectTimer) {
      clearTimeout(seat.disconnectTimer)
      seat.disconnectTimer = null
    }
    this.broadcastRoomUpdate(room)
    const opp = room.seats[(1 - seat.index) as 0 | 1]
    if (room.phase === 'playing' || room.phase === 'counterattack') {
      this.emitToSeat(opp, 'opponentReconnected')
    }
    // 回放：接管事件 + 全量射击结果（按序），客户端据此重建双方棋盘
    for (const p of room.takeovers) this.emitToSeat(seat, 'machineTakeover', { player: p })
    for (const e of room.shotLog) {
      this.emitToSeat(seat, 'shotResult', {
        by: e.by === seat.index ? 'you' : 'opponent',
        coord: e.coord,
        outcome: e.outcome,
      })
    }
    if (room.phase === 'ended') {
      // 按终局种类回放（常规 gameEnd / v0.3.0 blitz 时钟判负 gameOver）
      if (room.endPayload) {
        if (room.endKind === 'gameOver') this.emitToSeat(seat, 'gameOver', room.endPayload)
        else this.emitToSeat(seat, 'gameEnd', room.endPayload)
      }
      return { ok: true, you: seat.index }
    }
    this.emitToSeat(seat, 'phaseChange', { phase: this.mapPhase(room) })
    if (room.phase === 'playing' || room.phase === 'counterattack') {
      if (this.isBlitz(room)) this.broadcastBlitzClock(room, true)
      const current = room.game?.turn
      if (current !== undefined && current === seat.index) {
        if (seat.frozenRemainingMs !== null) {
          // 断线前冻结了本回合剩余时间 → 恢复 deadline
          seat.timing = resume(seat.timing, Date.now(), seat.frozenRemainingMs)
          seat.frozenRemainingMs = null
          room.turnDeadline = seat.timing.deadline
          this.emitTurnState(room, current)
          room.turnTimer = setTimeout(
            () => this.onTurnTimeout(room, current),
            Math.max(0, (seat.timing.deadline as number) - Date.now()),
          )
        } else {
          // 本回合在断线期间才开始 → 重新开始完整回合
          this.startTurnFor(room, current)
        }
      } else if (current !== undefined) {
        // 对手回合：对手计时器仍在运行，仅同步时钟显示
        this.emitTurnState(room, current)
      }
    }
    return { ok: true, you: seat.index }
  }

  /* ---------------------------------------------------------------- 公网匹配 */

  /**
   * 档位指纹：width×height×planeCount×形状（cells 排序 + head）。
   * 仅与三档标准配置（PRESETS）完全一致才进匹配池；自定义配置不进匹配池。
   */
  private configKey(config: GridConfig): string {
    const cells = [...config.shape.cells].sort((a, b) => a.r - b.r || a.c - b.c)
    const fp = cells.map((c) => `${c.r},${c.c}`).join(';')
    return `${config.width}x${config.height}x${config.planeCount}#${fp}#${config.shape.head.r},${config.shape.head.c}`
  }

  /**
   * 进入公网匹配（协议事件 createRoom 的 payload.match === true 即表示匹配意图，
   * 见 shared 的 ClientToServerEvents.createRoom）。
   * 仅与三档标准配置（PRESETS）完全一致才进匹配池；自定义配置不进池。
   * 配对成功直接建房；30s 未配对广播 matchmakingStatus 'timeout'。
   */
  matchmake(
    userId: string,
    name: string,
    socketId: string,
    config: unknown,
  ): { ok: true } | { ok: false; error: string } {
    const parsed = gridConfigSchema.safeParse(config)
    if (!parsed.success) return { ok: false, error: '棋盘配置非法' }
    const key = this.configKey(parsed.data)
    const presetKeys = Object.values(PRESETS).map((c) => this.configKey(c))
    if (!presetKeys.includes(key)) return { ok: false, error: '自定义配置不进匹配池，请自建房间' }
    // 兜底：若用户残留 waiting/placing 阶段的房间，先自动释放再入队；对局中仍拒绝
    if (!this.releaseStaleRoomOf(userId)) {
      if (this.roomOfUser(userId)) return { ok: false, error: '您已在其他对局中，请先退出' }
    }

    const queue = this.matchQueue.get(key) ?? []
    const waitingIdx = queue.findIndex((e) => e.socketId !== socketId && this.io.sockets.sockets.has(e.socketId))
    if (waitingIdx >= 0) {
      // 配对成功：同配置直接成房
      const waiting = queue[waitingIdx] as MatchEntry
      queue.splice(waitingIdx, 1)
      if (queue.length === 0) this.matchQueue.delete(key)
      if (waiting.timer) {
        clearTimeout(waiting.timer)
        waiting.timer = null
      }
      const code = this.uniqueCode()
      const room = this.buildRoom(code, parsed.data, true)
      this.rooms.set(code, room)
      this.occupySeat(room, 0, waiting.userId, waiting.name, waiting.socketId)
      this.occupySeat(room, 1, userId, name, socketId)
      room.phase = 'placing'
      this.emitToSocket(waiting.socketId, 'matchmakingStatus', { status: 'matched' })
      this.emitToSocket(socketId, 'matchmakingStatus', { status: 'matched' })
      this.broadcastRoomUpdate(room)
      return { ok: true }
    }

    // 入队等待
    const entry: MatchEntry = { socketId, userId, name, key, timer: null }
    entry.timer = setTimeout(() => {
      const q = this.matchQueue.get(key)
      if (!q) return
      const idx = q.findIndex((e) => e.socketId === socketId)
      if (idx >= 0) {
        q.splice(idx, 1)
        if (q.length === 0) this.matchQueue.delete(key)
      }
      this.emitToSocket(socketId, 'matchmakingStatus', { status: 'timeout' })
    }, this.matchmakingTimeoutMs)
    queue.push(entry)
    this.matchQueue.set(key, queue)
    this.emitToSocket(socketId, 'matchmakingStatus', { status: 'queued' })
    return { ok: true }
  }

  private removeFromMatchQueue(socketId: string): void {
    for (const [key, q] of this.matchQueue) {
      const idx = q.findIndex((e) => e.socketId === socketId)
      if (idx >= 0) {
        const entry = q[idx]
        if (entry?.timer) clearTimeout(entry.timer)
        q.splice(idx, 1)
        if (q.length === 0) this.matchQueue.delete(key)
        return
      }
    }
  }

  /* ---------------------------------------------------------------- 快速匹配（match:quick，v0.3.0） */

  /** combo 指纹键：同 gridSize/planes/blitz/blind 视为同一档位 */
  private quickKey(config: GridConfig): string {
    return `${config.width}x${config.height}x${config.planeCount}x${config.blitz ? 1 : 0}x${config.blind ? 1 : 0}`
  }

  /** 校验并规范化一个 combo → 完整房间配置（标准默认飞机形状）；非法返回 null */
  private comboToConfig(raw: unknown): GridConfig | null {
    if (typeof raw !== 'object' || raw === null) return null
    const c = raw as { gridSize?: unknown; planes?: unknown; blitz?: unknown; blind?: unknown }
    if (typeof c.gridSize !== 'number' || typeof c.planes !== 'number') return null
    const { gridSize, planes } = c
    if (!(QUICK_GRID_SIZES as readonly number[]).includes(gridSize)) return null
    const maxPlanes = Math.floor((gridSize * gridSize) / 25)
    if (!Number.isInteger(planes) || planes < 1 || planes > maxPlanes) return null
    return {
      width: gridSize,
      height: gridSize,
      planeCount: planes,
      shape: DEFAULT_PLANE_SHAPE,
      blitz: c.blitz === true,
      blind: c.blind === true,
    }
  }

  /**
   * 快速匹配：请求携带勾选的档位组合（combos）。与等待池任一玩家的组合有交集 →
   * 取交集 combo 建房并双方广播 room:joined；无交集 → 入池并广播 match:waiting。
   * 断开连接 / match:cancel 时移出池。
   */
  quickMatch(
    userId: string,
    name: string,
    socketId: string,
    rawCombos: unknown,
  ): { ok: true } | { ok: false; error: string } {
    if (!Array.isArray(rawCombos) || rawCombos.length === 0) return { ok: false, error: '缺少匹配选项' }
    // 兜底：释放残留 waiting/placing 房间；对局中（playing/counterattack）仍拒绝
    if (!this.releaseStaleRoomOf(userId)) {
      if (this.roomOfUser(userId)) return { ok: false, error: '您已在其他对局中，请先退出' }
    }
    const keys = new Set<string>()
    const configByKey = new Map<string, GridConfig>()
    for (const raw of rawCombos) {
      const cfg = this.comboToConfig(raw)
      if (!cfg) return { ok: false, error: '匹配选项非法' }
      const k = this.quickKey(cfg)
      keys.add(k)
      configByKey.set(k, cfg)
    }
    // 扫等待池：先到先配对（移除已断开的陈旧条目）
    for (let i = 0; i < this.quickPool.length; i++) {
      const entry = this.quickPool[i] as QuickEntry
      if (entry.socketId === socketId) continue
      if (!this.io.sockets.sockets.has(entry.socketId)) {
        this.quickPool.splice(i, 1)
        i--
        continue
      }
      const shared = [...entry.keys].find((k) => keys.has(k))
      if (!shared) continue
      this.quickPool.splice(i, 1)
      const cfg = configByKey.get(shared) as GridConfig
      this.buildQuickRoom(cfg, entry, { userId, name, socketId })
      return { ok: true }
    }
    // 无交集：入池等待
    this.quickPool.push({ socketId, userId, name, keys })
    this.emitToSocket(socketId, 'match:waiting')
    return { ok: true }
  }

  /** 按交集 combo 建房并广播 room:joined（房主 = 先入池者，坐 0 号位） */
  private buildQuickRoom(
    config: GridConfig,
    host: { socketId: string; userId: string; name: string },
    guest: { socketId: string; userId: string; name: string },
  ): void {
    const code = this.uniqueCode()
    const room = this.buildRoom(code, config, true)
    this.rooms.set(code, room)
    this.occupySeat(room, 0, host.userId, host.name, host.socketId)
    this.occupySeat(room, 1, guest.userId, guest.name, guest.socketId)
    room.phase = 'placing'
    const joined = { roomCode: code, config } as const
    this.emitToSocket(host.socketId, 'room:joined', joined)
    this.emitToSocket(guest.socketId, 'room:joined', joined)
    this.broadcastRoomUpdate(room)
  }

  /** 取消快速匹配（match:cancel）：把用户移出等待池 */
  quickCancel(socketId: string): void {
    this.removeFromQuickPool(socketId)
  }

  private removeFromQuickPool(socketId: string): void {
    const idx = this.quickPool.findIndex((e) => e.socketId === socketId)
    if (idx >= 0) this.quickPool.splice(idx, 1)
  }

  /** 停止全部计时器（关服/测试收尾） */
  shutdown(): void {
    for (const room of this.rooms.values()) this.clearRoomTimers(room)
    for (const q of this.matchQueue.values()) {
      for (const e of q) if (e.timer) clearTimeout(e.timer)
    }
    this.matchQueue.clear()
    this.quickPool.length = 0
    this.rooms.clear()
  }
}
