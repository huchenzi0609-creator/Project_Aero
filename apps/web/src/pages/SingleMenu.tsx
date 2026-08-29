import { PRESETS } from '@aero/shared'
import { useAppStore } from '../store/appStore'
import { PaperButton } from '../components/ui/PaperButton'

/** 迷你棋盘图标（按档位格数画点阵） */
function MiniGridIcon({ cols }: { cols: number }) {
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
  const setPlacementOrigin = useAppStore((s) => s.setPlacementOrigin)

  const goPreset = (key: 'small' | 'medium' | 'large') => {
    setGridConfig(PRESETS[key])
    setPlacementOrigin('single')
    setView('placement')
  }

  const goCustom = () => {
    setPlacementOrigin('custom')
    setView('custom')
  }

  return (
    <div className="page">
      <PaperButton size="sm" variant="ghost" className="page__back" onClick={() => setView('home')}>
        ← 返回主页
      </PaperButton>
      <header className="page__head">
        <div>
          <h1 className="page__title">单人对局</h1>
        </div>
      </header>
      <div className="page__body single__cards">
        {PRESET_CARDS.map((p) => (
          <PaperButton
            key={p.key}
            variant="default"
            className="single__card"
            onClick={() => goPreset(p.key)}
          >
            <MiniGridIcon cols={p.cols} />
            <span>
              <span className="single__card-label">{p.label}</span>
              <span className="single__card-sub">{p.sub}</span>
            </span>
          </PaperButton>
        ))}
        <PaperButton variant="primary" className="single__card" onClick={goCustom}>
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
