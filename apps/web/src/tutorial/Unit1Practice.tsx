/**
 * Unit1Practice —— 教程·单元1「辨认飞机和基本操作」（v0.3.13 全新）。
 *
 * 三个练习场景（纯前端演示网格，不进入对局引擎）：
 * 1) 5×5 居中：己方飞机 (A3,u) 演示态（不可旋转/拖拽）——认识飞机与机头标识；
 * 2) 10×10：对方目标飞机 (E5,u) + 已报点；双击 E5 → 成功提示 + 幽灵飞机；否则失败提示循环；
 * 3) 10×10：对方目标飞机 (F7,l) + 已报点；先突显网格讲解歧义 → 突显 J7 试错 → 突显 F7 命中 → 进入单元2。
 */
import { useMemo, useState } from 'react'
import type { Cell, PlacedPlane, Shot } from '@aero/shared'
import { DEFAULT_PLANE_SHAPE } from '@aero/shared'
import { useEffectiveOrientation } from '../hooks/useOrientation'
import { PaperButton } from '../components/ui/PaperButton'
import { PaperGrid } from '../components/grid/PaperGrid'
import { TutorialBubble } from './TutorialBubble'
import { TutorialSpotlight } from './TutorialSpotlight'
import { TutorialFxBand, useTutorialFx } from './TutorialFx'
import { useAnyModalOpen } from './useAnyModalOpen'
import '../styles/tutorial.css'

const cell = (coord: string): Cell => ({
  r: Number(coord.slice(1)) - 1,
  c: coord.charCodeAt(0) - 65,
})
const shotAt = (coord: string): Shot => ({ coord: cell(coord), outcome: 'hit' })

/** 场景2：已报机身点（9 个） */
const S2_SHOTS = ['C6', 'D6', 'E6', 'F8', 'G8', 'F9', 'D7', 'G6', 'E8'].map(shotAt)
/** 场景3：已报机身点（6 个） */
const S3_SHOTS = ['G6', 'G8', 'I6', 'I8', 'H7', 'H6'].map(shotAt)

/** 机头相对偏移（默认形状，顺时针 rotation） */
function headRel(rotation: 0 | 1 | 2 | 3): Cell {
  const rel: Record<number, Cell> = { 0: { r: 0, c: 2 }, 1: { r: 2, c: 4 }, 2: { r: 4, c: 2 }, 3: { r: 2, c: 0 } }
  return rel[rotation]!
}
/** 由机头绝对坐标与朝向反推 origin */
function originFromHead(head: Cell, rotation: 0 | 1 | 2 | 3): Cell {
  const rel = headRel(rotation)
  return { r: head.r - rel.r, c: head.c - rel.c }
}

type Scene = 1 | 2 | 3
type Phase =
  | 's1a' | 's1b'
  | 's2'
  | 's3a' | 's3j7' | 's3afterj7' | 's3f7' | 's3done'

