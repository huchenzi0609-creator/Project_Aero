/**
 * online/client —— v0.3.0 联机 Socket.IO 客户端（独立连接，与 net/socket 并存）。
 *
 * 为什么独立连接：
 * - net/socket（v0.2）为 typed 单例且事件全部转发 onlineStore，事件名/实例均不对外；
 *   v0.3 新增事件（match:quick / match:waiting / room:joined / clock:update / gameOver）
 *   不在其 typed 接口内，且 net/ 不属于本任务可编辑范围。
 * - 服务端身份按 socket 独立（每连接 auth 解析同 token 账号，socket.data 隔离），
 *   双连接互不干扰；本连接承载 v0.3 联机会话，旧连接仅保持 v0.2 身份/空闲连接。
 *
 * 职责：
 * - 同 URL 连接、auth、断线自动重连；恢复用 gameId 走独立 key（aero:v030:gameId），
 *   避免旧连接（aero:online:gameId）误触发其 reconnect。
 * - v0.2 既有事件（identity/roomUpdate/…/gameEnd）一律桥接 onlineStore.handleEvent，
 *   使房间数据/回放/App 恢复与页面读取和 v0.2 一致。
 * - v0.3 新增事件经本地订阅器分发给页面（OnlineMenu / OnlineGame / OnlinePlacement）。
 */
import { io } from 'socket.io-client'
import type { Socket } from 'socket.io-client'
import type { PlacedPlane } from '@aero/shared'
import { useOnlineStore } from '../store/onlineStore'
import { readToken } from '../net/storage'
import type { GridConfigV030, MatchCombo } from './protocol'
import type { RoomJoinedPayload } from './protocol'

/** 本客户端专属的房间持久化 key（与 net/storage 的 aero:online:gameId 隔离） */
const V030_GAME_KEY = 'aero:v030:gameId'

type RawSocket = Socket

let socket: RawSocket | null = null
let started = false

/* ---------------------------------------------------------------- 连接状态 */

export type ClientStatus = 'idle' | 'connecting' | 'connected' | 'disconnected'

type StatusListener = (status: ClientStatus) => void
const statusListeners = new Set<StatusListener>()

function notifyStatus(status: ClientStatus): void {
  statusListeners.forEach((fn) => fn(status))
  // 同步给 onlineStore（旧横幅/禁点逻辑沿用），保持两连接状态一致时体验不变
  useOnlineStore
    .getState()
    .setSocketStatus(
      status === 'connected' ? 'connected' : status === 'connecting' ? 'connecting' : 'disconnected',
    )
}

/** 订阅连接状态；返回退订函数 */
export function subscribeStatus(fn: StatusListener): () => void {
  statusListeners.add(fn)
  return () => statusListeners.delete(fn)
}

/* ---------- v0.3 事件订阅（本地分发） ---------- */

export interface ServerV030Handlers {
  'match:waiting': (p: { message?: string }) => void
  'room:joined': (p: RoomJoinedPayload) => void
  'clock:update': (p: { player: 0 | 1; ms: number }) => void
  gameOver: (p: import('./protocol').GameOverPayload) => void
}

type V030EventName = keyof ServerV030Handlers
type V030Handler = (payload: unknown) => void
const v030Listeners = new Map<V030EventName, Set<V030Handler>>()

/** 订阅 v0.3 新增事件；返回退订函数 */
export function onV030<K extends V030EventName>(event: K, fn: ServerV030Handlers[K]): () => void {
  const set = v030Listeners.get(event) ?? new Set<V030Handler>()
  set.add(fn as V030Handler)
  v030Listeners.set(event, set)
  return () => set.delete(fn as V030Handler)
}

function dispatchV030(event: V030EventName, payload: unknown): void {
  const set = v030Listeners.get(event)
  if (!set) return
  set.forEach((fn) => fn(payload))
}

/* ---------------------------------------------------------------- 持久化（隔离 key） */

export function readV030GameId(): string | null {
  try {
    return sessionStorage.getItem(V030_GAME_KEY)
  } catch {
    return null
  }
}

