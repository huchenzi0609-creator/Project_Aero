/**
 * TutorialBattle —— 教程·单元3「初次实战·对局」（v0.3.13 重写）。
 *
 * 经典 10×10 / 3 架对局：我方先手（beginTutorialBattle 固定 firstMover=0、关闭绝杀），
 * 对手 AI 避开我方全部机头、行动间隔 1s（GameScreen.aiShotSelector 门控）。
 *
 * 事件驱动教程机（click / wait 节点）：
 *   n1 实战开场 → n2 我方网格 → n3 参考网格 → n4 空网格引导报点 → n5 等首次报点 →
 *   n6 正向反馈（取消全部突显）→ n7 等首次击毁（成功提示）→ n8 击毁教学 → n9 参考网格拖幽灵 →
 *   n10 幽灵标记判定（真位 + 朝向正确 → 成功；否则失败重试）→ n11 [飞机就在这里！] →
 *   n12 突显着色按钮（等进入着色）→ n13 突显空网格（等着色模式下点击幽灵）→
 *   n14 标记教学完成 → n15 等预报点创建 → n16 预报点教学（5 段）→ 完成弹窗（完成教程 / 继续对局）。
 *
 * 幽灵标记判定：GameScreen 不向教程暴露幽灵坐标，故读取其渲染的幽灵 DOM
 * （`.game__opp .paper-grid__plane[data-plane-id]` 的 style.left/top = 旋转后包围盒左上角格位，
 *   与 PaperGrid.tsx 飞机层定位公式一致），对照本单元生成的对手阵型真位（oppFleetRef）：
 *   旋转由「宽高类别 + 包围盒左上角相对 origin 的偏移」唯一确定（默认形状 4 朝向互不重叠）。
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
  /** 展示文本（wait 节点返回空数组 = 隐藏气泡、静默等待事件） */
  text?: NodeText
  /** wait 事件谓词 */
  wait?: (e: TutorialGameEvent) => boolean
  /** click 节点读毕的目标 id（null = 流程完成 → 完成弹窗） */
  after?: string | null
  /** wait 事件命中后的目标 id（判定的节点在 dispatch 内特殊处理，可不用） */
  next?: string | null
  /** 突显目标：'bubble' = 整屏压暗突出气泡；null = 不突显（无遮罩、全可交互） */
  highlight?: string | string[] | null
  /** 事件命中时的屏幕边缘提示 */
  flashOnMatch?: 'success' | 'failure'
  /** 展示/等待期间暂停 AI（如预报点教学 n15：需要对手回合持续存在才能创建预报点） */
  pauseAi?: boolean
  /** 进入节点时的副作用 */
  onEnter?: () => void
}

/** 气泡文本（§5 手稿，单元3） */
const T = {
  n1: ['现在，我们正式进入实战！'],
  n2: ['这是你刚才摆的阵型，从这里可以看到对方是怎么攻击我方的。'],
  n3: ['这是参考网格，如果忘了飞机的形状，可以用于参考。'],
  n4: ['这是空网格，你需要通过双击报点来获得对方飞机的信息。试试看！'],
  n6: ['好极了！运用你刚才学到的所有技巧，高效地摧毁对手的飞机吧！'],
  n8: ['你成功摧毁了对方的飞机！'],
  n9: [
    '被击毁的飞机*不会自动显示*，因此要自行标记被击毁飞机位置。',
    '尝试从*参考网格*处拖动飞机，并将其放置到需要标记的位置。',
  ],
  n10fail: ['好像不太对，试试换个朝向吧。'],
  n11: ['飞机就在这里！'],
  n12: ['接下来，试试点击着色工具按钮！'],
  n13: ['现在，试试点击你刚才摆放的飞机！'],
  n14: ['现在，你学会了如何标记被击毁的飞机。'],
  n16: [
    '你刚才看见的红色“？”是预报点标记。',
    '如果当前不是你的回合，报点将会产生预报点标记。',
    '这些标记将会在你的回合时被依次转化为报点。',
    '双击一个预报点标记可以消除它。',
    '预报点标记最多可以同时存在10个。',
  ],
}

/**
 * 拖拽幽灵必须同时突显【参考网格】与【空网格】：
 * <突显> 为模态（非突显区域不可交互），只突显参考网格将无法把飞机拖入空网格。
 */
