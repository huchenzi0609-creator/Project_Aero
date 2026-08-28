import { PRESETS } from '@aero/shared'
import { useAppStore } from '../store/appStore'
import { PaperButton } from '../components/ui/PaperButton'

/** 迷你棋盘图标（按档位格数画点阵） */
function MiniGridIcon({ cols, rows }: { cols: number; rows: number }) {
  const n = cols === 10 ? 4 : cols === 15 ? 5 : 6
  const step = 40 / (n - 1)
  const dots: Array<{ x: number; y: number }> = []
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      dots.push({ x: 8 + c * step, y: 8 + r * step })
    }
  }
  return (
    <svg width="52" height="52" viewBox="0 0 52 52" aria-hidden="true">
      <rect x="1.5" y="1.5" width="49" height="49" rx="3" fill="none" stroke="var(--pencil)" strokeWidth="1.3" />
      <rect x="6" y="6" width="40" height="40" rx="2" fill="none" stroke="var(--pencil-faint)" strokeWidth="1" />
      {dots.map((d, i) => (
        <circle key={i} cx={d.x} cy={d.y} r="1.6" fill="var(--ink-soft)" />
      ))}
      <text x="26" y="40" textAnchor="middle" fontFamily="var(--font-mono)" fontSize="11" fill="var(--ink-soft)">
        {cols}×{rows}
      </text>
    </svg>
  )
}

const PRESET_CARDS = [
  {
    key: 'small' as const,
    cols: 10,
    rows: 10,
    label: '小型 · 10×10',
    sub: '3 架飞机 · 新手友好',
  },
  {
    key: 'medium' as const,
    cols: 15,
    rows: 15,
    label: '中型 · 15×15',
    sub: '5 架飞机 · 标准体验',
  },
  {
    key: 'large' as const,
    cols: 20,
    rows: 20,
    label: '大型 · 20×20',
    sub: '7 架飞机 · 持久战',
  },
]

export function SingleMenu() {
  const setView = useAppStore((s) => s.setView)
  const setGridConfig = useAppStore((s) => s.setGridConfig)

  return (
    <div className="page">
      <PaperButton size="sm" variant="ghost" className="page__back" onClick={() => setView('home')}>
        ← 返回主页
      </PaperButton>
      <header className="page__head">
        <div>
          <h1 className="page__title">单人对局</h1>
          <p className="page__subtitle">选择棋盘大小，与电脑 AI 开战（对局由 M4 实现）。</p>
        </div>
      </header>
      <div className="page__body single__cards">
        {PRESET_CARDS.map((p) => (
          <PaperButton
            key={p.key}
            variant="default"
            className="single__card"
            onClick={() => {
              setGridConfig(PRESETS[p.key])
              setView('game')
            }}
          >
            <MiniGridIcon cols={p.cols} rows={p.rows} />
            <span>
              <span className="single__card-label">{p.label}</span>
              <span className="single__card-sub">{p.sub}</span>
            </span>
          </PaperButton>
        ))}
        <PaperButton variant="primary" className="single__card" onClick={() => setView('custom')}>
          <svg width="52" height="52" viewBox="0 0 52 52" aria-hidden="true">
            <rect x="1.5" y="1.5" width="49" height="49" rx="3" fill="none" stroke="var(--pencil)" strokeWidth="1.3" />
            <path d="M26 12 V 40 M12 26 H 40" stroke="var(--kill-red)" strokeWidth="2.2" strokeLinecap="round" />
            <circle cx="26" cy="26" r="13" fill="none" stroke="var(--pencil-faint)" strokeWidth="1" />
          </svg>
          <span>
            <span className="single__card-label">自定义</span>
            <span className="single__card-sub">自定义棋盘与飞机形状</span>
          </span>
        </PaperButton>
      </div>
    </div>
  )
}
