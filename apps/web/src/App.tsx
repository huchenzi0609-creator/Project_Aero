import { useEffect } from 'react'
import { useAppStore } from './store/appStore'
import { useOnlineStore } from './store/onlineStore'
import { useEffectiveOrientation } from './hooks/useOrientation'
import { StampFilterDefs } from './components/grid/StampFilterDefs'
import { ToastRegion } from './components/ui/Toast'
import { connectSocket } from './net/socket'
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

export default function App() {
  const view = useAppStore((s) => s.view)
  const room = useOnlineStore((s) => s.room)
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

  // 页面刷新/重连恢复：已身处房间却落在主页时，自动回到联机流程对应页
  useEffect(() => {
    if (view !== 'home') return
    if (!room || room.players.length === 0) return
    const playing = room.phase === 'playing' || room.phase === 'counterattack' || room.phase === 'ended'
    useAppStore.getState().setView(playing ? 'onlineGame' : 'onlinePlacement')
  }, [view, room])

  return (
    <div className="app">
      <StampFilterDefs />
      {/* 舞台容器：竖版 9:16 画幅 / 横版全窗口；页面在其内部滚动，舞台本身不滚动 */}
      <div className={`app-stage app-stage--${orientation}`}>
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
      </div>
      <ToastRegion />
    </div>
  )
}