const GHOST_DRAG_HL: string[] = ['.game__ref', '.game__opp']

/** 节点表 */
function buildNodes(): FlowNode[] {
  return [
    { id: 'n1', kind: 'click', text: T.n1, after: 'n2', highlight: 'bubble' },
    { id: 'n2', kind: 'click', text: T.n2, after: 'n3', highlight: '.game__mine' },
    { id: 'n3', kind: 'click', text: T.n3, after: 'n4', highlight: '.game__ref' },
    { id: 'n4', kind: 'click', text: T.n4, after: 'n5', highlight: '.game__opp' },
    { id: 'n5', kind: 'wait', wait: (e) => e.type === 'shotByPlayer', next: 'n6', highlight: '.game__opp' },
    { id: 'n6', kind: 'click', text: T.n6, after: 'n7', highlight: null },
    {
      id: 'n7',
      kind: 'wait',
      wait: (e) => e.type === 'planeKilled' && e.side === 1,
      next: 'n8',
      highlight: null,
      flashOnMatch: 'success',
    },
    { id: 'n8', kind: 'click', text: T.n8, after: 'n9', highlight: ['.game__opp'] },
    { id: 'n9', kind: 'click', text: T.n9, after: 'n10', highlight: GHOST_DRAG_HL },
    {
      id: 'n10',
      kind: 'wait',
      // 失败提示：判定不通过后（failedHintRef）展示失败文本并停留在本节点重试
      text: (e) => (failedHint && e?.type === 'ghostCreated' ? T.n10fail : []),
      wait: (e) => e.type === 'ghostCreated',
      highlight: GHOST_DRAG_HL,
    },
    { id: 'n11', kind: 'click', text: T.n11, after: 'n12', highlight: ['.game__opp'] },
    {
      id: 'n12',
      kind: 'wait',
      text: T.n12,
      wait: (e) => e.type === 'enteredColoring',
      next: 'n13',
      highlight: ['.game__opp', '.coloring-btn'],
    },
    {
      id: 'n13',
      kind: 'wait',
      text: T.n13,
      // 着色模式下直接点击幽灵（deliberate）才推进，避免误触其它染色事件
      wait: (e) => e.type === 'ghostBatchColored' && e.viaGhostPointerDown === true,
      next: 'n14',
      highlight: '.game__opp',
      flashOnMatch: 'success',
    },
    { id: 'n14', kind: 'click', text: T.n14, after: 'n15', highlight: null },
    {
      id: 'n15',
      kind: 'wait',
      wait: (e) => e.type === 'preFireCreated',
      next: 'n16',
      highlight: null,
      // 预报点只能在【对手回合】创建（且需两次点击）：暂停 AI，使对手回合保持存在
      pauseAi: true,
    },
    { id: 'n16', kind: 'click', text: T.n16, after: null, highlight: 'bubble' },
  ]
}

// n10 文本谓词引用（节点表构造时闭包读取模块级可变标志，避免重建节点表）
let failedHint = false

/** 旋转后包围盒信息（默认形状下 4 朝向的 (minR,minC,w,h) 互不相同 → 可唯一反推 rotation） */
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

