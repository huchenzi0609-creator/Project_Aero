/**
 * TutorialEntry —— 新手教程宿主（v0.3.13，三单元流程）。
 *
 * 由 Home「新手教程」按钮以面板形式挂载（App view 恒为 home，教程内不触发页面级导航）：
 * - entry：入口弹窗 P1/P2 ——「还不了解」进单元1（辨认飞机）；「我已了解」跳到单元2（摆阵）；
 * - unit1（单元1 · 辨认飞机和基本操作）：纯练习（3 个演示场景）；
 * - placement（单元2 · 初次实战·摆阵）：摆阵并确认 → 阵型传入单元3；
 * - battle（单元3 · 初次实战·对局）：经典对局（我方先手、AI 避机头、1s 间隔）→ 完成弹窗。
 * 结束（返回主页 / 完成教程）→ 清对局并回 Home 面板。
 */
import { useState } from 'react'
import type { PlacedPlane } from '@aero/shared'
import { PRESETS } from '@aero/shared'
import { generateFleet, mulberry32 } from '@aero/game-core/ai'
import { useGameStore } from '../store/gameStore'
import { useSettingsStore } from '../store/settingsStore'
import { useEffectiveOrientation } from '../hooks/useOrientation'
import { PaperButton } from '../components/ui/PaperButton'
import { PaperModal } from '../components/ui/PaperModal'
import { TutorialPlacement } from '../tutorial/TutorialPlacement'
import { TutorialBattle } from '../tutorial/TutorialBattle'
import { Unit1Practice } from '../tutorial/Unit1Practice'
import '../styles/tutorial.css'

export type TutorialStage = 'entry' | 'unit1' | 'placement' | 'battle'

export function TutorialEntry({ onExit }: { onExit: () => void }) {
  const orientation = useEffectiveOrientation()
  const resetGame = useGameStore((s) => s.reset)
  const [stage, setStage] = useState<TutorialStage>('entry')
  const [entryOpen, setEntryOpen] = useState(true)
  // 单元1 → 单元2 阵型传递
  const [fleet, setFleet] = useState<PlacedPlane[] | null>(null)

  /** 结束教程并回主页（清对局） */
  const exitAll = () => {
    resetGame()
    onExit()
  }

  // 单元2 → 单元3：阵型不足时按小档规格随机补齐，保证 3 架开局
  const onPlacementDone = (planes: PlacedPlane[]) => {
    const cfg = PRESETS.small
    let full = planes
    if (full.length < cfg.planeCount) {
      const diff = useSettingsStore.getState().difficulty
      const rng = mulberry32(((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0) || 1)
      try {
        full = generateFleet(cfg.width, cfg.height, cfg.planeCount, cfg.shape, diff, rng)
      } catch {
        full = planes
      }
    }
    setFleet(full)
    setStage('battle')
  }

  /* ---------- 阶段渲染 ---------- */

  if (stage === 'unit1') {
    return <Unit1Practice onExitHome={exitAll} onDone={() => setStage('placement')} />
  }
  if (stage === 'placement') {
    return <TutorialPlacement onDone={onPlacementDone} onExitHome={exitAll} />
  }
  if (stage === 'battle') {
    // 开局前清账由 TutorialBattle 自身完成（不在渲染期调用 store）
    return <TutorialBattle fleet={fleet} onExitHome={exitAll} />
  }

  /* ---------- 入口（欢迎页 + P1/P2 弹窗，进入即询问） ---------- */

  return (
    <div className={`page tutorial-home tutorial-home--${orientation}`}>
      <header className="page__head">
        <PaperButton size="sm" variant="ghost" onClick={onExit}>
          ← 返回主页
        </PaperButton>
        <h1 className="page__title">新手教程</h1>
      </header>
      <div className="page__body tutorial-home__body">
        <ul className="tutorial-home__list">
          <li>单元1 · 辨认飞机和基本操作</li>
          <li>单元2 · 初次实战·摆阵</li>
          <li>单元3 · 初次实战·对局</li>
        </ul>
        {entryOpen ? null : (
          <PaperButton variant="primary" onClick={() => setEntryOpen(true)}>
            开始教程
          </PaperButton>
        )}
      </div>

      {/* 入口弹窗（P1/P2）。教程加固不变量：弹窗打开期间教程层不得渲染 `.tutorial-block`
          阻断带/暗层。本组件不持有 spotlight 等覆盖层（单元1/2/3 的覆盖层在各自子组件内，
          且子组件仅在 entryOpen=false 且已切 stage 后挂载），且 TutorialSpotlight 内部
          以 useAnyModalOpen 兜底，故入口弹窗期间阻断带恒为 0。 */}
      <PaperModal
        open={entryOpen}
        title="新手教程"
        onClose={() => setEntryOpen(false)}
        footer={
          <>
            {/* P2：我已了解 → 直达进阶·单元3；还不了解 → 基础·单元1 */}
            <PaperButton
              variant="ghost"
              onClick={() => {
                setEntryOpen(false)
                setStage('placement')
              }}
            >
              我已了解
            </PaperButton>
            <PaperButton
              variant="primary"
              onClick={() => {
                setEntryOpen(false)
                setStage('unit1')
              }}
            >
              还不了解
            </PaperButton>
          </>
        }
      >
        <p style={{ margin: 0 }}>您是否了解本游戏的基本规则？</p>
      </PaperModal>
    </div>
  )
}
