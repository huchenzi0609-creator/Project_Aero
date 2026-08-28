/**
 * appStore —— 当前视图路由 + 对局配置 + 横竖版手动覆盖。
 */
import { create } from 'zustand'
import type { GridConfig } from '@aero/shared'
import { PRESETS } from '@aero/shared'

export type View = 'home' | 'single' | 'custom' | 'settings' | 'rules' | 'online' | 'placement' | 'game'
export type OrientationOverride = 'auto' | 'landscape' | 'portrait'

interface AppState {
  view: View
  /** 进入摆阵/对局时携带的棋盘配置 */
  gridConfig: GridConfig
  /** 摆阵页"返回"时回到的来源（单机菜单 / 自定义配置） */
  placementOrigin: 'single' | 'custom'
  orientationOverride: OrientationOverride
  setView: (view: View) => void
  setGridConfig: (config: GridConfig) => void
  setPlacementOrigin: (origin: 'single' | 'custom') => void
  setOrientationOverride: (override: OrientationOverride) => void
  /** auto → portrait → landscape → auto 循环 */
  cycleOrientationOverride: () => void
  resetOrientation: () => void
}

export const useAppStore = create<AppState>()((set) => ({
  view: 'home',
  gridConfig: PRESETS.small,
  placementOrigin: 'single',
  orientationOverride: 'auto',
  setView: (view) => set({ view }),
  setGridConfig: (gridConfig) => set({ gridConfig }),
  setPlacementOrigin: (placementOrigin) => set({ placementOrigin }),
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
