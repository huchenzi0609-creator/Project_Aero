/**
 * OnlineGame —— 联机对局页（M6）。
 *
 * 复用 M4 GameScreen 的网格渲染与报点交互，状态来源换成 onlineStore（服务端事件驱动）：
 * - 我方回合才可报点（deadline 倒计时 + chancesLeft「剩余超时机会」）；非我方回合禁用；
 * - 两块网格：我方网格渲染对手报点（oppShots + 残骸暗色），对手网格渲染我方报点（myShots）；
 * - machineTakeover 横幅；对手断线 60s 倒计时横幅与恢复；我方断线自动重连横幅；
 * - 投降按钮（二次确认）；gameEnd 结算页复用 M4 布局（胜负+双方真实阵型+stats）。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Cell, PlaneShape, PlacedPlane, Shot } from '@aero/shared'
import { DEFAULT_PLANE_SHAPE } from '@aero/shared'
import { boundingBox, formatCoord, inBounds, killEfficiencyStats, occupiedCells, parseCoord, rotateShape } from '@aero/game-core'
import { useAppStore } from '../store/appStore'
import { useOnlineStore } from '../store/onlineStore'
import { useGuestStore } from '../store/guestStore'
import { useSettingsStore } from '../store/settingsStore'
import { useToastStore } from '../store/toastStore'
import { connectClient, onV030, v030Api } from '../online/client'
import { BlitzClock } from '../components/v030/BlitzClock'
import { PreFireMark } from '../components/v030/PreFireMark'
import { blindVisibleMarks } from '../components/v030/BlindMarks'
import { prefireAdd, prefireRemove, prefireShift, sameCell } from '../online/prefire'
import { useEffectiveOrientation, useViewport } from '../hooks/useOrientation'
import type { Viewport } from '../hooks/useOrientation'
import { audioService } from '../lib/audioService'
import { PaperButton } from '../components/ui/PaperButton'
import { PaperCard } from '../components/ui/PaperCard'
import { PaperModal } from '../components/ui/PaperModal'
import { PaperGrid } from '../components/grid/PaperGrid'
import { PlaneGlyph } from '../components/grid/PlaneGlyph'
import { StampMark } from '../components/grid/StampMark'
import type { GameState } from '@aero/game-core'
import {
  ColoringToolButton,
  refShotsFor,
  useColoring,
  useRefPlanes,
  type GhostRect,
} from '../components/grid/ColoringTool'

const OUTCOME_TEXT: Record<string, string> = {
  miss: '击空',
  hit: '击中',
  kill: '击毁',
}

/** 按报点 kill 标记还原被击毁飞机 id（v0.2.9 结算叠加残骸层 / 击杀效率计算共用） */
function killedPlaneIds(layout: PlacedPlane[], shots: Shot[], shape: PlaneShape): number[] {
  const kills = new Set(shots.filter((s) => s.outcome === 'kill').map((s) => `${s.coord.r},${s.coord.c}`))
  return layout
    .filter((p) => {
      const head = rotateShape(shape, p.rotation).head
      return kills.has(`${head.r + p.origin.r},${head.c + p.origin.c}`)
    })
    .map((p) => p.id)
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

function useNow(intervalMs = 200): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(t)
  }, [intervalMs])
  return now
}

