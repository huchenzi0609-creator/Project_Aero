import { useState } from 'react'
import { useAppStore } from '../store/appStore'
import { useToastStore } from '../store/toastStore'
import { PaperButton } from '../components/ui/PaperButton'
import { PaperCard } from '../components/ui/PaperCard'

type MatchTier = 'small' | 'medium' | 'large'

const TIERS: ReadonlyArray<{ key: MatchTier; label: string; sub: string }> = [
  { key: 'small', label: '小型', sub: '10×10 · 3 架' },
  { key: 'medium', label: '中型', sub: '15×15 · 5 架' },
  { key: 'large', label: '大型', sub: '20×20 · 7 架' },
]

const TIER_LABEL: Record<MatchTier, string> = {
  small: '小型 10×10',
  medium: '中型 15×15',
  large: '大型 20×20',
}

export function OnlineMenu() {
  const setView = useAppStore((s) => s.setView)
  const toast = useToastStore((s) => s.push)
  const [code, setCode] = useState('')
  const [matching, setMatching] = useState<MatchTier | null>(null)

  const stub = (msg: string) => toast(`${msg}（联机 UI 骨架，M6 接入后端）`, 'info')

  return (
    <div className="page online">
      <PaperButton size="sm" variant="ghost" className="page__back" onClick={() => setView('home')}>
        ← 返回主页
      </PaperButton>
      <header className="page__head">
        <div>
          <h1 className="page__title">联机对战</h1>
          <p className="page__subtitle">三种玩法入口已就位，联机后端将于 M6 接入。</p>
        </div>
      </header>

      <div className="page__body online__grid">
        {/* 局域网对局 */}
        <PaperCard tape>
          <h2 className="online__card-title">局域网对局</h2>
          <p className="online__card-desc">同一局域网内，输入房主分享的 6 位房码即可加入。</p>
          <div className="online__form">
            <PaperButton variant="primary" onClick={() => stub('创建房间')}>
              创建房间
            </PaperButton>
            <span style={{ color: 'var(--ink-faint)', fontSize: 14 }}>或</span>
            <input
              className="online__codeinput"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 6))}
              placeholder="房码"
              aria-label="房码输入"
              maxLength={6}
              inputMode="text"
            />
            <PaperButton onClick={() => stub(`加入房间 ${code || '（未输入房码）'}`)}>加入房间</PaperButton>
          </div>
        </PaperCard>

        {/* 公网匹配 */}
        <PaperCard pin>
          <h2 className="online__card-title">公网匹配</h2>
          <p className="online__card-desc">按标准三档同配置配对，找到对手即刻开局。</p>
          <div className="online__tiers">
            {TIERS.map((t) => (
              <PaperButton
                key={t.key}
                size="sm"
                variant={matching === t.key ? 'primary' : 'default'}
                aria-pressed={matching === t.key}
                onClick={() => setMatching((m) => (m === t.key ? null : t.key))}
              >
                {t.label} · {t.sub}
              </PaperButton>
            ))}
          </div>
          {matching ? (
            <div className="online__matching" role="status">
              <span className="online__spinner" aria-hidden="true" />
              <span>
                正在匹配：{TIER_LABEL[matching]}…
              </span>
              <PaperButton size="sm" variant="ghost" onClick={() => setMatching(null)}>
                取消
              </PaperButton>
            </div>
          ) : null}
        </PaperCard>

        {/* 自定义房间 */}
        <PaperCard className="online__span2">
          <h2 className="online__card-title">自定义房间</h2>
          <p className="online__card-desc">
            房主配置棋盘与飞机形状（双方使用同一形状）与回合时限；自定义配置不进公网匹配池。
          </p>
          <PaperButton disabled onClick={() => stub('自定义房间')}>
            自定义房间（M6 开放）
          </PaperButton>
        </PaperCard>
      </div>
    </div>
  )
}
