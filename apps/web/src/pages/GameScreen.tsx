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
import type { Cell, Rotation, Shot } from '@aero/shared'
import { formatCoord, inBounds, parseCoord } from '@aero/game-core'
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

const REF_SHOTS: Shot[] = [
  { coord: { r: 0, c: 0 }, outcome: 'miss' },
  { coord: { r: 1, c: 4 }, outcome: 'hit' },
  { coord: { r: 0, c: 2 }, outcome: 'kill' },
]

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

  const orientation = useEffectiveOrientation()
  const viewport = useViewport()

  const [screen, setScreen] = useState<'banner' | 'battle' | 'result'>('banner')
  const [highlight, setHighlight] = useState<Cell | null>(null)
  const [input, setInput] = useState('')
  const [aiFlash, setAiFlash] = useState<Cell | null>(null)
  const [aiMsg, setAiMsg] = useState<string | null>(null)
  const [shake, setShake] = useState(false)
  const [exitOpen, setExitOpen] = useState(false)
  const [refRot, setRefRot] = useState<Rotation>(0)
  const shakeTimer = useRef(0)

  const state: GameState | null = session?.state ?? null
  const config = session?.config
  const me = session?.me ?? 0
  const ai = session?.ai ?? 1

  /* ---------- 音量占位接线（M7 实现真实音效） ---------- */
  useEffect(() => {
    audioService.setBgmVolume(bgmVolume)
    audioService.setSfxVolume(sfxVolume)
  }, [bgmVolume, sfxVolume])

  useEffect(
    () => () => {
      window.clearTimeout(shakeTimer.current)
    },
    [],
  )

  /* ---------- 横幅 → 对战 ---------- */
  useEffect(() => {
    setScreen('banner')
    setHighlight(null)
    setInput('')
    setAiFlash(null)
    setAiMsg(null)
    const t = window.setTimeout(() => setScreen('battle'), 1500)
    return () => window.clearTimeout(t)
  }, [session?.nonce])

  /* ---------- 终局 → 结算 ---------- */
  useEffect(() => {
    if (!state || state.phase !== 'ended' || screen !== 'battle') return
    const t = window.setTimeout(() => setScreen('result'), 650)
    return () => window.clearTimeout(t)
  }, [state, screen])

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
        setAiMsg(`对方报点 ${formatCoord(cell)}：${OUTCOME_TEXT[res.outcome] ?? '无效'}！`)
        window.setTimeout(() => setAiFlash(null), 800)
        audioService.playSfx('stamp')
      },
      300 + Math.random() * 600,
    )
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, screen, session?.nonce])

  /* ---------- 尺寸 ---------- */

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
    audioService.playSfx('shoot')
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
    if (aiMsg) {
      statusText = aiMsg
      statusThem = true
    } else if (isCounterattackMine) {
      statusText = '绝地反击！您获得一次额外报点机会'
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
          您 · {guestName}　<span className="game__vs">VS</span>　电脑
        </span>
      </header>

      <main className="game__main">
        {/* 样式参考图：5×5 + 本局形状 + 旋转演示 */}
        <section className="game__ref">
          <PaperCard className="game__card">
            <div className="game__card-head">
              <h2 className="game__card-title">样式参考</h2>
              <PaperButton size="sm" variant="ghost" onClick={() => setRefRot(((r) => ((r + 1) % 4) as Rotation))}>
                旋转
              </PaperButton>
            </div>
            <PaperGrid
              width={5}
              height={5}
              cellSize={refCell}
              showLabels
              planes={[{ id: 0, rotation: refRot, origin: { r: 0, c: 0 } }]}
              shape={config.shape}
              shots={REF_SHOTS}
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

        {/* 对手网格（居中）：只渲染我方报点标记，绝不显示对方阵型 */}
        <section className="game__opp">
          <PaperGrid
            width={config.width}
            height={config.height}
            cellSize={mainCell}
            showLabels
            onCellClick={onOppCellClick}
            shots={aiBoard.shotsFired}
            highlight={highlight}
            ariaLabel="对手棋盘"
          />
        </section>
      </main>

      <footer className="game__inputbar">
        <label className="visually-hidden" htmlFor="game-coord">
          报点坐标
        </label>
        <input
          id="game-coord"
          className={['paper-select__control game__input', shake ? 'shake' : ''].filter(Boolean).join(' ')}
          style={{ width: 130, textAlign: 'center', letterSpacing: '0.08em' }}
          value={input}
          disabled={!isMyTurn || screen !== 'battle'}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitInput()
          }}
          placeholder="如 A5"
          aria-label="报点坐标，如 A5"
          autoComplete="off"
        />
        <PaperButton variant="primary" onClick={commitInput} disabled={!isMyTurn || screen !== 'battle'}>
          确认报点
        </PaperButton>
        <span className="game__hint">点击棋盘选格，再点一次报点 · 或输入坐标回车</span>
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
          <div className="result__card paper-card">
            <h1 className={`result__title ${iWin ? 'result__title--win' : 'result__title--lose'}`}>
              {iWin ? '恭喜您，您赢了！' : '您输了，下次一定！'}
            </h1>
            <p className="result__sub">
              {iWin ? '您的机队笑到了最后，海面归于平静。' : '电脑技高一筹，重整旗鼓再战一局吧。'}
            </p>

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
              <PaperButton variant="ghost" onClick={() => setView('home')}>
                返回主页
              </PaperButton>
              <PaperButton
                variant="primary"
                onClick={() => {
                  resetGame()
                  setView('placement')
                }}
              >
                再来一局
              </PaperButton>
            </div>
          </div>
        </div>
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
