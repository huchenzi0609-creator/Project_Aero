import { useAppStore } from './store/appStore'
import { StampFilterDefs } from './components/grid/StampFilterDefs'
import { ToastRegion } from './components/ui/Toast'
import { Home } from './pages/Home'
import { SingleMenu } from './pages/SingleMenu'
import { CustomConfig } from './pages/CustomConfig'
import { Settings } from './pages/Settings'
import { Rules } from './pages/Rules'
import { OnlineMenu } from './pages/OnlineMenu'
import { Placement } from './pages/Placement'
import { GameScreen } from './pages/GameScreen'

export default function App() {
  const view = useAppStore((s) => s.view)
  return (
    <div className="app">
      <StampFilterDefs />
      {/* key=view 触发 200ms 页面淡入切换 */}
      <div key={view} className="page-fade">
        {view === 'home' ? <Home /> : null}
        {view === 'single' ? <SingleMenu /> : null}
        {view === 'custom' ? <CustomConfig /> : null}
        {view === 'settings' ? <Settings /> : null}
        {view === 'rules' ? <Rules /> : null}
        {view === 'online' ? <OnlineMenu /> : null}
        {view === 'placement' ? <Placement /> : null}
        {view === 'game' ? <GameScreen mode="single" /> : null}
      </div>
      <ToastRegion />
    </div>
  )
}
