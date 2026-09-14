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
 * - 幽灵标记判定（v0.3.17-beta5）：读取空网格上幽灵 DOM（包围盒左上角 + 朝向）做【每步重复检测】——
 *   · 只要幽灵发生位置/朝向变化（拖动落定、点击旋转、移出再放回）就重新评估三态；
 *   · 仍保留 beta3「必须松手才算」语义：pointerdown 期间（拖动中）一律不判定，松手落定后才评估；
 *   · 同一架飞机同一判定结果只提示一次，结果变化后才允许再次提示（不刷屏）；
 *   · 失败【不自动回收】幽灵：玩家可直接拖动/旋转同一架幽灵重试（引擎对已放置副本走 move/rotate，同 id 不会被重叠拒绝）。
 * - 完成：教程不再提供“提前完成/继续对局”弹窗；对局自然结束（胜负判定）后展示完成提示 → 返回主页。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Cell, GridConfig, PlacedPlane } from '@aero/shared'
import { DEFAULT_PLANE_SHAPE, PRESETS } from '@aero/shared'
import { rotateShape } from '@aero/game-core'
import { chooseTutorialShot, generateFleet } from '@aero/game-core/ai'
import type { Rng, ShotKnowledge } from '@aero/game-core/ai'
import { useEffectiveOrientation } from '../hooks/useOrientation'
import { useGameStore } from '../store/gameStore'
import { useSettingsStore } from '../store/settingsStore'
import { useToastStore } from '../store/toastStore'
import { PaperButton } from '../components/ui/PaperButton'
import { GameScreen } from '../pages/GameScreen'
import { TutorialBubble } from './TutorialBubble'
import { TutorialSpotlight } from './TutorialSpotlight'
import { TutorialTopLayerPortal } from './TutorialTopLayer'
import { TutorialFxBand, useTutorialFx } from './TutorialFx'
import { useAnyModalOpen } from './useAnyModalOpen'
import { useSingleTapBridge } from './useSingleTapBridge'
import { makeRng } from '../lib/rng'
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
    // 判定不通过（机头一致/朝向不一致）时显示失败文案；否则展示教学两段
    // （v0.3.17-beta5：文案只由“最近一次判定结果”决定，移动/旋转同样能触发失败文案）
    text: () => (k2FailedFlag ? T.k2fail : T.k2),
    // v0.3.17-beta5：判定改由「每步重复检测」watcher 驱动（松手落定后反复评估三态），
    // 本节点不再靠事件推进；恒不匹配，避免 ghostCreated 直接把节点推到 k3。
    wait: () => false,
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

/** k2 失败文案开关（模块级：避免每次重建节点表）；由每步重复检测 watcher 维护 */
let k2FailedFlag = false

