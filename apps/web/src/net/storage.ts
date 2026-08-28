/**
 * net/storage —— 联机会话的浏览器持久化（token / 当前房间码）。
 * 供 net/socket 与 store/onlineStore 共用，避免循环依赖。
 */
import { GUEST_TOKEN_KEY } from '@aero/shared'

/** sessionStorage 中保存的当前房间码（页面刷新恢复对局用） */
export const ONLINE_GAME_KEY = 'aero:online:gameId'

/** localStorage 中保存我方阵型（按房间码隔离；仅自己的阵型，不涉及对手信息） */
export const ONLINE_FLEET_KEY = 'aero:online:fleet'

export function readToken(): string {
  try {
    return localStorage.getItem(GUEST_TOKEN_KEY) ?? ''
  } catch {
    return ''
  }
}

export function writeToken(token: string): void {
  try {
    localStorage.setItem(GUEST_TOKEN_KEY, token)
  } catch {
    /* 隐私模式等场景静默失败 */
  }
}

export function readPersistedGameId(): string | null {
  try {
    return sessionStorage.getItem(ONLINE_GAME_KEY)
  } catch {
    return null
  }
}

export function persistGameId(code: string | null): void {
  try {
    if (code === null) sessionStorage.removeItem(ONLINE_GAME_KEY)
    else sessionStorage.setItem(ONLINE_GAME_KEY, code)
  } catch {
    /* 静默失败 */
  }
}

export function readPersistedFleet(roomCode: string): unknown {
  try {
    const raw = sessionStorage.getItem(`${ONLINE_FLEET_KEY}:${roomCode}`)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function writePersistedFleet(roomCode: string, fleet: unknown): void {
  try {
    sessionStorage.setItem(`${ONLINE_FLEET_KEY}:${roomCode}`, JSON.stringify(fleet))
  } catch {
    /* 静默失败 */
  }
}

export function clearPersistedFleet(roomCode: string): void {
  try {
    sessionStorage.removeItem(`${ONLINE_FLEET_KEY}:${roomCode}`)
  } catch {
    /* 静默失败 */
  }
}