export function persistV030GameId(code: string | null): void {
  try {
    if (code === null) sessionStorage.removeItem(V030_GAME_KEY)
    else sessionStorage.setItem(V030_GAME_KEY, code)
  } catch {
    /* 隐私模式等场景静默失败 */
  }
}

/* ---------------------------------------------------------------- 连接装配 */

function serverUrl(): string | undefined {
  const url = (import.meta.env.VITE_SERVER_URL as string | undefined)?.trim()
  return url || undefined
}

function ensureSocket(): RawSocket {
  if (socket) return socket
  socket = io(serverUrl() ?? '/', {
    autoConnect: false,
    reconnection: true,
    reconnectionDelay: 500,
    reconnectionDelayMax: 3000,
    timeout: 8000,
  })
  wireEvents(socket)
  return socket
}

function wireEvents(s: RawSocket): void {
  s.on('connect', () => {
    notifyStatus('connected')
    const token = readToken()
    // 身份（auth 不带 gameId；房间恢复走下方独立 reconnect，与 v0.2 路径一致）
    s.emit('auth', { token })
    const gameId = readV030GameId()
    if (gameId) {
      s.emit('reconnect', { token, gameId }, (res: { ok?: boolean; error?: string } | undefined) => {
        if (!res || !res.ok) {
          persistV030GameId(null)
          useOnlineStore.getState().handleReconnectFailed(res?.error ?? '对局已结束或房间已解散')
        }
      })
    }
  })

  s.on('disconnect', () => notifyStatus('disconnected'))
  s.on('connect_error', () => notifyStatus('disconnected'))

  // v0.2 既有事件 → onlineStore（幂等处理，重连回放安全；旧连接不 join 房间故无重复）
  s.on('identity', (p) => useOnlineStore.getState().handleEvent('identity', p))
  s.on('roomUpdate', (p) => useOnlineStore.getState().handleEvent('roomUpdate', p))
  s.on('phaseChange', (p) => useOnlineStore.getState().handleEvent('phaseChange', p))
  s.on('turnStart', (p) => useOnlineStore.getState().handleEvent('turnStart', p))
  s.on('shotResult', (p) => useOnlineStore.getState().handleEvent('shotResult', p))
  s.on('timerUpdate', (p) => useOnlineStore.getState().handleEvent('timerUpdate', p))
  s.on('machineTakeover', (p) => useOnlineStore.getState().handleEvent('machineTakeover', p))
  s.on('opponentDisconnected', (p) => useOnlineStore.getState().handleEvent('opponentDisconnected', p))
  s.on('opponentReconnected', () =>
    useOnlineStore.getState().handleEvent('opponentReconnected', undefined),
  )
  s.on('gameEnd', (p) => useOnlineStore.getState().handleEvent('gameEnd', p))

  // v0.3 新增事件 → 本地订阅器（gameOver 完整结构时同时喂 onlineStore，
  // 结算页/统计沿用 gameEnd 渲染路径；M5 契约落地后若改事件名在此对齐）
  s.on('match:waiting', (p) => dispatchV030('match:waiting', p))
  s.on('room:joined', (p) => dispatchV030('room:joined', p))
  s.on('clock:update', (p) => dispatchV030('clock:update', p))
  s.on('gameOver', (p) => {
    const full = p as { winner?: number; reason?: string; layouts?: unknown } | undefined
    if (full?.layouts && full.winner !== undefined) {
      useOnlineStore.getState().handleEvent('gameEnd', p as never)
    }
    dispatchV030('gameOver', p)
  })
}

/** 连接（幂等）：进入联机页时调用 */
export function connectClient(): void {
  const s = ensureSocket()
  if (!started) {
    started = true
    s.connect()
    return
  }
  if (!s.connected) s.connect()
}

export function getClientStatus(): ClientStatus {
  if (!socket) return 'idle'
  if (socket.connected) return 'connected'
  return started ? 'disconnected' : 'idle'
}

/* ---------------------------------------------------------------- emit 封装 */

function whenConnected(timeoutMs = 4000): Promise<boolean> {
  const s = ensureSocket()
  if (s.connected) return Promise.resolve(true)
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      s.off('connect', onOk)
      resolve(false)
    }, timeoutMs)
    const onOk = () => {
      window.clearTimeout(timer)
      resolve(true)
    }
    s.once('connect', onOk)
    s.connect()
  })
}

