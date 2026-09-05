/**
 * OnlinePlacement —— 联机摆阵页（M6 / v0.3.0）。
 *
 * 复用 FleetPlacementBoard 的托盘/拖拽/校验；确认改为 placeFleet + ready；
 * 显示房间码（+复制）、对手状态（等待加入/摆阵中/已就绪/已断线）、
 * 房间配置只读预览（加入者可见棋盘与形状）与模式徽标（超快棋/盲棋，v0.3 透传）；
 * 摆阵阶段断线横幅。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { PlacedPlane } from '@aero/shared'
import { generateFleet, mulberry32 } from '@aero/game-core/ai'
import { useAppStore } from '../store/appStore'
import { useOnlineStore } from '../store/onlineStore'
import { useGuestStore } from '../store/guestStore'
import { useSettingsStore } from '../store/settingsStore'
import { useToastStore } from '../store/toastStore'
import { connectClient, v030Api } from '../online/client'
import type { GridConfigV030 } from '../online/protocol'
import { useEffectiveOrientation } from '../hooks/useOrientation'
import { PaperButton } from '../components/ui/PaperButton'
import { PaperModal } from '../components/ui/PaperModal'
import { PlaneGlyph } from '../components/grid/PlaneGlyph'
import { FleetPlacementBoard, fleetCheckState } from '../components/placement/FleetPlacementBoard'
import { cellsBBox } from '../lib/shape'

function useNow(intervalMs = 500): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(t)
  }, [intervalMs])
  return now
}

/** 模式徽标（超快棋/盲棋）样式；styles/ 不在本任务可编辑范围，故内联 */
function badgeStyle(extra: CSSProperties): CSSProperties {
  return {
    display: 'inline-block',
    padding: '0 8px',
    borderRadius: 999,
    border: '1.5px solid var(--danger, #a8362f)',
    color: 'var(--danger, #a8362f)',
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '0.05em',
    lineHeight: 1.7,
    ...extra,
  }
}

