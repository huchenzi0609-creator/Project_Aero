/**
 * TutorialBattle —— 教程单元2/3：对局（v0.3.1，M4 接管 M8 重写）。
 *
 * 事件驱动教程机（替代旧线性 useSteps）：
 * - 节点分三类：click（气泡点击翻段，读毕按 next 前进）、wait（等待事件命中后按 next 前进，
 *   next===自身 id = 循环反馈刷新文本）、quiet（等待事件后进入静默窗口，窗口内重复事件重置计时，
 *   静默满后前进 —— 单元3 T3-9 涂色轮询）。
 * - 胜负判定以 gameStore 权威状态为准（phase==='ended'），不再依赖事件顺序，杜绝提前胜利文案。
 * - 单元2：T2-1~T2-3 引导 → 每次我方报点循环反馈（击空/击中分支文本）→ 击毁三连文本 →
 *   继续循环直至真正胜利 → T2-6 胜利气泡 → P3。中途绝不显示胜利文案。
 * - 单元3：按手稿 T3-1~T3-12 依次引导（突显气泡/参考网格/我方网格/输入框/着色按钮），
 *   涂色后 3s 静默轮询，幽灵批染需「着色+点击幽灵」deliberate 事件，预报点创建后 AI 暂停教学。
 * - AI 节奏走 GameScreen.aiShotSelector；pauseAi 节点/气泡展示期间 AI 不出手。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Cell, GridConfig, PlacedPlane } from '@aero/shared'
import { PRESETS } from '@aero/shared'
import { rotateShape } from '@aero/game-core'
import { chooseTutorialShot, generateFleet, mulberry32 } from '@aero/game-core/ai'
import type { Rng, ShotKnowledge } from '@aero/game-core/ai'
import { useGameStore } from '../store/gameStore'
import { useSettingsStore } from '../store/settingsStore'
import { useToastStore } from '../store/toastStore'
import { PaperButton } from '../components/ui/PaperButton'
import { PaperModal } from '../components/ui/PaperModal'
import { GameScreen } from '../pages/GameScreen'
import { TutorialBubble } from './TutorialBubble'
import { TutorialSpotlight } from './TutorialSpotlight'
import type { TutorialGameEvent } from './events'

/* ============ 教程机节点模型 ============ */

type NodeText = string[] | ((e: TutorialGameEvent | null) => string[])

interface FlowNode {
  id: string
  kind: 'click' | 'wait' | 'quiet'
  /** 展示文本（wait/quiet 节点返回空数组 = 隐藏气泡、静默等待事件） */
  text?: NodeText
  /** wait/quiet 事件谓词 */
  wait?: (e: TutorialGameEvent) => boolean
  /** wait/quiet 事件命中后的目标 id（返回自身 = 刷新文本停留；null = 流程完成） */
  next?: string | ((e: TutorialGameEvent | null) => string | null) | null
  /** click 节点读毕的目标 id（函数可按最后事件/胜负决定；null = 流程完成） */
  after?: string | ((e: TutorialGameEvent | null) => string | null) | null
  /** quiet 静默窗口毫秒（kind=quiet） */
  quietMs?: number
  /** 突显目标：'bubble' = 气泡自身；null = 不突显（可保留弱化遮罩） */
  highlight?: string | null
  /** 展示期间暂停 AI（aiShotSelector 返回 null） */
  pauseAi?: boolean
}

/** 手稿气泡文本（单元2，§5.4 原文） */
const T2_WELCOME = '是时候学习如何对战了！'
const T2_GRID = '我们要在这张网格上找出对手的*飞机机头*的位置，但是目前还一无所知呢。'
const T2_FIRST = '试试双击一个格子，我们就能知道对手的这个位置有没有飞机了。'
const T2_MISS = '哎呀，不走运，这里没有飞机呢，点击其他方格试试吧！'
const T2_HIT = '机头就在这附近！但是信息还不够多，再在附近试试吧！'
const T2_KILL = [
  '厉害！你摧毁了对手的一架飞机！',
  '注意，对已击毁的飞机报点将显示*击空*哦！',
  '现在，请你继续找出所有飞机的机头！',
]
const T2_WIN = '恭喜！你获得了一场胜利！'

