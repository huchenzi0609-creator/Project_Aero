import { useEffect, useMemo, useState } from 'react'
import { DEFAULT_PLANE_SHAPE } from '@aero/shared'
import type { Cell, PlacedPlane, Shot, ShotOutcome } from '@aero/shared'
import { useAppStore } from '../store/appStore'
import { useSettingsStore } from '../store/settingsStore'
import { useToastStore } from '../store/toastStore'
import { useEffectiveOrientation, useViewport } from '../hooks/useOrientation'
import { PaperButton } from '../components/ui/PaperButton'
import { PaperCard } from '../components/ui/PaperCard'
import { PaperModal } from '../components/ui/PaperModal'
import { PaperGrid } from '../components/grid/PaperGrid'
import { formatCoord, parseCoord } from '../lib/coord'
import { placeFleetStub } from '../lib/shape'

const REF_SHOTS: Shot[] = [
  { coord: { r: 0, c: 0 }, outcome: 'miss' },
  { coord: { r: 1, c: 4 }, outcome: 'hit' },
  { coord: { r: 0, c: 2 }, outcome: 'kill' },
]

const REF_PLANES: PlacedPlane[] = [{ id: 0, rotation: 0, origin: { r: 0, c: 0 } }]

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

function randomOutcome(): ShotOutcome {
  const roll = Math.random()
  if (roll < 0.55) return 'miss'
  if (roll < 0.85) return 'hit'
  return 'kill'
}

/**
 * 对局占位页（M4 接真实规则）：
 * 顶部状态条（占位切换）、居中空棋盘（高亮 + 坐标联动）、
 * 底部坐标输入 + 回车确认；样式参考图（5×5）与我方小网格（1/2 尺寸）按横竖版摆放。
 * 点击仅本地演示：点格高亮、再点输入坐标、确认后盖随机标记桩。
 */