function segmentsOfNode(node: FlowNode, e: TutorialGameEvent | null): string[] {
  if (typeof node.text === 'function') return node.text(e)
  return node.text ?? []
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
  const nodes = useMemo(() => buildNodes(), [])
  const nodeMapRef = useRef(new Map(nodes.map((n) => [n.id, n])))
  nodeMapRef.current = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])

  /** 对手阵型（本单元生成并持有；幽灵标记真位判定用） */
  const oppFleetRef = useRef<PlacedPlane[] | null>(null)

  const [startFailed, setStartFailed] = useState(false)
  const [doneOpen, setDoneOpen] = useState(false)
  const [free, setFree] = useState(false)
  const [, tick] = useState(0)
  const runRef = useRef<{ nodeId: string; seg: number } | null>(null)
  const lastEventRef = useRef<TutorialGameEvent | null>(null)
  const startedRef = useRef(false)
  const finishedRef = useRef(false)
  const sessionNonce = useGameStore((s) => s.session?.nonce ?? 0)
  const sessionLive = useGameStore((s) => s.session)
  /** 弹窗门控：自身完成弹窗 + 任何已打开弹窗（含对局内退出确认等外部弹窗）——
   *  弹窗打开期间不渲染阻断带/暗层/气泡，保证弹窗永不被教程层拦截（v0.3.13 加固） */
  const domModalOpen = useAnyModalOpen()
  const anyModalOpen = doneOpen || domModalOpen
  const rerender = useCallback(() => tick((x) => x + 1), [])

  const currentNode = useCallback((): FlowNode | null => {
    const r = runRef.current
    return r ? (nodeMapRef.current.get(r.nodeId) ?? null) : null
  }, [])

  const goNode = useCallback(
    (id: string | null) => {
      if (id == null) {
        runRef.current = null
        finishedRef.current = true
        setDoneOpen(true)
        rerender()
        return
      }
      runRef.current = { nodeId: id, seg: 0 }
      nodeMapRef.current.get(id)?.onEnter?.()
      rerender()
    },
    [rerender],
  )

  /**
   * 幽灵标记判定：真位 + 朝向全部正确才算通过。
   * 位置取幽灵 DOM 包围盒左上角格位（与 PaperGrid 飞机层定位公式一致）；
   * 朝向由「宽高类别 + 包围盒左上角相对 origin 的偏移」与 4 个候选旋转逐一比对得出。
   */
  const judgeGhost = useCallback(
    (id: string): boolean => {
      const s = useGameStore.getState().session
      const oppFleet = oppFleetRef.current
      if (!s || !oppFleet || !id) return false
      const destroyed = s.state.players[1].destroyedPlaneIds
      if (destroyed.length === 0) return false
      const target = oppFleet.find((p) => p.id === destroyed[0])
      if (!target) return false
      const board = document
        .querySelector('.game__opp .paper-grid__board')
        ?.getBoundingClientRect()
      const el = document.querySelector(
        `.game__opp .paper-grid__plane[data-plane-id="${id}"]`,
      ) as HTMLElement | null
      if (!board || !el || board.width <= 0) return false
      const cell = board.width / config.width
      const visR = Math.round(parseFloat(el.style.top || '0') / cell)
      const visC = Math.round(parseFloat(el.style.left || '0') / cell)
      const wide = el.offsetWidth >= el.offsetHeight
      let visualRotation: number | null = null
      for (const rot of [0, 1, 2, 3]) {
        const b = bboxOf(rot)
        if (b.w >= b.h !== wide) continue
        if (target.origin.r + b.minR === visR && target.origin.c + b.minC === visC) {
          visualRotation = rot
          break
        }
      }
      return visualRotation === target.rotation
    },
    [config.width],
  )

  /** 事件分发 */
  const dispatchEvent = useCallback(
    (e: TutorialGameEvent) => {
      if (anyModalOpen || free || !runRef.current) return
      lastEventRef.current = e
      const node = currentNode()
      if (!node || node.kind !== 'wait' || !node.wait || !node.wait(e)) return
      if (node.flashOnMatch) flash(node.flashOnMatch)
      if (node.id === 'n10') {
        const id = e.type === 'ghostCreated' ? e.id : ''
        if (judgeGhost(id)) {
          failedHint = false
          flash('success')
          goNode('n11')
        } else {
          failedHint = true
          flash('failure')
          const r = runRef.current
          if (r) r.seg = 0
          rerender()
        }
        return
      }
      goNode(node.next ?? null)
    },
    [anyModalOpen, currentNode, flash, free, goNode, judgeGhost, rerender],
  )

  /** 气泡点击：翻段；click 节点读毕 → after（null = 完成） */
  const onBubbleClick = useCallback(() => {
    if (anyModalOpen) return
    const r = runRef.current
    const node = currentNode()
    if (!r || !node) return
    const segs = segmentsOfNode(node, lastEventRef.current)
    if (r.seg + 1 < segs.length) {
      r.seg += 1
      rerender()
      return
    }
    if (node.kind === 'click') goNode(node.after ?? null)
    else rerender()
  }, [anyModalOpen, currentNode, goNode, rerender])

  /* ---------- 开局（挂载一次） ---------- */
  useEffect(() => {
    resetGame()
    runRef.current = null
    finishedRef.current = false
    failedHint = false
    if (!fleet || fleet.length === 0) {
      setStartFailed(true)
      return
    }
    const rng = mulberry32(((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0) || 1)
    try {
      const opp = generateFleet(
        config.width,
        config.height,
        config.planeCount,
        config.shape,
        difficulty,
        rng,
      )
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

  /** 新对局就绪 → 从 n1 开始 */
  useEffect(() => {
    if (sessionNonce > 0 && !runRef.current && !finishedRef.current) goNode('n1')
  }, [sessionNonce, goNode])

  /** 退出收口（任意阶段）：session 被清空 → 回主页 */
  useEffect(() => {
    if (startedRef.current && !useGameStore.getState().session) onExitHome()
  }, [sessionLive, onExitHome])

  /** 终局兜底：教程未走完但对局已结束（玩家提前获胜/落败）→ 直接完成弹窗 */
  useEffect(() => {
    if (free || anyModalOpen) return
    const st = useGameStore.getState().session?.state
    if (st?.phase === 'ended' && runRef.current) goNode(null)
  }, [sessionNonce, sessionLive, free, anyModalOpen, goNode])

  /* ---------- AI 门控：避开我方全部机头 + 行动间隔 1s ---------- */
  const gateRef = useRef({ pausedUntil: 0, lastShots: -1 })
  /** AI 暂停：教程气泡展示期间 + 声明 pauseAi 的教学节点（n15 预报点） */
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
      // 教程气泡展示 / 教学节点期间 AI 不动手（保持教学节奏；n15 需对手回合持续存在）
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
  const r = runRef.current
  const node = currentNode()
  const segsNow = node && r ? segmentsOfNode(node, lastEventRef.current) : []
  const showBubble = !!node && !free && r != null && segsNow.length > 0
  pauseAiRef.current = !free && !!node && (node.pauseAi === true || (showBubble && !anyModalOpen))
  const segText = showBubble ? (segsNow[Math.min(r!.seg, segsNow.length - 1)] ?? '') : ''

  const resolveTarget = (t: string): string => {
    if (t.includes('.coloring-btn')) {
      return orientation === 'portrait'
        ? '.game__inputbar .coloring-btn'
        : '.coloring-stage__btn .coloring-btn'
    }
    return t
  }
  const rawHighlight: string | string[] | null = !free && node?.highlight ? node.highlight : null
  // 'bubble' 突显 = 整屏压暗无洞（气泡 z 高于遮罩、豁免开洞，暗背景使其轮廓突出）
  const bubbleDim = rawHighlight === 'bubble'
  const highlight = bubbleDim
    ? null
    : Array.isArray(rawHighlight)
      ? rawHighlight.map(resolveTarget)
      : rawHighlight
        ? resolveTarget(rawHighlight)
        : null
  // 突显目标位于底部输入栏/着色按钮时气泡上置（避免遮挡底部按钮）
  const hlText = Array.isArray(node?.highlight) ? node.highlight.join(' ') : (node?.highlight ?? '')
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
      <GameScreen
        onGameEvent={dispatchEvent}
        aiShotSelector={free ? undefined : aiShotSelector}
        hideSettlement={!free}
      />

      {!anyModalOpen && (showBubble || highlight || bubbleDim) ? (
        <TutorialSpotlight target={highlight} dim={bubbleDim} />
      ) : null}
      {/* 弹窗打开期间 TutorialSpotlight 内部亦返回 null（useAnyModalOpen 二道防线） */}
      {showBubble && !anyModalOpen ? (
        <TutorialBubble
          key={node!.id}
          text={segText}
          showHint={node!.kind === 'click'}
          anchor={bubbleAnchor}
          onClick={onBubbleClick}
        />
      ) : null}
      <TutorialFxBand fx={fx} />

      <PaperModal
        open={doneOpen}
        title="新手教程"
        onClose={() => {}}
        footer={
          <>
            <PaperButton variant="ghost" onClick={onExitHome}>
              完成教程
            </PaperButton>
            <PaperButton
              variant="primary"
              onClick={() => {
                // 对局已结束：无法继续，直接收口
                if (useGameStore.getState().session?.state.phase === 'ended') {
                  onExitHome()
                  return
                }
                gateRef.current = { pausedUntil: 0, lastShots: -1 }
                setFree(true)
                setDoneOpen(false)
              }}
            >
              继续对局
            </PaperButton>
          </>
        }
      >
        <p style={{ margin: 0 }}>教程已完成，是否完成对局？</p>
      </PaperModal>
    </>
  )
}