export interface ApiResult<T = undefined> {
  ok: boolean
  data?: T
  error?: string
}

type AnyAck = { error?: string } & Record<string, unknown>

function toResult<T>(ack: AnyAck | undefined, pick: (ack: AnyAck) => T | undefined): ApiResult<T> {
  if (ack && ack.error) return { ok: false, error: ack.error }
  if (!ack) return { ok: false, error: '服务器无响应' }
  return { ok: true, data: pick(ack) }
}

/** v0.3 客户端 API（页面经此 emit；房间事件沿用 v0.2 事件名，config 含 v0.3 扩展字段） */
export const v030Api = {
  /** 快速匹配：按勾选组合发起 */
  matchQuick(combos: MatchCombo[]): Promise<ApiResult> {
    return whenConnected().then((ok) => {
      if (!ok) return { ok: false, error: '尚未连接服务器，请稍候重试' }
      return new Promise((resolve) => {
        socket!.emit('match:quick', { combos }, (ack: AnyAck | undefined) => {
          resolve(toResult(ack, () => undefined))
        })
      })
    })
  },

  /** 取消匹配（离开等待池） */
  cancelMatch(): void {
    if (socket?.connected) socket.emit('match:cancel')
  },

  /** 创建房间（config 可携带 blitz/blind 模式开关） */
  createRoom(config: GridConfigV030): Promise<ApiResult<string>> {
    return whenConnected().then((ok) => {
      if (!ok) return { ok: false, error: '尚未连接服务器，请稍候重试' }
      return new Promise((resolve) => {
        socket!.emit('createRoom', { config, match: false }, (ack: AnyAck | undefined) => {
          const res = toResult(ack, (a) => (a as { roomCode?: string }).roomCode)
          if (res.ok && res.data) persistV030GameId(res.data)
          resolve(res)
        })
      })
    })
  },

  /** 加入已有对局（房码大小写容错） */
  joinRoom(code: string): Promise<ApiResult> {
    return whenConnected().then((ok) => {
      if (!ok) return { ok: false, error: '尚未连接服务器，请稍候重试' }
      return new Promise((resolve) => {
        socket!.emit('joinRoom', { code: code.toUpperCase() }, (ack: AnyAck | undefined) => {
          const res = toResult(ack, () => undefined)
          if (res.ok) persistV030GameId(code.toUpperCase())
          resolve(res)
        })
      })
    })
  },

  placeFleet(planes: PlacedPlane[]): Promise<ApiResult> {
    return whenConnected().then((ok) => {
      if (!ok) return { ok: false, error: '尚未连接服务器，请稍候重试' }
      return new Promise((resolve) => {
        socket!.emit('placeFleet', { planes }, (ack: AnyAck | undefined) => {
          const raw = ack?.errors as unknown
          const errors: string[] = Array.isArray(raw) ? (raw as string[]) : []
          if (errors.length > 0) return resolve({ ok: false, error: errors.join('；') })
          resolve({ ok: true })
        })
      })
    })
  },

  ready(): Promise<ApiResult> {
    return whenConnected().then((ok) => {
      if (!ok) return { ok: false, error: '尚未连接服务器，请稍候重试' }
      return new Promise((resolve) => {
        socket!.emit('ready', (ack: AnyAck | undefined) => {
          resolve(toResult(ack, () => undefined))
        })
      })
    })
  },

  shoot(coord: { r: number; c: number }): Promise<ApiResult> {
    return whenConnected().then((ok) => {
      if (!ok) return { ok: false, error: '尚未连接服务器，请稍候重试' }
      return new Promise((resolve) => {
        socket!.emit('shoot', { coord }, (ack: AnyAck | undefined) => {
          resolve(toResult(ack, () => undefined))
        })
      })
    })
  },

  resign(): void {
    if (socket?.connected) socket.emit('resign')
  },

  leaveRoom(): void {
    if (socket?.connected) socket.emit('leaveRoom')
    persistV030GameId(null)
    useOnlineStore.getState().handleLeftRoom()
  },
}
