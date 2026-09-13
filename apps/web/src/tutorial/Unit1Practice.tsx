/**
 * Unit1Practice —— 教程·单元1「辨认飞机和基本操作」（v0.3.14 修订）。
 *
 * 三个练习场景（纯前端演示网格，不进入对局引擎）：
 * 1) 5×5 居中：己方飞机演示态（不可旋转/拖拽）——认识飞机与机头标识；
 * 2) 10×10 居中：对方目标飞机 (E5,u) + 预置报点；双击 E5 → 成功提示 + 幽灵飞机，否则失败提示循环；
 * 3) 10×10 居中：对方目标飞机 (F7,l) + 预置报点；突显气泡讲歧义 → 突显 J7 试错 → 突显 F7 命中 →
 *    在【同一网格】的真实位置生成幽灵飞机 → 进入单元2。
 *
 * v0.3.14 修复：
 * - 预置报点结果【显式声明】（场景2 D7/G8/F9、场景3 H6 为击空），不再由真实机体推导；
 * - 玩家每次报点都写入展示用 shots 列表（机头=★击毁 / 机身=◯击中 / 空=✗击空）；
 * - 场景3 命中后不再另开网格，改为在同一 10×10 网格的真实位置生成幽灵飞机；
 * - 网格水平+垂直居中（见 tutorial.css `.tutorial-unit1__body` / `.u1-grid-wrap`）。
 */
import { useMemo, useState } from 'react'
import type { Cell, PlacedPlane, Shot, ShotOutcome } from '@aero/shared'
import { DEFAULT_PLANE_SHAPE } from '@aero/shared'
import { rotateShape } from '@aero/game-core'
import { useEffectiveOrientation } from '../hooks/useOrientation'
import { useSettingsStore } from '../store/settingsStore'
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

/** 场景2 预置报点：显式结果（击空 D7/G8/F9） */
const S2_PRESET: Shot[] = [
  ...['C6', 'D6', 'E6', 'F8', 'G6', 'E8'].map((c) => ({ coord: cell(c), outcome: 'hit' as ShotOutcome })),
  ...['D7', 'G8', 'F9'].map((c) => ({ coord: cell(c), outcome: 'miss' as ShotOutcome })),
]
/** 场景3 预置报点：显式结果（击空 H6） */
const S3_PRESET: Shot[] = [
  ...['G6', 'G8', 'I6', 'I8', 'H7'].map((c) => ({ coord: cell(c), outcome: 'hit' as ShotOutcome })),
  { coord: cell('H6'), outcome: 'miss' as ShotOutcome },
]

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

/** 报点结果判定：机头 → kill；机身 → hit；其余 → miss */
function classifyShot(plane: PlacedPlane, coord: Cell): ShotOutcome {
  const rotated = rotateShape(DEFAULT_PLANE_SHAPE, plane.rotation)
  const head = { r: plane.origin.r + rotated.head.r, c: plane.origin.c + rotated.head.c }
  if (head.r === coord.r && head.c === coord.c) return 'kill'
  const body = rotated.cells.some((c) => plane.origin.r + c.r === coord.r && plane.origin.c + c.c === coord.c)
  return body ? 'hit' : 'miss'
}

