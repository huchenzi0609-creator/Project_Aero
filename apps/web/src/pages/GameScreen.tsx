/**
 * GameScreen —— 单机对局页（M4 交付物 2/3/4）。
 *
 * 流程：
 * - 摆阵确认后进入本页：先展示 1.5s 先后手横幅（与 createGame 的 firstMover 一致）；
 * - 对战：顶部状态条（单机隐藏倒计时）、样式参考图（5×5，本局形状+旋转演示）、
 *   我方小网格（1/2 尺寸，竖版右上 / 横版右侧居中）、对手大网格居中、底部坐标输入框；
 * - 报点：点格高亮→再点同一格报点（点他格转移高亮）；输入框坐标+回车/确认；
 *   已报格禁点；非法坐标抖动+Toast；
 * - 我方报点 → applyShot → 渲染；AI 300~900ms 后 chooseShot 报点 →
 *   我方网格 0.8s 高亮动画 + 状态条"对方报点 Xn：…" → 渲染 → 回到我方回合；
 * - 绝地反击：状态条提示并获得一次额外报点机会；终局 → 结算（胜负文案+双方真实阵型+统计）。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Cell } from '@aero/shared'
import { DEFAULT_PLANE_SHAPE } from '@aero/shared'
import { boundingBox, formatCoord, inBounds, parseCoord } from '@aero/game-core'
import type { GameState, ShotResult } from '@aero/game-core'
import { chooseShot } from '@aero/game-core/ai'
import type { ShotKnowledge } from '@aero/game-core/ai'
import { useAppStore } from '../store/appStore'
import { useGameStore } from '../store/gameStore'
import { useGuestStore } from '../store/guestStore'
import { useSettingsStore } from '../store/settingsStore'
import { useToastStore } from '../store/toastStore'
import { useEffectiveOrientation, useViewport } from '../hooks/useOrientation'
import { audioService } from '../lib/audioService'
import { PaperButton } from '../components/ui/PaperButton'
import { PaperCard } from '../components/ui/PaperCard'
import { PaperModal } from '../components/ui/PaperModal'
import { PaperGrid } from '../components/grid/PaperGrid'
import { PlaneGlyph } from '../components/grid/PlaneGlyph'
import {
  ColoringToolButton,
  refShotsFor,
  useColoring,
  useRefPlanes,
} from '../components/grid/ColoringTool'

const OUTCOME_TEXT: Record<string, string> = {
  miss: '击空',
  hit: '击中',
  kill: '击毁',
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

export function GameScreen({ mode = 'single' }: { mode?: 'single' | 'online' }) {
  const session = useGameStore((s) => s.session)
  const applyShotAt = useGameStore((s) => s.applyShotAt)
  const resetGame = useGameStore((s) => s.reset)
  const setView = useAppStore((s) => s.setView)
  const toast = useToastStore((s) => s.push)
  const guestName = useGuestStore((s) => s.name)
  const difficulty = useSettingsStore((s) => s.difficulty)
  const bgmVolume = useSettingsStore((s) => s.bgmVolume)
  const sfxVolume = useSettingsStore((s) => s.sfxVolume)
  const settingsAllowMove = useSettingsStore((s) => s.allowMoveRefPlane)

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
  const shakeTimer = useRef(0)
  const sfxTimers = useRef<number[]>([])
  const oppBoardRef = useRef<HTMLDivElement | null>(null)
  const refAreaRef = useRef<HTMLElement | null>(null)

  /** 延时播放音效（如报点后的盖章/击毁结果音），统一登记便于卸载清理 */
  const playSfxAt = (name: Parameters<typeof audioService.playSfx>[0], delayMs: number) => {
    sfxTimers.current.push(window.setTimeout(() => audioService.playSfx(name), delayMs))
  }

  const state: GameState | null = session?.state ?? null
  const config = session?.config
  const me = session?.me ?? 0
  const ai = session?.ai ?? 1

  /* ---------- 着色工具（每局独立，新对局清空） ---------- */
  const coloring = useColoring()
  const isColoring = coloring.coloringMode

  /* ---------- 样式参考飞机：允许拖拽开关（config 优先，回退设置，默认 true） ---------- */
  const allowMoveRefPlane = config?.allowMoveRefPlane ?? settingsAllowMove ?? true

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
    coloring.reset()
    refPlanes.reset()
    audioService.playSfx('page-flip')
    const t = window.setTimeout(() => setScreen('battle'), 1500)
    return () => window.clearTimeout(t)
  }, [session?.nonce])

  /* ---------- 终局 → 结算（胜负提示音 + 结算翻页） ---------- */
  useEffect(() => {
    if (!state || state.phase !== 'ended' || screen !== 'battle') return
    const iWin = state.winner === me
    audioService.playSfx(iWin ? 'win' : 'lose')
    const t = window.setTimeout(() => {
      setScreen('result')
      audioService.playSfx('page-flip')
    }, 650)
    return () => window.clearTimeout(t)
  }, [state, screen, me])

  /* ---------- AI 回合驱动：300~900ms 后 chooseShot 报点 ---------- */
  useEffect(() => {
    if (!state || !session || screen !== 'battle') return
    if (state.phase === 'ended' || state.turn !== ai) return
    const t = window.setTimeout(
      () => {
        const aiBoardNow = state.players[ai]
        const knowledge: ShotKnowledge = {
          width: aiBoardNow.width,
          height: aiBoardNow.height,
          shots: aiBoardNow.shotsFired,
          planeShape: aiBoardNow.shape,
        }
        const cell = chooseShot(knowledge, difficulty, session.aiRng)
        const res = applyShotAt(cell)
        if (!res || !res.ok || !res.outcome) return
        setAiFlash(cell)
        setMyMsg(null)
        setAiMsg(`对方报点 ${formatCoord(cell)}：${OUTCOME_TEXT[res.outcome] ?? '无效'}！`)
        window.setTimeout(() => setAiFlash(null), 800)
        // 对方报点结果音：击中盖章 / 击毁重章
        audioService.playSfx(res.outcome === 'kill' ? 'kill' : 'stamp')
      },
      300 + Math.random() * 600,
    )
    return () => window.clearTimeout(t)
  }, [state, screen, session?.nonce])

  /* ---------- 尺寸 ---------- */
  // 竖版 9:16 无滚动：状态条 + 参考/我方行 + 中央棋盘 + 输入栏 全部收进舞台
  // （常量由 390×667 实测校准：主区高度基准 172、行预算 170、各卡固定开销）
  const PORTRAIT_MAIN_BASE = 172
  const PORTRAIT_ROW_BUDGET = 170
  const REF_CARD_CHROME = 81 // 参考卡：标题+列标+内边距
  const MINE_CARD_CHROME = 53 // 我方卡：标题+内边距
  const OPP_CARD_CHROME = 27 // 中央棋盘：列标+边框

  const landscapeMainCell = useMemo(() => {
    if (!config) return 20
    const availW = viewport.width * 0.4
    const availH = viewport.height - 170
    return clamp(Math.floor(Math.min(availW / config.width, availH / config.height)), 12, 34)
  }, [viewport, config])

  const portraitSizes = useMemo(() => {
    if (!config) return null
    const availW = viewport.width - 16
    const mainAvailH = viewport.height - PORTRAIT_MAIN_BASE
    let mainCell = clamp(Math.floor(availW / config.width), 8, 30)
    // 中央棋盘高度 + 行预算不超主区；宽度优先，必要时缩格
    const oppMaxH = mainAvailH - PORTRAIT_ROW_BUDGET
    if (mainCell * config.height + OPP_CARD_CHROME > oppMaxH) {
      mainCell = Math.max(8, Math.floor((oppMaxH - OPP_CARD_CHROME) / config.height))
    }
    const oppH = mainCell * config.height + OPP_CARD_CHROME
    const rowH = mainAvailH - oppH - 8
    const halfW = Math.floor((availW - 8) / 2)
    const refCell = clamp(Math.floor((rowH - REF_CARD_CHROME) / 5), 8, 24)
    const miniCell = clamp(
      Math.min(Math.floor((rowH - MINE_CARD_CHROME) / config.height), Math.floor((halfW - 18) / config.width)),
      4,
      18,
    )
    return { mainCell, refCell, miniCell }
  }, [viewport, config])

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
  const resCell = config ? clamp(Math.floor(200 / Math.max(config.width, config.height)), 4, 16) : 8

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

  /* ---------- 报点 ---------- */

  const alreadyShot = (cell: Cell) =>
    myBoard.shotsFired.some((s) => s.coord.r === cell.r && s.coord.c === cell.c)

  const shakeInput = () => {
    setShake(true)
    window.clearTimeout(shakeTimer.current)
    shakeTimer.current = window.setTimeout(() => setShake(false), 420)
  }

  const doShot = (cell: Cell) => {
    if (!isPlaying) return
    if (state.turn !== me) {
      toast('还没轮到您报点', 'error')
      return
    }
    if (alreadyShot(cell)) {
      toast('该格已经报过点了', 'error')
      shakeInput()
      return
    }
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
    setHighlight(null)
    setInput('')
    setAiMsg(null)
    const resultLabel = res.outcome ? OUTCOME_TEXT[res.outcome] : '无效'
    setMyMsg(`我方报点 ${formatCoord(cell)}：${resultLabel}！`)
    audioService.playSfx('shoot')
    // 结果音：击中盖章 / 击毁重章（稍延时贴合报点节奏）
    if (res.outcome === 'kill') playSfxAt('kill', 180)
    else if (res.outcome === 'hit') playSfxAt('stamp', 140)
  }

  const onOppCellClick = (cell: Cell) => {
    if (screen !== 'battle' || !isPlaying) return
    if (state.turn !== me) {
      toast('还没轮到您报点', 'error')
      return
    }
    if (alreadyShot(cell)) {
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
    doShot(cell)
  }

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
        <span className="game__names">
          您 · {guestName} <span className="game__vs">VS</span> 电脑
        </span>
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
              shots={myBoard.receivedShots}
              destroyedPlaneIds={myBoard.destroyedPlaneIds}
              flash={aiFlash}
              ariaLabel="我方小网格"
            />
          </PaperCard>
        </section>

        {/* 对手网格（居中）：只渲染我方报点标记，绝不显示对方阵型；可放置参考飞机副本 */}
        <section className="game__opp">
          <div className="coloring-stage">
            <PaperGrid
              width={config.width}
              height={config.height}
              cellSize={mainCell}
              showLabels
              onCellClick={onOppCellClick}
              shots={myBoard.shotsFired}
              highlight={highlight}
              coloredCells={coloring.coloredCells}
              coloring={
                isColoring
                  ? { active: true, color: coloring.currentColor, onPaint: coloring.paintCell }
                  : undefined
              }
              planes={refPlanes.shownPlanes}
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
          </div>
        </section>
      </main>

      <footer className="game__inputbar">
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
        <label className="visually-hidden" htmlFor="game-coord">
          报点坐标
        </label>
        <input
          id="game-coord"
          className={['paper-select__control game__input', shake ? 'shake' : ''].filter(Boolean).join(' ')}
          style={{ width: 130, textAlign: 'center', letterSpacing: '0.08em' }}
          value={input}
          disabled={!isMyTurn || screen !== 'battle' || isColoring}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitInput()
          }}
          placeholder="请输入坐标"
          aria-label="报点坐标，如 A5"
          autoComplete="off"
        />
        <PaperButton variant="primary" onClick={commitInput} disabled={!isMyTurn || screen !== 'battle' || isColoring}>
          确认报点
        </PaperButton>
        <span className="game__hint">
          {isColoring ? '着色模式：点按染色 · 按住拖动画线 · 再点同色擦除' : '点击棋盘选格，再点一次报点 · 或输入坐标回车'}
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
            <h1 className={`result__title ${iWin ? 'result__title--win' : 'result__title--lose'}`}>
              {iWin ? '恭喜您，您赢了！' : '您输了，下次一定！'}
            </h1>

            <div className="result__boards">
              <div className="result__board">
                <h2 className="game__card-title">我方真实阵型</h2>
                <PaperGrid
                  width={config.width}
                  height={config.height}
                  cellSize={resCell}
                  planes={myBoard.planes}
                  shape={config.shape}
                  ariaLabel="我方真实阵型"
                />
              </div>
              <div className="result__board">
                <h2 className="game__card-title">对方真实阵型</h2>
                <PaperGrid
                  width={config.width}
                  height={config.height}
                  cellSize={resCell}
                  planes={aiBoard.planes}
                  shape={config.shape}
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