/** 手稿气泡文本（单元3，§5.6 原文） */
const T3_WELCOME = '《飞机杀》有很多实用的对局工具呢！'
const T3_REF = ['这是“参考网格”。如果忘了飞机长什么样子，可以看这里！', '这里的飞机也可点击旋转90度！']
const T3_DRAG = '并且，这里的飞机也可以拖到空网格里。试试看！'
const T3_GHOST = [
  '你创建了一个幽灵飞机！它可以用来直观地判断飞机位置。',
  '你可以创建多个幽灵飞机，回收它们只需要将其拖回去即可。',
]
const T3_MINE = '这是“我方网格”。可以看到我方阵型以及被击毁情况，以及对方报点的详细情况。'
const T3_SURE = [
  '值得一提的是，如果对方先手，在对方击毁了我方所有飞机后，……',
  '如果对方也只剩一架飞机未被击毁，那么我方将会获得一次额外报点机会。',
  '如果这次报点我方击毁了对方的最后一架飞机，则我方胜利。',
  '这就是“绝杀”规则。',
]
const T3_INPUT = '这是坐标输入框，网格太小不便点击时，可输入坐标进行报点。'
const T3_COLORBTN = '点击这个按钮进入着色模式，长按可以选择颜色。'
const T3_PAINT = '试试看给空网格涂色，点击和拖动都可以！'
const T3_TOOL = [
  '着色工具是对局中的好帮手，可助您事半功倍。',
  '这一强大的工具搭配“幽灵飞机”变得更为强大。',
  '试试看！在着色模式下点击“幽灵飞机”。',
]
const T3_BATCH = [
  '你刚刚对幽灵飞机下的方格进行了一次批量着色！',
  '使用批量着色功能会自动消灭选中的幽灵飞机，并且退出着色模式。',
  '若不想消灭和退出，可以在设置中关闭“快捷着色”。',
  '现在，灵活使用这些工具继续对局吧！',
]
const T3_PRE = [
  '你刚刚创建了一个预报点标记！',
  '在真实对局中，常常出现对手陷入长考的局面。',
  '为了节省我方时间，你可以在对方轮次时创建预报点标记。',
  '我方轮次时，将会自动按顺序上报这些预报点。',
  '请注意，预报点标记最多同时存在10个。',
]

/** 取事件中的报点结果（null = 非 shot 事件） */
function shotOutcome(e: TutorialGameEvent | null): 'miss' | 'hit' | 'kill' | null {
  return e && e.type === 'shotByPlayer' ? e.outcome : null
}

/* ============ 单元流程定义 ============ */

/** 单元2 节点表（F=反馈循环 / K=击毁三连 / W=胜利收尾） */
function buildBasicNodes(): FlowNode[] {
  const shot = (e: TutorialGameEvent) => e.type === 'shotByPlayer'
  const nodes: FlowNode[] = [
    { id: 'welcome', kind: 'click', text: [T2_WELCOME], after: 'grid', highlight: 'bubble' },
    { id: 'grid', kind: 'click', text: [T2_GRID], after: 'first', highlight: '.game__opp' },
    { id: 'first', kind: 'wait', text: [T2_FIRST], wait: shot, highlight: '.game__opp', next: (e) => (shotOutcome(e) === 'kill' ? 'kill' : 'fb') },
    {
      id: 'fb',
      kind: 'wait',
      // 循环反馈：击空/击中文本；kill 时无文本（进 kill 节点）；随每次非击毁报点刷新
      text: (e) => {
        const o = shotOutcome(e)
        if (o === 'kill') return []
        return [o === 'hit' ? T2_HIT : T2_MISS]
      },
      wait: shot,
      next: (e) => (shotOutcome(e) === 'kill' ? 'kill' : 'fb'),
    },
    {
      id: 'kill',
      kind: 'click',
      text: T2_KILL,
      after: (_e) => (wonNow() ? 'win' : 'fb'),
      highlight: null,
    },
    { id: 'win', kind: 'click', text: [T2_WIN], after: null, highlight: 'bubble' },
  ]
  return nodes
}