/** k2 幽灵三态判定结果 */
type K2Verdict = 'exact' | 'headOnly' | 'none'

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
  const anyModalOpen = domModalOpen

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

      // k2 不在这里推进（wait 恒 false）：幽灵落点判定由「每步重复检测」watcher 负责
      goNode(node.next ?? null)
    },
    [anyModalOpen, currentNode, goNode, rerender, startTask],
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
    // v0.3.15：教程内随机源统一走 makeRng（e2e 注入种子后对手阵型完全可复现；无种子保持随机）
    const rng = makeRng(101)
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
      // v0.3.18-beta3 根因 B：会话就绪的同一次提交内就把开场链节点设好，
      // 避免“新阶段已挂载、节点还是 null”的那一帧（active=false → 整页洞 + 0 阻断带）。
      ptrRef.current = { table: 'intro', nodeId: 'i1', seg: 0 }
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

  /**
   * 对局自然结束（胜负判定）：清掉教学覆盖层，**交给 GameScreen 的常规结算画面**展示
   * （v0.3.17-beta4 item 3：不再有教程自己的完成弹窗；结算页无「再来一局」由 hideRematch 控制）
   */
  useEffect(() => {
    const st = useGameStore.getState().session?.state
    if (st?.phase === 'ended') ptrRef.current = null
  }, [sessionNonce, sessionLive])

  /* ---------- 幽灵判定（v0.3.17-beta3 item 7） ----------
     beta2 曾在拖动中（未松手）判定通过；现按要求改回：**必须在 ghostCreated（彻底放下）后**才判定，
     拖动/移动过程中不推进节点。 */

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

  /* ---------- k2 幽灵判定：每步重复检测（v0.3.17-beta5） ----------
   * 只要幽灵的位置或朝向发生变化（拖动落定 / 点击旋转 / 移出再放回），就重新评估三态：
   *   ① 机头格一致且朝向一致 → 成功（k3）；
   *   ② 机头格一致但朝向不同 → 失败提示（留在 k2，不回收幽灵）；
   *   ③ 其他位置 → 不提示，继续等待。
   * 判定时机：pointerdown 期间（拖动中）一律不评估，松手落定后评估（保留 beta3「必须松手才算」语义）；
   * 幂等：同一架飞机同一结果只提示一次，结果变化后才再次提示。 */
  const judgeGhostRef = useRef(judgeGhostById)
  judgeGhostRef.current = judgeGhostById
  const goNodeRef = useRef(goNode)
  goNodeRef.current = goNode
  const flashRef = useRef(flash)
  flashRef.current = flash
  const modalOpenRef = useRef(anyModalOpen)
  modalOpenRef.current = anyModalOpen
  /** 每架幽灵最近一次判定结果（“同一架 + 同一结果”只提示一次） */
  const k2VerdictsRef = useRef<Map<string, K2Verdict>>(new Map())
  /** 成功分支是否已处理（幂等：轮询/松手多次评估不得重复播成功反馈或重复推进节点） */
  const k2DoneRef = useRef(false)
  const k2Active = !!node && node.id === 'k2'

  useEffect(() => {
    if (!k2Active) return
    k2VerdictsRef.current = new Map()
    k2DoneRef.current = false
    k2FailedFlag = false
    let pointerDown = false
    const timers: number[] = []

    const evaluate = () => {
      const p = ptrRef.current
      if (!p || p.nodeId !== 'k2') return
      if (modalOpenRef.current) return
      // 空网格上的全部幽灵（排除参考体拖拽预览 id=-1；隐藏/拖离棋盘的实例跳过）
      const ghosts = Array.from(
        document.querySelectorAll<HTMLElement>('.game__opp .paper-grid__plane[data-plane-id]'),
      ).filter((el) => el.getAttribute('data-plane-id') !== '-1' && el.offsetWidth > 0)
      if (ghosts.length === 0) return
      const verdicts = k2VerdictsRef.current
      const seen = new Set<string>()
      let exact = false
      let headOnly = false
      let changedToHeadOnly = false
      for (const el of ghosts) {
        const id = el.getAttribute('data-plane-id')!
        seen.add(id)
        const v = judgeGhostRef.current(id)
        if (v === 'exact') exact = true
        else if (v === 'headOnly') {
          headOnly = true
          if (verdicts.get(id) !== 'headOnly') changedToHeadOnly = true
        }
        verdicts.set(id, v)
      }
      for (const id of Array.from(verdicts.keys())) if (!seen.has(id)) verdicts.delete(id)

      if (exact) {
        if (k2DoneRef.current) return
        k2DoneRef.current = true
        k2FailedFlag = false
        flashRef.current('success')
        goNodeRef.current('k3')
        return
      }
      if (changedToHeadOnly) {
        k2FailedFlag = true
        flashRef.current('failure')
        goNodeRef.current('k2')
        return
      }
      // 已不再是「机头对/朝向错」→ 收回失败文案，回到常规两段引导（状态变化才允许再提示）
      if (!headOnly && k2FailedFlag) {
        k2FailedFlag = false
        goNodeRef.current('k2')
      }
    }

    const onDown = () => {
      pointerDown = true
    }
    const onUp = () => {
      pointerDown = false
      // 落定需等 React 提交 + DOM 更新：稍后评估，并留一次兜底重试
      timers.push(window.setTimeout(evaluate, 80), window.setTimeout(evaluate, 260))
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('pointerup', onUp, true)
    window.addEventListener('pointercancel', onUp, true)
    // 静默兜底轮询（仅在没有按下指针时评估 → 拖动中不会误判）
    const poll = window.setInterval(() => {
      if (!pointerDown) evaluate()
    }, 150)
    return () => {
      window.clearInterval(poll)
      for (const t of timers) window.clearTimeout(t)
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('pointerup', onUp, true)
      window.removeEventListener('pointercancel', onUp, true)
    }
  }, [k2Active])

  const resolveTarget = (t: string): string => {
    if (t.includes('.coloring-btn')) {
      return orientation === 'portrait' ? '.game__inputbar .coloring-btn' : '.coloring-stage__btn .coloring-btn'
    }
    return t
  }
  // v0.3.16：教程对局兼容「单击报点」设置（GameScreen 在注入 onGameEvent 时保持两步语义）
  const singleTapShot = useSettingsStore((s) => s.singleTapShot)
  useSingleTapBridge(singleTapShot)

  /** 遮罩激活态（v0.3.16：淡出滞留由 TutorialSpotlight 内部处理，此处只需给出 active） */
  const overlayActive = showBubble || !!(node?.highlight ?? null)
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
      {/* 教程对局：hideBannerBackdrop = 横幅不渲染自带暗底（避免与遮罩双重压暗）；
          hideRematch = 结算画面不显示「再来一局」（教程上下文只回主页）；
          hideFirstTurnBanner = 不显示「您先手/您后手」横幅（v0.3.18-beta2 item 7，仅教程模式）；
          不再传 hideSettlement —— 教程对局需要展示常规结算画面 */}
      <GameScreen
        onGameEvent={dispatchEvent}
        aiShotSelector={aiShotSelector}
        hideRematch
        hideBannerBackdrop
        hideFirstTurnBanner
      />

      {/* 弹窗期间由组件内部处理（渲染基础态遮罩、不渲染阻断带），避免“界面已显示但遮罩未就位”的帧 */}
      <TutorialSpotlight active={overlayActive} target={highlight} dim={bubbleDim} />
      {showBubble && !anyModalOpen ? (
        // v0.3.18-beta2 item 4：气泡同样结构化置顶（自带 fixed 视口坐标，portal 后坐标不变），
        // 规避祖先堆叠上下文把它压到遮罩之下
        <TutorialTopLayerPortal>
          <TutorialBubble
            key={`${ptrRef.current?.table ?? ''}-${node!.id}`}
            text={segText}
            showHint={node!.kind === 'click'}
            anchor={bubbleAnchor}
            onClick={onBubbleClick}
          />
        </TutorialTopLayerPortal>
      ) : null}
      <TutorialFxBand fx={fx} />

    </>
  )
}
