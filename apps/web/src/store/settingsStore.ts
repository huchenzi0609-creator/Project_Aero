/**
 * settingsStore —— 音量 / 反转 X 与 O / AI 难度 / 参考飞机 / 快捷着色，localStorage 持久化。
 */
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { Difficulty } from '@aero/shared'

export const DIFFICULTY_OPTIONS: ReadonlyArray<{ value: Difficulty; label: string; description: string }> = [
  { value: 'easy', label: '简单', description: '随机乱射，偶尔“忘记”己方命中。' },
  { value: 'normal', label: '正常', description: '命中后围杀相邻四格。' },
  { value: 'hard', label: '困难', description: '全局概率热图，会绕开你已知的残骸。' },
  { value: 'hell', label: '地狱', description: '机头概率热图 + 斩首式报点，强度显著高于困难。' },
]

interface SettingsState {
  bgmVolume: number // 0..1
  sfxVolume: number // 0..1
  invertMarks: boolean
  difficulty: Difficulty
  /** 是否允许在对局中拖拽移动样式参考飞机；旧存档缺省时视为 true */
  allowMoveRefPlane: boolean
  /** 快捷着色（v0.3.0）：着色模式点击幽灵飞机 = 整架批量着色并回收幽灵；旧存档缺省视为 true */
  quickColor: boolean
  setBgmVolume: (v: number) => void
  setSfxVolume: (v: number) => void
  toggleInvertMarks: () => void
  setDifficulty: (d: Difficulty) => void
  toggleAllowMoveRefPlane: () => void
  toggleQuickColor: () => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      bgmVolume: 0.5,
      sfxVolume: 0.7,
      invertMarks: false,
      difficulty: 'normal',
      allowMoveRefPlane: true,
      quickColor: true,
      setBgmVolume: (bgmVolume) => set({ bgmVolume }),
      setSfxVolume: (sfxVolume) => set({ sfxVolume }),
      toggleInvertMarks: () => set((s) => ({ invertMarks: !s.invertMarks })),
      setDifficulty: (difficulty) => set({ difficulty }),
      toggleAllowMoveRefPlane: () => set((s) => ({ allowMoveRefPlane: !s.allowMoveRefPlane })),
      toggleQuickColor: () => set((s) => ({ quickColor: !s.quickColor })),
    }),
    {
      name: 'aero-settings',
      storage: createJSONStorage(() => localStorage),
      // 旧存档（无 allowMoveRefPlane / quickColor 字段）合并后取默认 true，保证新增开关默认开
      merge: (persisted, current) => ({
        ...current,
        ...(persisted as Partial<SettingsState>),
        allowMoveRefPlane: (persisted as Partial<SettingsState> | null)?.allowMoveRefPlane ?? true,
        quickColor: (persisted as Partial<SettingsState> | null)?.quickColor ?? true,
      }),
    },
  ),
)
