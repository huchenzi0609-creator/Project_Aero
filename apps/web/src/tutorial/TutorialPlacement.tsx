/**
 * TutorialPlacement —— 教程单元1：摆阵（v0.3.0，手稿 T1-1~T1-7）。
 *
 * 复用 FleetPlacementBoard 的全部摆阵交互与校验（与真实 Placement 同 UI），
 * 事件语义与 Placement 一致（planePlaced / planeRotated / allPlanesPlaced / formationValid）。
 * 确认后把玩家所摆阵型回调父级（TutorialEntry 沿用到单元2），本页不做游戏开局导航。
 */
import { useEffect, useRef, useState } from 'react'
import type { PlacedPlane } from '@aero/shared'
import { useEffectiveOrientation } from '../hooks/useOrientation'
import { useToastStore } from '../store/toastStore'
import { useGameStore } from '../store/gameStore'
import { useAppStore } from '../store/appStore'
import { PaperButton } from '../components/ui/PaperButton'
import { FleetPlacementBoard, fleetCheckState } from '../components/placement/FleetPlacementBoard'
import { useSteps } from './stepMachine'
import type { TutorialStep } from './stepMachine'
import { TutorialBubble } from './TutorialBubble'
import { TutorialSpotlight } from './TutorialSpotlight'
import '../styles/tutorial.css'

const T1_STEPS: TutorialStep[] = [
  { key: 't11', text: ['欢迎来到《飞机杀》！我们先来学习如何摆阵吧！'], highlight: 'bubble' },
  { key: 't12', text: ['这是飞机待选栏，可以从这里把飞机拖到网格中。'], highlight: '.placement__tray' },
  { key: 't13', text: ['现在就试试看吧！把飞机拖到网格里！'], wait: 'planePlaced' },
  { key: 't14', text: ['好极了！现在尝试把剩余的飞机全部拖到网格里！'] },
  { key: 't15', text: [], wait: 'allPlanesPlaced' },
  { key: 't16', text: ['单击飞机可以使飞机旋转90度，试试看！'], wait: 'planeRotated' },
  { key: 't17', text: ['太棒了！确保你的飞机不重叠不越界之后，就可以开始游戏了！'] },
  { key: 't18', text: ['点击“确认布阵”开始游戏'], highlight: '.tutorial-confirm' },
]

export function TutorialPlacement({
  onDone,
  onExitHome,
}: {
  onDone: (fleet: PlacedPlane[]) => void
  /** 退出/跳过→回主页（A5：统一由宿主 TutorialEntry 收口，避免误回废弃页面） */
  onExitHome: () => void
}) {
  const orientation = useEffectiveOrientation()
  const config = useAppStore((s) => s.gridConfig)
  const toast = useToastStore((s) => s.push)
  const resetGame = useGameStore((s) => s.reset)
  const { width, height, planeCount } = config

  const [grid, setGrid] = useState<PlacedPlane[]>([])
  const step = useSteps(T1_STEPS)

  /* ---------- 事件桥（与 Placement 一致的增量语义） ---------- */
  const prevGridRef = useRef<PlacedPlane[]>(grid)
  const handlePlanesChange = (next: PlacedPlane[]) => {
    const prev = prevGridRef.current
    if (next.length - prev.length === 1) {
      const added = next.find((p) => !prev.some((q) => q.id === p.id))
      if (added) step.dispatch({ type: 'planePlaced', planeId: added.id })
    }
    if (next.length - prev.length <= 1) {
      const prevRot = new Map(prev.map((p) => [p.id, p.rotation]))
      for (const np of next) {
        const pr = prevRot.get(np.id)
        if (pr !== undefined && pr !== np.rotation) step.dispatch({ type: 'planeRotated', planeId: np.id })
      }
    }
    prevGridRef.current = next
    setGrid(next)
  }

  const prevFullRef = useRef(grid.length === planeCount)
  useEffect(() => {
    const full = grid.length === planeCount
    if (full && !prevFullRef.current) step.dispatch({ type: 'allPlanesPlaced' })
    prevFullRef.current = full
  }, [grid.length, planeCount, step])

  const check = fleetCheckState(grid, config)
  const prevValidRef = useRef(check.ok)
  useEffect(() => {
    if (check.ok && !prevValidRef.current) step.dispatch({ type: 'formationValid' })
    prevValidRef.current = check.ok
  }, [check.ok, step])

  const confirm = () => {
    if (!check.ok) {
      toast('摆阵未通过：请确保数量/越界/重叠校验全部通过', 'error')
      return
    }
    onDone(grid)
  }

  // 首页返回 = 退出教程（对局未开，直接回主页）
  const exit = () => {
    resetGame()
    onExitHome()
  }

  // 突显目标映射：'bubble' = 气泡自身；确认步（t18）仅在阵形合法后点亮（B3 突显语义）
  const rawHighlight = step.index >= 0 && step.step?.highlight ? step.step.highlight : null
  const highlight =
    rawHighlight === '.tutorial-confirm' && !check.ok ? null : rawHighlight === 'bubble' ? '.tutorial-bubble' : rawHighlight
  const showBubble = step.index >= 0 && step.segments.length > 0
  const segText = showBubble ? (step.segments[Math.min(step.seg, step.segments.length - 1)] ?? '') : ''
  // A6：仅纯文本步（无 wait）显示「点击继续」
  const stepWait = Boolean(step.step?.wait)

  return (
    <div className={`placement placement--${orientation}`}>
      <header className="placement__head">
        <PaperButton size="sm" variant="ghost" onClick={exit}>
          ← 退出教程
        </PaperButton>
        <div>
          <h1 className="page__title" style={{ fontSize: 22 }}>
            新手教程 · 摆阵
          </h1>
          <p className="page__subtitle" style={{ fontSize: 13 }}>
            {width}×{height} · {planeCount} 架飞机
          </p>
        </div>
        <div className="placement__controls">
          <PaperButton
            size="sm"
            variant="primary"
            className={['tutorial-confirm', check.ok ? '' : 'placement__confirm--pending'].join(' ')}
            disabled={!check.ok}
            onClick={confirm}
          >
            确认布阵
          </PaperButton>
        </div>
      </header>

      <FleetPlacementBoard
        config={config}
        planes={grid}
        onPlanesChange={handlePlanesChange}
        portraitChromeReserve={345}
      />

      <footer className="placement__foot">
        <span className="placement__status" role="status" aria-live="polite">
          {check.ok ? '校验通过，可以确认布阵！' : `已摆放 ${grid.length} / ${planeCount} 架`}
        </span>
      </footer>

      {/* 教程层 */}
      <TutorialSpotlight target={highlight} />
      {showBubble && step.step ? (
        <TutorialBubble
          key={`${step.step.key}-${step.seg}`}
          text={segText}
          showHint={!stepWait}
          onClick={() => step.click()}
          skipLabel="跳过单元"
          onSkip={() => onDone(grid)} // 跳过摆阵：以当前（可能部分）阵型容错——不足则父级随机补齐
        />
      ) : null}
    </div>
  )
}
