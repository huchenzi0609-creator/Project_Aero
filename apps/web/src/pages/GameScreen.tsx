/**
 * GameScreen —— 单机对局页（M4 交付物 2/3/4）。
 *
 * 流程：
 * - 摆阵确认后进入本页：先展示 1.5s 先后手横幅（与 createGame 的 firstMover 一致）；
 * - 对战：顶部状态条（超快棋 blitz 时右侧显示双方 BlitzClock）、样式参考图（5×5，本局形状+旋转演示）、
 *   我方小网格（1/2 尺寸，竖版右上 / 横版右侧居中）、对手大网格居中、底部坐标输入框；
 * - 报点：点格高亮→再点同一格报点（点他格转移高亮）；输入框坐标+回车/确认；
 *   已报格禁点；非法坐标抖动+Toast；
 * - v0.3.0：盲棋重复报点放行（对手网格只显示最近可见标记窗口，参考飞机/着色禁用）；
 *   预报点 = 非我方回合点击空网格创建「?」（上限 10），点选/输入可取消，我方回合开始 FIFO 自动上报；
 *   blitz 时钟实时走秒（仅当前回合方计时），超时判负弹结算；
 * - 我方报点 → applyShot → 渲染；AI 300~900ms 后 chooseShot 报点 →
 *   我方网格 0.8s 高亮动画 + 状态条"对方报点 Xn：…" → 渲染 → 回到我方回合；
 * - 绝地反击：状态条提示并获得一次额外报点机会；终局 → 结算（胜负文案+双方真实阵型+统计）。
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Cell, Shot } from '@aero/shared'
import { DEFAULT_PLANE_SHAPE } from '@aero/shared'
import {
  boundingBox,
  formatCoord,
  inBounds,
  killEfficiencyStats,
  occupiedCells,
  parseCoord,
  visibleMarks,
} from '@aero/game-core'
import type { GameState, ShotResult } from '@aero/game-core'
import { chooseShot } from '@aero/game-core/ai'
import type { Rng, ShotKnowledge } from '@aero/game-core/ai'
import { useAppStore } from '../store/appStore'
import { useGameStore } from '../store/gameStore'
import { useGuestStore } from '../store/guestStore'
import { useSettingsStore } from '../store/settingsStore'
import { useToastStore } from '../store/toastStore'
import { useEffectiveOrientation, useViewport } from '../hooks/useOrientation'
import type { Viewport } from '../hooks/useOrientation'
import { audioService } from '../lib/audioService'
import { PaperButton } from '../components/ui/PaperButton'
import { PaperCard } from '../components/ui/PaperCard'
import { PaperModal } from '../components/ui/PaperModal'
import { PaperGrid } from '../components/grid/PaperGrid'
import { PlaneGlyph } from '../components/grid/PlaneGlyph'
import { StampMark } from '../components/grid/StampMark'
import {
  ColoringToolButton,
  ghostRectAt,
  refShotsFor,
  useColoring,
  useRefPlanes,
} from '../components/grid/ColoringTool'
import type { ColoringColor, GhostRect, PaintBrush } from '../components/grid/ColoringTool'
import { BlitzClock } from '../components/v030/BlitzClock'
import { PreFireMark } from '../components/v030/PreFireMark'
import type { TutorialGameEvent } from '../tutorial/events'

const OUTCOME_TEXT: Record<string, string> = {
  miss: '击空',
  hit: '击中',
  kill: '击毁',
}

const cellKey = (c: Cell) => `${c.r},${c.c}`

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

interface GameScreenProps {
  mode?: 'single' | 'online'
  /** 教程事件钩子（v0.3.0 预留，M8 TutorialProvider 注入；为空零开销） */
  onGameEvent?: (e: TutorialGameEvent) => void
  /** 教程 AI 注入（v0.3.0）：替代默认 chooseShot 的出手决策；
   *  返回 null = 本帧不出手（教程用它暂停 AI），此后由本组件轮询直至放行。缺省用默认 AI。 */
  aiShotSelector?: (knowledge: ShotKnowledge, rng: Rng) => Cell | null
  /** 教程（v0.3.1）：终局不弹出胜负结算 overlay（只发 playerWin/playerLose 事件，由教程气泡/弹窗接管） */
  hideSettlement?: boolean
}