/** 单元3 节点表 */
function buildAdvancedNodes(): FlowNode[] {
  const nodes: FlowNode[] = [
    { id: 'a1', kind: 'click', text: [T3_WELCOME], after: 'a2', highlight: 'bubble' },
    { id: 'a2', kind: 'click', text: T3_REF, after: 'a3', highlight: '.game__ref' },
    { id: 'a3', kind: 'wait', text: [T3_DRAG], wait: (e) => e.type === 'ghostCreated', highlight: '.game__ref', next: 'a4', pauseAi: true },
    { id: 'a4', kind: 'click', text: T3_GHOST, after: 'a5', highlight: 'bubble', pauseAi: true },
    { id: 'a5', kind: 'click', text: [T3_MINE], after: 'a6', highlight: '.game__mine' },
    { id: 'a6', kind: 'click', text: T3_SURE, after: 'a7', highlight: null },
    { id: 'a7', kind: 'click', text: [T3_INPUT], after: 'a8', highlight: '.game__inputbar' },
    {
      id: 'a8',
      kind: 'wait',
      text: [T3_COLORBTN],
      wait: (e) => e.type === 'enteredColoring',
      highlight: '.game__inputbar .coloring-btn',
      next: 'a9',
      pauseAi: true,
    },
    {
      id: 'a9',
      kind: 'quiet',
      text: [T3_PAINT],
      wait: (e) => e.type === 'cellColored',
      quietMs: 3000,
      highlight: null,
      next: 'a10',
      pauseAi: true,
    },
    { id: 'a10', kind: 'click', text: T3_TOOL, after: 'ghostAwait', highlight: 'bubble', pauseAi: true },
    // 静默等待：仅【着色模式 + 点击幽灵飞机】（deliberate）才推进
    {
      id: 'ghostAwait',
      kind: 'wait',
      wait: (e) => e.type === 'ghostBatchColored' && e.viaGhostPointerDown === true,
      highlight: null,
      next: 'a11',
      pauseAi: true,
    },
    { id: 'a11', kind: 'click', text: T3_BATCH, after: 'preAwait', highlight: 'bubble', pauseAi: true },
    // 静默等待：我方创建预报点 → 展示 T3-12 并等 AI 恢复
    {
      id: 'preAwait',
      kind: 'wait',
      wait: (e) => e.type === 'preFireCreated',
      highlight: null,
      next: 'a12',
      pauseAi: true,
    },
    { id: 'a12', kind: 'click', text: T3_PRE, after: null, highlight: 'bubble', pauseAi: true },
  ]
  return nodes
}

/** 是否已分出胜负（我方视角；教程以引擎状态为准） */
function wonNow(): boolean {
  const s = useGameStore.getState().session
  return !!s && s.state.phase === 'ended' && s.state.winner === s.me
}
function endedNow(): boolean {
  const s = useGameStore.getState().session
  return !!s && s.state.phase === 'ended'
}

/* ============ 组件 ============ */

export interface TutorialBattleProps {
  variant: 'basic' | 'advanced'
  fleet: PlacedPlane[] | null
  onExitHome: () => void
  onGoAdvanced: () => void
}

function headCells(planes: PlacedPlane[], shape: GridConfig['shape']): Cell[] {
  const out: Cell[] = []
  for (const p of planes) {
    const head = rotateShape(shape, p.rotation).head
    out.push({ r: head.r + p.origin.r, c: head.c + p.origin.c })
  }
  return out
}

/** 每步当前展示段（分页用） */
interface RunState {
  nodeId: string
  seg: number
}

