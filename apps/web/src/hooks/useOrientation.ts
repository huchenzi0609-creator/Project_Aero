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

export function useViewport(): Viewport {
  const [size, setSize] = useState<Viewport>(() => ({
    width: typeof window === 'undefined' ? 1280 : window.innerWidth,
    height: typeof window === 'undefined' ? 800 : window.innerHeight,
  }))
  useEffect(() => {
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return size
}
