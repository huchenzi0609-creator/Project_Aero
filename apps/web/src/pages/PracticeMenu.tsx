/**
 * PracticeMenu —— 练习模式页（v0.3.0）：四子模式入口 + 共用尺寸/AI 难度选择。
 *
 * - 经典 / 超快棋 / 盲棋：进入同一套「尺寸选择」界面（小/中/大 + AI 难度，
 *   难度读写 settingsStore，与「设置」页联动），确认后进入摆阵（view 'placement'）。
 * - 自定义：进入既有 CustomConfig（view 'custom'）。
 * - 超快棋 / 盲棋以配置标记 `blitz` / `blind` 写入 GridConfig（与 game-core 新字段同名），
 *   由 M4 单机流程读取生效。
 *
 * 组件既可直接由路由挂载（缺省返回主页），也可由 Home 内嵌（通过 onExit 回到 Home 面板）。
 */
import { useState } from 'react'
import { PRESETS } from '@aero/shared'
import type { GridConfig } from '@aero/shared'
import { useAppStore } from '../store/appStore'
import { DIFFICULTY_OPTIONS, useSettingsStore } from '../store/settingsStore'
import { PaperButton } from '../components/ui/PaperButton'
import { PaperSelect } from '../components/ui/PaperSelect'
import '../styles/v030.css'

type PracticeMode = 'classic' | 'blitz' | 'blind'
type SizeKey = 'small' | 'medium' | 'large'

const MODE_CARDS: ReadonlyArray<{
  key: PracticeMode | 'custom'
  label: string
  badge: string
  badgeClass: string
  sub: string
}> = [
  {
    key: 'classic',
    label: '经典模式',
    badge: '经',
    badgeClass: 'practice__badge--classic',
    sub: '常规对局：先摆阵，再随机先后手轮流报点。',
  },
  {
    key: 'blitz',
    label: '超快棋模式',
    badge: '快',
    badgeClass: 'practice__badge--blitz',
    sub: '开局倒计时 10×n 秒（3/5/7 架为 30/50/70 秒），超时判负。',
  },
  {
    key: 'blind',
    label: '盲棋模式',
    badge: '盲',
    badgeClass: 'practice__badge--blind',
    sub: '不记旧报点，禁用参考飞机与着色。',
  },
  {
    key: 'custom',
    label: '自定义模式',
    badge: '自',
    badgeClass: 'practice__badge--custom',
    sub: '自定棋盘尺寸与飞机形状，全部校验通过才可开战。',
  },
]

const SIZE_CARDS: ReadonlyArray<{ key: SizeKey; label: string; sub: string }> = [
  { key: 'small', label: '小型 · 10×10', sub: '3 架飞机 · 新手友好' },
  { key: 'medium', label: '中型 · 15×15', sub: '5 架飞机 · 标准体验' },
  { key: 'large', label: '大型 · 20×20', sub: '7 架飞机 · 持久战' },
]

const MODE_TITLES: Record<PracticeMode, string> = {
  classic: '经典模式',
  blitz: '超快棋模式',
  blind: '盲棋模式',
}

/** 模式 → 配置标记（超快棋 blitz / 盲棋 blind，可与经典互相独立组合） */
function modeFlags(mode: PracticeMode): { blitz?: boolean; blind?: boolean } {
  if (mode === 'blitz') return { blitz: true }
  if (mode === 'blind') return { blind: true }
  return {}
}

export function PracticeMenu({ onExit }: { onExit?: () => void }) {
  const setView = useAppStore((s) => s.setView)
  const setGridConfig = useAppStore((s) => s.setGridConfig)
  const setPlacementOrigin = useAppStore((s) => s.setPlacementOrigin)
  const difficulty = useSettingsStore((s) => s.difficulty)
  const setDifficulty = useSettingsStore((s) => s.setDifficulty)

  const [setup, setSetup] = useState<PracticeMode | null>(null)
  const [size, setSize] = useState<SizeKey>('small')

  const exit = () => (onExit ? onExit() : setView('home'))

  /** 经典 / 超快棋 / 盲棋：确认 → 写入配置（含 blitz/blind 标记）→ 进入摆阵 */
  const startPlacement = () => {
    if (!setup) return
    const extra = modeFlags(setup)
    const config: GridConfig = { ...PRESETS[size], ...extra }
    setGridConfig(config)
    setPlacementOrigin('single')
    setView('placement')
  }

  const goCustom = () => {
    setPlacementOrigin('custom')
    setView('custom')
  }

  /* ---------- 尺寸 + AI 难度选择（经典 / 超快棋 / 盲棋共用） ---------- */
  if (setup) {
    return (
      <div className="page practice">
        <PaperButton size="sm" variant="ghost" className="page__back" onClick={() => setSetup(null)}>
          ← 返回练习模式
        </PaperButton>
        <header className="page__head">
          <div>
            <h1 className="page__title">{MODE_TITLES[setup]}</h1>
            <p className="page__subtitle">选择棋盘大小与 AI 难度，进入摆阵对局。</p>
          </div>
        </header>
        <div className="page__body practice__setup">
          <div className="practice__size-cards" role="group" aria-label="棋盘大小">
            {SIZE_CARDS.map((s) => (
              <PaperButton
                key={s.key}
                variant={size === s.key ? 'primary' : 'default'}
                className="practice__size-card"
                aria-pressed={size === s.key}
                onClick={() => setSize(s.key)}
              >
                <span className="practice__size-label">{s.label}</span>
                <span className="practice__size-sub">{s.sub}</span>
              </PaperButton>
            ))}
          </div>

          <PaperSelect
            label="AI 难度"
            value={difficulty}
            onChange={setDifficulty}
            options={DIFFICULTY_OPTIONS}
          />
          <p className="practice__setup-note">AI 难度与「设置」页联动，双向同步保存。</p>

          <div className="practice__setup-foot">
            <PaperButton variant="ghost" onClick={exit}>
              返回主页
            </PaperButton>
            <PaperButton variant="primary" onClick={startPlacement}>
              开始摆阵
            </PaperButton>
          </div>
        </div>
      </div>
    )
  }

  /* ---------- 四子模式入口 ---------- */
  return (
    <div className="page practice">
      <PaperButton size="sm" variant="ghost" className="page__back" onClick={exit}>
        ← 返回主页
      </PaperButton>
      <header className="page__head">
        <div>
          <h1 className="page__title">练习模式</h1>
          <p className="page__subtitle">选择一种玩法，与电脑 AI 对战（单机）。</p>
        </div>
      </header>
      <div className="page__body practice__cards">
        {MODE_CARDS.map((m) => (
          <PaperButton
            key={m.key}
            variant="default"
            className="practice__mode-card"
            onClick={() => (m.key === 'custom' ? goCustom() : setSetup(m.key))}
          >
            <span className={['practice__badge', m.badgeClass].join(' ')} aria-hidden="true">
              {m.badge}
            </span>
            <span>
              <span className="practice__mode-label">{m.label}</span>
              <span className="practice__mode-sub">{m.sub}</span>
            </span>
          </PaperButton>
        ))}
      </div>
    </div>
  )
}