export function OnlinePlacement() {
  const setView = useAppStore((s) => s.setView)
  const toast = useToastStore((s) => s.push)
  const orientation = useEffectiveOrientation()
  const now = useNow()

  const room = useOnlineStore((s) => s.room)
  const config = useOnlineStore((s) => s.config)
  const you = useOnlineStore((s) => s.you)
  const phase = useOnlineStore((s) => s.phase)
  const myFleet = useOnlineStore((s) => s.myFleet)
  const oppDisconnect = useOnlineStore((s) => s.oppDisconnect)
  const socketStatus = useOnlineStore((s) => s.socketStatus)
  const sessionError = useOnlineStore((s) => s.sessionError)
  const setMyFleet = useOnlineStore((s) => s.setMyFleet)
  const guestName = useGuestStore((s) => s.name)

  const [grid, setGrid] = useState<PlacedPlane[]>(() => myFleet ?? [])
  const [localReady, setLocalReady] = useState(false)
  const [exitOpen, setExitOpen] = useState(false)
  const busyRef = useRef(false)

  // 本页会话必须由 v0.3 客户端连接承载（旧连接不 join 房间，不会收到房间事件）
  useEffect(() => {
    connectClient()
  }, [])

  // 会话错误（reconnect 失败 / 房间解散）→ 提示并回联机菜单
  useEffect(() => {
    if (sessionError) {
      toast(sessionError, 'error')
      useOnlineStore.getState().resetSession()
      useAppStore.getState().setView('online')
    }
  }, [sessionError, toast])

  // 房间关闭（players=[]）→ 回菜单
  useEffect(() => {
    if (room && room.players.length === 0) {
      toast('房间已解散', 'info')
      useOnlineStore.getState().resetSession()
      setView('online')
    }
  }, [room, setView, toast])

  // 对局开始 → 切到联机对局页
  useEffect(() => {
    if (phase === 'playing' || phase === 'counterattack' || phase === 'ended') {
      setView('onlineGame')
    }
  }, [phase, setView])

  // 房间配置只读预览（形状；hooks 必须在任何提前 return 之前）
  const shapePreview = useMemo(() => {
    if (!config) return null
    const b = cellsBBox(config.shape.cells)
    if (!b) return null
    // 紧凑预览（v0.2.5：缩小顶部模块，保证竖版 9:16 无滚动时下方网格完整显示；
    // v0.2.9：格宽 10 → 8，窄视口头部更紧凑，网格优先获得更多空间）
    const cell = 8
    return (
      <div
        style={{
          width: (b.c1 - b.c0 + 1) * cell,
          height: (b.r1 - b.r0 + 1) * cell,
          flex: 'none',
        }}
      >
        <PlaneGlyph shape={config.shape} rotation={0} />
      </div>
    )
  }, [config])

  if (!room || !config) {
    // v0.3：可能是 room:joined 刚跳转、roomUpdate 尚未到达，或刷新恢复中
    return (
      <div className="page" style={{ alignItems: 'center', gap: 16 }}>
        <p>正在进入房间…（若长时间无响应，可返回联机菜单重试）</p>
        <PaperButton variant="primary" onClick={() => setView('online')}>
          返回联机菜单
        </PaperButton>
      </div>
    )
  }

  // v0.3 模式透传：房间 config 的 blitz/blind（服务端回传；创建/加入后经 roomUpdate 到达）
  const modeCfg = config as GridConfigV030
  const modeBlitz = modeCfg.blitz === true
  const modeBlind = modeCfg.blind === true

  const players = room.players
  const meSeat = players[you]
  const oppSeat = players[(1 - you) as 0 | 1]
  // 空席位也含在 players 数组（name 为空串）；以 name 判定是否已有玩家
  const oppEmpty = !oppSeat || oppSeat.name.length === 0
  const myReady = localReady || meSeat?.ready === true
  const check = fleetCheckState(grid, config)
  const canConfirm = check.ok

  const oppStatusText = oppEmpty
    ? '等待对手加入…'
    : !oppSeat.connected
      ? '对手已断线，等待重连'
      : oppSeat.ready
        ? '对手已就绪'
        : '对手摆阵中…'

  const copyCode = async () => {
    const code = room.code
    try {
      await navigator.clipboard.writeText(code)
      toast(`房间码 ${code} 已复制`, 'success')
    } catch {
      toast(`房间码：${code}（请手动记录）`, 'info')
    }
  }

  const clearAll = () => setGrid([])

  const randomFleet = () => {
    const diff = useSettingsStore.getState().difficulty
    const rng = mulberry32(((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0) || 1)
    try {
      const fleet = generateFleet(config.width, config.height, config.planeCount, config.shape, diff, rng)
      setGrid(fleet)
      toast('已随机摆阵，可微调后确认', 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : '随机摆阵失败，请手动摆放', 'error')
    }
  }

  const confirmFleet = async () => {
    if (!canConfirm || busyRef.current) return
    busyRef.current = true
    try {
      const placed = await v030Api.placeFleet(grid)
      if (!placed.ok) {
        toast(placed.error ?? '摆阵提交失败', 'error')
        return
      }
      setMyFleet(grid)
      const r = await v030Api.ready()
      if (!r.ok) {
        toast(r.error ?? '就绪失败', 'error')
        return
      }
      setLocalReady(true)
      toast('已就绪，等待对手完成摆阵', 'success')
    } finally {
      busyRef.current = false
    }
  }

  const leave = () => {
    v030Api.leaveRoom()
    setView('online')
  }

  const disconnRemaining = oppDisconnect
    ? Math.max(0, oppDisconnect.graceMs - (now - oppDisconnect.since))
    : 0

  const checkItems = [
    { key: 'count', label: '数量', pass: check.countOk, detail: `${grid.length} / ${config.planeCount} 架` },
    { key: 'bounds', label: '越界', pass: check.boundsOk, detail: `${check.flags.outOfBoundsIds.size} 架` },
    { key: 'overlap', label: '重叠', pass: check.overlapOk, detail: `${check.flags.overlapIds.size} 架` },
  ]

  return (
    <div className={`placement placement--${orientation}`}>
      <header className="placement__head">
        <PaperButton size="sm" variant="ghost" onClick={() => setExitOpen(true)}>
          ← 退出
        </PaperButton>
        <div>
          <h1 className="page__title" style={{ fontSize: 22 }}>
            摆阵 · 联机对局
          </h1>
          <p className="page__subtitle" style={{ fontSize: 13 }}>
            {config.width}×{config.height} · {config.planeCount} 架飞机
            {modeBlitz || modeBlind ? (
              <span style={{ display: 'inline-flex', gap: 6, marginLeft: 8, verticalAlign: 'middle' }}>
                {modeBlitz ? (
                  <span style={badgeStyle({})}>超快棋</span>
                ) : null}
                {modeBlind ? (
                  <span style={badgeStyle({ borderColor: '#7a4a86', color: '#7a4a86' })}>盲棋</span>
                ) : null}
              </span>
            ) : null}
            <span className="placement__hint"> 点击飞机旋转 · 拖拽摆放 · 拖回托盘回收</span>
          </p>
        </div>
        <div className="online__roommeta">
          <span className="online__roomcode" title="房间码">
            {room.code}
          </span>
          <PaperButton size="sm" variant="ghost" onClick={copyCode}>
            复制房码
          </PaperButton>
          {shapePreview}
          <span className="online__roomsize">
            {config.width}×{config.height}
          </span>
        </div>
        <div className="placement__controls">
          <PaperButton size="sm" variant="ghost" onClick={clearAll} disabled={grid.length === 0}>
            清空重摆
          </PaperButton>
          <PaperButton size="sm" variant="ghost" onClick={randomFleet} disabled={grid.length === config.planeCount}>
            随机摆阵
          </PaperButton>
        </div>
      </header>

      {/* 双方状态条 */}
      <div className="online__statusrow" role="status" aria-live="polite">
        <span className="online__statusitem online__statusitem--me">
          我（{guestName}）：{myReady ? '已就绪 ✓' : '摆阵中…'}
        </span>
        <span
          className={[
            'online__statusitem',
            !oppEmpty && oppSeat && !oppSeat.connected ? 'online__statusitem--warn' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          对手：{oppStatusText}
        </span>
      </div>

      <FleetPlacementBoard
        config={config}
        planes={grid}
        onPlanesChange={setGrid}
        portraitChromeReserve={430}
      />

      {/* 底部：校验清单 + 确认 */}
      <footer className="placement__foot">
        <ul className="checklist placement__checklist">
          {checkItems.map((item) => (
            <li key={item.key} className="checklist__item">
              <span
                className={['checklist__mark', item.pass ? 'checklist__mark--ok' : 'checklist__mark--no'].join(' ')}
              >
                {item.pass ? '✓' : '✗'}
              </span>
              <span>{item.label}</span>
              <span className="checklist__detail">{item.detail}</span>
            </li>
          ))}
        </ul>
        <PaperButton
          variant="primary"
          disabled={!canConfirm || myReady}
          onClick={confirmFleet}
        >
          {myReady ? '已就绪，等待对手…' : canConfirm ? '确认布阵并就绪' : '校验未通过'}
        </PaperButton>
      </footer>

      {/* 断线横幅 */}
      {socketStatus !== 'connected' ? (
        <div className="online__banner online__banner--danger" role="alert">
          连接中断，正在重连…（请勿关闭页面；60 秒内将自动恢复对局）
        </div>
      ) : null}
      {oppDisconnect && disconnRemaining > 0 ? (
        <div className="online__banner" role="alert">
          对手已断线，正在等待重连…（{Math.ceil(disconnRemaining / 1000)} 秒后房间将解散）
        </div>
      ) : null}

      <PaperModal
        open={exitOpen}
        title="退出房间？"
        onClose={() => setExitOpen(false)}
        footer={
          <>
            <PaperButton variant="ghost" onClick={() => setExitOpen(false)}>
              继续摆阵
            </PaperButton>
            <PaperButton variant="danger" onClick={leave}>
              确认退出
            </PaperButton>
          </>
        }
      >
        退出后房间将解散（若您是房主），尚未开始的联机对局不会记录。
      </PaperModal>
    </div>
  )
}