export function GameScreenPlaceholder({ mode = 'single' }: { mode?: 'single' | 'online' }) {
  const config = useAppStore((s) => s.gridConfig)
  const setView = useAppStore((s) => s.setView)
  const toast = useToastStore((s) => s.push)
  const orientation = useEffectiveOrientation()
  const viewport = useViewport()
  const invertMarks = useSettingsStore((s) => s.invertMarks)

  const [status, setStatus] = useState<'us' | 'them'>('us')
  const [shots, setShots] = useState<Shot[]>([])
  const [highlight, setHighlight] = useState<Cell | null>(null)
  const [input, setInput] = useState('')
  const [seconds, setSeconds] = useState(20)
  const [exitOpen, setExitOpen] = useState(false)

  // 占位：状态条自动切换（点击状态文字也可切换）
  useEffect(() => {
    const t = window.setInterval(() => setStatus((s) => (s === 'us' ? 'them' : 'us')), 6000)
    return () => window.clearInterval(t)
  }, [])

  // 占位倒计时：仅联机模式显示
  useEffect(() => {
    if (mode !== 'online') return
    const t = window.setInterval(() => setSeconds((s) => (s <= 1 ? 20 : s - 1)), 1000)
    return () => window.clearInterval(t)
  }, [mode])

  // 主棋盘格宽：按视口与方向自适应
  const mainCell = useMemo(() => {
    if (orientation === 'landscape') {
      const availW = viewport.width * 0.4
      const availH = viewport.height - 170
      return clamp(Math.floor(Math.min(availW / config.width, availH / config.height)), 12, 34)
    }
    const availW = viewport.width - 30
    return clamp(Math.floor((availW - 20) / config.width), 10, 30)
  }, [orientation, viewport, config])

  const miniCell = clamp(
    Math.min(Math.floor(mainCell / 2), Math.floor((viewport.width / 2 - 44) / config.width)),
    6,
    20,
  )
  const refCell = Math.min(24, Math.max(13, Math.floor(mainCell * 0.8)))

  // 我方阵型（演示桩：确定性随机摆阵）
  const myPlanes = useMemo(
    () => placeFleetStub(config.width, config.height, config.planeCount, config.shape) ?? [],
    [config],
  )
  const wreckedIds = useMemo(() => myPlanes.slice(0, Math.min(2, myPlanes.length)).map((p) => p.id), [myPlanes])

  const onCell = (cell: Cell) => {
    if (shots.some((s) => s.coord.r === cell.r && s.coord.c === cell.c)) return
    setHighlight(cell)
    setInput(formatCoord(cell))
  }

  const commit = () => {
    const parsed = parseCoord(input)
    if (!parsed) {
      toast('坐标格式应为“字母+数字”，如 A5', 'error')
      return
    }
    const { cell } = parsed
    if (cell.c >= config.width || cell.r >= config.height) {
      toast('坐标超出棋盘范围', 'error')
      return
    }
    if (shots.some((s) => s.coord.r === cell.r && s.coord.c === cell.c)) {
      toast('该格已经报过点了', 'error')
      return
    }
    setShots((prev) => [...prev, { coord: cell, outcome: randomOutcome() }])
    setHighlight(null)
    setInput('')
  }

  const statusText = status === 'us' ? '轮到我方报点' : '等待对方报点…'

  return (
    <div className={`game game--${orientation}`}>
      <header className="game__statusbar">
        <PaperButton size="sm" variant="ghost" onClick={() => setExitOpen(true)}>
          ← 退出
        </PaperButton>
        <button
          type="button"
          className="game__statusbtn"
          onClick={() => setStatus((s) => (s === 'us' ? 'them' : 'us'))}
          aria-label="切换状态演示"
        >
          <span className={`game__dot${status === 'them' ? ' game__dot--them' : ''}`} aria-hidden="true" />
          <span className="game__status-text" aria-live="polite">
            {statusText}
          </span>
        </button>
        {mode === 'online' ? (
          <span className="game__timer" role="timer">
            00:{String(seconds).padStart(2, '0')}
          </span>
        ) : (
          <span style={{ width: 1 }} aria-hidden="true" />
        )}
      </header>

      <main className="game__main">
        {/* 样式参考图：5×5 + 默认飞机 + 三种标记 */}
        <section className="game__ref">
          <PaperCard className="game__card">
            <h2 className="game__card-title">样式参考</h2>
            <PaperGrid
              width={5}
              height={5}
              cellSize={refCell}
              showLabels
              planes={REF_PLANES}
              shape={DEFAULT_PLANE_SHAPE}
              shots={REF_SHOTS}
              invertMarks={invertMarks}
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
              planes={myPlanes}
              shape={config.shape}
              destroyedPlaneIds={wreckedIds}
              ariaLabel="我方小网格"
            />
          </PaperCard>
        </section>

        {/* 居中空棋盘（对手视野） */}
        <section className="game__opp">
          <PaperGrid
            width={config.width}
            height={config.height}
            cellSize={mainCell}
            showLabels
            onCellClick={onCell}
            shots={shots}
            highlight={highlight}
            invertMarks={invertMarks}
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
          className="paper-select__control game__input"
          style={{ width: 130, textAlign: 'center', letterSpacing: '0.08em' }}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
          }}
          placeholder="如 A5"
          aria-label="报点坐标，如 A5"
          autoComplete="off"
        />
        <PaperButton variant="primary" onClick={commit}>
          确认报点
        </PaperButton>
        <span className="game__hint">点击棋盘或输入坐标，回车确认 · 本地演示</span>
      </footer>

      <PaperModal
        open={exitOpen}
        title="确认退出对局？"
        onClose={() => setExitOpen(false)}
        footer={
          <>
            <PaperButton variant="ghost" onClick={() => setExitOpen(false)}>
              继续对局
            </PaperButton>
            <PaperButton variant="danger" onClick={() => setView('single')}>
              确认退出
            </PaperButton>
          </>
        }
      >
        返回后本局进度将丢失（正式二次确认流程由 M4 实现）。
      </PaperModal>
    </div>
  )
}
