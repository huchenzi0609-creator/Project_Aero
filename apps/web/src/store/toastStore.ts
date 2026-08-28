/**
 * toastStore —— 轻量提示（纸片 Toast），自动消失。
 */
import { create } from 'zustand'

export type ToastKind = 'info' | 'success' | 'error'

export interface ToastItem {
  id: number
  message: string
  kind: ToastKind
}

interface ToastState {
  items: ToastItem[]
  push: (message: string, kind?: ToastKind) => void
  dismiss: (id: number) => void
}

let toastSeq = 0

export const useToastStore = create<ToastState>()((set, get) => ({
  items: [],
  push: (message, kind = 'info') => {
    const id = ++toastSeq
    set((s) => ({ items: [...s.items, { id, message, kind }] }))
    window.setTimeout(() => get().dismiss(id), 2600)
  },
  dismiss: (id) => set((s) => ({ items: s.items.filter((t) => t.id !== id) })),
}))
