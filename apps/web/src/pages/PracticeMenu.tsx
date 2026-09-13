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
import { DEFAULT_PLANE_SHAPE, PRESETS } from '@aero/shared'
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
  badgeClass: string
  sub: string
}> = [
  {
    key: 'classic',
    label: '经典模式',
    badgeClass: 'practice__badge--classic',
    sub: '无特殊规则，不限时。推荐新手尝试。',
  },
  {
    key: 'blitz',
    label: '超快棋模式',
    badgeClass: 'practice__badge--blitz',
    sub: '限时10*n秒，每步加一秒，超时判负。',
  },
  {
    key: 'blind',
    label: '盲棋模式',
    badgeClass: 'practice__badge--blind',
    sub: '仅显示最近3个报点，禁用参考与着色。难度较高，谨慎选择。',
  },
  {
    key: 'custom',
    label: '自定义模式',
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

/** 圆形徽标内图标尺寸（px；徽标 44px，四周留白，不触边框） */
const BADGE_ICON_SIZE = 26

/* ---------- 经典模式图标：真实默认飞机（DEFAULT_PLANE_SHAPE，4 行×5 列共 10 格） ----------
   按 shared 的 DEFAULT_PLANE_SHAPE.cells（编辑器 5×5 坐标：机头 1 格顶部居中、
   机翼 5 格整行、机身 1 格、机尾 3 格）逐格绘制等大小方格（格间细缝），
   忠实反映 4×5 结构；机头格加实心圆点座舱以示朝向。 */
const PLANE_GRID = {
  /** 每格边长 */
  cell: 3.4,
  /** 格间细缝 */
  gap: 0.9,
  /** 网格在 24×24 中的偏移：宽 5 格（20.6）、高 4 格（16.3），居中 */
  x0: 1.7,
  y0: 3.85,
}

/** 依 DEFAULT_PLANE_SHAPE 生成的格子矩形（含机头标注圆） */
const PLANE_GRID_CELLS = (() => {
  const { cell, gap, x0, y0 } = PLANE_GRID
  const pitch = cell + gap
  const rects = DEFAULT_PLANE_SHAPE.cells.map((p) => ({
    key: `${p.r}-${p.c}`,
    x: +(x0 + p.c * pitch).toFixed(3),
    y: +(y0 + p.r * pitch).toFixed(3),
  }))
  const head = DEFAULT_PLANE_SHAPE.head
  return { rects, headX: +(x0 + head.c * pitch + cell / 2).toFixed(3), headY: +(y0 + head.r * pitch + cell / 2).toFixed(3) }
})()

/** 闪电（超快棋，v0.3.9：瘦长版——窄于原版并上下加长） */
const ICON_ZAP_POINTS = '12.3 1.2 9.0 14.2 12 14.2 11.6 22.8 15.0 9.8 12 9.8 12.3 1.2'

/** 徽标图标：SVG 内联，颜色取徽标 currentColor（与既有配色一致） */
function ModeIcon({ kind }: { kind: PracticeMode | 'custom' }) {
  if (kind === 'blitz') {
    return (
      <svg width={BADGE_ICON_SIZE} height={BADGE_ICON_SIZE} viewBox="0 0 24 24" aria-hidden="true">
        <polygon points={ICON_ZAP_POINTS} fill="currentColor" />
      </svg>
    )
  }
  if (kind === 'classic') {
    return (
      <svg width={BADGE_ICON_SIZE} height={BADGE_ICON_SIZE} viewBox="0 0 24 24" aria-hidden="true">
        {/* 机身/机翼/机尾：真实 4×5 十格（格间细缝） */}
        {PLANE_GRID_CELLS.rects.map((r) => (
          <rect key={r.key} x={r.x} y={r.y} width={PLANE_GRID.cell} height={PLANE_GRID.cell} rx={0.8} fill="currentColor" />
        ))}
        {/* 机头座舱：中心深色圆点（以纸色镂空显示，强化朝上机头） */}
        <circle
          cx={PLANE_GRID_CELLS.headX}
          cy={PLANE_GRID_CELLS.headY}
          r={1.05}
          fill="var(--paper-sheet-2)"
        />
      </svg>
    )
  }
  if (kind === 'blind') {
    return (
      <svg
        width={BADGE_ICON_SIZE}
        height={BADGE_ICON_SIZE}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {/* 眼睛轮廓 */}
        <path d="M3 12 C5.6 6.9 9.6 5.6 12 5.6 C14.4 5.6 18.4 6.9 21 12 C18.4 17.1 14.4 18.4 12 18.4 C9.6 18.4 5.6 17.1 3 12 Z" />
        {/* 瞳孔 */}
        <circle cx="12" cy="12" r="2.7" fill="currentColor" stroke="none" />
        {/* 斜杠（不可视） */}
        <path d="M4.8 19.2 L19.2 4.8" strokeWidth={2.4} />
      </svg>
    )
  }
  if (kind === 'custom') {
    return (
      <svg
        width={BADGE_ICON_SIZE}
        height={BADGE_ICON_SIZE}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.6}
        strokeLinecap="round"
        aria-hidden="true"
      >
        <path d="M12 5 v14 M5 12 h14" />
      </svg>
    )
  }
  // classic：默认飞机俯视轮廓（见上方 classic 分支；此兜底不应到达）
  return (
    <svg width={BADGE_ICON_SIZE} height={BADGE_ICON_SIZE} viewBox="0 0 24 24" aria-hidden="true" />
  )
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
              <ModeIcon kind={m.key} />
            </span>
            <span className="practice__mode-text">
              <span className="practice__mode-label">{m.label}</span>
              <span className="practice__mode-sub">{m.sub}</span>
            </span>
          </PaperButton>
        ))}
      </div>
    </div>
  )
}
