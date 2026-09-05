/**
 * TutorialEntry —— 新手教程宿主（v0.3.0）。
 *
 * 由 Home「新手教程」按钮以面板形式挂载（App view 恒为 home，教程内不触发页面级导航）：
 * - entry：入口弹窗 P1/P2 ——「还没有」进单元1 摆阵；「是的」直达进阶单元3；
 * - placement（单元1）：摆阵教程，确认/跳过后把玩家阵型传入单元2；
 * - basic（单元2）：对战教程（沿用单元1 阵型）→ 胜利弹 P3；
 * - advanced（单元3）：工具教程（残局对局）→ 完成弹 P5。
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
import '../styles/tutorial.css'

export type TutorialStage = 'entry' | 'placement' | 'basic' | 'advanced'

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

  // 单元1 → 单元2：阵型不足（跳过摆阵）时按小档规格随机补齐，保证 3 架开局
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
    setStage('basic')
  }

  // 单元2 P4「继续教程」→ 单元3
  const goAdvanced = () => {
    resetGame()
    setStage('advanced')
  }

  /* ---------- 阶段渲染 ---------- */

  if (stage === 'placement') {
    return <TutorialPlacement onDone={onPlacementDone} onExitHome={exitAll} />
  }
  if (stage === 'basic' || stage === 'advanced') {
    return (
      <TutorialBattle
        key={stage}
        variant={stage}
        fleet={stage === 'basic' ? fleet : null}
        onExitHome={exitAll}
        onGoAdvanced={goAdvanced}
      />
    )
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
          <li>基础 · 摆阵与对战：约 2 分钟</li>
          <li>进阶 · 对局工具：约 3 分钟</li>
        </ul>
        {entryOpen ? null : (
          <PaperButton variant="primary" onClick={() => setEntryOpen(true)}>
            开始教程
          </PaperButton>
        )}
      </div>

      <PaperModal
        open={entryOpen}
        title="新手教程"
        onClose={() => setEntryOpen(false)}
        footer={
          <>
            {/* P2：我已了解 → 返回主页（跳过教程）；还不了解 → 进入基础·单元1 */}
            <PaperButton variant="ghost" onClick={exitAll}>
              我已了解
            </PaperButton>
            <PaperButton
              variant="primary"
              onClick={() => {
                setEntryOpen(false)
                setStage('placement')
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