export function TutorialBattle({ variant, fleet, onExitHome, onGoAdvanced }: TutorialBattleProps) {
  const toast = useToastStore((s) => s.push)
  const begin = useGameStore((s) => s.beginTutorialBattle)
  const beginEndgame = useGameStore((s) => s.beginTutorialEndgame)
  const resetGame = useGameStore((s) => s.reset)
  const difficulty = useSettingsStore((s) => s.difficulty)

  const config: GridConfig = useMemo(() => ({ ...PRESETS.small }), [])
  const nodes = useMemo(() => (variant === 'basic' ? buildBasicNodes() : buildAdvancedNodes()), [variant])
  const nodeMap = useMemo(() => {
    const m = new Map<string, FlowNode>()
    for (const n of nodes) m.set(n.id, n)
    return m
  }, [nodes])

  const [startFailed, setStartFailed] = useState(false)
  const [p3Open, setP3Open] = useState(false)
  const [p5Open, setP5Open] = useState(false)
  const [free, setFree] = useState(false)
  const [skipOpen, setSkipOpen] = useState(false)
  const [, tick] = useState(0)
  const runRef = useRef<RunState | null>(null) // null = 未开始（挂载后 begin 成功再启动）
  const lastEventRef = useRef<TutorialGameEvent | null>(null)
  const quietTimerRef = useRef(0)
  const bubblePauseRef = useRef(false)
  const sessionNonce = useGameStore((s) => s.session?.nonce ?? 0)

  /** 强制重渲染（节点/分段变化后） */
  const rerender = useCallback(() => tick((x) => x + 1), [])

  const currentNode = (): FlowNode | null => {
    const r = runRef.current
    if (!r) return null
    return nodeMap.get(r.nodeId) ?? null
  }

  const segmentsOf = useCallback(
    (node: FlowNode, e: TutorialGameEvent | null): string[] => {
      if (typeof node.text === 'function') return node.text(e)
      return node.text ?? []
    },
    [],
  )

  const segs = useCallback(
    (nodeId: string, e: TutorialGameEvent | null): string[] => {
      const node = nodeMap.get(nodeId)
      if (!node) return []
      return segmentsOf(node, e)
    },
    [nodeMap, segmentsOf],
  )

  /** 解析目标 id（支持函数 + null=完成）；返回 undefined 表示节点未变更 */
  const resolveNext = useCallback(
    (node: FlowNode, e: TutorialGameEvent | null, field: 'after' | 'next'): string | null => {
      const v = field === 'after' ? node.after : node.next
      if (v == null) return null
      return typeof v === 'function' ? v(e) : v
    },
    [],
  )

  /** 按当前节点是否【有可见气泡】且声明 pauseAi 同步 AI 暂停（隐藏的静默等待节点不阻塞 AI） */
  const syncPause = useCallback(() => {
    const node = currentNode()
    const r = runRef.current
    if (!node || !r) {
      bubblePauseRef.current = false
      return
    }
    bubblePauseRef.current = segmentsOf(node, lastEventRef.current).length > 0 && !!node.pauseAi
  }, [segmentsOf])

  /** 进入节点 id（重置分页）；null = 单元完成（P3/P5） */
  const goNode = useCallback(
    (id: string | null) => {
      window.clearTimeout(quietTimerRef.current)
      if (id == null) {
        runRef.current = null
        bubblePauseRef.current = false
        if (variant === 'basic') setP3Open(true)
        else setP5Open(true)
        rerender()
        return
      }
      runRef.current = { nodeId: id, seg: 0 }
      syncPause()
      rerender()
    },
    [variant, syncPause, rerender],
  )

  /** 事件分发：返回是否已处理 */
  const dispatchEvent = useCallback(
    (e: TutorialGameEvent) => {
      if (free || !runRef.current) return false
      lastEventRef.current = e
      const node = currentNode()
      if (!node) return false
      if (node.kind === 'click') return false
      if (node.kind === 'wait' || node.kind === 'quiet') {
        if (!node.wait || !node.wait(e)) return false
        const to = resolveNext(node, e, 'next')
        if (node.kind === 'quiet') {
          // 涂色轮询：静默 3s 无新染色才前进
          window.clearTimeout(quietTimerRef.current)
          quietTimerRef.current = window.setTimeout(() => {
            const cur = currentNode()
            if (cur && cur.kind === 'quiet') goNode(resolveNext(cur, lastEventRef.current, 'next'))
          }, node.quietMs ?? 3000)
          rerender()
          return true
        }
        if (to === node.id) {
          // 自循环刷新文本（单元2 反馈循环）
          const s = runRef.current
          if (s) s.seg = 0
          rerender()
          return true
        }
        goNode(to)
        return true
      }
      return false
    },
    [free, resolveNext, goNode, rerender],
  )

  /** 气泡点击：翻段；click 节点读毕 → after */
  const onBubbleClick = useCallback(() => {
    const r = runRef.current
    const node = currentNode()
    if (!r || !node) return
    const segsNow = segs(node.id, lastEventRef.current)
    if (r.seg + 1 < segsNow.length) {
      r.seg += 1
      rerender()
      return
    }
    if (node.kind === 'click') {
      const to = resolveNext(node, lastEventRef.current, 'after')
      // 无后续目标（win 节点等）→ 单元完成
      if (to == null) {
        goNode(null)
        return
      }
      goNode(to)
      return
    }
    // wait/quiet：事件未到，点击仅翻段后停留
    rerender()
  }, [segs, resolveNext, goNode, rerender])

  // 开局（挂载一次）
  useEffect(() => {
    const doStart = () => {
      resetGame()
      runRef.current = null
      if (variant === 'basic') {
        if (!fleet || fleet.length === 0) {
          setStartFailed(true)
          return
        }
        const res = begin(config, fleet)
        if (!res.ok) {
          toast(res.errors.join('；'), 'error')
          setStartFailed(true)
          return
        }
      } else {
        const rng = mulberry32(((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0) || 1)
        try {
          const myFleet = generateFleet(config.width, config.height, config.planeCount, config.shape, difficulty, rng)
          const oppFleet = generateFleet(config.width, config.height, config.planeCount, config.shape, difficulty, rng)
          const res = beginEndgame(config, myFleet, oppFleet, {
            preKill: { side: 'me', planeIndex: 0 },
            firstTurn: 'them',
          })
          if (!res.ok) {
            toast(res.errors.join('；'), 'error')
            setStartFailed(true)
            return
          }
        } catch (err) {
          toast(err instanceof Error ? err.message : '教程对局生成失败', 'error')
          setStartFailed(true)
          return
        }
      }
    }
    doStart()
    return () => window.clearTimeout(quietTimerRef.current)
  }, [variant])

  // 新对局就绪 → 教程从头开始
  useEffect(() => {
    if (sessionNonce > 0 && !runRef.current) {
      goNode(variant === 'basic' ? 'welcome' : 'a1')
    }
  }, [sessionNonce, variant, goNode])

  // 终局兜底：单元3 任何时刻对局结束（含玩家在工具步骤前获胜/超时）→ 直接 P5
  useEffect(() => {
    if (variant !== 'advanced' || free) return
    if (endedNow()) {
      setP5Open(true)
    }
  }, [sessionNonce, free, variant])

  /** 教程 AI 门控：气泡 pauseAi / advanced 每回合思考窗口 / 预报点后 5s */
  const gateRef = useRef({
    delayMs: 0,
    pausedUntil: 0,
    lastShots: 0,
  })

  useEffect(() => {
    gateRef.current = { delayMs: variant === 'advanced' ? 6000 : 0, pausedUntil: 0, lastShots: 0 }
  }, [variant])

  const aiShotSelector = useCallback(
    (knowledge: ShotKnowledge, rng: Rng): Cell | null => {
      const g = gateRef.current
      const now = Date.now()
      if (g.lastShots !== knowledge.shots.length) {
        g.lastShots = knowledge.shots.length
        if (g.delayMs > 0) g.pausedUntil = now + g.delayMs
      }
      if (bubblePauseRef.current) return null
      if (now < g.pausedUntil) return null
      const s = useGameStore.getState()
      const myPlanes = s.session?.state.players[0].planes ?? []
      const shape = s.session?.state.players[0].shape ?? config.shape
      return chooseTutorialShot(knowledge, { avoidHeads: headCells(myPlanes, shape) }, rng)
    },
    [config.shape],
  )

  /** 事件桥（GameScreen → 教程机 + AI 额外暂停） */
  const onGameEvent = useCallback(
    (e: TutorialGameEvent) => {
      dispatchEvent(e)
      if (e.type === 'preFireCreated' && variant === 'advanced' && !free) {
        const g = gateRef.current
        g.pausedUntil = Math.max(g.pausedUntil, Date.now() + 5000)
      }
    },
    [dispatchEvent, variant, free],
  )

  // 展示派生
  const r = runRef.current
  const node = currentNode()
  const segsNow = node && r ? segs(node.id, lastEventRef.current) : []
  const showBubble = !!node && !free && r != null && segsNow.length > 0
  const segText = showBubble ? (segsNow[Math.min(r!.seg, segsNow.length - 1)] ?? '') : ''
  const highlight = !free && node?.highlight ? node.highlight : null
  const unitLabel = variant === 'basic' ? '对战基础' : '工具进阶'

  /** 跳过确认（确认 = 视为完成：basic→P3 / advanced→P5） */
  const confirmSkip = () => {
    setSkipOpen(false)
    if (variant === 'basic') setP3Open(true)
    else setP5Open(true)
  }

  if (startFailed) {
    return (
      <div className="page" style={{ alignItems: 'center', gap: 16 }}>
        <p>教程对局启动失败，请返回主页重试。</p>
        <PaperButton variant="primary" onClick={onExitHome}>
          返回主页
        </PaperButton>
      </div>
    )
  }

  return (
    <>
      <GameScreen
        onGameEvent={onGameEvent}
        aiShotSelector={free ? undefined : aiShotSelector}
        hideSettlement={!free}
      />

      {!free ? (
        <div className="tutorial-hud">
          <button type="button" className="tutorial-bubble__skip" onClick={() => setSkipOpen(true)}>
            跳过 · {unitLabel}
          </button>
        </div>
      ) : null}

      {showBubble || highlight ? <TutorialSpotlight target={highlight} /> : null}
      {showBubble ? (
        <TutorialBubble
          key={`${node!.id}-${r!.seg}`}
          text={segText}
          showHint={node!.kind === 'click'}
          onClick={onBubbleClick}
          skipLabel={`跳过 · ${unitLabel}`}
          onSkip={() => setSkipOpen(true)}
        />
      ) : null}

      {/* 跳过确认（ui-copy §4） */}
      <PaperModal
        open={skipOpen}
        title="新手教程"
        onClose={() => setSkipOpen(false)}
        footer={
          <>
            <PaperButton variant="ghost" onClick={() => setSkipOpen(false)}>
              取消
            </PaperButton>
            <PaperButton variant="danger" onClick={confirmSkip}>
              确认
            </PaperButton>
          </>
        }
      >
        <p style={{ margin: 0 }}>确认跳过当前单元？</p>
      </PaperModal>

      {/* P3 基础完成弹窗（§5.5） */}
      <PaperModal
        open={p3Open}
        title="基础教程"
        onClose={() => {}}
        footer={
          <>
            <PaperButton variant="ghost" onClick={onExitHome}>
              返回主页
            </PaperButton>
            <PaperButton variant="primary" onClick={onGoAdvanced}>
              继续教程
            </PaperButton>
          </>
        }
      >
        <p style={{ margin: 0 }}>基础教程已完成，是否继续进阶教程？</p>
      </PaperModal>

      {/* P5 进阶完成弹窗（§5.7） */}
      <PaperModal
        open={p5Open}
        title="进阶教程"
        onClose={() => {}}
        footer={
          <>
            <PaperButton variant="ghost" onClick={onExitHome}>
              完成教程
            </PaperButton>
            <PaperButton
              variant="primary"
              onClick={() => {
                if (endedNow()) {
                  // 对局已结束：留在结果画面（不提供继续对局）
                  onExitHome()
                  return
                }
                gateRef.current = { ...gateRef.current, delayMs: 0, pausedUntil: 0 }
                setFree(true)
                setP5Open(false)
              }}
            >
              继续对局
            </PaperButton>
          </>
        }
      >
        <p style={{ margin: 0 }}>进阶教程已完成，是否完成对局？</p>
      </PaperModal>
    </>
  )
}
