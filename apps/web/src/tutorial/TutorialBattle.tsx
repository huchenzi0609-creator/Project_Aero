/**
 * TutorialBattle —— 教程·单元3「初次实战·对局」（v0.3.14 修订）。
 *
 * 经典 10×10 / 3 架，我方先手（beginTutorialBattle 固定 firstMover=0、关闭绝杀）；
 * 对手 AI 避开我方全部机头、行动间隔 1s。
 *
 * 结构：
 * - 开场链 i1→i2→i3→i4：依次突显气泡/我方网格/参考网格/空网格；i4 只等待【玩家真实报点】
 *   （不可点击推进），i6 正向反馈读毕后进入自由对局。
 * - 两条教学支线【并行监听、触发顺序无关】（v0.3.14 item 8）：
 *   · 击毁支线 k1..k6：首杀 → 成功提示 → 幽灵标记教学（拖动中持续判定）→ 着色按钮 → 着色点幽灵 → 收尾文案；
 *   · 预报点支线 p1：玩家触发预报点 → 5 段教学。
 *   两条件各自自第一帧起被监听；先到者先播，另一条排队（不丢失）。
 * - 幽灵标记判定（v0.3.14 item 10/11）：读取空网格上幽灵/拖拽预览 DOM（包围盒左上角 + 朝向），
 *   · 拖动/移动过程中每 120ms 持续判定，机头格与朝向【完全一致】即刻成功（无需松手）；
 *   · 松手（ghostCreated）时：机头格一致但 rotation 不一致 → 失败提示；位置不符 → 不提示、继续尝试。
 * - 完成：教程不再提供“提前完成/继续对局”弹窗；对局自然结束（胜负判定）后展示完成提示 → 返回主页。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Cell, GridConfig, PlacedPlane } from '@aero/shared'
import { DEFAULT_PLANE_SHAPE, PRESETS } from '@aero/shared'
import { rotateShape } from '@aero/game-core'
import { chooseTutorialShot, generateFleet, mulberry32 } from '@aero/game-core/ai'
import type { Rng, ShotKnowledge } from '@aero/game-core/ai'
import { useEffectiveOrientation } from '../hooks/useOrientation'
import { useGameStore } from '../store/gameStore'
import { useSettingsStore } from '../store/settingsStore'
import { useToastStore } from '../store/toastStore'
import { PaperButton } from '../components/ui/PaperButton'
import { PaperModal } from '../components/ui/PaperModal'
import { GameScreen } from '../pages/GameScreen'
import { TutorialBubble } from './TutorialBubble'
import { TutorialSpotlight } from './TutorialSpotlight'
import { TutorialFxBand, useTutorialFx } from './TutorialFx'
import { useAnyModalOpen } from './useAnyModalOpen'
import type { TutorialGameEvent } from './events'

/* ============ 节点模型 ============ */

type NodeText = string[] | ((e: TutorialGameEvent | null) => string[])

interface FlowNode {
  id: string
  kind: 'click' | 'wait'
  /** 展示文本（wait 节点返回空数组 = 隐藏气泡、静默等待） */
  text?: NodeText
  /** wait 事件谓词（k2 幽灵判定在 dispatch 内特殊处理） */
  wait?: (e: TutorialGameEvent) => boolean
  /** click 节点读毕的目标 id（null = 本链结束） */
  after?: string | null
  /** wait 事件命中后的目标 id */
  next?: string | null
  /** 突显目标：'bubble' = 整屏压暗突出气泡；具体选择器 = 突显该元素；null = 不突显 */
  highlight?: string | string[] | null
}

