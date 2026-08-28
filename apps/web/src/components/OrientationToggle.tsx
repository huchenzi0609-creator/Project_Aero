import { useAppStore } from '../store/appStore'
import { useEffectiveOrientation } from '../hooks/useOrientation'
import type { Orientation } from '../hooks/useOrientation'
import { PaperButton } from './ui/PaperButton'

function OrientIcon({ landscape }: { landscape: boolean }) {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
      <rect
        x={landscape ? 0.5 : 4.5}
        y={landscape ? 4.5 : 0.5}
        width={landscape ? 15 : 7}
        height={landscape ? 7 : 15}
        rx="1.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
    </svg>
  )
}

/** 主页左上角：横/竖版布局即时切换（强制预览 / 恢复自动） */
export function OrientationToggle() {
  const orientation = useEffectiveOrientation()
  const override = useAppStore((s) => s.orientationOverride)
  const setOverride = useAppStore((s) => s.setOrientationOverride)
  const reset = useAppStore((s) => s.resetOrientation)

  const target: Orientation = orientation === 'landscape' ? 'portrait' : 'landscape'
  const targetLabel = target === 'landscape' ? '横版' : '竖版'
  const forced = override !== 'auto'
  const currentLabel = orientation === 'landscape' ? '横版' : '竖版'

  return (
    <div className="home__orient">
      <PaperButton
        size="sm"
        variant="ghost"
        onClick={() => setOverride(target)}
        title={`布局预览：当前为${currentLabel}，点击切换为${targetLabel}`}
        aria-label={`布局预览：点击切换为${targetLabel}`}
      >
        <OrientIcon landscape={target === 'landscape'} />
        {forced ? `切到${targetLabel}` : `强制${targetLabel}预览`}
      </PaperButton>
      {forced ? (
        <button type="button" className="link-btn" onClick={reset}>
          恢复自动
        </button>
      ) : null}
    </div>
  )
}
