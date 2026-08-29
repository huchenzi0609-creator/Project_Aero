import { useAppStore } from '../store/appStore'
import { useGuestStore } from '../store/guestStore'
import { useEffectiveOrientation } from '../hooks/useOrientation'
import { PaperButton } from '../components/ui/PaperButton'
import { OrientationToggle } from '../components/OrientationToggle'

/** 折纸飞机小涂鸦 + 虚线航迹（签名元素） */
function PaperPlaneDoodle() {
  return (
    <svg className="home__doodle" width="76" height="46" viewBox="0 0 76 46" aria-hidden="true">
      <path
        d="M4 26 Q 20 19 31 24"
        fill="none"
        stroke="var(--pencil-faint)"
        strokeWidth="1.4"
        strokeDasharray="3 4"
        strokeLinecap="round"
      />
      <path d="M34 24 L 63 10 L 53 24 L 63 38 Z" fill="#fbf7ea" stroke="var(--ink)" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M34 24 L 53 24 L 63 10 Z" fill="#ece2c4" stroke="var(--ink)" strokeWidth="1" strokeLinejoin="round" />
      <path d="M34 24 L 53 24 L 63 38 Z" fill="#e2d6b2" stroke="var(--ink)" strokeWidth="1" strokeLinejoin="round" />
      <path d="M44 24 L 46 14" fill="none" stroke="var(--pencil-faint)" strokeWidth="1" />
    </svg>
  )
}

/** 铅笔波浪下划线 */
function PencilUnderline() {
  return (
    <svg className="home__underline" width="230" height="10" viewBox="0 0 230 10" aria-hidden="true">
      <path
        d="M2 6 Q 30 1 60 5 T 122 5 T 184 5 T 228 4"
        fill="none"
        stroke="var(--pencil)"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function Home() {
  const orientation = useEffectiveOrientation()
  const setView = useAppStore((s) => s.setView)
  const guestName = useGuestStore((s) => s.name)

  return (
    <div className={`page home home--${orientation}`}>
      <header className="home__top">
        <OrientationToggle />
        <div className="home__guest">
          <span className="home__guest-label">你好，</span>
          <span className="home__guest-name">{guestName}</span>
        </div>
      </header>

      <main className="home__main">
        <section className="home__title-block">
          <PaperPlaneDoodle />
          <h1 className="home__title">方格空袭</h1>
          <PencilUnderline />
        </section>
        <nav className="home__menu" aria-label="主菜单">
          <PaperButton size="lg" onClick={() => setView('single')}>
            单人对局
          </PaperButton>
          <PaperButton size="lg" onClick={() => setView('online')}>
            联机对战
          </PaperButton>
          <PaperButton size="lg" onClick={() => setView('settings')}>
            设置
          </PaperButton>
        </nav>
      </main>

      <footer className="home__foot">
        <button type="button" className="link-btn" onClick={() => setView('rules')}>
          规则说明
        </button>
        <span className="home__version">v0.2.2 · 方格空袭</span>
      </footer>
    </div>
  )
}
