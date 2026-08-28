/**
 * appStore —— 当前视图路由 + 对局占位配置 + 横竖版手动覆盖。
 */
import { create } from 'zustand'
import type { GridConfig } from '@aero/shared'
import { PRESETS } from '@aero/shared'

export type View = 'home' | 'single' | 'custom' | 'settings' | 'rules' | 'online' | 'game'
export type OrientationOverride = 'auto' | 'landscape' | 'portrait'

interface AppState {
  view: View
  /** 进入对局占位页时携带的棋盘配置（M4 起由真实流程接管） */
  gridConfig: GridConfig
  orientationOverride: OrientationOverride
  setView: (view: View) => void
  setGridConfig: (config: GridConfig) => void
  setOrientationOverride: (override: OrientationOverride) => void
  /** auto → portrait → landscape → auto 循环 */
  cycleOrientationOverride: () => void
  resetOrientation: () => void
}

export const useAppStore = create<AppState>()((set) => ({
  view: 'home',
  gridConfig: PRESETS.small,
  orientationOverride: 'auto',
  setView: (view) => set({ view }),
  setGridConfig: (gridConfig) => set({ gridConfig }),
  setOrientationOverride: (orientationOverride) => set({ orientationOverride }),
  cycleOrientationOverride: () =>
    set((s) => ({
      orientationOverride:
        s.orientationOverride === 'auto'
          ? 'portrait'
          : s.orientationOverride === 'portrait'
            ? 'landscape'
            : 'auto',
    })),
  resetOrientation: () => set({ orientationOverride: 'auto' }),
}))
