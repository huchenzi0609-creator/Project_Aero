/**
 * guestStore —— 游客身份（M6 起由服务端权威）。
 *
 * token 存 localStorage（键名契约：shared 的 GUEST_TOKEN_KEY）；
 * socket 连接后 emit auth({token}) → 服务端返回 identity（有 token 复用同名，
 * 无 token 新建「游客XXXXX」），经 applyIdentity 写入本 store；
 * 服务端身份到达前先显示本地旧名（迁移自 M4 的 aero-guest 持久化桩）。
 */
import { create } from 'zustand'
import type { GuestIdentity } from '@aero/shared'
import { readToken, writeToken } from '../net/storage'

interface GuestState {
  id: string
  name: string
  token: string
  /** 是否已从服务端获得身份 */
  ready: boolean
  applyIdentity: (identity: GuestIdentity) => void
}

/** 迁移：读取 M4 桩（aero-guest）里的旧名，服务端身份到达前先显示 */
function legacyName(): string {
  try {
    const raw = localStorage.getItem('aero-guest')
    if (raw) {
      const parsed = JSON.parse(raw) as { state?: { name?: string } } | null
      const name = parsed?.state?.name
      if (typeof name === 'string' && name.length > 0 && name !== '游客……') return name
    }
  } catch {
    /* 忽略损坏数据 */
  }
  return '游客……'
}

const stored = readToken()

export const useGuestStore = create<GuestState>()((set) => ({
  id: '',
  name: stored ? legacyName() : '游客……',
  token: stored,
  ready: false,
  applyIdentity: (identity) => {
    writeToken(identity.token)
    set({ id: identity.id, name: identity.name, token: identity.token, ready: true })
  },
}))
