/**
 * OnlineMenu —— 对战模式菜单（M6 / v0.3.0 重构）。
 *
 * 结构（docs/qa-checklist-v030.md §B）：
 * 1) 三个板块「经典模式」「超快棋模式」「盲棋模式」，每块含小/中/大三档勾选项，
 *    板块间与档位间相互独立可多选；默认仅经典模式三档勾选。
 * 2) 「开始匹配」：按所有勾选项收集 combos（经典=blitz/blind 均 false，
 *    超快棋=blitz true，盲棋=blind true）发送 match:quick { combos }；
 *    match:waiting → 显示等待态（可取消 match:cancel）；
 *    room:joined { roomCode, config } → 直接进入房间流程（onlinePlacement）。
 * 3) 「自定义房间」板块：档位 + 超快棋/盲棋两开关创建房间（沿用 createRoom），
 *    或输入房码加入已有对局。
 *
 * 房间流程全部走 online/v030 客户端连接（v0.3 事件不在 v0.2 net/socket 的 typed 接口内）。
 */
import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { PRESETS } from '@aero/shared'
import type { GridConfig } from '@aero/shared'
import { useAppStore } from '../store/appStore'
import { useGuestStore } from '../store/guestStore'
import { useToastStore } from '../store/toastStore'
import { useEffectiveOrientation } from '../hooks/useOrientation'
import { connectClient, onV030, subscribeStatus, v030Api } from '../online/client'
import type { ClientStatus } from '../online/client'
import type { MatchCombo, MatchGridSize } from '../online/protocol'
import { PaperButton } from '../components/ui/PaperButton'
import { PaperCard } from '../components/ui/PaperCard'

type Mode = 'classic' | 'blitz' | 'blind'
type Tier = 'small' | 'medium' | 'large'

const MODES: ReadonlyArray<{ key: Mode; title: string; desc: string; blitz: boolean; blind: boolean }> = [
  { key: 'classic', title: '经典模式', desc: '常规对局：先摆阵，再随机先后手轮流报点。', blitz: false, blind: false },
  { key: 'blitz', title: '超快棋模式', desc: '双方合计限时 10 秒/架，报点回血，超时判负。', blitz: true, blind: false },
  { key: 'blind', title: '盲棋模式', desc: '不记旧报点，双方禁参考飞机与着色。', blitz: false, blind: true },
]

const TIERS: ReadonlyArray<{ key: Tier; label: string; sub: string; gridSize: MatchGridSize; planes: number }> = [
  { key: 'small', label: '小型', sub: '10×10 · 3 架', gridSize: 10, planes: 3 },
  { key: 'medium', label: '中型', sub: '15×15 · 5 架', gridSize: 15, planes: 5 },
  { key: 'large', label: '大型', sub: '20×20 · 7 架', gridSize: 20, planes: 7 },
]

const DEFAULT_CHECKS: Record<Mode, Record<Tier, boolean>> = {
  classic: { small: true, medium: true, large: true },
  blitz: { small: false, medium: false, large: false },
  blind: { small: false, medium: false, large: false },
}

const switchStyle: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }
const checkboxStyle: CSSProperties = { accentColor: 'var(--kill-red, #a8362f)', width: 16, height: 16, cursor: 'pointer' }

