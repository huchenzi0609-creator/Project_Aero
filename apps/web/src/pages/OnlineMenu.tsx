/**
 * OnlineMenu —— 联机菜单三入口（M6）。
 *
 * 1) 局域网对局：选档位（三档 / 自定义）→ 建房（房码在摆阵页展示 + 复制）；输入房码加入（大小写容错）；
 * 2) 公网匹配：三档选择 → createRoom({config, match:true}) → 匹配中动画；
 *    30s 超时（服务端 matchmakingStatus 'timeout'）提示自建房间；取消走断开重连移出队列；
 * 3) 自定义房间：房主配置棋盘+形状（CustomConfig online 模式）→ 建房。
 */
import { useEffect, useState } from 'react'
import { PRESETS } from '@aero/shared'
import type { GridConfig } from '@aero/shared'
import { useAppStore } from '../store/appStore'
import { useOnlineStore } from '../store/onlineStore'
import { useGuestStore } from '../store/guestStore'
import { useToastStore } from '../store/toastStore'
import { useEffectiveOrientation } from '../hooks/useOrientation'
import { cancelMatchmaking, onlineApi } from '../net/socket'
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
  const guestName = useGuestStore((s) => s.name)
  const socketStatus = useOnlineStore((s) => s.socketStatus)
  const matchmaking = useOnlineStore((s) => s.matchmaking)
  const orientation = useEffectiveOrientation()
  const isPortrait = orientation === 'portrait'

  const [code, setCode] = useState('')
  const [lanTier, setLanTier] = useState<MatchTier>('small')
  const [matchTier, setMatchTier] = useState<MatchTier>('small')
  const [matching, setMatching] = useState(false)
  const [busy, setBusy] = useState(false)

  const connected = socketStatus === 'connected'

  // 公网匹配状态：matched → 进摆阵；timeout → 提示自建房间
  useEffect(() => {
    const m = matchmaking
    if (!m || Date.now() - m.at > 8000) return
    if (m.status === 'matched') {
      setMatching(false)
      setView('onlinePlacement')
    } else if (m.status === 'timeout') {
      setMatching(false)
      toast('30 秒未匹配到对手，可自建房间邀请好友对战', 'info')
    }
  }, [matchmaking, setView, toast])

  const createRoom = async (config: GridConfig) => {
    if (busy) return
    setBusy(true)
    try {
      const res = await onlineApi.createRoom(config, false)
      if (!res.ok) {
        toast(res.error ?? '创建房间失败', 'error')
        return
      }
      toast(`房间已创建：${res.data}`, 'success')
      setView('onlinePlacement')
    } finally {
      setBusy(false)
    }
  }

  const joinRoom = async () => {
    const raw = code.trim().toUpperCase()
    if (raw.length < 6) {
      toast('请输入 6 位房码', 'error')
      return
    }
    if (busy) return
    setBusy(true)
    try {
      const res = await onlineApi.joinRoom(raw)
      if (!res.ok) {
        toast(res.error ?? '加入房间失败', 'error')
        return
      }
      setView('onlinePlacement')
    } finally {
      setBusy(false)
    }
  }

  const startMatch = () => {
    if (busy) return
    setBusy(true)
    void onlineApi.createRoom(PRESETS[matchTier], true).then((res) => {
      setBusy(false)
      if (!res.ok) {
        toast(res.error ?? '匹配失败', 'error')
        return
      }
      setMatching(true)
      toast(`已进入匹配队列：${TIER_LABEL[matchTier]}`, 'info')
    })
  }

  const cancelMatch = () => {
    setMatching(false)
    cancelMatchmaking()
    toast('已退出匹配', 'info')
  }

  const backHome = () => {
    if (matching) cancelMatch()
    setView('home')
  }

  const connText =
    socketStatus === 'connected'
      ? '已连接服务器'
      : socketStatus === 'connecting'
        ? '正在连接服务器…'
        : '未连接（将自动重连）'

  return (
    <div className="page online">
      <PaperButton size="sm" variant="ghost" className="page__back" onClick={backHome}>
        ← 返回主页
      </PaperButton>
      <header className="page__head">
        <div>
          <h1 className="page__title">联机对战</h1>
          <p className="page__subtitle">
            {guestName} · {connText}
          </p>
        </div>
      </header>

      <div className="page__body online__grid">
        {/* 局域网对局 */}
        <PaperCard tape>
          <h2 className="online__card-title">局域网对局</h2>

          <div className="online__tiers" role="group" aria-label="创建房间档位">
            {TIERS.map((t) => (
              <PaperButton
                key={t.key}
                size="sm"
                variant={lanTier === t.key ? 'primary' : 'default'}
                aria-pressed={lanTier === t.key}
                onClick={() => setLanTier(t.key)}
              >
                {t.label}
                {isPortrait ? '' : ` · ${t.sub}`}
              </PaperButton>
            ))}
            <PaperButton
              size="sm"
              variant="ghost"
              onClick={() => setView('onlineCustom')}
              title="自定义棋盘与飞机形状（双方同一形状）"
            >
              自定义…
            </PaperButton>
          </div>

          <div className="online__form">
            <PaperButton variant="primary" disabled={busy || !connected} onClick={() => void createRoom(PRESETS[lanTier])}>
              创建房间
            </PaperButton>
            <span style={{ color: 'var(--ink-faint)', fontSize: 14 }}>或</span>
            <input
              className="online__codeinput"
              value={code}
              onChange={(e) =>
                setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))
              }
              placeholder="房码"
              aria-label="房码输入"
              maxLength={6}
              inputMode="text"
              onKeyDown={(e) => {
                if (e.key === 'Enter') void joinRoom()
              }}
            />
            <PaperButton disabled={busy || !connected || code.length < 6} onClick={() => void joinRoom()}>
              加入房间
            </PaperButton>
          </div>
        </PaperCard>

        {/* 公网匹配 */}
        <PaperCard pin>
          <h2 className="online__card-title">公网匹配</h2>
          <div className="online__tiers" role="group" aria-label="匹配档位">
            {TIERS.map((t) => (
              <PaperButton
                key={t.key}
                size="sm"
                variant={matchTier === t.key ? 'primary' : 'default'}
                aria-pressed={matchTier === t.key}
                disabled={matching}
                onClick={() => setMatchTier(t.key)}
              >
                {t.label}
                {isPortrait ? '' : ` · ${t.sub}`}
              </PaperButton>
            ))}
          </div>
          {matching ? (
            <div className="online__matching" role="status">
              <span className="online__spinner" aria-hidden="true" />
              <span>正在匹配：{TIER_LABEL[matchTier]}…（30 秒内未匹配可自建房间）</span>
              <PaperButton size="sm" variant="ghost" onClick={cancelMatch}>
                取消
              </PaperButton>
            </div>
          ) : (
            <div className="online__form" style={{ marginTop: 10 }}>
              <PaperButton variant="primary" disabled={busy || !connected} onClick={startMatch}>
                开始匹配
              </PaperButton>
            </div>
          )}
        </PaperCard>

        {/* 自定义房间 */}
        <PaperCard className="online__span2">
          <h2 className="online__card-title">自定义房间</h2>
          <PaperButton variant="primary" onClick={() => setView('onlineCustom')}>
            配置并创建自定义房间
          </PaperButton>
        </PaperCard>
      </div>
    </div>
  )
}
