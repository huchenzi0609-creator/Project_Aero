/**
 * OnlineGame —— 联机对局页（M6）。
 *
 * 复用 M4 GameScreen 的网格渲染与报点交互，状态来源换成 onlineStore（服务端事件驱动）：
 * - 我方回合才可报点（deadline 倒计时 + chancesLeft「剩余超时机会」）；非我方回合禁用；
 * - 两块网格：我方网格渲染对手报点（oppShots + 残骸暗色），对手网格渲染我方报点（myShots）；
 * - machineTakeover 横幅；对手断线 60s 倒计时横幅与恢复；我方断线自动重连横幅；
 * - 投降按钮（二次确认）；gameEnd 结算页复用 M4 布局（胜负+双方真实阵型+stats）。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Cell } from '@aero/shared'
import { DEFAULT_PLANE_SHAPE } from '@aero/shared'
import { boundingBox, formatCoord, inBounds, parseCoord, rotateShape } from '@aero/game-core'
import { useAppStore } from '../store/appStore'
import { useOnlineStore } from '../store/onlineStore'
import { useGuestStore } from '../store/guestStore'
import { useSettingsStore } from '../store/settingsStore'
import { useToastStore } from '../store/toastStore'
import { onlineApi } from '../net/socket'
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

  /* ---------- 着色工具（每局独立：新房间 / 终局时清空） ---------- */
  const coloring = useColoring()
  const isColoring = coloring.coloringMode
  const roomCode = room?.code ?? ''
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

  /* ---------- 尺寸（沿用 M4 布局；hooks 必须在任何提前 return 之前） ---------- */

  const mainCell = useMemo(() => {
    if (!config) return 20
    if (orientation === 'landscape') {
      const availW = viewport.width * 0.4
      const availH = viewport.height - 170
      return clamp(Math.floor(Math.min(availW / config.width, availH / config.height)), 12, 34)
    }
    const availW = viewport.width - 30
    return clamp(Math.floor((availW - 20) / config.width), 10, 30)
  }, [orientation, viewport, config])

  const miniCell = config
    ? clamp(
        Math.min(Math.floor(mainCell / 2), Math.floor((viewport.width / 2 - 44) / config.width)),
        6,
        20,
      )
    : 10
  const refCell = Math.min(24, Math.max(13, Math.floor(mainCell * 0.8)))
  const resCell = config ? clamp(Math.floor(200 / Math.max(config.width, config.height)), 4, 16) : 8

  /* ---------- 样式参考飞机拖拽（config 开关优先，回退设置，默认 true；每局独立） ---------- */
  const settingsAllowMove = useSettingsStore((s) => s.allowMoveRefPlane)
  const allowMoveRefPlane = config?.allowMoveRefPlane ?? settingsAllowMove ?? true
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

  const isPlaying = phase === 'playing' || phase === 'counterattack'
  const canShoot = isPlaying && yourTurn && socketStatus === 'connected' && !isColoring

  const alreadyShot = (cell: Cell) =>
    myShots.some((s) => s.coord.r === cell.r && s.coord.c === cell.c)

  const shakeInput = () => {
    setShake(true)
    window.clearTimeout(shakeTimer.current)
    shakeTimer.current = window.setTimeout(() => setShake(false), 420)
  }

  const doShot = (cell: Cell) => {
    if (!canShoot) {
      toast('还没轮到您报点', 'error')
      return
    }
    if (alreadyShot(cell)) {
      toast('该格已经报过点了', 'error')
      shakeInput()
      return
    }
    void onlineApi.shoot(cell).then((res) => {
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
    if (!yourTurn) {
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
    } else if (yourTurn) {
      statusText = `轮到我方报点 · 第 ${turnNo} 回合`
    } else {
      statusText = '等待对方报点…'
      statusThem = true
    }
  }

  /* ---------- 结算 ---------- */

  const iWin = gameEnd ? gameEnd.winner === you : false
  const reasonText = gameEnd
    ? gameEnd.reason === 'all-destroyed'
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

  const mineLayout = gameEnd ? gameEnd.layouts[you === 0 ? 'player0' : 'player1'] : []
  const oppLayout = gameEnd ? gameEnd.layouts[you === 0 ? 'player1' : 'player0'] : []

  const takeoverMine = takeovers.includes(you)
  const takeoverOpp = takeovers.includes((1 - you) as 0 | 1)
  const oppDisconnSec = oppDisconnect ? Math.max(0, oppDisconnect.graceMs - (now - oppDisconnect.since)) : 0

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

      {/* 计时条 */}
      {isPlaying && deadline > 0 ? (
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

        {/* 对手网格（居中）：只渲染我方报点标记，绝不显示对方阵型；可放置参考飞机副本 */}
        <section className="game__opp">
          <div className="coloring-stage">
            <PaperGrid
              width={config.width}
              height={config.height}
              cellSize={mainCell}
              showLabels
              onCellClick={onOppCellClick}
              shots={myShots}
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
        <label className="visually-hidden" htmlFor="online-coord">
          报点坐标
        </label>
        <input
          id="online-coord"
          className={['paper-select__control game__input', shake ? 'shake' : ''].filter(Boolean).join(' ')}
          style={{ width: 130, textAlign: 'center', letterSpacing: '0.08em' }}
          value={input}
          disabled={!canShoot}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitInput()
          }}
          placeholder="请输入报点坐标"
          aria-label="报点坐标，如 A5"
          autoComplete="off"
        />
        <PaperButton variant="primary" onClick={commitInput} disabled={!canShoot}>
          确认报点
        </PaperButton>
        <span className="game__hint">
          {isColoring ? '着色模式：点按染色 · 按住拖动画线 · 再点同色擦除' : '点击棋盘选格，再点一次报点 · 或输入坐标回车'}
        </span>
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

      {/* 结算界面（复用 M4 布局） */}
      {gameEnd ? (
        <div className="result">
          <div className="result__card paper-card" role="status" aria-live="assertive">
            <h1 className={`result__title ${iWin ? 'result__title--win' : 'result__title--lose'}`}>
              {iWin ? '恭喜您，您赢了！' : '您输了，下次一定！'}
            </h1>
            <p className="result__sub">{reasonText}</p>

            <div className="result__boards">
              <div className="result__board">
                <h2 className="game__card-title">我方真实阵型（{guestName}）</h2>
                <PaperGrid
                  width={config.width}
                  height={config.height}
                  cellSize={resCell}
                  planes={mineLayout}
                  shape={config.shape}
                  ariaLabel="我方真实阵型"
                />
              </div>
              <div className="result__board">
                <h2 className="game__card-title">对方真实阵型（{oppName}）</h2>
                <PaperGrid
                  width={config.width}
                  height={config.height}
                  cellSize={resCell}
                  planes={oppLayout}
                  shape={config.shape}
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
            </dl>

            <div className="result__actions">
              <PaperButton
                variant="ghost"
                onClick={() => {
                  useOnlineStore.getState().resetSession()
                  setView('home')
                }}
              >
                返回主页
              </PaperButton>
              <PaperButton
                variant="primary"
                onClick={() => {
                  useOnlineStore.getState().resetSession()
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
                onlineApi.resign()
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
    </div>
  )
}