export function Unit1Practice({ onExitHome, onDone }: { onExitHome: () => void; onDone: () => void }) {
  const orientation = useEffectiveOrientation()
  const { fx, flash } = useTutorialFx()
  /** 纵深防护：任何弹窗打开期间不渲染阻断带/暗层/气泡（单元1 自身无弹窗，防外部弹窗） */
  const modalOpen = useAnyModalOpen()
  const [scene, setScene] = useState<Scene>(1)
  const [phase, setPhase] = useState<Phase>('s1a')
  const [seg, setSeg] = useState(0)
  const [s2Resolved, setS2Resolved] = useState(false)
  const [s2Msg, setS2Msg] = useState<string | null>(null)
  const lastClickRef = useMemo(() => ({ coord: null as Cell | null, t: 0 }), [])

  /* ---------- 场景2 目标：E5（rot u = 0） ---------- */
  const s2Head = cell('E5')
  const s2Plane: PlacedPlane = { id: 9, rotation: 0, origin: originFromHead(s2Head, 0) }
  /* ---------- 场景3 目标：F7（rot l = 3） ---------- */
  const s3Head = cell('F7')
  const s3Plane: PlacedPlane = { id: 10, rotation: 3, origin: originFromHead(s3Head, 3) }
  const j7 = cell('J7')

  /** 双击判定（同格 600ms 内两次） */
  const isDouble = (coord: Cell): boolean => {
    const now = performance.now()
    const same = lastClickRef.coord && lastClickRef.coord.r === coord.r && lastClickRef.coord.c === coord.c
    const fast = now - lastClickRef.t < 600
    lastClickRef.coord = coord
    lastClickRef.t = now
    return Boolean(same && fast)
  }

  const onCellClick = (coord: Cell) => {
    if (!isDouble(coord)) return
    if (scene === 2) {
      if (!s2Resolved && coord.r === s2Head.r && coord.c === s2Head.c) {
        setS2Resolved(true)
        flash('success')
        setS2Msg('致命打击！干得漂亮！')
      } else if (!s2Resolved) {
        flash('failure')
        setS2Msg('机头不在这里，想想飞机的形状！')
      }
      return
    }
    if (scene === 3) {
      if (phase === 's3j7' && coord.r === j7.r && coord.c === j7.c) {
        setPhase('s3afterj7')
        return
      }
      if ((phase === 's3j7' || phase === 's3afterj7' || phase === 's3f7') && coord.r === s3Head.r && coord.c === s3Head.c) {
        setPhase('s3done')
        return
      }
    }
  }

  /** 气泡文本与点击推进 */
  const bubbleText = (): string[] => {
    if (scene === 1) {
      if (phase === 's1a') return ['欢迎来到《飞机杀》！', '在正式开始游戏之前，我们先来做几个练习吧！']
      if (phase === 's1b') return ['请记住图上飞机的样式，注意*机头*的特殊标识！', '记住了吗？记住了的话，点我继续！']
      return []
    }
    if (scene === 2) {
      if (s2Msg) return [s2Msg]
      return ['如图，“O”表示已知的飞机机身，试着双击可能的*机头*位置！']
    }
    if (phase === 's3a') return ['在这种情况下，我们不能完全确定机头位置呢。', '机头可能在F7，也可能在J7。']
    if (phase === 's3j7') return ['我们需要更多的信息。试着双击J7！']
    if (phase === 's3afterj7') return ['看来机头不在这里，试试另一个吧！']
    if (phase === 's3f7') return ['试试双击F7！']
    if (phase === 's3done') return ['恭喜！你成功锁定了机头的位置！']
    return []
  }
  const canClick =
    (scene === 1 && (phase === 's1a' || phase === 's1b')) ||
    (scene === 2 && s2Resolved) ||
    (scene === 3 && (phase === 's3a' || phase === 's3afterj7' || phase === 's3done'))
  const segments = bubbleText()
  const text = segments[Math.min(seg, Math.max(0, segments.length - 1))] ?? ''
  const showBubble = segments.length > 0

  const clickBubble = () => {
    if (seg + 1 < segments.length) {
      setSeg(seg + 1)
      return
    }
    // 读毕推进
    if (scene === 1 && phase === 's1a') {
      setPhase('s1b')
      setSeg(0)
    } else if (scene === 1 && phase === 's1b') {
      setScene(2)
      setPhase('s2')
      setSeg(0)
    } else if (scene === 2 && s2Resolved) {
      setScene(3)
      setPhase('s3a')
      setSeg(0)
      setS2Msg(null)
    } else if (scene === 3 && phase === 's3a') {
      setPhase('s3j7')
      setSeg(0)
    } else if (scene === 3 && phase === 's3afterj7') {
      setPhase('s3f7')
      setSeg(0)
    } else if (scene === 3 && phase === 's3done') {
      onDone()
    }
  }

  /** 突显目标：模态洞（网格 / J7 格 / F7 格 / 气泡暗层）
   *  场景2 必须突显网格（而非仅压暗气泡）：本场景要玩家双击报点，dim 会阻断网格交互。 */
  const target: string | string[] | null =
    scene === 1
      ? phase === 's1b'
        ? '.u1-grid'
        : null
      : scene === 2
        ? '.u1-grid'
        : phase === 's3a'
          ? '.u1-grid'
          : phase === 's3j7'
            ? '.u1-grid button[aria-label="J7"]'
            : phase === 's3afterj7' || phase === 's3f7'
              ? '.u1-grid button[aria-label="F7"]'
              : null
  const bubbleDim = showBubble && target === null
  const modal = showBubble || target !== null

  const gridSize = scene === 1 ? 5 : 10

  return (
    <div className={`page tutorial-unit1 tutorial-unit1--${orientation}`}>
      <header className="page__head">
        <PaperButton size="sm" variant="ghost" className="tutorial-escape" onClick={onExitHome}>
          ← 退出教程
        </PaperButton>
        <h1 className="page__title">新手教程 · 辨认飞机</h1>
      </header>

      <div className="page__body tutorial-unit1__body">
        <div className="u1-grid-wrap">
          <div className="u1-grid">
            <PaperGrid
              width={gridSize}
              height={gridSize}
              cellSize={scene === 1 ? 46 : 30}
              showLabels
              onCellClick={onCellClick}
              shots={scene === 2 ? S2_SHOTS : scene === 3 ? S3_SHOTS : []}
              planes={
                scene === 1
                  ? [{ id: 1, rotation: 0, origin: { r: 1, c: 0 } }]
                  : scene === 2 && s2Resolved
                    ? [s2Plane]
                    : []
              }
              shape={DEFAULT_PLANE_SHAPE}
              planesLayer={
                scene === 2 && s2Resolved
                  ? { ghost: true }
                  : scene === 1
                    ? { ghost: false }
                    : undefined
              }
              ariaLabel="教程练习网格"
            />
          </div>
        </div>
        {scene === 3 && phase === 's3done' ? (
          <div className="u1-grid-wrap">
            <div className="u1-grid">
              <PaperGrid
                width={10}
                height={10}
                cellSize={22}
                showLabels
                shots={S3_SHOTS}
                planes={[s3Plane]}
                shape={DEFAULT_PLANE_SHAPE}
                ariaLabel="目标机揭示"
              />
            </div>
          </div>
        ) : null}
      </div>

      {modal && !modalOpen ? <TutorialSpotlight target={target} dim={bubbleDim} /> : null}
      {showBubble && !modalOpen ? (
        <TutorialBubble
          key={`${scene}-${phase}`}
          text={text}
          showHint={canClick && seg >= segments.length - 1}
          onClick={clickBubble}
        />
      ) : null}
      <TutorialFxBand fx={fx} />
    </div>
  )
}
