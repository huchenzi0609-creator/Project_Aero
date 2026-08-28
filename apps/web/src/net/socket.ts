/**
 * net/socket —— Socket.IO 客户端单例（M6）。
 *
 * 职责：
 * - typed socket.io-client 单例（ClientToServerEvents / ServerToClientEvents）；
 * - 连接生命周期：应用挂载时 connectSocket()；断线自动重连（socket.io 内建）；
 * - 身份：每次连接后 emit `auth({ token })` 存 identity（token 来自 GUEST_TOKEN_KEY）；
 * - 断线重连 / 刷新恢复：若已知当前房间码（store 或 sessionStorage），连接后
 *   额外 emit `reconnect({ token, gameId }, ack)`，服务端回放历史事件重建棋盘，
 *   ack 失败说明房间已解散 → 通知 store 复位会话；
 * - 所有 ServerToClientEvents 一律转发给 onlineStore.handleEvent（幂等处理，回放安全）；
 * - 组件只经本模块 emit（onlineApi），渲染层只读 onlineStore。
 */
import { io } from 'socket.io-client'
import type { Socket } from 'socket.io-client'
import type { Cell, ClientToServerEvents, GridConfig, PlacedPlane, ServerToClientEvents } from '@aero/shared'
import { useOnlineStore } from '../store/onlineStore'
import { readPersistedGameId, readToken } from './storage'

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>

let socket: ClientSocket | null = null
let wired = false

/* ---------------------------------------------------------------- 单例与装配 */

function serverUrl(): string | undefined {
  const url = (import.meta.env.VITE_SERVER_URL as string | undefined)?.trim()
  return url || undefined
}

function ensureSocket(): ClientSocket {
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

/** 当前应恢复的房间码：store 优先（正常会话），其次 sessionStorage（刷新/重连） */
function currentGameId(): string | null {
  const fromStore = useOnlineStore.getState().room?.code
  return fromStore ?? readPersistedGameId()
}

function wireEvents(s: ClientSocket): void {
  if (wired) return
  wired = true

  s.on('connect', () => {
    useOnlineStore.getState().setSocketStatus('connected')
    const token = readToken()
    // 身份（不携带 gameId，避免与下方 reconnect 事件重复触发服务端重连恢复）
    s.emit('auth', { token })
    // 断线重连 / 刷新恢复：显式 reconnect 事件，ack 可判定房间是否还在
    const gameId = currentGameId()
    if (gameId) {
      s.emit('reconnect', { token, gameId }, (res) => {
        if (!res || !res.ok) {
          useOnlineStore.getState().handleReconnectFailed(
            (res as { error?: string } | undefined)?.error ?? '对局已结束或房间已解散',
          )
        }
      })
    }
  })

  s.on('disconnect', () => {
    useOnlineStore.getState().setSocketStatus('disconnected')
  })

  s.on('connect_error', () => {
    useOnlineStore.getState().setSocketStatus('disconnected')
  })

  // 服务端事件 → store（幂等处理，重连回放安全）
  s.on('identity', (p) => useOnlineStore.getState().handleEvent('identity', p))
  s.on('roomUpdate', (p) => useOnlineStore.getState().handleEvent('roomUpdate', p))
  s.on('phaseChange', (p) => useOnlineStore.getState().handleEvent('phaseChange', p))
  s.on('turnStart', (p) => useOnlineStore.getState().handleEvent('turnStart', p))
  s.on('shotResult', (p) => useOnlineStore.getState().handleEvent('shotResult', p))
  s.on('timerUpdate', (p) => useOnlineStore.getState().handleEvent('timerUpdate', p))
  s.on('machineTakeover', (p) => useOnlineStore.getState().handleEvent('machineTakeover', p))
  s.on('opponentDisconnected', (p) => useOnlineStore.getState().handleEvent('opponentDisconnected', p))
  s.on('opponentReconnected', () => useOnlineStore.getState().handleEvent('opponentReconnected', undefined))
  s.on('matchmakingStatus', (p) => useOnlineStore.getState().handleEvent('matchmakingStatus', p))
  s.on('gameEnd', (p) => useOnlineStore.getState().handleEvent('gameEnd', p))
}

/** 应用挂载时调用（幂等）：建立连接并自动重连 */
export function connectSocket(): void {
  const s = ensureSocket()
  if (!s.connected) s.connect()
}

export function getSocketConnected(): boolean {
  return socket?.connected ?? false
}

/** 等待连接就绪（最多 4s），供 emit 前置检查 */
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

/** 离开公网匹配队列：服务端仅在 socket 断开时移出队列，故断开后立即重连 */
export function cancelMatchmaking(): void {
  const s = ensureSocket()
  if (!s.connected) return
  s.disconnect()
  window.setTimeout(() => {
    if (!socket?.connected) s.connect()
  }, 400)
}

/* ---------------------------------------------------------------- 联机 API（组件经此 emit） */

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

export const onlineApi = {
  createRoom(config: GridConfig, match: boolean): Promise<ApiResult<string>> {
    return whenConnected().then((ok) => {
      if (!ok) return { ok: false, error: '尚未连接服务器，请稍候重试' }
      return new Promise((resolve) => {
        socket!.emit('createRoom', { config, match }, (ack) => {
          const res = toResult(ack as AnyAck | undefined, (a) => (a as { roomCode?: string }).roomCode)
          if (res.ok && res.data) {
            useOnlineStore.getState().noteRoomCode(res.data)
          }
          resolve(res)
        })
      })
    })
  },

  joinRoom(code: string): Promise<ApiResult> {
    return whenConnected().then((ok) => {
      if (!ok) return { ok: false, error: '尚未连接服务器，请稍候重试' }
      return new Promise((resolve) => {
        socket!.emit('joinRoom', { code: code.toUpperCase() }, (ack) => {
          const res = toResult(ack as AnyAck | undefined, () => undefined)
          if (res.ok) {
            useOnlineStore.getState().noteRoomCode(code.toUpperCase())
          }
          resolve(res)
        })
      })
    })
  },

  placeFleet(planes: PlacedPlane[]): Promise<ApiResult> {
    return whenConnected().then((ok) => {
      if (!ok) return { ok: false, error: '尚未连接服务器，请稍候重试' }
      return new Promise((resolve) => {
        socket!.emit('placeFleet', { planes }, (ack) => {
          const errors = (ack as { errors?: string[] } | undefined)?.errors ?? []
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
        socket!.emit('ready', (ack) => {
          resolve(toResult(ack as AnyAck | undefined, () => undefined))
        })
      })
    })
  },

  shoot(coord: Cell): Promise<ApiResult> {
    return whenConnected().then((ok) => {
      if (!ok) return { ok: false, error: '尚未连接服务器，请稍候重试' }
      return new Promise((resolve) => {
        socket!.emit('shoot', { coord }, (ack) => {
          resolve(toResult(ack as AnyAck | undefined, () => undefined))
        })
      })
    })
  },

  resign(): void {
    if (socket?.connected) socket.emit('resign')
  },

  leaveRoom(): void {
    if (socket?.connected) socket.emit('leaveRoom')
    useOnlineStore.getState().handleLeftRoom()
  },
}
