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
  const allowMoveRefPlane = useSettingsStore((s) => s.allowMoveRefPlane)
  const setBgmVolume = useSettingsStore((s) => s.setBgmVolume)
  const setSfxVolume = useSettingsStore((s) => s.setSfxVolume)
  const toggleInvertMarks = useSettingsStore((s) => s.toggleInvertMarks)
  const setDifficulty = useSettingsStore((s) => s.setDifficulty)
  const toggleAllowMoveRefPlane = useSettingsStore((s) => s.toggleAllowMoveRefPlane)

  // 「地狱」难度描述跟随新算法（v0.2.7 后：机头概率热图 + 斩首式报点）
  const difficultyOptions = DIFFICULTY_OPTIONS.map((o) =>
    o.value === 'hell'
      ? { ...o, description: '机头概率热图 + 斩首式报点，强度显著高于困难。' }
      : o,
  )

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
              description="交换 ✗ 与 ◯ 的显示含义"
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
              options={difficultyOptions}
            />
            <div className="settings__row">
              <PaperToggle
                label="允许移动参考飞机"
                checked={allowMoveRefPlane}
                onChange={toggleAllowMoveRefPlane}
              />
            </div>
          </PaperCard>
        </section>
      </div>
    </div>
  )
}
