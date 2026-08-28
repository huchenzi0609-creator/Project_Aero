import { useAppStore } from '../store/appStore'
import { DIFFICULTY_OPTIONS, useSettingsStore } from '../store/settingsStore'
import { audioService } from '../lib/audioService'
import { PaperButton } from '../components/ui/PaperButton'
import { PaperCard } from '../components/ui/PaperCard'
import { PaperSlider } from '../components/ui/PaperSlider'
import { PaperToggle } from '../components/ui/PaperToggle'
import { PaperSelect } from '../components/ui/PaperSelect'
import { StampMark } from '../components/grid/StampMark'

export function Settings() {
  const setView = useAppStore((s) => s.setView)

  const bgmVolume = useSettingsStore((s) => s.bgmVolume)
  const sfxVolume = useSettingsStore((s) => s.sfxVolume)
  const invertMarks = useSettingsStore((s) => s.invertMarks)
  const difficulty = useSettingsStore((s) => s.difficulty)
  const setBgmVolume = useSettingsStore((s) => s.setBgmVolume)
  const setSfxVolume = useSettingsStore((s) => s.setSfxVolume)
  const toggleInvertMarks = useSettingsStore((s) => s.toggleInvertMarks)
  const setDifficulty = useSettingsStore((s) => s.setDifficulty)

  // 试听：解锁 Web Audio 并播放一组合成音效（翻页+盖章+暖音）
  const preview = () => {
    audioService.unlock()
    audioService.playSfx('preview')
  }

  return (
    <div className="page settings">
      <PaperButton size="sm" variant="ghost" className="page__back" onClick={() => setView('home')}>
        ← 返回主页
      </PaperButton>
      <header className="page__head">
        <div>
          <h1 className="page__title">设置</h1>
          <p className="page__subtitle">声音、标记偏好与 AI 难度，自动保存在本机浏览器。</p>
        </div>
      </header>

      <div className="page__body">
        <section className="settings__section">
          <h2 className="settings__section-title">声音</h2>
          <PaperCard>
            <div className="settings__row settings__vol">
              <div style={{ flex: 1 }}>
                <PaperSlider label="BGM 音量" value={bgmVolume} onChange={setBgmVolume} />
              </div>
              <PaperButton size="sm" variant="ghost" onClick={preview}>
                试听
              </PaperButton>
            </div>
            <div className="settings__row settings__vol">
              <div style={{ flex: 1 }}>
                <PaperSlider
                  label="音效音量"
                  value={sfxVolume}
                  onChange={setSfxVolume}
                  hint="报点、盖章、铅笔划线的音量"
                />
              </div>
              <PaperButton size="sm" variant="ghost" onClick={preview}>
                试听
              </PaperButton>
            </div>
          </PaperCard>
        </section>

        <section className="settings__section">
          <h2 className="settings__section-title">显示</h2>
          <PaperCard>
            <PaperToggle
              label="反转 X 和 O"
              description="交换 ✗ 与 ◯ 的显示含义（仅本地偏好，两棋盘同生效，不影响胜负裁决）。"
              checked={invertMarks}
              onChange={toggleInvertMarks}
            />
            <div className="settings__markdemo" aria-hidden="true">
              <span className="settings__markpair">
                <StampMark outcome="miss" size={26} cell={{ r: 0, c: 0 }} inverted={invertMarks} /> 击空
              </span>
              <span className="settings__markpair">
                <StampMark outcome="hit" size={26} cell={{ r: 0, c: 1 }} inverted={invertMarks} /> 击中
              </span>
              <span className="settings__markpair">
                <StampMark outcome="kill" size={26} cell={{ r: 0, c: 2 }} inverted={invertMarks} /> 击毁
              </span>
            </div>
          </PaperCard>
        </section>

        <section className="settings__section">
          <h2 className="settings__section-title">对局</h2>
          <PaperCard>
            <PaperSelect
              label="AI 难度"
              value={difficulty}
              onChange={setDifficulty}
              options={DIFFICULTY_OPTIONS}
            />
          </PaperCard>
        </section>

        <p className="settings__note">全部设置将自动保存到本机（localStorage），无需手动保存。</p>
      </div>
    </div>
  )
}
