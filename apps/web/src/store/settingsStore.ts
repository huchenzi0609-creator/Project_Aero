/**
 * settingsStore —— 音量 / 反转 X 与 O / AI 难度，localStorage 持久化。
 */
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { Difficulty } from '@aero/shared'

export const DIFFICULTY_OPTIONS: ReadonlyArray<{ value: Difficulty; label: string; description: string }> = [
  { value: 'easy', label: '简单', description: '随机乱射，偶尔“忘记”己方命中。' },
  { value: 'normal', label: '正常', description: '命中后围杀相邻四格。' },
  { value: 'hard', label: '困难', description: '全局概率热图，会绕开你已知的残骸。' },
  { value: 'hell', label: '地狱', description: '还会学习你的布阵习惯。' },
]

interface SettingsState {
  bgmVolume: number // 0..1
  sfxVolume: number // 0..1
  invertMarks: boolean
  difficulty: Difficulty
  /** 是否允许在对局中拖拽移动样式参考飞机；旧存档缺省时视为 true */
  allowMoveRefPlane: boolean
  setBgmVolume: (v: number) => void
  setSfxVolume: (v: number) => void
  toggleInvertMarks: () => void
  setDifficulty: (d: Difficulty) => void
  toggleAllowMoveRefPlane: () => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      bgmVolume: 0.5,
      sfxVolume: 0.7,
      invertMarks: false,
      difficulty: 'normal',
      allowMoveRefPlane: true,
      setBgmVolume: (bgmVolume) => set({ bgmVolume }),
      setSfxVolume: (sfxVolume) => set({ sfxVolume }),
      toggleInvertMarks: () => set((s) => ({ invertMarks: !s.invertMarks })),
      setDifficulty: (difficulty) => set({ difficulty }),
      toggleAllowMoveRefPlane: () => set((s) => ({ allowMoveRefPlane: !s.allowMoveRefPlane })),
    }),
    {
      name: 'aero-settings',
      storage: createJSONStorage(() => localStorage),
      // 旧存档（无 allowMoveRefPlane 字段）合并后取默认 true，保证新增开关默认开
      merge: (persisted, current) => ({
        ...current,
        ...(persisted as Partial<SettingsState>),
        allowMoveRefPlane: (persisted as Partial<SettingsState> | null)?.allowMoveRefPlane ?? true,
      }),
    },
  ),
)
