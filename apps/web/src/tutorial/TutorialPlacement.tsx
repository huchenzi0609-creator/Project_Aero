/**
 * TutorialPlacement —— 教程·单元2「初次实战·摆阵」（v0.3.13 重写）。
 *
 * 10×10 / 3 架，复用 FleetPlacementBoard 的拖拽、旋转与合法性校验。组件级小驱动：
 *   1) 4 段开场气泡（整屏压暗突出气泡，点击逐段读毕）→ 取消突显 + 突显待选栏
 *      「这是飞机待选栏，可以从这里把飞机拖到网格中。」→ 突显我方网格
 *      「现在就试试看吧！把飞机拖到网格里！」
 *   2) 拖入第 1 架 → <成功提示> +「好极了！现在尝试把剩余的飞机全部拖到网格里！」（续拖）
 *   3) 全部入格 → <成功提示> + 突显气泡「单击飞机可以使飞机旋转90度，试试看！」（点击读毕
 *      → 取消突显 + 突显空网格，等待旋转）
 *   4) 旋转 →「太棒了！确保你的飞机不重叠不越界之后，就可以开始游戏了！」（常驻）
 *   5) 阵形变动 → 合法性判定：合法 = 突显「确认布阵」+「点击“确认布阵”开始游戏」；
 *      非法 =「飞机不能重叠、不能越界哦！」（持续非法持续显示）
 *   6) 点击「确认布阵」→ 携带阵型进入单元3。
 *
 * 突显为模态（非突显区域不可交互），故需要拖拽/旋转的步骤一律同时突显
 * 【待选栏 + 网格】；左上角「退出教程」用 `.tutorial-escape` 保持可点。
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
import { TutorialFxBand, useTutorialFx } from './TutorialFx'
import { useAnyModalOpen } from './useAnyModalOpen'
import type { TutorialGameEvent } from './events'
import '../styles/tutorial.css'

/** 开场 4 段（手稿逐字文案，`*…*` 为强调记号） */
const WELCOME = [
  '很好！接下来我们即将进入实战！',
  '首先要做的一件事是*摆阵*！',
  '对手将尝试破解我方阵型，我们需要在那之前抢先破解对方的阵型！',
  '在真实对局中，一个好的阵型可以充分地迷惑对手，为我方取得优势！',
]

const T2 = {
  tray: '这是飞机待选栏，可以从这里把飞机拖到网格中。',
  drag: '现在就试试看吧！把飞机拖到网格里！',
  more: '好极了！现在尝试把剩余的飞机全部拖到网格里！',
  rotate: '单击飞机可以使飞机旋转90度，试试看！',
  thanks: '太棒了！确保你的飞机不重叠不越界之后，就可以开始游戏了！',
  confirm: '点击“确认布阵”开始游戏',
  invalid: '飞机不能重叠、不能越界哦！',
}

/** 需要同时可交互的拖拽区（模态突显下非突显区域不可点） */
const DRAG_HL = ['.placement__tray', '.placement__board-wrap']

type Phase = 'welcome' | 'tray' | 'drag' | 'more' | 'rotateWait' | 'thanks' | 'detect'

