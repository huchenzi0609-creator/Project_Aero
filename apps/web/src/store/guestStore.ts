/**
 * guestStore —— 本地游客名桩（“游客00001”）。M5 接入后端身份后替换为真实身份。
 */
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

interface GuestState {
  id: string
  name: string
  token: string
}

const DEFAULT_GUEST: GuestState = {
  id: 'local-guest',
  name: '游客00001',
  token: 'local-guest-token',
}

export const useGuestStore = create<GuestState>()(
  persist(() => DEFAULT_GUEST, {
    name: 'aero-guest',
    storage: createJSONStorage(() => localStorage),
  }),
)