export function OnlineMenu() {
  const setView = useAppStore((s) => s.setView)
  const toast = useToastStore((s) => s.push)
  const guestName = useGuestStore((s) => s.name)
  const orientation = useEffectiveOrientation()
  const isPortrait = orientation === 'portrait'

  const [checks, setChecks] = useState<Record<Mode, Record<Tier, boolean>>>(DEFAULT_CHECKS)
  const [waiting, setWaiting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [conn, setConn] = useState<ClientStatus>('idle')

  // 本页承载联机会话 → 连接 v0.3 客户端
  useEffect(() => connectClient(), [])

  // 连接状态订阅（断线/重连后 UI 更新）
  useEffect(() => subscribeStatus(setConn), [])

  const connected = conn === 'connected'

  // room:joined（快速匹配配对成功）→ 复位匹配态并进入房间流程
  useEffect(
    () =>
      onV030('room:joined', () => {
        setWaiting(false)
        setBusy(false)
        setView('onlinePlacement')
      }),
    [setView],
  )
  // match:waiting → 进入等待态（可取消）
  useEffect(
    () =>
      onV030('match:waiting', () => {
        setWaiting(true)
        setBusy(false)
      }),
    [],
  )

  const toggle = (mode: Mode, tier: Tier) =>
    setChecks((prev) => ({
      ...prev,
      [mode]: { ...prev[mode], [tier]: !prev[mode][tier] },
    }))

  /** 收集勾选项为匹配组合 */
  const combos = useMemo<MatchCombo[]>(() => {
    const out: MatchCombo[] = []
    for (const mode of MODES) {
      for (const tier of TIERS) {
        if (!checks[mode.key][tier.key]) continue
        out.push({
          gridSize: tier.gridSize,
          planes: tier.planes,
          blitz: mode.blitz,
          blind: mode.blind,
        })
      }
    }
    return out
  }, [checks])

  const startMatch = async () => {
    if (busy || combos.length === 0) return
    setBusy(true)
    const res = await v030Api.matchQuick(combos)
    if (!res.ok) {
      setBusy(false)
      toast(res.error ?? '发起匹配失败', 'error')
      return
    }
    // ack 成功即视为已入等待池（waiting 事件会同步 UI）；若事件先行丢失，本页兜底
    setWaiting(true)
  }

  const cancelMatch = () => {
    setWaiting(false)
    setBusy(false)
    v030Api.cancelMatch()
    toast('已退出匹配', 'info')
  }

  /* ---------- 自定义房间 ---------- */
  const [customTier, setCustomTier] = useState<Tier>('small')
  const [customBlitz, setCustomBlitz] = useState(false)
  const [customBlind, setCustomBlind] = useState(false)
  const [code, setCode] = useState('')

  const createCustomRoom = async () => {
    if (busy) return
    setBusy(true)
    try {
      const config: GridConfig = {
        ...PRESETS[customTier],
        blitz: customBlitz,
        blind: customBlind,
      }
      const res = await v030Api.createRoom(config)
      if (!res.ok) {
        toast(res.error ?? '创建房间失败', 'error')
        return
      }
      toast(
        `房间已创建：${res.data}${customBlitz ? '（超快棋）' : ''}${customBlind ? '（盲棋）' : ''}`,
        'success',
      )
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
      const res = await v030Api.joinRoom(raw)
      if (!res.ok) {
        toast(res.error ?? '加入房间失败', 'error')
        return
      }
      setView('onlinePlacement')
    } finally {
      setBusy(false)
    }
  }

  const backHome = () => {
    if (waiting) cancelMatch()
    setView('home')
  }

  const connText =
    conn === 'connected' ? '已连接服务器' : conn === 'connecting' ? '正在连接服务器…' : '未连接（将自动重连）'
  const summary = combos.length > 0 ? `已勾选 ${combos.length} 组组合` : '请至少勾选一组（档位 × 模式）'

  return (
    <div className="page online">
      <PaperButton size="sm" variant="ghost" className="page__back" onClick={backHome}>
        ← 返回主页
      </PaperButton>
      <header className="page__head">
        <div>
          <h1 className="page__title">对战模式</h1>
          <p className="page__subtitle">
            {guestName} · {connText}
          </p>
        </div>
      </header>

      <div className="page__body online__grid">
        {/* 匹配：三板块 × 三档勾选 */}
        {MODES.map((mode) => (
          <PaperCard key={mode.key} tape={mode.key === 'classic'}>
            <h2 className="online__card-title">{mode.title}</h2>
            <p className="online__card-desc">{mode.desc}</p>
            <div
              className="online__tiers"
              role="group"
              aria-label={`${mode.title}档位勾选`}
              style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}
            >
              {TIERS.map((tier) => (
                <label key={tier.key} style={switchStyle}>
                  <input
                    type="checkbox"
                    checked={checks[mode.key][tier.key]}
                    onChange={() => toggle(mode.key, tier.key)}
                    disabled={waiting}
                    style={checkboxStyle}
                  />
                  <span>
                    {tier.label}
                    {isPortrait ? '' : ` · ${tier.sub}`}
                  </span>
                </label>
              ))}
            </div>
          </PaperCard>
        ))}

        {/* 匹配发起 / 等待态 */}
        <PaperCard className="online__span2">
          {waiting ? (
            <div className="online__matching" role="status">
              <span className="online__spinner" aria-hidden="true" />
              <span>
                正在匹配对手…（30 秒内未匹配上，可自建房间邀请好友）
                <br />
                <span style={{ fontSize: 13, color: 'var(--ink-faint)' }}>{summary}</span>
              </span>
              <PaperButton size="sm" variant="ghost" onClick={cancelMatch}>
                取消匹配
              </PaperButton>
            </div>
          ) : (
            <div className="online__form" style={{ justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--ink-soft)', fontSize: 14 }}>{summary}</span>
              <PaperButton
                variant="primary"
                size="lg"
                disabled={busy || !connected || combos.length === 0}
                onClick={() => void startMatch()}
              >
                开始匹配
              </PaperButton>
            </div>
          )}
        </PaperCard>

        {/* 自定义房间：档位 + 超快棋/盲棋开关 → 创建；或房码加入 */}
        <PaperCard className="online__span2" pin>
          <h2 className="online__card-title">自定义房间</h2>
          <p className="online__card-desc">
            选择棋盘尺寸与模式开关创建房间；或输入房主分享的 6 位房码加入已有对局。
          </p>

          <div className="online__tiers" role="group" aria-label="创建房间档位">
            {TIERS.map((tier) => (
              <PaperButton
                key={tier.key}
                size="sm"
                variant={customTier === tier.key ? 'primary' : 'default'}
                aria-pressed={customTier === tier.key}
                disabled={busy}
                onClick={() => setCustomTier(tier.key)}
              >
                {tier.label}
                {isPortrait ? '' : ` · ${tier.sub}`}
              </PaperButton>
            ))}
          </div>

          <div className="online__form" style={{ margin: '10px 0' }}>
            <label style={switchStyle}>
              <input
                type="checkbox"
                checked={customBlitz}
                onChange={(e) => setCustomBlitz(e.target.checked)}
                disabled={busy}
                style={checkboxStyle}
              />
              超快棋（10 秒/架限时，报点回血，超时判负）
            </label>
            <label style={switchStyle}>
              <input
                type="checkbox"
                checked={customBlind}
                onChange={(e) => setCustomBlind(e.target.checked)}
                disabled={busy}
                style={checkboxStyle}
              />
              盲棋（不记旧报点，双方禁参考飞机与着色）
            </label>
          </div>

          <div className="online__form">
            <PaperButton
              variant="primary"
              disabled={busy || !connected}
              onClick={() => void createCustomRoom()}
            >
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
            <PaperButton
              disabled={busy || !connected || code.length < 6}
              onClick={() => void joinRoom()}
            >
              加入已有对局
            </PaperButton>
          </div>
        </PaperCard>
      </div>
    </div>
  )
}
