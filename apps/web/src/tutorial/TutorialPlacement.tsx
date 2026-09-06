/**
 * TutorialPlacement —— 教程单元1：摆阵（v0.3.3，按最新手稿 T1-1~T1-7 重做）。
 *
 * 复用 FleetPlacementBoard 摆阵交互与校验；组件级小驱动（click / wait 两类节点）：
 * - T1-1 突显对话气泡（点击推进）→ T1-2 突显待选栏（点击推进）→
 * - T1-3 拖入第 1 架（wait planePlaced，无 hint、点击不消失）→
 * - T1-4 拖完剩余（wait allPlanesPlaced，文本常驻）→
 * - T1-5 旋转引导（先突显气泡，点击翻段后切突显空网格、文本保持、wait planeRotated）→
 * - T1-6/7 final 阶段随阵形合法性派生：合法 → 高亮确认布阵 + 确认文案；非法 → "飞机不能重叠、不能越界哦！"
 *   持续非法持续显示；转合法立即切换；点击「确认布阵」→ 沿玩家阵型进单元2。
 * 气泡持久性（§7.4）：wait 节点文本常驻、点击不消失、无「点击继续」。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { PlacedPlane } from '@aero/shared'
import { PRESETS } from '@aero/shared'
import { useEffectiveOrientation } from '../hooks/useOrientation'
import { useToastStore } from '../store/toastStore'
import { PaperButton } from '../components/ui/PaperButton'
import { PaperModal } from '../components/ui/PaperModal'
import { FleetPlacementBoard, fleetCheckState } from '../components/placement/FleetPlacementBoard'
import { TutorialBubble } from './TutorialBubble'
import { TutorialSpotlight } from './TutorialSpotlight'
import type { TutorialGameEvent } from './events'
import '../styles/tutorial.css'

const T1 = {
  welcome: '欢迎来到《飞机杀》！我们先来学习如何摆阵吧！',
  tray: '这是飞机待选栏，可以从这里把飞机拖到网格中。',
  drag: '现在就试试看吧！把飞机拖到网格里！',
  more: '好极了！现在尝试把剩余的飞机全部拖到网格里！',
  rotate: '单击飞机可以使飞机旋转90度，试试看！',
  thanks: '太棒了！确保你的飞机不重叠不越界之后，就可以开始游戏了！',
  confirm: '点击“确认布阵”开始游戏',
  invalid: '飞机不能重叠、不能越界哦！',
}

type Phase = 'welcome' | 'tray' | 'drag' | 'more' | 'rotateHint' | 'rotateWait' | 'thanks' | 'detect'

export function TutorialPlacement({
  onDone,
  onExitHome,
}: {
  onDone: (fleet: PlacedPlane[]) => void
  /** 退出/跳过 → 回主页（统一由宿主 TutorialEntry 收口） */
  onExitHome: () => void
}) {
  const orientation = useEffectiveOrientation()
  // v0.3.6：教程摆阵固定 10×10（PRESETS.small），与全局/自定义配置解耦
  const config = useMemo(() => ({ ...PRESETS.small }), [])
  const toast = useToastStore((s) => s.push)
  const { width, height, planeCount } = config

  const [grid, setGrid] = useState<PlacedPlane[]>([])
  const versionRef = useRef(0)
  const thanksCauseRef = useRef<number | null>(null)
  const [phase, setPhase] = useState<Phase>('welcome')
  const [skipOpen, setSkipOpen] = useState(false)
  const [exitOpen, setExitOpen] = useState(false)
  const [, force] = useState(0)
  const phaseRef = useRef<Phase>('welcome')
  const setPh = (p: Phase) => {
    phaseRef.current = p
    segIdxRef.current = 0
    setPhase(p)
  }

  const check = fleetCheckState(grid, config)

  /* ---------- 事件桥（与 Placement 一致的增量语义） ---------- */
  const prevGridRef = useRef<PlacedPlane[]>(grid)
  const handlePlanesChange = (next: PlacedPlane[]) => {
    versionRef.current += 1
    const prev = prevGridRef.current
    if (next.length - prev.length === 1) {
      const added = next.find((p) => !prev.some((q) => q.id === p.id))
      if (added) dispatchEvent({ type: 'planePlaced', planeId: added.id })
    }
    if (next.length - prev.length <= 1) {
      const prevRot = new Map(prev.map((p) => [p.id, p.rotation]))
      for (const np of next) {
        const pr = prevRot.get(np.id)
        if (pr !== undefined && pr !== np.rotation) dispatchEvent({ type: 'planeRotated', planeId: np.id })
      }
    }
    prevGridRef.current = next
    setGrid(next)
  }

  const prevFullRef = useRef(false)
  useEffect(() => {
    const full = grid.length === planeCount
    if (full && !prevFullRef.current) dispatchEvent({ type: 'allPlanesPlaced' })
    prevFullRef.current = full
  }, [grid.length, planeCount])

  // T1-6/7：旋转完成后的 thanks 常驻展示期，玩家再次挪动/旋转（下一次网格变化）→ 进入合法性检测
  useEffect(() => {
    if (phaseRef.current === 'thanks' && versionRef.current > (thanksCauseRef.current ?? Infinity)) {
      setPh('detect')
    }
  }, [grid])

  /** 事件 → 阶段推进（wait 节点：事件到达才离开；期间气泡常驻） */
  const dispatchEvent = (e: TutorialGameEvent) => {
    const cur = phaseRef.current
    if (cur === 'drag' && e.type === 'planePlaced') setPh('more')
    else if (cur === 'more' && e.type === 'allPlanesPlaced') setPh('rotateHint')
    else if (cur === 'rotateWait' && e.type === 'planeRotated') {
      thanksCauseRef.current = versionRef.current
      setPh('thanks')
    }
  }

  /** 气泡点击：click 节点推进；wait/thanks/detect 仅翻段不消失 */
  const clickBubble = () => {
    const cur = phaseRef.current
    if (cur === 'welcome') setPh('tray')
    else if (cur === 'tray') setPh('drag')
    else if (cur === 'rotateHint') setPh('rotateWait')
    // 其余（drag/more/rotateWait/thanks/detect）：点击仅翻段，不消失
    force((x) => x + 1)
  }

  const confirm = () => {
    if (!check.ok) {
      toast('摆阵未通过：请确保数量/越界/重叠校验全部通过', 'error')
      return
    }
    onDone(grid)
  }

  /* ---------- 展示派生 ---------- */

  // 阶段文本 / 是否可点击推进（click 节点显示「点击继续」）
  const segsOf = (p: Phase): string[] => {
    if (p === 'welcome') return [T1.welcome]
    if (p === 'tray') return [T1.tray]
    if (p === 'drag') return [T1.drag]
    if (p === 'more') return [T1.more]
    if (p === 'rotateHint') return [T1.rotate]
    if (p === 'rotateWait') return [T1.rotate]
    if (p === 'thanks') return [T1.thanks]
    if (p === 'detect') return check.ok ? [T1.confirm] : [T1.invalid]
    return []
  }
  const isClickNode = phase === 'welcome' || phase === 'tray' || phase === 'rotateHint'
  const segments = segsOf(phase)
  const segIdxRef = useRef(0)

  if (segments.length === 0) segIdxRef.current = 0
  const segIdx = Math.min(segIdxRef.current, segments.length - 1)
  const segText = segments.length > 0 ? (segments[segIdx] ?? '') : ''
  const clickSeg = () => {
    if (segIdxRef.current + 1 < segments.length) {
      segIdxRef.current += 1
      force((x) => x + 1)
      return
    }
    clickBubble()
  }

  // 突显目标：'bubble'=气泡自身（welcome/rotateHint）；tray；棋盘（rotateWait 引导旋转）；
  // detect 合法 → 确认按钮（随合法性即时切换）；非法 → 无突显（页面全亮）；thanks 无突显
  const highlightFor = (p: Phase): string | null => {
    if (p === 'welcome' || p === 'rotateHint') return '.tutorial-bubble'
    if (p === 'tray') return '.placement__tray'
    if (p === 'rotateWait') return '.placement__board-wrap'
    if (p === 'detect') return check.ok ? '.tutorial-confirm' : null
    return null
  }
  const highlight = highlightFor(phase)

  const exit = () => {
    setExitOpen(true)
  }
  const confirmExit = () => {
    setExitOpen(false)
    onExitHome()
  }

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

      {/* 教程层（detect 非法 → highlight null → 无遮罩全亮）；「点击继续」仅 click 节点显示 */}
      <TutorialSpotlight target={highlight} />
      {segments.length > 0 ? (
        <TutorialBubble
          key={`${phase}-${segIdx}-${highlight ?? 'none'}`}
          text={segText}
          showHint={isClickNode}
          onClick={clickSeg}
          skipLabel="跳过单元"
          onSkip={() => setSkipOpen(true)}
        />
      ) : null}

      {/* 退出确认（确认 → 回主页；不进任何旧页面） */}
      <PaperModal
        open={exitOpen}
        title="退出教程？"
        onClose={() => setExitOpen(false)}
        footer={
          <>
            <PaperButton variant="ghost" onClick={() => setExitOpen(false)}>
              继续摆阵
            </PaperButton>
            <PaperButton variant="danger" onClick={confirmExit}>
              确认退出
            </PaperButton>
          </>
        }
      >
        <p style={{ margin: 0 }}>退出后摆阵进度将丢失，确认离开教程吗？</p>
      </PaperModal>

      {/* 跳过确认：确认 = 以当前阵型跳入单元2（不足父级随机补齐） */}
      <PaperModal
        open={skipOpen}
        title="新手教程"
        onClose={() => setSkipOpen(false)}
        footer={
          <>
            <PaperButton variant="ghost" onClick={() => setSkipOpen(false)}>
              取消
            </PaperButton>
            <PaperButton
              variant="danger"
              onClick={() => {
                setSkipOpen(false)
                onDone(grid)
              }}
            >
              确认
            </PaperButton>
          </>
        }
      >
        <p style={{ margin: 0 }}>确认跳过当前单元？</p>
      </PaperModal>
    </div>
  )
}