export function OnlineGame() {
  const setView = useAppStore((s) => s.setView)
  const toast = useToastStore((s) => s.push)
  const guestName = useGuestStore((s) => s.name)
  const orientation = useEffectiveOrientation()
  const viewport = useViewport()
  const now = useNow()

  const room = useOnlineStore((s) => s.room)
  const config = useOnlineStore((s) => s.config)
  const you = useOnlineStore((s) => s.you)
  const phase = useOnlineStore((s) => s.phase)
  const yourTurn = useOnlineStore((s) => s.yourTurn)
  const deadline = useOnlineStore((s) => s.deadline)
  const turnNo = useOnlineStore((s) => s.turnNo)
  const chancesLeft = useOnlineStore((s) => s.chancesLeft)
  const myShots = useOnlineStore((s) => s.myShots)
  const oppShots = useOnlineStore((s) => s.oppShots)
  const lastShot = useOnlineStore((s) => s.lastShot)
  const takeovers = useOnlineStore((s) => s.takeovers)
  const oppDisconnect = useOnlineStore((s) => s.oppDisconnect)
  const gameEnd = useOnlineStore((s) => s.gameEnd)
  const myFleet = useOnlineStore((s) => s.myFleet)
  const socketStatus = useOnlineStore((s) => s.socketStatus)
  const sessionError = useOnlineStore((s) => s.sessionError)

  // v0.3 模式（shared GridConfig 携带 blitz/blind；经典 = 双 false）
  const modeBlitz = config?.blitz === true
  const modeBlind = config?.blind === true
  const roomCode = room?.code ?? ''

  /* ---------- v0.3 连接 / 时钟 / 预报点 / 快捷着色 ---------- */
  const [clock, setClock] = useState<Partial<Record<0 | 1, number>>>({})
  const [prefire, setPrefire] = useState<Cell[]>([])
  const [selectedPrefire, setSelectedPrefire] = useState<Cell | null>(null)
  // 无完整结构的 gameOver（如仅有 reason 的兜底事件）→ 本地提示
  const [blitzLoseNotice, setBlitzLoseNotice] = useState(false)

  // 本页会话必须由 v0.3 客户端连接承载（旧连接不 join 房间）
  useEffect(() => connectClient(), [])

  // 超快棋时钟（服务端权威 clock:update）
  useEffect(() => {
    return onV030('clock:update', ({ player, ms }) =>
      setClock((prev) => ({ ...prev, [player]: ms })),
    )
  }, [])
  useEffect(() => {
    setClock({})
  }, [roomCode])

  // gameOver（快速匹配房间的结算事件；含完整结构时 client 已桥接 store gameEnd）
  useEffect(() => {
    return onV030('gameOver', (p) => {
      if (p.reason !== 'blitz-timeout' && p.reason !== 'blitz-opp-timeout') return
      const storeEnd = useOnlineStore.getState().gameEnd
      if (!storeEnd && p.winner !== undefined) {
        // 兜底：仅有 winner/reason（无阵型）时本地提示，避免结算页访问缺失 layouts
        setBlitzLoseNotice(true)
        audioService.playSfx(p.winner === you ? 'win' : 'lose')
      }
    })
  }, [you])

  // 新房间：清空本地预报点/选中态
  useEffect(() => {
    setPrefire([])
    setSelectedPrefire(null)
    setBlitzLoseNotice(false)
  }, [roomCode])

  const [highlight, setHighlight] = useState<Cell | null>(null)
  const [input, setInput] = useState('')
  const [flash, setFlash] = useState<Cell | null>(null)
  const [oppMsg, setOppMsg] = useState<string | null>(null)
  const [myMsg, setMyMsg] = useState<string | null>(null)
  const [shake, setShake] = useState(false)
  const [resignOpen, setResignOpen] = useState(false)
  const shakeTimer = useRef(0)
  const flashTimer = useRef(0)
  const lastShotSeq = useRef(0)
  const sfxTimers = useRef<number[]>([])
  const oppBoardRef = useRef<HTMLDivElement | null>(null)
  const refAreaRef = useRef<HTMLElement | null>(null)

  /* ---------- 着色工具（每局独立：新房间 / 终局时清空；v0.3.0 幽灵快捷着色） ---------- */
  // 幽灵飞机（在场放置副本）活动列表：由 refPlanes.placed 经 useLayoutEffect 同步；
  // 快捷着色回收 = 从本列表移除（渲染层同时用 retiredGhostIds 过滤，避免点击滞后一帧）
  const [ghostRects, setGhostRects] = useState<GhostRect[]>([])
  const [retiredGhostIds, setRetiredGhostIds] = useState<ReadonlySet<string>>(new Set())
  // onGhostBatch 需引用其后定义的处理器（依赖 coloring），用 ref 桥接取最新闭包
  const ghostBatchHandlerRef = useRef<(id: string, cells: Cell[]) => void>(() => {})
  const coloring = useColoring({
    ghostRects,
    onGhostBatch: (id, cells) => ghostBatchHandlerRef.current(id, cells),
  })
  const isColoring = coloring.coloringMode
  useEffect(() => {
    coloring.reset()
  }, [roomCode])
  useEffect(() => {
    if (gameEnd) coloring.reset()
  }, [gameEnd])

  /** 延时播放音效（报点后的盖章/击毁结果音），卸载时统一清理 */
  const playSfxAt = (name: Parameters<typeof audioService.playSfx>[0], delayMs: number) => {
    sfxTimers.current.push(window.setTimeout(() => audioService.playSfx(name), delayMs))
  }

  // 会话错误 → 回菜单
  useEffect(() => {
    if (sessionError) {
      toast(sessionError, 'error')
      useOnlineStore.getState().resetSession()
      useAppStore.getState().setView('online')
    }
  }, [sessionError, toast])

  // 房间关闭 → 回菜单
  useEffect(() => {
    if (room && room.players.length === 0) {
      toast('房间已解散', 'info')
      useOnlineStore.getState().resetSession()
      setView('online')
    }
  }, [room, setView, toast])

  // 服务端报点结果：0.8s 高亮（对方） + 状态条文字（双方）+ 结果音
  useEffect(() => {
    if (!lastShot || lastShot.seq === lastShotSeq.current) return
    lastShotSeq.current = lastShot.seq
    const text = `${lastShot.by === 'you' ? '我方报点' : '对方报点'} ${formatCoord(lastShot.coord)}：${OUTCOME_TEXT[lastShot.outcome] ?? '无效'}！`
    if (lastShot.by === 'you') {
      setMyMsg(text)
      setOppMsg(null)
      // 我方结果音：击中盖章 / 击毁重章（贴合报点节奏）
      if (lastShot.outcome === 'kill') playSfxAt('kill', 180)
      else if (lastShot.outcome === 'hit') playSfxAt('stamp', 140)
    } else {
      setFlash(lastShot.coord)
      setOppMsg(text)
      setMyMsg(null)
      window.clearTimeout(flashTimer.current)
      flashTimer.current = window.setTimeout(() => setFlash(null), 800)
      audioService.playSfx(lastShot.outcome === 'kill' ? 'kill' : 'stamp')
    }
  }, [lastShot])

  useEffect(
    () => () => {
      window.clearTimeout(shakeTimer.current)
      window.clearTimeout(flashTimer.current)
      sfxTimers.current.forEach((t) => window.clearTimeout(t))
    },
    [],
  )

  // 终局 → 胜负提示音 + 结算翻页
  useEffect(() => {
    if (!gameEnd) return
    audioService.playSfx(gameEnd.winner === you ? 'win' : 'lose')
    const t = window.setTimeout(() => audioService.playSfx('page-flip'), 500)
    return () => window.clearTimeout(t)
  }, [gameEnd, you])

  /* ---------- 尺寸（竖版 9:16 无滚动：状态条+计时条+参考/我方行+中央棋盘+输入栏收进舞台；横版沿用 M4） ---------- */
  // v0.2.10 行优先重设计：压缩状态条/计时条/输入栏/卡片 chrome（m4.css/m6.css 竖版覆盖）后，
  // 行分配纵向预算（refCell≥18 / miniCell≥8 目标），中央空网格保持满宽（≥85% 舞台宽）、高度取剩余。
  // 常量按压缩后实测校准（最坏情况：状态条两行 54 + 计时条 25 + 输入栏 38 + 边距 16 + 间距 12）
  const PORTRAIT_MAIN_BASE = 145
  const PORTRAIT_ROW_BUDGET = 163 // 行目标预算：refCell≥18（73+5*18）与 miniCell≥8（49+10*8）取大
  const REF_CARD_CHROME = 73 // 参考卡：内边距+标题+列标+边框（压缩后实测校准）
  const MINE_CARD_CHROME = 49 // 我方卡：内边距+标题+边框（压缩后实测校准）
  const OPP_CARD_CHROME = 27 // 中央棋盘：列标+边框
  const ROW_GAP = 8

  // 尺寸冻结：仅在本局（房间码）首次进入时捕获舞台尺寸，本局内元素大小保持不变；
  // 新房间 → 新房间码 → 重新计算一次
  const frozenViewportRef = useRef<Map<string, Viewport>>(new Map())
  if (!frozenViewportRef.current.has(roomCode)) {
    frozenViewportRef.current.set(roomCode, viewport)
  }
  const frozenViewport = frozenViewportRef.current.get(roomCode) ?? viewport

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
  const resultViewportRef = useRef<Map<string, Viewport>>(new Map())
  if (gameEnd && !resultViewportRef.current.has(roomCode)) {
    resultViewportRef.current.set(roomCode, viewport)
  }
  const resultViewport = gameEnd ? (resultViewportRef.current.get(roomCode) ?? viewport) : null

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

  /* ---------- 样式参考飞机拖拽（config 开关优先，回退设置，默认 true；每局独立） ---------- */
  const settingsAllowMove = useSettingsStore((s) => s.allowMoveRefPlane)
  const allowMoveRefPlane = (config?.allowMoveRefPlane ?? settingsAllowMove ?? true) && !modeBlind

  // 着色入口在盲棋下禁用；进入盲棋房间时若已在着色模式则退出
  const blindColorLocked = modeBlind
  useEffect(() => {
    if (blindColorLocked && coloring.coloringMode) coloring.toggleMode()
  }, [blindColorLocked])

  // v0.3.0 幽灵快捷着色（与 M4 单机同构）：
  // placed 每次变化 → useLayoutEffect 同步活动幽灵列表（回收 = 从列表移除，渲染层再过滤 retired）
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

  useLayoutEffect(() => {
    if (!config) return
    setGhostRects(
      (refPlanes.placed ?? [])
        .filter((p) => !retiredGhostIds.has(String(p.id)))
        .map((p) => ({ id: String(p.id), cells: occupiedCells(p, config.shape) })),
    )
  }, [refPlanes.placed, retiredGhostIds, config])

  // 新房间 / 终局：清空幽灵活动列表与回收记录
  useEffect(() => {
    setGhostRects([])
    setRetiredGhostIds(new Set())
  }, [roomCode])
  useEffect(() => {
    if (gameEnd) {
      setGhostRects([])
      setRetiredGhostIds(new Set())
    }
  }, [gameEnd])

  // 快捷着色：整机被批量着色 → 回收该幽灵 + 退出着色模式（ColoringTool 只发事件，回收由页面执行）
  const handleGhostBatch = (id: string) => {
    setGhostRects((prev) => prev.filter((g) => g.id !== id))
    setRetiredGhostIds((prev) => new Set(prev).add(id))
    if (coloring.coloringMode) coloring.toggleMode()
  }
  ghostBatchHandlerRef.current = handleGhostBatch

  // 新房间 / 终局：清空参考飞机放置副本
  useEffect(() => {
    refPlanes.reset()
  }, [roomCode])
  useEffect(() => {
    if (gameEnd) refPlanes.reset()
  }, [gameEnd])

  const myKilledIds = useMemo(() => {
    if (!myFleet || !config) return []
    const kills = new Set(
      oppShots.filter((s) => s.outcome === 'kill').map((s) => `${s.coord.r},${s.coord.c}`),
    )
    return myFleet
      .filter((p) => {
        const head = rotateShape(config.shape, p.rotation).head
        const abs = { r: head.r + p.origin.r, c: head.c + p.origin.c }
        return kills.has(`${abs.r},${abs.c}`)
      })
      .map((p) => p.id)
  }, [myFleet, oppShots, config])

  // v0.2.9 结算用：gameEnd 权威阵型（双方真实机队；未终局为空）
  const mineLayout = gameEnd ? gameEnd.layouts[you === 0 ? 'player0' : 'player1'] : []
  const oppLayout = gameEnd ? gameEnd.layouts[you === 0 ? 'player1' : 'player0'] : []

  // v0.2.9 平均击杀效率：客户端只持有报点与终局阵型，按契约重建 GameState 供 killEfficiencyStats 计算。
  // useMemo：仅终局/报点/阵型变化时重算，避免无关重渲染（计时/着色/横幅）下重复计算
  const killEff = useMemo(() => {
    if (!gameEnd || !config) return null
    const mkBoard = (
      planes: PlacedPlane[],
      destroyedPlaneIds: number[],
      shotsFired: Shot[],
      receivedShots: Shot[],
    ) => ({
      width: config.width,
      height: config.height,
      shape: config.shape,
      planes,
      destroyedPlaneIds,
      receivedShots,
      shotsFired,
    })
    const mineBoard = mkBoard(mineLayout, killedPlaneIds(mineLayout, oppShots, config.shape), myShots, oppShots)
    const oppBoard = mkBoard(oppLayout, killedPlaneIds(oppLayout, myShots, config.shape), oppShots, myShots)
    const synth: GameState = {
      phase: 'ended',
      players: you === 0 ? [mineBoard, oppBoard] : [oppBoard, mineBoard],
      turn: 0,
      firstMover: 0,
      turnNo: gameEnd.stats.turnCount,
      winner: gameEnd.winner,
    }
    return killEfficiencyStats(synth)
  }, [gameEnd, config, you, myShots, oppShots, mineLayout, oppLayout])

  /* ---------- 盲棋：对手网格可见报点 = 击毁永存 + 最近 3 个非击毁（FIFO，共享工具） ---------- */
  const visibleShots = useMemo(() => {
    if (!modeBlind) return myShots
    return blindVisibleMarks(myShots)
  }, [modeBlind, myShots])

  // 可见标记格集合（预报点不可置于其上；盲棋按可见集判定，非盲棋按全量）
  const visibleMarkedKeys = useMemo(() => {
    const src = modeBlind ? visibleShots : myShots
    return new Set(src.map((s) => `${s.coord.r},${s.coord.c}`))
  }, [modeBlind, visibleShots, myShots])

  // 预报点渲染：伪 shot（outcome:'miss' 仅占位，不进统计）走 renderShot 画「?」
  const prefireKeys = useMemo(
    () => new Set(prefire.map((c) => `${c.r},${c.c}`)),
    [prefire],
  )
  const renderShots = useMemo<Shot[]>(
    () => [
      ...visibleShots,
      ...prefire.map((c) => ({ coord: c, outcome: 'miss' as const })),
    ],
    [visibleShots, prefire],
  )
  const invertMarks = useSettingsStore((s) => s.invertMarks)
  const renderPreFireShot = useCallback(
    (shot: Shot, cellSize: number) => {
      if (prefireKeys.has(`${shot.coord.r},${shot.coord.c}`)) {
        // 预报点（v030 共享组件；纸感「?」，选中由输入框坐标/高亮反馈）
        return <PreFireMark coord={shot.coord} size={cellSize * 0.72} />
      }
      return <StampMark outcome={shot.outcome} size={cellSize * 0.82} cell={shot.coord} inverted={invertMarks} />
    },
    [prefireKeys, invertMarks],
  )

  // 我方回合开始：预报点 FIFO 自动上报（每回合一个，队列空则恢复手动）
  const autoFiredTurnRef = useRef<{ turnNo: number; count: number }>({ turnNo: 0, count: 0 })
  const phaseInGame = phase === 'playing' || phase === 'counterattack'
  useEffect(() => {
    if (!phaseInGame || !yourTurn) return
    const fired = autoFiredTurnRef.current
    if (fired.turnNo === turnNo) return
    const { list, head } = prefireShift(prefire)
    if (!head) {
      autoFiredTurnRef.current = { turnNo, count: 0 }
      return
    }
    autoFiredTurnRef.current = { turnNo, count: fired.count + 1 }
    setPrefire(list)
    setSelectedPrefire(null)
    setHighlight(null)
    setInput('')
    audioService.playSfx('shoot')
    void v030Api.shoot(head).then((res) => {
      if (!res.ok) {
        toast(res.error ?? '自动上报失败', 'error')
        // 失败回填队首，下一回合重试
        setPrefire((prev) => [head, ...prev])
      }
    })
  }, [phaseInGame, yourTurn, turnNo, prefire])

  if (!room || !config) {
    return (
      <div className="page" style={{ alignItems: 'center', gap: 16 }}>
        <p>对局会话不存在，请返回联机菜单。</p>
        <PaperButton variant="primary" onClick={() => setView('online')}>
          返回联机菜单
        </PaperButton>
      </div>
    )
  }

  const oppSeat = room.players[(1 - you) as 0 | 1]
  const oppName = oppSeat?.name ?? '对手'

  // 对手网格实际渲染的幽灵：隐藏已被快捷着色回收的（placed 内部仍保留，拖拽/重叠不受影响）
  const visibleShownPlanes = refPlanes.shownPlanes.filter(
    (p) => p.id === -1 || !retiredGhostIds.has(String(p.id)),
  )

  const isPlaying = phase === 'playing' || phase === 'counterattack'
  // v0.3：非我方回合不再拦截报点（改预报点机制），故禁点条件移除 !yourTurn
  const canShoot = isPlaying && yourTurn && socketStatus === 'connected' && !isColoring

  const alreadyShot = (cell: Cell) =>
    myShots.some((s) => s.coord.r === cell.r && s.coord.c === cell.c)

  const shakeInput = () => {
    setShake(true)
    window.clearTimeout(shakeTimer.current)
    shakeTimer.current = window.setTimeout(() => setShake(false), 420)
  }

  /* ---------- 预报点（v0.3）：非我方回合点击/输入创建；再次点击选中，确认取消 ---------- */

  const markedKey = (cell: Cell) => `${cell.r},${cell.c}`

  const tryAddPrefire = (cell: Cell): void => {
    const { list, ok, full } = prefireAdd(prefire, cell)
    if (full) {
      toast('预报点已达上限（10 个），请先取消部分预报点。', 'error')
      return
    }
    if (!ok) {
      setSelectedPrefire(cell) // 已是预报点：转移选中
      setInput(formatCoord(cell))
      return
    }
    setPrefire(list)
    setSelectedPrefire(null)
    setInput(formatCoord(cell))
  }

  const togglePrefire = (cell: Cell): void => {
    // 已选中的预报点 → 再次确认 = 取消
    if (selectedPrefire && sameCell(selectedPrefire, cell)) {
      setPrefire((prev) => prefireRemove(prev, cell))
      setSelectedPrefire(null)
      setInput('')
      toast('预报点已取消。', 'info')
      return
    }
    if (prefire.some((c) => sameCell(c, cell))) {
      setSelectedPrefire(cell)
      setInput(formatCoord(cell))
      return
    }
    tryAddPrefire(cell)
  }

  const handlePrefireTap = (cell: Cell): void => {
    // 已有可见标记格不可设预报点（盲棋按可见集，常规按全量）
    if (visibleMarkedKeys.has(markedKey(cell))) {
      setSelectedPrefire(null)
      return
    }
    if (selectedPrefire && !sameCell(selectedPrefire, cell)) setSelectedPrefire(null)
    togglePrefire(cell)
  }

  const doShot = (cell: Cell) => {
    if (!canShoot) return
    void v030Api.shoot(cell).then((res) => {
      if (!res.ok) {
        toast(res.error ?? '报点被拒绝', 'error')
        shakeInput()
      }
    })
    setHighlight(null)
    setInput('')
    setOppMsg(null)
    audioService.playSfx('shoot')
  }

  const onOppCellClick = (cell: Cell) => {
    if (!isPlaying) return
    if (isColoring) return // 着色模式接管棋盘指针（PaperGrid 已屏蔽，此处兜底）
    if (canShoot) {
      // 我方回合：盲棋允许重复报点（服务端裁决返回击空），常规拒绝已报格
      if (!modeBlind && alreadyShot(cell)) {
        toast('该格已经报过点了', 'error')
        return
      }
      if (highlight && highlight.r === cell.r && highlight.c === cell.c) {
        doShot(cell)
      } else {
        setHighlight(cell)
        setInput(formatCoord(cell))
      }
      return
    }
    // 非我方回合 → 预报点（取代原「还没轮到您报点」提示）
    handlePrefireTap(cell)
  }

  const commitInput = () => {
    if (isColoring) return // 着色模式下不触发报点
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
    if (canShoot) {
      if (!modeBlind && alreadyShot(cell)) {
        toast('该格已经报过点了', 'error')
        shakeInput()
        return
      }
      doShot(cell)
      return
    }
    // 非我方回合：选中预报点 + 再次确认（点击或坐标输入）可取消
    if (selectedPrefire && sameCell(selectedPrefire, cell)) {
      setPrefire((prev) => prefireRemove(prev, cell))
      setSelectedPrefire(null)
      setInput('')
      toast('预报点已取消。', 'info')
      return
    }
    if (visibleMarkedKeys.has(markedKey(cell))) {
      setSelectedPrefire(null)
      return
    }
    togglePrefire(cell)
  }

  /* ---------- 计时 ---------- */

  const remainingMs = deadline > 0 ? Math.max(0, deadline - now) : 0
  const remainingSec = Math.ceil(remainingMs / 1000)

  /* ---------- 状态条 ---------- */

  let statusText = ''
  let statusThem = false
  if (isPlaying) {
    if (phase === 'counterattack' && yourTurn) {
      statusText = '绝地反击！您获得一次额外报点机会'
    } else if (oppMsg) {
      statusText = oppMsg
      statusThem = true
    } else if (myMsg) {
      statusText = myMsg
    } else if (yourTurn && prefire.length > 0) {
      statusText = `轮到你了——预报点将自动上报（${prefire.length} 个）`
    } else if (yourTurn) {
      statusText = `轮到我方报点 · 第 ${turnNo} 回合`
    } else {
      statusText = prefire.length > 0 ? `等待对方报点… 已预排 ${prefire.length} 个预报点` : '等待对方报点…'
      statusThem = true
    }
  }

  /* ---------- 结算 ---------- */

  const iWin = gameEnd ? gameEnd.winner === you : false
  // v0.3：超快棋超时判负（gameEnd.reason 扩展 / gameOver blitz-timeout，服务端契约 M5）
  const gameEndReason = (gameEnd?.reason as string | undefined) ?? ''
  const blitzTimeoutEnd = gameEndReason === 'blitz-timeout' || gameEndReason === 'blitz-opp-timeout'
  const reasonText = gameEnd
    ? blitzTimeoutEnd
      ? iWin
        ? '对方超时，您获胜。'
        : '您超时，本局判负。'
      : gameEnd.reason === 'all-destroyed'
        ? iWin
          ? '对手全部飞机被击毁'
          : '您的全部飞机被击毁'
        : gameEnd.reason === 'counterattack'
          ? '绝地反击定胜负'
          : gameEnd.reason === 'resign'
            ? iWin
              ? '对手认输'
              : '您认输了'
            : gameEnd.reason === 'disconnect'
              ? iWin
                ? '对手断线超时'
                : '您断线超时'
              : iWin
                ? '对手超时被机器接管后落败'
                : '您超时被机器接管后落败'
    : ''

  const myHits = myShots.filter((s) => s.outcome !== 'miss').length
  const myKillCount = myShots.filter((s) => s.outcome === 'kill').length
  const oppHits = oppShots.filter((s) => s.outcome !== 'miss').length
  const oppKillCount = oppShots.filter((s) => s.outcome === 'kill').length

  // v0.2.9 结算叠加：按 gameEnd 权威阵型 + 对方报点还原我方被击毁飞机（残骸暗色层）；
  // 对方真实阵型不叠残骸层（我方 kill 章已覆盖）
  const resultMineKilled = gameEnd ? killedPlaneIds(mineLayout, oppShots, config.shape) : []
  const fmtEff = (v: number | null) => (v === null ? '—' : v.toFixed(1))

  const takeoverMine = takeovers.includes(you)
  const takeoverOpp = takeovers.includes((1 - you) as 0 | 1)
  const oppDisconnSec = oppDisconnect ? Math.max(0, oppDisconnect.graceMs - (now - oppDisconnect.since)) : 0

  /* ---------- v0.3 输入栏可用性 / 提示（非我方回合改为预报点输入，不再禁用） ---------- */
  const inputDisabled = !isPlaying || socketStatus !== 'connected' || isColoring
  let hintText = ''
  if (isColoring) hintText = '着色模式：点按染色 · 按住拖动画线 · 再点同色擦除'
  else if (modeBlind) hintText = '盲棋：不记旧报点，参考飞机与着色已禁用'
  else if (canShoot) hintText = '点击棋盘选格，再点一次报点 · 或输入坐标回车'
  else if (isPlaying)
    hintText = '等待对方报点：可点击空格预排「?」预报点（≤10），轮到自动上报'
  else hintText = '点击棋盘选格，再点一次报点 · 或输入坐标回车'

  return (
    <div className={`game game--${orientation}`}>
      <header className="game__statusbar">
        <PaperButton size="sm" variant="ghost" onClick={() => setResignOpen(true)}>
          投降
        </PaperButton>
        <div className={`game__statusbtn ${shake ? 'shake' : ''}`} role="status" aria-live="polite">
          <span className={`game__dot${statusThem ? ' game__dot--them' : ''}`} aria-hidden="true" />
          <span className="game__status-text">{statusText}</span>
        </div>
        <span className="game__names">
          您 · {guestName} <span className="game__vs">VS</span> {oppName}
        </span>
      </header>

      {/* 计时条：超快棋（blitz）→ 双方时钟（服务端 clock:update 权威驱动，byo-yomi 不生效）；
          否则沿用 v0.2 读秒（turnStart.deadline === 0 表示不限时/机器回合 → 不显示） */}
      {modeBlitz && isPlaying ? (
        <div className="game__timerbar">
          <span className="game__timer" style={{ color: 'var(--ink-soft)' }}>
            我方{' '}
            <BlitzClock ms={clock[you] ?? config.planeCount * 10_000} active={yourTurn && socketStatus === 'connected'} />
          </span>
          <span className="game__timer" style={{ color: 'var(--ink-soft)' }}>
            对方{' '}
            <BlitzClock ms={clock[((1 - you) as 0 | 1)] ?? config.planeCount * 10_000} active={!yourTurn && socketStatus === 'connected'} />
          </span>
          <span className="game__chances">超时立即判负</span>
        </div>
      ) : isPlaying && deadline > 0 ? (
        <div className={['game__timerbar', remainingSec <= 5 ? 'game__timerbar--urgent' : ''].filter(Boolean).join(' ')}>
          <span className="game__timer">
            {yourTurn ? '我方' : '对方'}剩余 {remainingSec}s
          </span>
          <span className="game__chances">
            超时机会 ×{chancesLeft}
            {chancesLeft === 0 ? '（超时将由机器接管）' : ''}
          </span>
        </div>
      ) : null}

      <main className="game__main">
        {/* 样式参考图（点击旋转 / 可拖到对手棋盘） */}
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

        {/* 我方小网格：对手报点 + 残骸 */}
        <section className="game__mine">
          <PaperCard className="game__card">
            <h2 className="game__card-title">我方阵型</h2>
            <PaperGrid
              width={config.width}
              height={config.height}
              cellSize={miniCell}
              planes={myFleet ?? []}
              shape={config.shape}
              shots={oppShots}
              destroyedPlaneIds={myKilledIds}
              flash={flash}
              ariaLabel="我方小网格"
            />
          </PaperCard>
        </section>

        {/* 对手网格（居中）：只渲染我方报点标记，绝不显示对方阵型；可放置参考飞机副本；
            外缘随回合变色（轮到我方=深绿 / 轮到对方=深红，v0.2.9；着色模式/结算下隐藏）；
            v0.3：盲棋时仅显示最近 3 个报点 + 击毁标记；预报点「?」叠加渲染 */}
        <section
          className={[
            'game__opp',
            isPlaying && !isColoring ? (yourTurn ? 'game__opp--mine' : 'game__opp--theirs') : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <div className="coloring-stage">
            <PaperGrid
              width={config.width}
              height={config.height}
              cellSize={mainCell}
              showLabels
              onCellClick={onOppCellClick}
              shots={renderShots}
              renderShot={renderPreFireShot}
              highlight={highlight}
              coloredCells={coloring.coloredCells}
              coloring={
                isColoring
                  ? { active: true, color: coloring.currentColor, onPaint: coloring.paintAt }
                  : undefined
              }
              // 渲染过滤：隐藏已被快捷着色回收的幽灵（placed 内部仍保留，拖拽/重叠逻辑不受影响）
              planes={visibleShownPlanes}
              shape={config.shape}
              planesLayer={{
                ghost: true,
                onTop: true,
                overlayIds: refPlanes.overlappedIds,
                onPlanePointerDown: (plane, e) => refPlanes.startPlacedDrag(e, plane),
              }}
              onBoardRef={(el) => {
                oppBoardRef.current = el
              }}
              ariaLabel="对手棋盘"
            />
            {!blindColorLocked ? (
              <ColoringToolButton
                className="coloring-stage__btn"
                active={isColoring}
                color={coloring.currentColor}
                paletteOpen={coloring.paletteOpen}
                paletteDir="down"
                onToggle={coloring.toggleMode}
                onOpenPalette={() => coloring.setPaletteOpen(true)}
                onClosePalette={() => coloring.setPaletteOpen(false)}
                onSelectColor={coloring.selectColor}
              />
            ) : null}
          </div>
        </section>
      </main>

      <footer className="game__inputbar">
        {!blindColorLocked ? (
          <ColoringToolButton
            className="coloring-inputbar__btn"
            active={isColoring}
            color={coloring.currentColor}
            paletteOpen={coloring.paletteOpen}
            paletteDir="up"
            onToggle={coloring.toggleMode}
            onOpenPalette={() => coloring.setPaletteOpen(true)}
            onClosePalette={() => coloring.setPaletteOpen(false)}
            onSelectColor={coloring.selectColor}
          />
        ) : null}
        <label className="visually-hidden" htmlFor="online-coord">
          报点坐标
        </label>
        <input
          id="online-coord"
          className={['paper-select__control game__input', shake ? 'shake' : ''].filter(Boolean).join(' ')}
          style={{ width: 130, textAlign: 'center', letterSpacing: '0.08em' }}
          value={input}
          disabled={inputDisabled}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitInput()
          }}
          placeholder="请输入坐标"
          aria-label="报点坐标，如 A5"
          autoComplete="off"
        />
        <PaperButton variant="primary" onClick={commitInput} disabled={inputDisabled}>
          确认报点
        </PaperButton>
        <span className="game__hint">{hintText}</span>
      </footer>

      {/* 机器接管横幅 */}
      {takeoverMine || takeoverOpp ? (
        <div className={['online__banner', takeoverMine ? 'online__banner--warn' : 'online__banner--info'].filter(Boolean).join(' ')} role="status">
          {takeoverMine
            ? '您已超时，由机器接管（若及时报点仍可自行操作）'
            : '对方超时，已由机器接管'}
        </div>
      ) : null}

      {/* 断线横幅 */}
      {socketStatus !== 'connected' ? (
        <div className="online__banner online__banner--danger" role="alert">
          连接中断，正在重连…（请勿关闭页面；60 秒内将自动恢复对局）
        </div>
      ) : null}
      {oppDisconnect && oppDisconnSec > 0 ? (
        <div className="online__banner" role="alert">
          对手已断线，正在等待重连…（{Math.ceil(oppDisconnSec / 1000)} 秒后对局结束）
        </div>
      ) : null}

      {/* 结算界面（复用 M4 布局；v0.3 超时判负用「超时判负」主标题） */}
      {gameEnd ? (
        <div className="result">
          <div className="result__card paper-card" role="status" aria-live="assertive">
            <h1 className={`result__title ${blitzTimeoutEnd || !iWin ? 'result__title--lose' : 'result__title--win'}`}>
              {blitzTimeoutEnd ? '超时判负' : iWin ? '恭喜您，您赢了！' : '您输了，下次一定！'}
            </h1>
            <p className="result__sub">{reasonText}</p>

            <div className="result__boards">
              <div className="result__board">
                <h2 className="game__card-title">我方真实阵型（{guestName}）</h2>
                {/* v0.2.9：叠加对方标记（receivedShots + 残骸暗色层） */}
                <PaperGrid
                  width={config.width}
                  height={config.height}
                  cellSize={resCell}
                  planes={mineLayout}
                  shape={config.shape}
                  shots={oppShots}
                  destroyedPlaneIds={resultMineKilled}
                  ariaLabel="我方真实阵型"
                />
              </div>
              <div className="result__board">
                <h2 className="game__card-title">对方真实阵型（{oppName}）</h2>
                {/* v0.2.9：叠加我方标记与染色（myShots + 本局着色 coloredCells） */}
                <PaperGrid
                  width={config.width}
                  height={config.height}
                  cellSize={resCell}
                  planes={oppLayout}
                  shape={config.shape}
                  shots={myShots}
                  coloredCells={coloring.coloredCells}
                  ariaLabel="对方真实阵型"
                />
              </div>
            </div>

            <dl className="result__stats">
              <div className="result__stat">
                <dt>总报点数</dt>
                <dd>{gameEnd.stats.shotsFired}</dd>
                <dd className="result__stat-note">双方合计</dd>
              </div>
              <div className="result__stat">
                <dt>我方命中</dt>
                <dd>
                  {myShots.length > 0 ? Math.round((myHits / myShots.length) * 100) : 0}%
                </dd>
                <dd className="result__stat-note">
                  命中 {myHits}/{myShots.length} · 击毁 {myKillCount} 架
                </dd>
              </div>
              <div className="result__stat">
                <dt>对方命中</dt>
                <dd>
                  {oppShots.length > 0 ? Math.round((oppHits / oppShots.length) * 100) : 0}%
                </dd>
                <dd className="result__stat-note">
                  命中 {oppHits}/{oppShots.length} · 击毁 {oppKillCount} 架
                </dd>
              </div>
              {/* v0.2.9 平均击杀效率对比：我方 / 对方（从首次命中到击毁的平均报点步数） */}
              <div className="result__stat">
                <dt>平均击杀效率</dt>
                <dd className="result__stat-eff">
                  我方 {fmtEff(killEff ? (you === 0 ? killEff.player0 : killEff.player1) : null)} / 对方{' '}
                  {fmtEff(killEff ? (you === 0 ? killEff.player1 : killEff.player0) : null)}
                </dd>
                <dd className="result__stat-note">平均每架从首中到击毁的步数</dd>
              </div>
            </dl>

            <div className="result__actions">
              <PaperButton
                variant="ghost"
                onClick={() => {
                  v030Api.leaveRoom()
                  setView('home')
                }}
              >
                返回主页
              </PaperButton>
              <PaperButton
                variant="primary"
                onClick={() => {
                  v030Api.leaveRoom()
                  setView('online')
                }}
              >
                返回联机菜单
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

      {/* 投降二次确认 */}
      <PaperModal
        open={resignOpen}
        title="确认投降？"
        onClose={() => setResignOpen(false)}
        footer={
          <>
            <PaperButton variant="ghost" onClick={() => setResignOpen(false)}>
              继续对局
            </PaperButton>
            <PaperButton
              variant="danger"
              onClick={() => {
                setResignOpen(false)
                v030Api.resign()
                toast('已投降，等待对局结束', 'info')
              }}
            >
              确认投降
            </PaperButton>
          </>
        }
      >
        投降后本局立即判负，双方阵型将公开。
      </PaperModal>

      {/* v0.3 盲棋规则提示条（局内一次性） */}
      {modeBlind && isPlaying && !gameEnd ? (
        <div className="online__banner online__banner--info" role="status">
          盲棋：报点记录对双方隐藏，参考飞机与着色已禁用；仅最近 3 个报点可见。
        </div>
      ) : null}

      {/* v0.3 兜底：无完整结构的 gameOver（如纯 blitz-timeout 广播）→ 本地结算提示 */}
      <PaperModal
        open={blitzLoseNotice}
        title="超时判负"
        onClose={() => setBlitzLoseNotice(false)}
        footer={
          <>
            <PaperButton variant="ghost" onClick={() => setBlitzLoseNotice(false)}>
              知道了
            </PaperButton>
            <PaperButton
              variant="danger"
              onClick={() => {
                setBlitzLoseNotice(false)
                v030Api.leaveRoom()
                setView('online')
              }}
            >
              返回联机菜单
            </PaperButton>
          </>
        }
      >
        对局因超时结束，正在返回联机菜单…
      </PaperModal>
    </div>
  )
}
