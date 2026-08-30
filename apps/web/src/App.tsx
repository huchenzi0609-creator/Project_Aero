import { useEffect, useRef, useState } from 'react'
import { useAppStore } from './store/appStore'
import { useOnlineStore } from './store/onlineStore'
import { useEffectiveOrientation } from './hooks/useOrientation'
import { StampFilterDefs } from './components/grid/StampFilterDefs'
import { ToastRegion } from './components/ui/Toast'
import { connectSocket, onlineApi } from './net/socket'
import { audioService } from './lib/audioService'
import { Home } from './pages/Home'
import { SingleMenu } from './pages/SingleMenu'
import { CustomConfig } from './pages/CustomConfig'
import { Settings } from './pages/Settings'
import { Rules } from './pages/Rules'
import { OnlineMenu } from './pages/OnlineMenu'
import { OnlinePlacement } from './pages/OnlinePlacement'
import { OnlineGame } from './pages/OnlineGame'
import { Placement } from './pages/Placement'
import { GameScreen } from './pages/GameScreen'
import './styles/fab.css'

export default function App() {
  const view = useAppStore((s) => s.view)
  const room = useOnlineStore((s) => s.room)
  const phase = useOnlineStore((s) => s.phase)
  const orientation = useEffectiveOrientation()

  // 挂载即建立 Socket 连接（幂等；断线由 socket.io 自动重连）
  useEffect(() => {
    connectSocket()
  }, [])

  // 首次用户交互解锁 Web Audio（规避移动端自动播放限制；BGM 随之按设置启动）
  useEffect(() => {
    const unlock = () => audioService.unlock()
    window.addEventListener('pointerdown', unlock, { capture: true })
    window.addEventListener('keydown', unlock, { capture: true })
    return () => {
      window.removeEventListener('pointerdown', unlock, { capture: true })
      window.removeEventListener('keydown', unlock, { capture: true })
    }
  }, [])

  // v0.2.9 房间残留清理（客户端侧）：摆阵/准备状态离开联机流程 → emit leaveRoom；
  // 对局中（playing/counterattack）导航离开不清房间，配合浮窗"回到未完成的对局"
  const prevViewRef = useRef(view)
  useEffect(() => {
    const prev = prevViewRef.current
    prevViewRef.current = view
    if (prev === view) return
    if (prev !== 'onlinePlacement') return
    const s = useOnlineStore.getState()
    if (s.room && s.room.players.length > 0 && s.phase === 'placing') {
      onlineApi.leaveRoom()
    }
  }, [view])

  /* ---------- 全局小浮窗：回到未完成的对局（v0.2.9） ---------- */
  const FAB_SIZE = 48
  const FAB_MARGIN = 10
  const stageRef = useRef<HTMLDivElement | null>(null)
  const [fabPos, setFabPos] = useState<{ x: number; y: number } | null>(null)
  const fabDragRef = useRef<{ startX: number; startY: number; moved: boolean } | null>(null)

  /** 把浮窗位置夹回舞台内（方向/舞台尺寸变化后防越界） */
  const clampFabPos = (pos: { x: number; y: number } | null): { x: number; y: number } | null => {
    if (!pos) return null
    const rect = stageRef.current?.getBoundingClientRect()
    if (!rect) return pos
    const w = rect.width
    const h = rect.height
    // 舞台过小时（极端）直接贴左上角，避免上下界反转
    if (w <= FAB_SIZE + FAB_MARGIN * 2 || h <= FAB_SIZE + FAB_MARGIN * 2) {
      return { x: FAB_MARGIN, y: FAB_MARGIN }
    }
    return {
      x: Math.min(Math.max(pos.x, FAB_MARGIN), w - FAB_SIZE - FAB_MARGIN),
      y: Math.min(Math.max(pos.y, FAB_MARGIN), h - FAB_SIZE - FAB_MARGIN),
    }
  }

  // 方向或舞台尺寸变化时把浮窗位置夹回舞台内（防越界；位置尽量保留）
  useEffect(() => {
    const clamp = () => setFabPos((prev) => clampFabPos(prev))
    clamp()
    window.addEventListener('resize', clamp)
    return () => window.removeEventListener('resize', clamp)
  }, [orientation])

  // 仅存在未完成的对局（房间存活且处于摆阵/对局阶段）且当前不在该界面时显示
  const inOnlineView = view === 'onlinePlacement' || view === 'onlineGame'
  const showFab =
    room !== null &&
    room.players.length > 0 &&
    !inOnlineView &&
    (phase === 'placing' || phase === 'playing' || phase === 'counterattack')

  const clampFab = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

  const onFabPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    fabDragRef.current = { startX: e.clientX, startY: e.clientY, moved: false }
    e.currentTarget.setPointerCapture(e.pointerId)
    e.preventDefault()
  }

  const onFabPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = fabDragRef.current
    if (!d) return
    if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 6) d.moved = true
    if (!d.moved) return
    const rect = stageRef.current?.getBoundingClientRect()
    if (!rect) return
    setFabPos({ x: e.clientX - rect.left - FAB_SIZE / 2, y: e.clientY - rect.top - FAB_SIZE / 2 })
  }

  const onFabPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = fabDragRef.current
    fabDragRef.current = null
    if (!d) return
    if (!d.moved) {
      // 单击：回到未完成的对局（摆阵 → 联机摆阵；对局 → 联机对局）
      const phaseNow = useOnlineStore.getState().phase
      useAppStore.getState().setView(phaseNow === 'placing' ? 'onlinePlacement' : 'onlineGame')
      return
    }
    // 拖拽结束：吸附到最近的舞台边缘（保持纵向位置）
    const rect = stageRef.current?.getBoundingClientRect()
    const w = rect?.width ?? window.innerWidth
    const h = rect?.height ?? window.innerHeight
    const cx = e.clientX - (rect?.left ?? 0)
    const cy = e.clientY - (rect?.top ?? 0)
    const x = cx < w / 2 ? FAB_MARGIN : w - FAB_SIZE - FAB_MARGIN
    const y = clampFab(cy - FAB_SIZE / 2, FAB_MARGIN, h - FAB_SIZE - FAB_MARGIN)
    setFabPos({ x, y })
  }

  return (
    <div className="app">
      <StampFilterDefs />
      {/* 舞台容器：竖版 9:16 画幅 / 横版全窗口；页面在其内部滚动，舞台本身不滚动 */}
      <div ref={stageRef} className={`app-stage app-stage--${orientation}`}>
        {/* key=view 触发 200ms 页面淡入切换 */}
        <div key={view} className="page-fade">
          {view === 'home' ? <Home /> : null}
          {view === 'single' ? <SingleMenu /> : null}
          {view === 'custom' ? <CustomConfig mode="single" /> : null}
          {view === 'settings' ? <Settings /> : null}
          {view === 'rules' ? <Rules /> : null}
          {view === 'online' ? <OnlineMenu /> : null}
          {view === 'onlineCustom' ? <CustomConfig mode="online" /> : null}
          {view === 'onlinePlacement' ? <OnlinePlacement /> : null}
          {view === 'onlineGame' ? <OnlineGame /> : null}
          {view === 'placement' ? <Placement /> : null}
          {view === 'game' ? <GameScreen mode="single" /> : null}
        </div>
        {/* 回到未完成的对局：圆形图标、可拖拽吸附、单击回程 */}
        {showFab ? (
          <button
            type="button"
            className="fab"
            style={fabPos ? { left: fabPos.x, top: fabPos.y } : undefined}
            onPointerDown={onFabPointerDown}
            onPointerMove={onFabPointerMove}
            onPointerUp={onFabPointerUp}
            onPointerCancel={() => {
              fabDragRef.current = null
            }}
            aria-label="回到未完成的对局"
            title="回到未完成的对局"
          >
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" fill="currentColor" />
            </svg>
          </button>
        ) : null}
      </div>
      <ToastRegion />
    </div>
  )
}