type Scene = 1 | 2 | 3
type Phase = 's1a' | 's1b' | 's2' | 's3a' | 's3j7' | 's3afterj7' | 's3f7' | 's3done'

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
  /** 玩家报点留下的展示标记（同格覆盖预置值） */
  const [playerShots, setPlayerShots] = useState<Shot[]>([])
  /** v0.3.16：设置「单击报点」开启时，单击即视为报点（默认关 → 仍为双击） */
  const singleTapShot = useSettingsStore((s) => s.singleTapShot)
  const lastClickRef = useMemo(() => ({ coord: null as Cell | null, t: 0 }), [])

  /* ---------- 场景2 目标：E5（rot u = 0） ---------- */
  const s2Head = cell('E5')
  const s2Plane: PlacedPlane = { id: 9, rotation: 0, origin: originFromHead(s2Head, 0) }
  /* ---------- 场景3 目标：F7（rot l = 3） ---------- */
  const s3Head = cell('F7')
  const s3Plane: PlacedPlane = { id: 10, rotation: 3, origin: originFromHead(s3Head, 3) }
  const j7 = cell('J7')

  /** 展示用报点列表：预置 + 玩家 */
  const shots = useMemo(() => {
    const base = scene === 2 ? S2_PRESET : scene === 3 ? S3_PRESET : []
    const map = new Map<string, Shot>()
    for (const s of base) map.set(`${s.coord.r},${s.coord.c}`, s)
    for (const s of playerShots) map.set(`${s.coord.r},${s.coord.c}`, s)
    return [...map.values()]
  }, [scene, playerShots])

  /** 双击判定（同格 600ms 内两次） */
  const isDouble = (coord: Cell): boolean => {
    const now = performance.now()
    const same = lastClickRef.coord && lastClickRef.coord.r === coord.r && lastClickRef.coord.c === coord.c
    const fast = now - lastClickRef.t < 600
    lastClickRef.coord = coord
    lastClickRef.t = now
    return Boolean(same && fast)
  }

  const pushShot = (coord: Cell, outcome: ShotOutcome) => {
    setPlayerShots((prev) => [
      ...prev.filter((s) => !(s.coord.r === coord.r && s.coord.c === coord.c)),
      { coord, outcome },
    ])
  }

  const onCellClick = (coord: Cell) => {
    if (!singleTapShot && !isDouble(coord)) return
    if (scene === 2) {
      const outcome = classifyShot(s2Plane, coord)
      pushShot(coord, outcome)
      if (!s2Resolved) {
        if (outcome === 'kill') {
          setS2Resolved(true)
          flash('success')
          setS2Msg('致命打击！干得漂亮！')
        } else {
          flash('failure')
          setS2Msg('机头不在这里，想想飞机的形状！')
        }
      }
      return
    }
    if (scene === 3) {
      const outcome = classifyShot(s3Plane, coord)
      pushShot(coord, outcome)
      if (outcome === 'kill') {
        if (phase !== 's3done') {
          setPhase('s3done')
          setSeg(0)
          flash('success')
        }
        return
      }
      if (phase === 's3j7' && coord.r === j7.r && coord.c === j7.c) {
        setPhase('s3afterj7')
        setSeg(0)
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
      setPlayerShots([])
    } else if (scene === 2 && s2Resolved) {
      setScene(3)
      setPhase('s3a')
      setSeg(0)
      setS2Msg(null)
      setPlayerShots([])
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

  /**
   * 突显目标：<突显对话气泡> 节点 → target=null（bubbleDim 走整屏暗层）；
   * <突显网格/格子> 节点 → 选择器洞。
   * 场景2 以网格为突显目标（玩家需看清“O”并双击，不能压暗）；场景3 命中后“取消突显”（亮出幽灵飞机）。
   */
  const target: string | string[] | null =
    scene === 1
      ? phase === 's1b'
        ? '.u1-grid'
        : null
      : scene === 2
        ? '.u1-grid'
        : phase === 's3a'
          ? null
          : phase === 's3j7'
            ? '.u1-grid button[aria-label="J7"]'
            : phase === 's3afterj7' || phase === 's3f7'
              ? '.u1-grid button[aria-label="F7"]'
              : null
  /** <突显对话气泡>：整屏压暗无洞（场景1 开场、场景3 歧义讲解） */
  const bubbleDim = showBubble && target === null && !(scene === 3 && phase === 's3done')
  const modal = showBubble || target !== null

  const gridSize = scene === 1 ? 5 : 10
  /** 幽灵飞机：场景2/3 命中后在同一网格内按真实位置显示（不可交互） */
  const planes: PlacedPlane[] =
    scene === 1
      ? [{ id: 1, rotation: 0, origin: { r: 1, c: 0 } }]
      : scene === 2
        ? s2Resolved
          ? [s2Plane]
          : []
        : phase === 's3done'
          ? [s3Plane]
          : []
  const planesLayer =
    scene === 1
      ? { ghost: false }
      : (scene === 2 && s2Resolved) || (scene === 3 && phase === 's3done')
        ? { ghost: true }
        : undefined

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
          {/* key/data-scene：不同场景网格尺寸不同且同类名 → 强制换新节点，配合遮罩布局期测量，
              避免沿用上一场景（5×5）的旧几何（v0.3.17-beta2 item 2） */}
          <div key={scene} className="u1-grid" data-scene={scene}>
            <PaperGrid
              width={gridSize}
              height={gridSize}
              cellSize={scene === 1 ? 46 : 30}
              showLabels
              onCellClick={onCellClick}
              shots={shots}
              planes={planes}
              shape={DEFAULT_PLANE_SHAPE}
              planesLayer={planesLayer}
              ariaLabel="教程练习网格"
            />
          </div>
        </div>
      </div>

      {/* measureKey：同一选择器在不同场景尺寸变化（5×5 ↔ 10×10）时强制重新测量 */}
      <TutorialSpotlight
        active={modal}
        target={target}
        dim={bubbleDim}
        measureKey={`${scene}-${phase}`}
      />
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