const T = {
  i1: ['现在，我们正式进入实战！'],
  i2: ['这是你刚才摆的阵型，从这里可以看到对方是怎么攻击我方的。'],
  i3: ['这是参考网格，如果忘了飞机的形状，可以用于参考。'],
  i4: ['这是空网格，你需要通过双击报点来获得对方飞机的信息。试试看！'],
  i6: ['好极了！运用你刚才学到的所有技巧，高效地摧毁对手的飞机吧！'],
  k1: ['你成功摧毁了对方的飞机！'],
  k2: [
    '被击毁的飞机*不会自动显示*，因此要自行标记被击毁飞机位置。',
    '尝试从*参考网格*处拖动飞机，并将其放置到需要标记的位置。',
  ],
  k2fail: ['好像不太对，试试换个朝向吧。'],
  k3: ['飞机就在这里！'],
  k4: ['接下来，试试点击着色工具按钮！'],
  k5: ['现在，试试点击你刚才摆放的飞机！'],
  k6: ['现在，你学会了如何标记被击毁的飞机。继续寻找剩下的所有飞机吧！'],
  p1: [
    '你刚才看见的红色“？”是预报点标记。',
    '如果当前不是你的回合，报点将会产生预报点标记。',
    '这些标记将会在你的回合时被依次转化为报点。',
    '双击一个预报点标记可以消除它。',
    '预报点标记最多可以同时存在10个。',
  ],
}

/** 幽灵拖拽必须同时突显【参考网格】与【空网格】：<突显> 为模态，非突显区域不可交互。 */
const GHOST_DRAG_HL: string[] = ['.game__ref', '.game__opp']

/** 开场链 */
const INTRO: FlowNode[] = [
  { id: 'i1', kind: 'click', text: T.i1, after: 'i2', highlight: 'bubble' },
  { id: 'i2', kind: 'click', text: T.i2, after: 'i3', highlight: '.game__mine' },
  { id: 'i3', kind: 'click', text: T.i3, after: 'i4', highlight: '.game__ref' },
  // i4：只等玩家真实报点（不可点击推进）
  { id: 'i4', kind: 'wait', text: T.i4, wait: (e) => e.type === 'shotByPlayer', next: 'i6', highlight: '.game__opp' },
  { id: 'i6', kind: 'click', text: T.i6, after: null, highlight: 'bubble' },
]

/** 击毁支线 */
const KILL: FlowNode[] = [
  { id: 'k1', kind: 'click', text: T.k1, after: 'k2', highlight: ['bubble', '.game__opp'] },
  {
    id: 'k2',
    kind: 'wait',
    // 判定不通过（机头一致/朝向不一致）时追加失败文案；正常展示教学两段
    text: (e) => (k2FailedFlag && e?.type === 'ghostCreated' ? T.k2fail : T.k2),
    wait: (e) => e.type === 'ghostCreated',
    next: 'k3',
    highlight: GHOST_DRAG_HL,
  },
  { id: 'k3', kind: 'click', text: T.k3, after: 'k4', highlight: ['bubble', '.game__opp'] },
  {
    id: 'k4',
    kind: 'wait',
    // v0.3.14 item 12：进入着色工具教学时取消此前全部突显（仅突显着色按钮，空网格不再突显）
    text: T.k4,
    wait: (e) => e.type === 'enteredColoring',
    next: 'k5',
    highlight: ['.coloring-btn'],
  },
  {
    id: 'k5',
    kind: 'wait',
    text: T.k5,
    wait: (e) => e.type === 'ghostBatchColored' && e.viaGhostPointerDown === true,
    next: 'k6',
    highlight: '.game__opp',
  },
  { id: 'k6', kind: 'click', text: T.k6, after: null, highlight: 'bubble' },
]

/** 预报点支线 */
const PREFIRE: FlowNode[] = [
  // 手稿：<突显对话气泡><突显空网格> → 混合模式（整屏压暗 + 空网格开洞）
  { id: 'p1', kind: 'click', text: T.p1, after: null, highlight: ['bubble', '.game__opp'] },
]

/** k2 失败文案开关（模块级：避免每次重建节点表） */
let k2FailedFlag = false

/** 旋转后包围盒信息（默认形状 4 朝向的 (minR,minC,w,h) 互不相同） */
function bboxOf(rotation: number): { minR: number; minC: number; w: number; h: number } {
  const cells = rotateShape(DEFAULT_PLANE_SHAPE, rotation as 0 | 1 | 2 | 3).cells
  let minR = Infinity
  let maxR = -Infinity
  let minC = Infinity
  let maxC = -Infinity
  for (const c of cells) {
    minR = Math.min(minR, c.r)
    maxR = Math.max(maxR, c.r)
    minC = Math.min(minC, c.c)
    maxC = Math.max(maxC, c.c)
  }
  return { minR, minC, w: maxC - minC + 1, h: maxR - minR + 1 }
}