export function GameScreen({ mode = 'single', onGameEvent, aiShotSelector, hideSettlement }: GameScreenProps) {
  const session = useGameStore((s) => s.session)
  const applyShotAt = useGameStore((s) => s.applyShotAt)
  const advanceBlitz = useGameStore((s) => s.advanceBlitz)
  const queuePreFireAt = useGameStore((s) => s.queuePreFireAt)
  const cancelPreFireAt = useGameStore((s) => s.cancelPreFireAt)
  const takePreFireShot = useGameStore((s) => s.takePreFireShot)
  const resetGame = useGameStore((s) => s.reset)
  const setView = useAppStore((s) => s.setView)
  const toast = useToastStore((s) => s.push)
  const guestName = useGuestStore((s) => s.name)
  const difficulty = useSettingsStore((s) => s.difficulty)
  const bgmVolume = useSettingsStore((s) => s.bgmVolume)
  const sfxVolume = useSettingsStore((s) => s.sfxVolume)
  const settingsAllowMove = useSettingsStore((s) => s.allowMoveRefPlane)
  const invertMarks = useSettingsStore((s) => s.invertMarks)

  const orientation = useEffectiveOrientation()
  const viewport = useViewport()

  const [screen, setScreen] = useState<'banner' | 'battle' | 'result'>('banner')
  const [highlight, setHighlight] = useState<Cell | null>(null)
  const [input, setInput] = useState('')
  const [aiFlash, setAiFlash] = useState<Cell | null>(null)
  const [aiMsg, setAiMsg] = useState<string | null>(null)
  const [myMsg, setMyMsg] = useState<string | null>(null)
  const [shake, setShake] = useState(false)
  const [exitOpen, setExitOpen] = useState(false)
  /** 预报点「选中待确认/取消」格（非我方回合高亮；我方回合一律清空） */
  const [pfSel, setPfSel] = useState<Cell | null>(null)
  const shakeTimer = useRef(0)
  const sfxTimers = useRef<number[]>([])
  const oppBoardRef = useRef<HTMLDivElement | null>(null)
  const refAreaRef = useRef<HTMLElement | null>(null)
  /** 终局事件/胜负音已上报标记（每局一次，防 effect 依赖变化重复触发） */
  const endReportedRef = useRef(false)

  /** 延时播放音效（如报点后的盖章/击毁结果音），统一登记便于卸载清理 */
  const playSfxAt = (name: Parameters<typeof audioService.playSfx>[0], delayMs: number) => {
    sfxTimers.current.push(window.setTimeout(() => audioService.playSfx(name), delayMs))
  }

  const state: GameState | null = session?.state ?? null
  const config = session?.config
  const me = session?.me ?? 0
  const ai = session?.ai ?? 1

  /* ---------- v0.3.0 规则开关（config 由摆阵页 CustomConfig 写入 GridConfig.blitz/blind） ---------- */
  const isBlind = config?.blind ?? false
  const isBlitz = config?.blitz ?? false

  /* ---------- 预报点队列（引擎权威）与逻辑回合签名（R2） ---------- */
  const myPreFire: readonly Cell[] = (state?.preFire?.[me] ?? []) as readonly Cell[]
  const myPreFireKeys = useMemo(() => new Set(myPreFire.map(cellKey)), [myPreFire])
  // 逻辑签名只在“对局实质推进”（回合/阶段/局次/队列）时变化：
  // blitz 时钟每 ~100ms 的纯计时写入不改变它，依赖它的“AI 出手 / 预报点自动上报”定时 effect
  // 不会被时钟写入反复 cleanup + 重排导致 setTimeout 永不触发。
  const turnSig = state ? `${session?.nonce ?? 0}|${state.phase}|${state.turn}|${state.turnNo}` : ''
  const queueSig = state ? `${turnSig}|${myPreFire.length}|${myPreFire[0] ? cellKey(myPreFire[0]!) : ''}` : ''

  /* ---------- 着色工具（每局独立，新对局清空；v0.3.0 幽灵着色/快捷着色） ---------- */
  // 幽灵飞机（在场放置副本）的活动列表：由 refPlanes.placed 经 useLayoutEffect 同步（见下），
  // 回收 = 从本列表移除；渲染过滤走 retiredGhostIds（双状态分开驱动，避免快照着色的点击滞后）。
  const [ghostRects, setGhostRects] = useState<GhostRect[]>([])
  const [retiredGhostIds, setRetiredGhostIds] = useState<ReadonlySet<string>>(new Set())
  // onGhostBatch 需要引用在 useColoring 之后才定义的处理器（coloring 依赖），用 ref 桥接取最新闭包
  const ghostBatchHandlerRef = useRef<(id: string, cells: Cell[]) => void>(() => {})
  const coloring = useColoring({
    ghostRects,
    onGhostBatch: (id, cells) => ghostBatchHandlerRef.current(id, cells),
  })
  const isColoring = coloring.coloringMode

  /* ---------- 样式参考飞机：允许拖拽开关（config 优先，回退设置，默认 true；盲棋强制禁用） ---------- */
  const allowMoveRefPlane = isBlind ? false : (config?.allowMoveRefPlane ?? settingsAllowMove ?? true)

  /* ---------- 音量占位接线（M7 实现真实音效） ---------- */
  useEffect(() => {
    audioService.setBgmVolume(bgmVolume)
    audioService.setSfxVolume(sfxVolume)
  }, [bgmVolume, sfxVolume])

  useEffect(
    () => () => {
      window.clearTimeout(shakeTimer.current)
      sfxTimers.current.forEach((t) => window.clearTimeout(t))
    },
    [],
  )

  /* ---------- 横幅 → 对战（切页音 + 状态重置） ---------- */
  useEffect(() => {
    setScreen('banner')
    setHighlight(null)
    setInput('')
    setAiFlash(null)
    setAiMsg(null)
    setMyMsg(null)
    setPfSel(null)
    timeoutLoserRef.current = null
    autoFiredTurnRef.current = null
    endReportedRef.current = false
    setRetiredGhostIds(new Set())
    setGhostRects([])
    seenGhostIdsRef.current = new Set()
    coloring.reset()
    refPlanes.reset()
    audioService.playSfx('page-flip')
    const t = window.setTimeout(() => setScreen('battle'), 1500)
    return () => window.clearTimeout(t)
  }, [session?.nonce])

  /* ---------- 终局 → 结算（胜负提示音 + 结算翻页 + 教程胜负事件） ---------- */
  useEffect(() => {
    if (!state || state.phase !== 'ended' || screen !== 'battle') return
    // 胜负音/事件每局只报一次；结算翻页定时器每次重跑都重排（旧定时器已被清理）
    if (!endReportedRef.current) {
      endReportedRef.current = true
      const iWin = state.winner === me
      audioService.playSfx(iWin ? 'win' : 'lose')
      onGameEvent?.(iWin ? { type: 'playerWin' } : { type: 'playerLose' })
    }
    if (!hideSettlement) {
      const t = window.setTimeout(() => {
        setScreen('result')
        audioService.playSfx('page-flip')
      }, 650)
      return () => window.clearTimeout(t)
    }
    return undefined
  }, [state, screen, me, onGameEvent, hideSettlement])

  /* ---------- AI 回合驱动：300~900ms 后出手；教程注入 aiShotSelector 时按其决策轮询（null=暂停） ---------- */
  useEffect(() => {
    if (!state || !session || screen !== 'battle') return
    if (state.phase === 'ended' || state.turn !== ai) return
    const aiBoardNow = state.players[ai]
    const knowledge: ShotKnowledge = {
      width: aiBoardNow.width,
      height: aiBoardNow.height,
      shots: aiBoardNow.shotsFired,
      planeShape: aiBoardNow.shape,
    }
    /** AI 出手（两路径共用）：应用结果、渲染、发事件 */
    const fireAiShot = (cell: Cell) => {
      const res = applyShotAt(cell)
      if (!res || !res.ok || !res.outcome) return
      setAiFlash(cell)
      setMyMsg(null)
      setAiMsg(`对方报点 ${formatCoord(cell)}：${OUTCOME_TEXT[res.outcome] ?? '无效'}！`)
      window.setTimeout(() => setAiFlash(null), 800)
      // 对方报点结果音：击中盖章 / 击毁重章
      audioService.playSfx(res.outcome === 'kill' ? 'kill' : 'stamp')
      if (res.outcome === 'kill') onGameEvent?.({ type: 'planeKilled', side: me })
    }

    // 教程注入：按 selector 决策轮询；返回 null（暂停）则稍后再询，直至放行
    if (aiShotSelector) {
      let pollTimer = 0
      const poll = () => {
        const cell = aiShotSelector(knowledge, session.aiRng)
        if (cell === null) {
          pollTimer = window.setTimeout(poll, 400)
          return
        }
        fireAiShot(cell)
      }
      const t = window.setTimeout(poll, 300 + Math.random() * 600)
      return () => {
        window.clearTimeout(t)
        window.clearTimeout(pollTimer)
      }
    }

    // 默认 AI：单发延时（300~900ms 思考）
    const t = window.setTimeout(() => {
      fireAiShot(chooseShot(knowledge, difficulty, session.aiRng))
    }, 300 + Math.random() * 600)
    return () => window.clearTimeout(t)
    // 依赖逻辑回合签名而非整个 state：blitz 时钟写入（每 ~100ms 新 state）不得重排本定时器（R2）
  }, [turnSig, screen, session?.nonce, onGameEvent, aiShotSelector])

  // 我方回合开始：清掉对方回合遗留的预报点选中；若有预报点待报则再清提示让「轮到你了…」可读
  useEffect(() => {
    if (!state || screen !== 'battle') return
    if (state.phase !== 'playing' || state.turn !== me) return
    setPfSel(null)
    if ((state.preFire?.[me]?.length ?? 0) === 0) return
    setAiMsg(null)
    setMyMsg(null)
  }, [state, screen])

  /* ================= v0.3.0：预报点 / 超快棋（挂载于对战期） ================= */

  // 我方回合开始：预报点 FIFO 自动上报（每回合最多一个；队列空恢复手动报点）。
  // autoFiredTurnRef 记录已消费的回合号，避免同一回合内重复触发（applyShot 翻回合后自然复位）。
  const autoFiredTurnRef = useRef<number | null>(null)
  useEffect(() => {
    if (!state || screen !== 'battle') return
    if (state.phase !== 'playing' || state.turn !== me) return
    const queue = state.preFire?.[me] ?? []
    if (queue.length === 0) return
    if (autoFiredTurnRef.current === state.turnNo) return
    autoFiredTurnRef.current = state.turnNo
    const head = queue[0]!
    const t = window.setTimeout(
      () => {
        const res = takePreFireShot()
        if (!res || !res.ok || !res.outcome) {
          if (res && !res.ok) {
            // 罕见冲突（如经典下该格已被手动报过）：丢弃队首，避免每回合重复尝试阻塞
            cancelPreFireAt(head)
            toast(res.error === 'already-shot' ? '该格已经报过点了' : '当前阶段不允许报点', 'error')
            shakeInput()
          }
          return
        }
        // 自动上报与手动报点消耗一致：展示结果并翻转回合
        setHighlight(null)
        setInput('')
        setAiMsg(null)
        setPfSel(null)
        setMyMsg(`我方报点 ${formatCoord(head)}：${OUTCOME_TEXT[res.outcome] ?? '无效'}！`)
        audioService.playSfx('shoot')
        if (res.outcome === 'kill') playSfxAt('kill', 180)
        else if (res.outcome === 'hit') playSfxAt('stamp', 140)
        onGameEvent?.({ type: 'shotByPlayer', coord: { r: head.r, c: head.c }, outcome: res.outcome })
        if (res.outcome === 'kill') onGameEvent?.({ type: 'planeKilled', side: ai })
      },
      450, // 回合翻转后稍作停顿，让状态条"轮到你了…"可读
    )
    return () => window.clearTimeout(t)
    // 依赖队列签名而非整个 state：blitz 时钟写入不得重排自动上报定时器（与 R2 同根因）
  }, [queueSig, screen])

  // —— 超快棋：rAF 实时推进当前回合方时钟（象棋钟语义）——
  const timeoutLoserRef = useRef<0 | 1 | null>(null)
  const blitzLastRef = useRef(0)
  const blitzAccRef = useRef(0)
  useEffect(() => {
    if (!isBlitz || screen !== 'battle') return
    if (!state?.blitz || state.phase === 'ended') return
    let raf = 0
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      // 暂停：退出确认弹窗打开时不计时（切后台由 visibilitychange 兜底清零基线）
      if (exitOpen) {
        blitzLastRef.current = 0
        blitzAccRef.current = 0
        return
      }
      if (blitzLastRef.current === 0) {
        blitzLastRef.current = now
        return
      }
      const dt = now - blitzLastRef.current
      blitzLastRef.current = now
      blitzAccRef.current += dt
      if (blitzAccRef.current < 100) return // 100ms 粒度推进，避免每帧 setState
      const delta = blitzAccRef.current
      blitzAccRef.current = 0
      const out = advanceBlitz(delta)
      if (out?.timedOut) {
        // 超时 → 引擎已置 phase=ended + winner；终局 effect 负责切结算
        timeoutLoserRef.current = (1 - (out.winner ?? 0)) as 0 | 1
      }
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      blitzLastRef.current = 0
      blitzAccRef.current = 0
    }
  }, [isBlitz, screen, exitOpen, state?.blitz, state?.phase])

  // 切后台：rAF 停摆后时间戳会跳变，回到前台前清零基线，避免一次扣光
  useEffect(() => {
    const onVis = () => {
      if (document.hidden) {
        blitzLastRef.current = 0
        blitzAccRef.current = 0
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  /* ---------- 尺寸 ---------- */
  // 竖版 9:16 无滚动：状态条 + 参考/我方行 + 中央棋盘 + 输入栏 全部收进舞台。
  // v0.2.10 行优先重设计：参考/我方行实际显示大小为最高优先度——压缩状态条/输入栏/卡片
  // chrome（m4.css 竖版覆盖）后，行分配纵向预算（refCell≥18 / miniCell≥8 目标），
  // 中央空网格保持满宽（≥85% 舞台宽）、高度取剩余。常量按压缩后实测校准。
  const PORTRAIT_MAIN_BASE = 121 // 最坏情况：状态条两行 54 + 输入栏 38 + 边距 16 + 间距 8 + 余量 5
  const PORTRAIT_ROW_BUDGET = 163 // 行目标预算：refCell≥18（73+5*18）与 miniCell≥8（49+10*8）取大
  const REF_CARD_CHROME = 73 // 参考卡：内边距+标题+列标+边框（压缩后实测校准）
  const MINE_CARD_CHROME = 49 // 我方卡：内边距+标题+边框（压缩后实测校准）
  const OPP_CARD_CHROME = 27 // 中央棋盘：列标+边框
  const ROW_GAP = 8

  // 尺寸冻结：仅在本局会话首次进入时捕获舞台尺寸，本局内所有元素大小保持不变
  // （不再响应 resize；新对局/再来一局 → 新 nonce → 重新计算一次）
  const frozenViewportRef = useRef<Map<number, Viewport>>(new Map())
  const gameNonce = session?.nonce ?? 0
  if (!frozenViewportRef.current.has(gameNonce)) {
    frozenViewportRef.current.set(gameNonce, viewport)
  }
  const frozenViewport = frozenViewportRef.current.get(gameNonce) ?? viewport

  const landscapeMainCell = useMemo(() => {
    if (!config) return 20
    const availW = frozenViewport.width * 0.4
    const availH = frozenViewport.height - 170
    return clamp(Math.floor(Math.min(availW / config.width, availH / config.height)), 12, 34)
  }, [frozenViewport, config])

  const portraitSizes = useMemo(() => {
    if (!config) return null
    const availW = frozenViewport.width - 24 // 舞台 − 页面内边距20 − 主区内边距4
    const mainAvailH = frozenViewport.height - PORTRAIT_MAIN_BASE
    // 空网格 ≥85% 舞台宽（任务硬下限）对应的格宽
    const mainFloor = Math.ceil((frozenViewport.width * 0.85) / config.width)
    // 宽度上限取格（≤34）；行优先：行预算内网格让位（高度约束）
    const gridCap = clamp(Math.floor(availW / config.width), 8, 34)
    const heightBound = Math.floor(
      (mainAvailH - PORTRAIT_ROW_BUDGET - ROW_GAP - OPP_CARD_CHROME) / config.height,
    )
    // 85% 为硬下限（行预算与网格冲突时网格下限优先）；否则网格取宽度上限，行拿剩余
    const mainCell = Math.max(mainFloor, Math.min(gridCap, heightBound))
    const oppH = mainCell * config.height + OPP_CARD_CHROME
    const rowH = mainAvailH - oppH - ROW_GAP
    const halfW = Math.floor((availW - ROW_GAP) / 2)
    // 行取满剩余空间：高度优先，受半宽约束（卡片内边距 20 + 行标列 20），上限放宽
    const refCell = clamp(
      Math.min(Math.floor((rowH - REF_CARD_CHROME) / 5), Math.floor((halfW - 20 - 20) / 5)),
      6,
      34,
    )
    const miniCell = clamp(
      Math.min(
        Math.floor((rowH - MINE_CARD_CHROME) / config.height),
        Math.floor((halfW - 20) / config.width),
      ),
      2,
      26,
    )
    return { mainCell, refCell, miniCell }
  }, [frozenViewport, config])

  const mainCell = orientation === 'portrait' ? (portraitSizes?.mainCell ?? 20) : landscapeMainCell
  const miniCell =
    orientation === 'portrait'
      ? (portraitSizes?.miniCell ?? 10)
      : config
        ? clamp(
            Math.min(Math.floor(mainCell / 2), Math.floor((viewport.width / 2 - 44) / config.width)),
            6,
            20,
          )
        : 10
  const refCell =
    orientation === 'portrait'
      ? (portraitSizes?.refCell ?? 18)
      : Math.min(24, Math.max(13, Math.floor(mainCell * 0.8)))

  /* ---------- 结算尺寸：进入结算瞬间捕获舞台尺寸并冻结（resize 不再改变） ---------- */
  const resultViewportRef = useRef<Map<number, Viewport>>(new Map())
  if (screen === 'result' && !resultViewportRef.current.has(gameNonce)) {
    resultViewportRef.current.set(gameNonce, viewport)
  }
  const resultViewport = screen === 'result' ? (resultViewportRef.current.get(gameNonce) ?? viewport) : null

  // 竖版结算：两真实阵型棋盘并排（各约半宽），随结果视图冻结的舞台尺寸计算；横版保持原样
  const resCell = config
    ? orientation === 'portrait'
      ? clamp(
          Math.floor(((resultViewport ?? frozenViewport).width - 62) / 2 / Math.max(config.width, config.height)),
          3,
          16,
        )
      : clamp(Math.floor(200 / Math.max(config.width, config.height)), 4, 16)
    : 8

  /* ---------- 样式参考飞机拖拽（对手棋盘 cellSize 依赖上方尺寸；每局独立） ---------- */
  const refPlanes = useRefPlanes({
    width: config?.width ?? 10,
    height: config?.height ?? 10,
    shape: config?.shape ?? DEFAULT_PLANE_SHAPE,
    cellSize: mainCell,
    oppBoardRef,
    refAreaRef,
    allowMove: allowMoveRefPlane,
    coloring: {
      isColoring,
      currentColor: coloring.currentColor,
      coloredCells: coloring.coloredCells,
      paintPlane: coloring.paintPlane,
    },
  })

  /* ================= v0.3.0：幽灵飞机同步 / 快捷着色 / 教程事件包装 ================= */

  // placed 每次变化 → useLayoutEffect 同步活动幽灵列表（绘制前完成，避免拖入后点击滞后一帧）
  useLayoutEffect(() => {
    if (!config) return
    setGhostRects(
      (refPlanes.placed ?? [])
        .filter((p) => !retiredGhostIds.has(String(p.id)))
        .map((p) => ({ id: String(p.id), cells: occupiedCells(p, config.shape) })),
    )
  }, [refPlanes.placed, retiredGhostIds, config])

  // 幽灵诞生事件（拖入成功 → placed 新增条目）
  const seenGhostIdsRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    const ids = (refPlanes.placed ?? []).map((p) => String(p.id))
    const fresh = ids.filter((id) => !seenGhostIdsRef.current.has(id))
    for (const id of fresh) onGameEvent?.({ type: 'ghostCreated', id })
    seenGhostIdsRef.current = new Set(ids)
  }, [refPlanes.placed, onGameEvent])

  // 快捷着色：整机被批量着色 → 回收幽灵 + 退出着色模式（ColoringTool 只发事件，回收由页面执行）
  const ghostPointerDownRef = useRef(false)
  const handleGhostBatch = (id: string, cells: Cell[]) => {
    setGhostRects((prev) => prev.filter((g) => g.id !== id))
    setRetiredGhostIds((prev) => new Set(prev).add(id))
    if (coloring.coloringMode) coloring.toggleMode()
    // A4：仅当本次批量着色由【着色模式 + pointerdown 直接命中幽灵】触发时标记 deliberate，
    // 教程据此才推进 T3-11（拖拽擦过/普通涂色跨格误触不计数）
    const viaGhostPointerDown = ghostPointerDownRef.current
    ghostPointerDownRef.current = false
    onGameEvent?.({ type: 'ghostBatchColored', id, cells, viaGhostPointerDown })
  }
  ghostBatchHandlerRef.current = handleGhostBatch

  // 着色模式下 pointerdown 直接命中幽灵图层（capture 阶段监听，不阻断棋盘着色交互）
  useEffect(() => {
    if (!isColoring || screen !== 'battle') return
    const board = oppBoardRef.current
    if (!board) return
    const onDown = (ev: PointerEvent) => {
      const rect = board.getBoundingClientRect()
      const r = Math.floor((ev.clientY - rect.top) / mainCell)
      const c = Math.floor((ev.clientX - rect.left) / mainCell)
      if (c >= 0 && r >= 0 && config && r < config.height && c < config.width) {
        ghostPointerDownRef.current = ghostRectAt(ghostRects, { r, c }) !== null
      } else {
        ghostPointerDownRef.current = false
      }
    }
    board.addEventListener('pointerdown', onDown, true)
    return () => board.removeEventListener('pointerdown', onDown, true)
  }, [isColoring, screen, ghostRects, mainCell, config])

  // 着色入口包装：进入着色模式/选色发 enteredColoring；单格染色发 cellColored（幽灵批染不发，走 ghostBatchColored）
  const toggleColoringMode = () => {
    const entering = !coloring.coloringMode
    coloring.toggleMode()
    if (entering) onGameEvent?.({ type: 'enteredColoring' })
  }
  const selectColoringColor = (color: ColoringColor) => {
    const entering = !coloring.coloringMode
    coloring.selectColor(color)
    if (entering) onGameEvent?.({ type: 'enteredColoring' })
  }
  const openColoringPalette = () => coloring.setPaletteOpen(true)
  const closeColoringPalette = () => coloring.setPaletteOpen(false)
  const paintCellAt = (coord: Cell, brush: PaintBrush) => {
    const isGhostHit = ghostRectAt(ghostRects, coord) !== null
    coloring.paintAt(coord, brush)
    if (!isGhostHit && brush === 'paint') {
      onGameEvent?.({ type: 'cellColored', coord: { r: coord.r, c: coord.c } })
    }
  }

  // 盲棋重复报点 → 同一格位在可见窗口内可能出现多条标记；渲染前去重（保留末条，格位唯一）
  const dedupeShots = (list: readonly Shot[]): Shot[] => {
    const seen = new Set<string>()
    const out: Shot[] = []
    for (let i = list.length - 1; i >= 0; i--) {
      const s = list[i]!
      const k = cellKey(s.coord)
      if (seen.has(k)) continue
      seen.add(k)
      out.push(s)
    }
    return out.reverse()
  }

  // v0.2.9 平均击杀效率：从首次命中到击毁的平均报点步数（越低越高效）；无击毁 = null。
  // useMemo：state 引用仅在报点/开局时变化，避免无关重渲染（横幅/着色等）下重复计算
  const killEff = useMemo(() => (state ? killEfficiencyStats(state) : null), [state])

  if (!session || !state || !config) {
    return (
      <div className="page" style={{ alignItems: 'center', gap: 16 }}>
        <p>对局会话不存在，请返回主页重新开始。</p>
        <PaperButton variant="primary" onClick={() => setView('home')}>
          返回主页
        </PaperButton>
      </div>
    )
  }

  const myBoard = state.players[me]
  const aiBoard = state.players[ai]
  const isMyTurn = state.turn === me
  const isCounterattackMine = state.phase === 'counterattack' && state.turn === me
  const isPlaying = state.phase === 'playing' || state.phase === 'counterattack'

  /* ---------- 报点 / 预报点 ---------- */

  const alreadyShot = (cell: Cell) =>
    myBoard.shotsFired.some((s) => s.coord.r === cell.r && s.coord.c === cell.c)

  const shakeInput = () => {
    setShake(true)
    window.clearTimeout(shakeTimer.current)
    shakeTimer.current = window.setTimeout(() => setShake(false), 420)
  }

  /** 我方成功报点后的统一反馈（手动报点 / 预报点自动上报共用；结果音与教程事件同步） */
  const presentMyShot = (cell: Cell, res: ShotResult) => {
    setHighlight(null)
    setInput('')
    setAiMsg(null)
    setPfSel(null)
    const resultLabel = res.outcome ? OUTCOME_TEXT[res.outcome] : '无效'
    setMyMsg(`我方报点 ${formatCoord(cell)}：${resultLabel}！`)
    audioService.playSfx('shoot')
    // 结果音：击中盖章 / 击毁重章（稍延时贴合报点节奏）
    if (res.outcome === 'kill') playSfxAt('kill', 180)
    else if (res.outcome === 'hit') playSfxAt('stamp', 140)
    onGameEvent?.({ type: 'shotByPlayer', coord: { r: cell.r, c: cell.c }, outcome: res.outcome ?? 'miss' })
    if (res.outcome === 'kill') onGameEvent?.({ type: 'planeKilled', side: ai })
  }

  const doShot = (cell: Cell) => {
    if (!isPlaying || state.turn !== me) return
    // 盲棋允许重复报点（含残骸格，引擎返回 miss 误导）；经典模式拦截已报格
    if (!isBlind && alreadyShot(cell)) {
      toast('该格已经报过点了', 'error')
      shakeInput()
      return
    }
    // R1 竞态防护：手动报点命中仍在预报点队列的坐标（自动上报 450ms 窗口内抢先手点）→
    // 先撤掉该预报点再打，避免“真实章 + 残留 ?”同格双渲染与队列滞留
    if (myPreFireKeys.has(cellKey(cell))) cancelPreFireAt(cell)
    const res: ShotResult | null = applyShotAt(cell)
    if (!res || !res.ok) {
      if (res?.error === 'already-shot') {
        toast('该格已经报过点了', 'error')
        shakeInput()
      } else if (res?.error === 'out-of-bounds') {
        toast('坐标超出棋盘范围', 'error')
        shakeInput()
      } else {
        toast('当前阶段不允许报点', 'error')
      }
      return
    }
    presentMyShot(cell, res)
  }

  /** 非我方回合点击空网格 = 创建预报点；已预报格 = 点选 / 再点取消（上限 10，FIFO 由引擎裁决） */
  const onPrefireTap = (cell: Cell) => {
    if (screen !== 'battle' || state.phase !== 'playing' || isColoring) return
    if (myPreFireKeys.has(cellKey(cell))) {
      // 已是预报点：再次点击选中的同一格 = 取消
      if (pfSel && pfSel.r === cell.r && pfSel.c === cell.c) {
        if (cancelPreFireAt(cell)) {
          setPfSel(null)
          setInput('')
          toast('预报点已取消。', 'info')
        }
        return
      }
      setPfSel(cell)
      setInput(formatCoord(cell))
      return
    }
    const res = queuePreFireAt(cell)
    if (!res) return
    if (!res.ok) {
      if (res.error === 'PRE_FIRE_FULL') {
        toast('预报点已达上限（10 个），请先取消部分预报点。', 'error')
        shakeInput()
      } else {
        // CELL_TAKEN：该格已有可见标记（经典全量 / 盲棋可见窗口）
        toast('该格已经报过点了', 'error')
        shakeInput()
      }
      return
    }
    setPfSel(null)
    setInput(formatCoord(cell))
    onGameEvent?.({ type: 'preFireCreated', coord: { r: cell.r, c: cell.c } })
  }

  const onOppCellClick = (cell: Cell) => {
    if (screen !== 'battle' || !isPlaying) return
    if (state.turn !== me) {
      // 原「还没轮到您报点」提示已删除（v0.3.0），对方回合点击转为预报点交互
      onPrefireTap(cell)
      return
    }
    if (!isBlind && alreadyShot(cell)) {
      toast('该格已经报过点了', 'error')
      return
    }
    if (highlight && highlight.r === cell.r && highlight.c === cell.c) {
      doShot(cell)
    } else {
      setHighlight(cell)
      setInput(formatCoord(cell))
    }
  }

  const commitInput = () => {
    if (isColoring) return // 着色模式下不触发
    const cell = parseCoord(input)
    if (!cell) {
      toast('坐标格式应为"字母+数字"，如 A5', 'error')
      shakeInput()
      return
    }
    if (!inBounds(cell, config.width, config.height)) {
      toast('坐标超出棋盘范围', 'error')
      shakeInput()
      return
    }
    if (state.turn !== me) {
      // 对方回合：输入命中预报点 = 取消该预报点；空网格 = 创建（与点击一致）
      if (myPreFireKeys.has(cellKey(cell))) {
        if (cancelPreFireAt(cell)) {
          setPfSel(null)
          setInput('')
          toast('预报点已取消。', 'info')
        }
        return
      }
      onPrefireTap(cell)
      return
    }
    doShot(cell)
  }

  /* ---------- 对手网格展示（v0.3.0：盲棋可见窗口 / 预报点伪标记） ---------- */

  // 我方在对手网格上的可见标记：盲棋只显示最近 N 个非击毁 + 全部击毁（同格重复条目去重保键唯一）
  const oppVisibleShots: Shot[] = isBlind ? dedupeShots(visibleMarks(state).player0) : myBoard.shotsFired
  // 防御（R1）：预报点伪标记不与【已可见】报点格同格叠加——手动报点抢先于自动上报等竞态下，
  // 队列可能暂留已报坐标；同格只渲染真实章，伪「?」隐藏直到队列被自动/取消清理（格位唯一、无重复 key）
  const oppVisibleKeys = new Set(oppVisibleShots.map((s) => cellKey(s.coord)))
  const oppRenderShots: Shot[] = [
    ...oppVisibleShots,
    ...myPreFire
      .filter((c) => !oppVisibleKeys.has(cellKey(c)))
      .map((c) => ({ coord: { r: c.r, c: c.c }, outcome: 'miss' as const })),
  ]

  // 我方小网格 / 结算真实阵型的重复报点章去重（仅盲棋会出现同格多条；渲染格位唯一）
  const myReceivedShots = isBlind ? dedupeShots(myBoard.receivedShots) : myBoard.receivedShots
  const myResultShots = isBlind ? dedupeShots(myBoard.shotsFired) : myBoard.shotsFired

  // 对手网格上实际渲染的幽灵：隐藏已被快捷着色回收的（placed 内部仍保留，拖拽/重叠逻辑不受影响）
  const visibleShownPlanes = refPlanes.shownPlanes.filter(
    (p) => p.id === -1 || !retiredGhostIds.has(String(p.id)),
  )

  // 自定义报点渲染：预报点伪标记画「?」章（与可见标记同格时不再画 ?，防止竞态遮蔽真实结果）；
  // 其余保持 StampMark（含反转设置）
  const renderOppShot = (shot: Shot, size: number) =>
    myPreFireKeys.has(cellKey(shot.coord)) && !oppVisibleKeys.has(cellKey(shot.coord)) ? (
      <PreFireMark coord={shot.coord} size={size} />
    ) : (
      <StampMark outcome={shot.outcome} size={size * 0.82} cell={shot.coord} inverted={invertMarks} />
    )

  /* ---------- 状态条 ---------- */

  let statusText = ''
  let statusThem = false
  if (screen === 'battle') {
    if (isCounterattackMine) {
      statusText = '绝地反击！您获得一次额外报点机会'
    } else if (aiMsg) {
      statusText = aiMsg
      statusThem = true
    } else if (myMsg) {
      statusText = myMsg
    } else if (state.turn === me && myPreFire.length > 0) {
      // 预报点将在本回合自动上报（引擎 FIFO）
      statusText = '轮到你了——预报点将自动上报。'
    } else if (state.turn === me) {
      statusText = '轮到我方报点'
    } else {
      statusText = '等待对方报点…'
      statusThem = true
    }
  }

  /* ---------- 结算统计（轻量计算，无需 memo） ---------- */

  const totalShots = myBoard.shotsFired.length + aiBoard.shotsFired.length
  const myHits = myBoard.shotsFired.filter((s) => s.outcome !== 'miss').length
  const aiHits = aiBoard.shotsFired.filter((s) => s.outcome !== 'miss').length
  const stats = {
    totalShots,
    myHitRate: myBoard.shotsFired.length ? Math.round((myHits / myBoard.shotsFired.length) * 100) : 0,
    myShots: myBoard.shotsFired.length,
    myHits,
    myKills: aiBoard.destroyedPlaneIds.length,
    aiHitRate: aiBoard.shotsFired.length ? Math.round((aiHits / aiBoard.shotsFired.length) * 100) : 0,
    aiShots: aiBoard.shotsFired.length,
    aiHits,
    aiKills: myBoard.destroyedPlaneIds.length,
  }

  const iWin = state.winner === me
  const bannerText = state.firstMover === me ? '您先手' : '您后手'
  const fmtEff = (v: number | null | undefined) => (v === null || v === undefined ? '—' : v.toFixed(1))

  return (
    <div className={`game game--${orientation}`}>
      <header className="game__statusbar">
        <PaperButton size="sm" variant="ghost" onClick={() => setExitOpen(true)}>
          ← 退出
        </PaperButton>
        <div className={`game__statusbtn ${shake ? 'shake' : ''}`} role="status" aria-live="polite">
          <span className={`game__dot${statusThem ? ' game__dot--them' : ''}`} aria-hidden="true" />
          <span className="game__status-text">{statusText}</span>
        </div>
        {screen === 'battle' && isBlitz && state.blitz ? (
          // 超快棋：状态条右侧以双方 BlitzClock 替换玩家名（激活方 = 当前回合方）
          <span
            className="game__clocks"
            role="group"
            aria-label="超快棋倒计时，左侧为我方，右侧为对方"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, flex: 'none' }}
          >
            <BlitzClock ms={state.blitz.clocks[me]} active={state.turn === me} />
            <span className="game__vs" aria-hidden="true">
              VS
            </span>
            <BlitzClock ms={state.blitz.clocks[ai]} active={state.turn === ai} />
          </span>
        ) : (
          <span className="game__names">
            您 · {guestName} <span className="game__vs">VS</span> 电脑
          </span>
        )}
      </header>

      <main className="game__main">
        {/* 样式参考图：5×5 + 本局形状（点击旋转 / 可拖到对手棋盘） */}
        <section className="game__ref" ref={refAreaRef}>
          <PaperCard className="game__card">
            <div className="game__card-head">
              <h2 className="game__card-title">样式参考</h2>
            </div>
            <PaperGrid
              width={5}
              height={5}
              cellSize={refCell}
              showLabels
              planes={[{ id: 0, rotation: refPlanes.refRotation, origin: { r: 0, c: 0 } }]}
              shape={config.shape}
              shots={refShotsFor(config.shape, refPlanes.refRotation)}
              planesLayer={{
                onPlanePointerDown: (_plane, e) => refPlanes.startRefDrag(e),
              }}
              ariaLabel="样式参考图"
            />
          </PaperCard>
        </section>

        {/* 我方小网格（1/2 尺寸） */}
        <section className="game__mine">
          <PaperCard className="game__card">
            <h2 className="game__card-title">我方阵型</h2>
            <PaperGrid
              width={config.width}
              height={config.height}
              cellSize={miniCell}
              planes={myBoard.planes}
              shape={config.shape}
              shots={myReceivedShots}
              destroyedPlaneIds={myBoard.destroyedPlaneIds}
              flash={aiFlash}
              ariaLabel="我方小网格"
            />
          </PaperCard>
        </section>

        {/* 对手网格（居中）：只渲染我方可见报点标记（盲棋窗口）/ 预报点「?」，绝不显示对方阵型；可放置参考飞机副本 */}
        <section className="game__opp">
          <div className="coloring-stage">
            <PaperGrid
              width={config.width}
              height={config.height}
              cellSize={mainCell}
              showLabels
              onCellClick={onOppCellClick}
              shots={oppRenderShots}
              renderShot={renderOppShot}
              highlight={isMyTurn ? highlight : pfSel}
              coloredCells={coloring.coloredCells}
              coloring={
                isColoring
                  ? { active: true, color: coloring.currentColor, onPaint: paintCellAt }
                  : undefined
              }
              planes={visibleShownPlanes}
              shape={config.shape}
              planesLayer={
                isColoring
                  ? // 着色模式下幽灵不响应拖拽：点击交给棋盘着色层 → useColoring.paintAt 快捷着色
                    { ghost: true, onTop: true, overlayIds: refPlanes.overlappedIds }
                  : {
                      ghost: true,
                      onTop: true,
                      overlayIds: refPlanes.overlappedIds,
                      onPlanePointerDown: (plane, e) => refPlanes.startPlacedDrag(e, plane),
                    }
              }
              onBoardRef={(el) => {
                oppBoardRef.current = el
              }}
              ariaLabel="对手棋盘"
            />
            {!isBlind ? (
              <ColoringToolButton
                className="coloring-stage__btn"
                active={isColoring}
                color={coloring.currentColor}
                paletteOpen={coloring.paletteOpen}
                paletteDir="down"
                onToggle={toggleColoringMode}
                onOpenPalette={openColoringPalette}
                onClosePalette={closeColoringPalette}
                onSelectColor={selectColoringColor}
              />
            ) : null}
          </div>
        </section>
      </main>

      <footer className="game__inputbar">
        {!isBlind ? (
          <ColoringToolButton
            className="coloring-inputbar__btn"
            active={isColoring}
            color={coloring.currentColor}
            paletteOpen={coloring.paletteOpen}
            paletteDir="up"
            onToggle={toggleColoringMode}
            onOpenPalette={openColoringPalette}
            onClosePalette={closeColoringPalette}
            onSelectColor={selectColoringColor}
          />
        ) : null}
        <label className="visually-hidden" htmlFor="game-coord">
          报点坐标
        </label>
        <input
          id="game-coord"
          className={['paper-select__control game__input', shake ? 'shake' : ''].filter(Boolean).join(' ')}
          style={{ width: 130, textAlign: 'center', letterSpacing: '0.08em' }}
          value={input}
          // 对方回合输入框保持可用：输入既有预报点坐标可取消（v0.3.0）
          disabled={screen !== 'battle' || isColoring}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitInput()
          }}
          placeholder="请输入坐标"
          aria-label="报点坐标，如 A5"
          autoComplete="off"
        />
        <PaperButton variant="primary" onClick={commitInput} disabled={screen !== 'battle' || isColoring}>
          确认报点
        </PaperButton>
        <span className="game__hint">
          {isColoring
            ? '着色模式：点按染色 · 按住拖动画线 · 再点同色擦除'
            : state.turn !== me && state.phase === 'playing'
              ? '对方回合：点空网格可预排报点（?）· 点预报点再点取消'
              : '点击棋盘选格，再点一次报点 · 或输入坐标回车'}
        </span>
      </footer>

      {/* 先后手横幅 */}
      {screen === 'banner' ? (
        <div className="game-banner" role="status" aria-live="assertive">
          <div className="game-banner__card">
            <span className="game-banner__label">本局先后手</span>
            <span className="game-banner__text">{bannerText}</span>
            <span className="game-banner__sub">
              {state.firstMover === me ? '由您率先报点' : '电脑将先发制人'}
            </span>
          </div>
        </div>
      ) : null}

      {/* 结算界面 */}
      {screen === 'result' && stats ? (
        <div className="result">
          <div className="result__card paper-card" role="status" aria-live="assertive">
            {/* v0.3.0：超时判负 → 结算主标题「超时判负」+ 副文案（ui-copy-v030 §4） */}
            {timeoutLoserRef.current !== null ? (
              <>
                <h1 className={`result__title ${iWin ? 'result__title--win' : 'result__title--lose'}`}>
                  超时判负
                </h1>
                <p
                  className="result__timeout-note"
                  style={{ margin: '2px 0 10px', fontSize: 14, color: 'var(--ink-soft)' }}
                >
                  {timeoutLoserRef.current === me ? '你超时，本局判负。' : '对方超时，你获胜。'}
                </p>
              </>
            ) : (
              <h1 className={`result__title ${iWin ? 'result__title--win' : 'result__title--lose'}`}>
                {iWin ? '恭喜您，您赢了！' : '您输了，下次一定！'}
              </h1>
            )}

            <div className="result__boards">
              <div className="result__board">
                <h2 className="game__card-title">我方真实阵型</h2>
                {/* v0.2.9：叠加对方标记（receivedShots + 残骸暗色层） */}
                <PaperGrid
                  width={config.width}
                  height={config.height}
                  cellSize={resCell}
                  planes={myBoard.planes}
                  shape={config.shape}
                  shots={myReceivedShots}
                  destroyedPlaneIds={myBoard.destroyedPlaneIds}
                  ariaLabel="我方真实阵型"
                />
              </div>
              <div className="result__board">
                <h2 className="game__card-title">对方真实阵型</h2>
                {/* v0.2.9：叠加我方标记与染色（shotsFired + 本局着色 coloredCells） */}
                <PaperGrid
                  width={config.width}
                  height={config.height}
                  cellSize={resCell}
                  planes={aiBoard.planes}
                  shape={config.shape}
                  shots={myResultShots}
                  coloredCells={coloring.coloredCells}
                  ariaLabel="对方真实阵型"
                />
              </div>
            </div>

            <dl className="result__stats">
              <div className="result__stat">
                <dt>总回合数</dt>
                <dd>{stats.totalShots}</dd>
                <dd className="result__stat-note">双方合计报点</dd>
              </div>
              <div className="result__stat">
                <dt>我方命中率</dt>
                <dd>{stats.myHitRate}%</dd>
                <dd className="result__stat-note">
                  命中 {stats.myHits}/{stats.myShots} · 击毁 {stats.myKills} 架
                </dd>
              </div>
              <div className="result__stat">
                <dt>电脑命中率</dt>
                <dd>{stats.aiHitRate}%</dd>
                <dd className="result__stat-note">
                  命中 {stats.aiHits}/{stats.aiShots} · 击毁 {stats.aiKills} 架
                </dd>
              </div>
              {/* v0.2.9 平均击杀效率对比：我方 / 对方（从首次命中到击毁的平均报点步数） */}
              <div className="result__stat">
                <dt>平均击杀效率</dt>
                <dd className="result__stat-eff">
                  我方 {fmtEff(killEff?.player0)} / 对方 {fmtEff(killEff?.player1)}
                </dd>
                <dd className="result__stat-note">平均每架从首中到击毁的步数</dd>
              </div>
            </dl>

            <div className="result__actions">
              <PaperButton
                variant="ghost"
                onClick={() => {
                  resetGame()
                  setView('home')
                }}
              >
                返回主页
              </PaperButton>
              <PaperButton
                variant="primary"
                onClick={() => {
                  resetGame()
                  audioService.playSfx('page-flip')
                  setView('placement')
                }}
              >
                再来一局
              </PaperButton>
            </div>
          </div>
        </div>
      ) : null}

      {/* 参考飞机拖拽浮游幽灵（半透明虚线；拖离棋盘或自参考本体拖出时显示） */}
      {refPlanes.drag && (refPlanes.drag.source === 'ref' || !refPlanes.drag.origin) ? (
        (() => {
          const d = refPlanes.drag
          const box = boundingBox(config.shape, d.rotation)
          return (
            <div
              className="coloring-ref-ghost"
              style={{
                left: d.pointer.x - d.grabOffset.c * mainCell,
                top: d.pointer.y - d.grabOffset.r * mainCell,
                width: box.w * mainCell,
                height: box.h * mainCell,
              }}
              aria-hidden="true"
            >
              <PlaneGlyph shape={config.shape} rotation={d.rotation} ghost />
            </div>
          )
        })()
      ) : null}

      <PaperModal
        open={exitOpen}
        title="确认退出对局？"
        onClose={() => setExitOpen(false)}
        footer={
          <>
            <PaperButton variant="ghost" onClick={() => setExitOpen(false)}>
              继续对局
            </PaperButton>
            <PaperButton
              variant="danger"
              onClick={() => {
                resetGame()
                setView(mode === 'online' ? 'online' : 'single')
              }}
            >
              确认退出
            </PaperButton>
          </>
        }
      >
        退出后本局进度将丢失，且不会计入任何记录。
      </PaperModal>
    </div>
  )
}
