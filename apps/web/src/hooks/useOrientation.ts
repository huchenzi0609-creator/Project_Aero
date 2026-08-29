/**
 * 响应式方向钩子：基于 matchMedia('(orientation)') + resize，
 * 按可用宽高比（窗口宽 > 高 = 横版）判定并实时更新。
 * 支持 appStore 中的手动覆盖（主页左上角的横/竖版预览切换）。
 */
import { useEffect, useState } from 'react'
import { useAppStore } from '../store/appStore'

export type Orientation = 'landscape' | 'portrait'

function computeOrientation(): Orientation {
  if (typeof window === 'undefined') return 'landscape'
  return window.innerWidth > window.innerHeight ? 'landscape' : 'portrait'
}

export function useOrientation(): Orientation {
  const [orientation, setOrientation] = useState<Orientation>(computeOrientation)
  useEffect(() => {
    const update = () => setOrientation(computeOrientation())
    const mq = window.matchMedia('(orientation: landscape)')
    update()
    window.addEventListener('resize', update)
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', update)
      return () => {
        window.removeEventListener('resize', update)
        mq.removeEventListener('change', update)
      }
    }
    // 旧版 Safari 回退
    mq.addListener(update)
    return () => {
      window.removeEventListener('resize', update)
      mq.removeListener(update)
    }
  }, [])
  return orientation
}

/** 实际生效的方向：手动覆盖优先，否则跟随窗口 */
export function useEffectiveOrientation(): Orientation {
  const orientation = useOrientation()
  const override = useAppStore((s) => s.orientationOverride)
  return override === 'auto' ? orientation : override
}

export interface Viewport {
  width: number
  height: number
}

/** 舞台尺寸：竖版 9:16 画幅（min(vw, vh*9/16) × min(vh, vw*16/9)），横版即窗口尺寸 */
function computeStageSize(orientation: Orientation): Viewport {
  if (typeof window === 'undefined') return { width: 1280, height: 800 }
  const vw = window.innerWidth
  const vh = window.innerHeight
  if (orientation === 'landscape') return { width: vw, height: vh }
  return {
    width: Math.min(vw, (vh * 9) / 16),
    height: Math.min(vh, (vw * 16) / 9),
  }
}

/** 返回舞台（app-stage）的像素尺寸；战斗组件据此计算格宽等 */
export function useViewport(): Viewport {
  const orientation = useEffectiveOrientation()
  const [size, setSize] = useState<Viewport>(() => computeStageSize(orientation))
  useEffect(() => {
    const update = () => setSize(computeStageSize(orientation))
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [orientation])
  return size
}