function headRel(rotation: number): Cell {
  const rel: Record<number, Cell> = { 0: { r: 0, c: 2 }, 1: { r: 2, c: 4 }, 2: { r: 4, c: 2 }, 3: { r: 2, c: 0 } }
  return rel[rotation % 4] ?? rel[0]!
}

function segmentsOfNode(node: FlowNode, e: TutorialGameEvent | null): string[] {
  if (typeof node.text === 'function') return node.text(e)
  return node.text ?? []
}

type Table = 'intro' | 'kill' | 'prefire'
const TABLE_NODES: Record<Table, FlowNode[]> = { intro: INTRO, kill: KILL, prefire: PREFIRE }
const NODE_MAP: Record<Table, Map<string, FlowNode>> = {
  intro: new Map(INTRO.map((n) => [n.id, n])),
  kill: new Map(KILL.map((n) => [n.id, n])),
  prefire: new Map(PREFIRE.map((n) => [n.id, n])),
}

/* ============ 组件 ============ */

export interface TutorialBattleProps {
  /** 单元2 摆好的我方阵型（缺失 = 启动失败） */
  fleet: PlacedPlane[] | null
  onExitHome: () => void
}

export function TutorialBattle({ fleet, onExitHome }: TutorialBattleProps) {
  const orientation = useEffectiveOrientation()
  const toast = useToastStore((s) => s.push)
  const begin = useGameStore((s) => s.beginTutorialBattle)
  const resetGame = useGameStore((s) => s.reset)
  const difficulty = useSettingsStore((s) => s.difficulty)
  const { fx, flash } = useTutorialFx()

  const config: GridConfig = useMemo(() => ({ ...PRESETS.small }), [])
  /** 对手阵型（本单元生成并持有；幽灵标记真位判定用） */
  const oppFleetRef = useRef<PlacedPlane[] | null>(null)

  const [startFailed, setStartFailed] = useState(false)
  const [endedOpen, setEndedOpen] = useState(false)
  const [, tick] = useState(0)
  const rerender = useCallback(() => tick((x) => x + 1), [])

  /** 当前活动节点指针（开场链或某条教学支线） */
  const ptrRef = useRef<{ table: Table; nodeId: string; seg: number } | null>(null)
  const lastEventRef = useRef<TutorialGameEvent | null>(null)
  const startedRef = useRef(false)
  const sessionNonce = useGameStore((s) => s.session?.nonce ?? 0)
  const sessionLive = useGameStore((s) => s.session)
  /** 教学支线状态机：idle → queued（事件已到）→ running → done */
  const statusRef = useRef<{
    kill: 'idle' | 'queued' | 'running' | 'done'
    prefire: 'idle' | 'queued' | 'running' | 'done'
  }>({ kill: 'idle', prefire: 'idle' })
  const domModalOpen = useAnyModalOpen()
  const anyModalOpen = endedOpen || domModalOpen

  const currentNode = useCallback((): FlowNode | null => {
    const p = ptrRef.current
    return p ? (NODE_MAP[p.table].get(p.nodeId) ?? null) : null
  }, [])

  const startTask = useCallback(
    (table: 'kill' | 'prefire') => {
      statusRef.current[table] = 'running'
      ptrRef.current = { table, nodeId: TABLE_NODES[table][0]!.id, seg: 0 }
      rerender()
    },
    [rerender],
  )

  /** 教学支线结束：交棒给排队中的另一条 */
  const finishTask = useCallback(() => {
    const p = ptrRef.current
    if (p && p.table !== 'intro') statusRef.current[p.table] = 'done'
    ptrRef.current = null
    if (statusRef.current.kill === 'queued') startTask('kill')
    else if (statusRef.current.prefire === 'queued') startTask('prefire')
    else rerender()
  }, [rerender, startTask])

  const goNode = useCallback(
    (id: string | null) => {
      if (id == null) {
        finishTask()
        return
      }
      const p = ptrRef.current
      if (!p) return
      ptrRef.current = { table: p.table, nodeId: id, seg: 0 }
      rerender()
    },
    [finishTask, rerender],
  )

  /** 开场链结束 → 放开自由对局，并启动排队中的教学支线 */
  const finishIntro = useCallback(() => {
    ptrRef.current = null
    if (statusRef.current.kill === 'queued') startTask('kill')
    else if (statusRef.current.prefire === 'queued') startTask('prefire')
    else rerender()
  }, [rerender, startTask])

  /**
   * 幽灵标记判定：读取空网格上的幽灵/拖拽预览 DOM
   * （`.paper-grid__plane` 的 left/top = 旋转后包围盒左上角；宽高比 + 左上角相对 origin 的偏移
   *   可唯一反推旋转与机头格）。返回：
   *   'exact'    = 机头格与朝向都与被击毁飞机一致 → 通过；
   *   'headOnly' = 机头格一致但朝向不一致 → 失败提示；
   *   'none'     = 位置不符（不提示）。
   */
  const judgeElement = useCallback(
    (el: HTMLElement): 'exact' | 'headOnly' | 'none' => {
      const s = useGameStore.getState().session
      const oppFleet = oppFleetRef.current
      if (!s || !oppFleet) return 'none'
      const destroyed = s.state.players[1].destroyedPlaneIds
      if (destroyed.length === 0) return 'none'
      const target = oppFleet.find((p) => p.id === destroyed[0])
      if (!target) return 'none'
      const board = document.querySelector('.game__opp .paper-grid__board')?.getBoundingClientRect()
      if (!board || board.width <= 0) return 'none'
      const cell = board.width / config.width
      const visR = Math.round(parseFloat(el.style.top || '0') / cell)
      const visC = Math.round(parseFloat(el.style.left || '0') / cell)
      const wide = el.offsetWidth >= el.offsetHeight
      const tHead = rotateShape(DEFAULT_PLANE_SHAPE, target.rotation).head
      const trueHead = { r: target.origin.r + tHead.r, c: target.origin.c + tHead.c }
      let result: 'exact' | 'headOnly' | 'none' = 'none'
      for (const rot of [0, 1, 2, 3]) {
        const b = bboxOf(rot)
        if (b.w >= b.h !== wide) continue
        const origin = { r: visR - b.minR, c: visC - b.minC }
        const rel = headRel(rot)
        const head = { r: origin.r + rel.r, c: origin.c + rel.c }
        if (head.r !== trueHead.r || head.c !== trueHead.c) continue
        if (rot === target.rotation) return 'exact'
        result = 'headOnly'
      }
      return result
    },
    [config.width],
  )

  const judgeGhostById = useCallback(
    (id: string): 'exact' | 'headOnly' | 'none' => {
      const el = document.querySelector(
        `.game__opp .paper-grid__plane[data-plane-id="${id}"]`,
      ) as HTMLElement | null
      return el ? judgeElement(el) : 'none'
    },
    [judgeElement],
  )

  /** 事件分发：开场链按节点推进；两条教学支线条件【并行监听】 */
  const dispatchEvent = useCallback(
    (e: TutorialGameEvent) => {
      if (anyModalOpen) return
      lastEventRef.current = e

      // --- 并行条件监听（触发顺序无关；先到先播，另一条排队） ---
      if (e.type === 'planeKilled' && e.side === 1 && statusRef.current.kill === 'idle') {
        statusRef.current.kill = 'queued'
        flash('success')
        if (!ptrRef.current) startTask('kill')
      }
      if (e.type === 'preFireCreated' && statusRef.current.prefire === 'idle') {
        statusRef.current.prefire = 'queued'
        if (!ptrRef.current) startTask('prefire')
      }

      const p = ptrRef.current
      if (!p) return
      const node = currentNode()
      if (!node || node.kind !== 'wait' || !node.wait || !node.wait(e)) return

      // k2：幽灵落点判定（机头一致/朝向不一致 → 失败提示并留在本节点）
      if (node.id === 'k2' && e.type === 'ghostCreated') {
        const ghostId = e.id
        // ghostCreated 由引擎在状态更新时同步抛出，此刻 React 尚未把新幽灵渲染进 DOM；
        // 因此判定需等到元素出现（最多重试 6×60ms），否则会误判为“位置不符”而不给提示。
        const attempt = (n: number) => {
          if (ptrRef.current?.nodeId !== 'k2') return
          const verdict = judgeGhostById(ghostId)
          if (verdict === 'exact') {
            k2FailedFlag = false
            flash('success')
            goNode('k3')
            return
          }
          if (verdict === 'headOnly') {
            k2FailedFlag = true
            flash('failure')
            const cur = ptrRef.current
            if (cur) cur.seg = 0
            rerender()
            return
          }
          if (n < 6) window.setTimeout(() => attempt(n + 1), 60)
        }
        attempt(0)
        return
      }
      goNode(node.next ?? null)
    },
    [anyModalOpen, currentNode, flash, goNode, judgeGhostById, rerender, startTask],
  )

  /** 气泡点击：翻段；click 节点读毕 → after（null = 本链结束） */
  const onBubbleClick = useCallback(() => {
    if (anyModalOpen) return
    const p = ptrRef.current
    const node = currentNode()
    if (!p || !node) return
    const segs = segmentsOfNode(node, lastEventRef.current)
    if (p.seg + 1 < segs.length) {
      p.seg += 1
      rerender()
      return
    }
    if (node.kind === 'click') {
      if (p.table === 'intro' && node.after == null) finishIntro()
      else goNode(node.after ?? null)
      return
    }
    rerender()
  }, [anyModalOpen, currentNode, finishIntro, goNode, rerender])

  /* ---------- 开局（挂载一次） ---------- */
  useEffect(() => {
    resetGame()
    ptrRef.current = null
    statusRef.current = { kill: 'idle', prefire: 'idle' }
    k2FailedFlag = false
    if (!fleet || fleet.length === 0) {
      setStartFailed(true)
      return
    }
    const rng = mulberry32(((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0) || 1)
    try {
      const opp = generateFleet(config.width, config.height, config.planeCount, config.shape, difficulty, rng)
      oppFleetRef.current = opp
      const res = begin(config, fleet, opp)
      if (!res.ok) {
        toast(res.errors.join('；'), 'error')
        setStartFailed(true)
        return
      }
      startedRef.current = true
    } catch (err) {
      toast(err instanceof Error ? err.message : '教程对局生成失败', 'error')
      setStartFailed(true)
    }
  }, [begin, config, difficulty, fleet, resetGame, toast])

  /** 新对局就绪 → 开场链 i1 */
  useEffect(() => {
    if (sessionNonce > 0 && !ptrRef.current) {
      ptrRef.current = { table: 'intro', nodeId: 'i1', seg: 0 }
      rerender()
    }
  }, [sessionNonce, rerender])

  /** 退出收口：session 被清空 → 回主页 */
  useEffect(() => {
    if (startedRef.current && !useGameStore.getState().session) onExitHome()
  }, [sessionLive, onExitHome])

  /** 对局自然结束（胜负判定）→ 完成提示（不再提供“继续对局/提前完成”） */
  useEffect(() => {
    const st = useGameStore.getState().session?.state
    if (st?.phase === 'ended') {
      ptrRef.current = null
      setEndedOpen(true)
    }
  }, [sessionNonce, sessionLive])

  /* ---------- 幽灵拖动中持续判定（v0.3.14 item 10） ---------- */
  const activeNodeId = ptrRef.current?.nodeId ?? null
  useEffect(() => {
    if (activeNodeId !== 'k2') return
    const timer = window.setInterval(() => {
      if (ptrRef.current?.nodeId !== 'k2') return
      const els = document.querySelectorAll<HTMLElement>('.game__opp .paper-grid__plane[data-plane-id]')
      for (const el of els) {
        if (judgeElement(el) === 'exact') {
          k2FailedFlag = false
          flash('success')
          goNode('k3')
          return
        }
      }
    }, 120)
    return () => window.clearInterval(timer)
  }, [activeNodeId, flash, goNode, judgeElement])

  /* ---------- AI 门控：避开我方全部机头 + 行动间隔 1s + 教学气泡期间暂停 ---------- */
  const gateRef = useRef({ pausedUntil: 0, lastShots: -1 })
  const pauseAiRef = useRef(false)

  const aiShotSelector = useCallback(
    (knowledge: ShotKnowledge, rng: Rng): Cell | null => {
      const g = gateRef.current
      const now = Date.now()
      if (g.lastShots !== knowledge.shots.length) {
        g.lastShots = knowledge.shots.length
        g.pausedUntil = now + 1000
      }
      if (now < g.pausedUntil) return null
      if (pauseAiRef.current) return null
      const s = useGameStore.getState()
      const myPlanes = s.session?.state.players[0].planes ?? []
      const shape = s.session?.state.players[0].shape ?? config.shape
      const avoidHeads: Cell[] = myPlanes.map((p) => {
        const h = rotateShape(shape, p.rotation).head
        return { r: h.r + p.origin.r, c: h.c + p.origin.c }
      })
      return chooseTutorialShot(knowledge, { avoidHeads }, rng)
    },
    [config.shape],
  )

  /* ---------- 展示派生 ---------- */
  const node = currentNode()
  const segsNow = node ? segmentsOfNode(node, lastEventRef.current) : []
  const seg = ptrRef.current?.seg ?? 0
  const showBubble = !!node && segsNow.length > 0
  pauseAiRef.current = showBubble && !anyModalOpen
  const segText = showBubble ? (segsNow[Math.min(seg, segsNow.length - 1)] ?? '') : ''

  const resolveTarget = (t: string): string => {
    if (t.includes('.coloring-btn')) {
      return orientation === 'portrait' ? '.game__inputbar .coloring-btn' : '.coloring-stage__btn .coloring-btn'
    }
    return t
  }
  const rawHighlight: string | string[] | null = node?.highlight ?? null
  // 'bubble' 标记 = 该节点同时为 <突显对话气泡>；其余选择器 = <突显目标>。
  // 两者同时存在 = 混合模式（整屏压暗 + 目标处开洞，气泡 z 更高豁免可见/可点）
  const rawList: string[] = Array.isArray(rawHighlight) ? rawHighlight : rawHighlight ? [rawHighlight] : []
  const bubbleDim = rawList.includes('bubble')
  const holeSels = rawList.filter((t) => t !== 'bubble').map(resolveTarget)
  const highlight: string | string[] | null =
    holeSels.length === 0 ? null : holeSels.length === 1 && !Array.isArray(rawHighlight) ? holeSels[0]! : holeSels
  const hlText = rawList.filter((t) => t !== 'bubble').join(' ')
  const bubbleAnchor =
    hlText.includes('.game__inputbar') || hlText.includes('.coloring-btn') ? 'top' : 'bottom'

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

  if (startedRef.current && !sessionLive) return null

  return (
    <>
      <GameScreen onGameEvent={dispatchEvent} aiShotSelector={aiShotSelector} hideSettlement />

      {!anyModalOpen && (showBubble || highlight || bubbleDim) ? (
        <TutorialSpotlight target={highlight} dim={bubbleDim} />
      ) : null}
      {showBubble && !anyModalOpen ? (
        <TutorialBubble
          key={`${ptrRef.current?.table ?? ''}-${node!.id}`}
          text={segText}
          showHint={node!.kind === 'click'}
          anchor={bubbleAnchor}
          onClick={onBubbleClick}
        />
      ) : null}
      <TutorialFxBand fx={fx} />

      {/* 完成提示：对局自然结束后展示（仅“返回主页”，不再提供继续/提前完成） */}
      <PaperModal
        open={endedOpen}
        title="教程完成"
        onClose={() => {}}
        footer={
          <PaperButton variant="primary" onClick={onExitHome}>
            返回主页
          </PaperButton>
        }
      >
        <p style={{ margin: 0 }}>本局对局已结束，恭喜完成新手教程！</p>
      </PaperModal>
    </>
  )
}