export function TutorialPlacement({
  onDone,
  onExitHome,
}: {
  onDone: (fleet: PlacedPlane[]) => void
  /** 退出 → 回主页（统一由宿主 TutorialEntry 收口） */
  onExitHome: () => void
}) {
  const orientation = useEffectiveOrientation()
  // 教程摆阵固定 10×10（PRESETS.small），与全局/自定义配置解耦
  const config = useMemo(() => ({ ...PRESETS.small }), [])
  const toast = useToastStore((s) => s.push)
  const { fx, flash } = useTutorialFx()
  const { width, height, planeCount } = config

  const [grid, setGrid] = useState<PlacedPlane[]>([])
  const versionRef = useRef(0)
  const thanksCauseRef = useRef<number | null>(null)
  const [phase, setPhase] = useState<Phase>('welcome')
  const [exitOpen, setExitOpen] = useState(false)
  const [segIdx, setSegIdx] = useState(0)
  const [, force] = useState(0)
  /** 弹窗门控：自身退出确认 + 任何已打开弹窗（纵深防护，阻断带/暗层/气泡一律不渲染）。
   *  注意：useAnyModalOpen 必须先无条件调用（hooks 顺序稳定），再与自身状态合并。 */
  const domModalOpen = useAnyModalOpen()
  const modalOpen = exitOpen || domModalOpen
  const phaseRef = useRef<Phase>('welcome')
  const setPh = (p: Phase) => {
    phaseRef.current = p
    setSegIdx(0)
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

  // 旋转后的 thanks 常驻展示期，玩家再次挪动/旋转（下一次网格变化）→ 进入合法性检测
  useEffect(() => {
    if (phaseRef.current === 'thanks' && versionRef.current > (thanksCauseRef.current ?? Infinity)) {
      setPh('detect')
    }
  }, [grid])

  /** 事件 → 阶段推进（wait 节点：事件到达才离开；期间气泡常驻） */
  const dispatchEvent = (e: TutorialGameEvent) => {
    const cur = phaseRef.current
    if (cur === 'drag' && e.type === 'planePlaced') {
      flash('success')
      setPh('more')
    } else if (cur === 'more' && e.type === 'allPlanesPlaced') {
      // v0.3.14：气泡「单击飞机可以使飞机旋转90度」触发的同时即 <取消当前突显><突显空网格>
      flash('success')
      setPh('rotateWait')
    } else if (cur === 'rotateWait' && e.type === 'planeRotated') {
      thanksCauseRef.current = versionRef.current
      setPh('thanks')
    }
  }

  /** 气泡点击：click 节点读毕推进；wait/thanks/detect 仅翻段不消失 */
  const clickBubble = () => {
    const cur = phaseRef.current
    if (cur === 'welcome') setPh('tray')
    else if (cur === 'tray') setPh('drag')
    // 其余（drag/more/rotateWait/thanks/detect）：点击仅翻段，不消失
    else force((x) => x + 1)
  }

  const confirm = () => {
    if (!check.ok) {
      toast('摆阵未通过：请确保数量/越界/重叠校验全部通过', 'error')
      return
    }
    onDone(grid)
  }

  /* ---------- 展示派生 ---------- */
  const segmentsOf = (p: Phase): string[] => {
    if (p === 'welcome') return WELCOME
    if (p === 'tray') return [T2.tray]
    if (p === 'drag') return [T2.drag]
    if (p === 'more') return [T2.more]
    if (p === 'rotateWait') return [T2.rotate]
    if (p === 'thanks') return [T2.thanks]
    if (p === 'detect') return check.ok ? [T2.confirm] : [T2.invalid]
    return []
  }
  const isClickNode = phase === 'welcome' || phase === 'tray'
  const segments = segmentsOf(phase)
  const seg = Math.min(segIdx, Math.max(segments.length - 1, 0))
  const segText = segments.length > 0 ? (segments[seg] ?? '') : ''

  /** 分段读毕才推进节点 */
  const clickSeg = () => {
    if (segIdx + 1 < segments.length) {
      setSegIdx(segIdx + 1)
      return
    }
    clickBubble()
  }

  // 突显目标：'bubble'=整屏压暗突出气泡（开场 / 旋转引导）；
  // 待选栏；拖拽/旋转步骤 = 待选栏 + 网格；detect 合法 → 确认按钮，非法 → 无突显
  const highlightFor = (p: Phase): string | string[] | null => {
    // 'bubble' = <突显对话气泡>：整屏压暗无洞 + 阻断；'bubble-soft' 同款压暗但不阻断
    // （thanks / 阵形非法：气泡期间玩家仍需挪动或旋转飞机）
    if (p === 'welcome') return 'bubble'
    if (p === 'thanks') return 'bubble-soft'
    if (p === 'tray') return '.placement__tray'
    if (p === 'drag' || p === 'more' || p === 'rotateWait') return DRAG_HL
    if (p === 'detect') return check.ok ? '.tutorial-confirm' : 'bubble-soft'
    return null
  }
  const rawHl = highlightFor(phase)
  const bubbleDim = rawHl === 'bubble' || rawHl === 'bubble-soft'
  const highlight = bubbleDim ? null : rawHl
  // 气泡默认底部；突显确认按钮（页头）时同样保持底部
  const exit = () => setExitOpen(true)
  const confirmExit = () => {
    setExitOpen(false)
    onExitHome()
  }

  return (
    <div className={`placement placement--${orientation} tutorial-placement`}>
      <header className="placement__head">
        <PaperButton size="sm" variant="ghost" className="tutorial-escape" onClick={exit}>
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

      {/* 教程层（detect 非法 → highlight null → 无遮罩全亮）；「点击继续」仅 click 节点显示。
          弹窗打开期间（自身退出确认 exitOpen，或任何外部弹窗）不渲染阻断带/暗层/气泡 */}
      {!modalOpen ? (
        <TutorialSpotlight target={highlight} dim={bubbleDim} block={rawHl !== 'bubble-soft'} />
      ) : null}
      {!modalOpen && segments.length > 0 ? (
        <TutorialBubble key={phase} text={segText} showHint={isClickNode} onClick={clickSeg} />
      ) : null}
      <TutorialFxBand fx={fx} />

      {/* 退出确认（确认 → 回主页） */}
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
    </div>
  )
}
