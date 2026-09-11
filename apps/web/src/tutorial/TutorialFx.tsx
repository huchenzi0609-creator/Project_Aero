/**
 * TutorialFx —— 教程通用提示（v0.3.13）。
 *
 * <成功提示>：网页四周边缘短暂闪烁深绿色 5px 条带（淡入淡出）+ playSfx('success')；
 * <失败提示>：同样闪烁深红色 5px 条带 + playSfx('failure')。
 * useTutorialFx() 返回 { fx, flash }：调用 flash('success'|'failure') 触发一次闪烁。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { audioService } from '../lib/audioService'

export type FxKind = 'success' | 'failure'

export interface TutorialFxHandle {
  kind: FxKind | null
  seq: number
}

export function useTutorialFx(): { fx: TutorialFxHandle; flash: (kind: FxKind) => void } {
  const [fx, setFx] = useState<TutorialFxHandle>({ kind: null, seq: 0 })
  const flash = useCallback((kind: FxKind) => {
    setFx((prev) => ({ kind, seq: prev.seq + 1 }))
    audioService.playSfx(kind)
  }, [])
  return { fx, flash }
}

/** 边带提示渲染（由 fx.seq 变化触发一次淡入淡出） */
export function TutorialFxBand({ fx }: { fx: TutorialFxHandle }) {
  const [on, setOn] = useState(false)
  const timerRef = useRef(0)
  useEffect(() => {
    if (!fx.kind || fx.seq === 0) return
    setOn(true)
    window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => setOn(false), 700)
    return () => window.clearTimeout(timerRef.current)
  }, [fx.seq, fx.kind])
  if (!fx.kind) return null
  const cls = ['tutorial-fx', `tutorial-fx--${fx.kind}`, on ? 'tutorial-fx--on' : ''].filter(Boolean).join(' ')
  return (
    <div className={cls} aria-hidden="true">
      <span className="tutorial-fx__edge tutorial-fx__edge--top" />
      <span className="tutorial-fx__edge tutorial-fx__edge--bottom" />
      <span className="tutorial-fx__edge tutorial-fx__edge--left" />
      <span className="tutorial-fx__edge tutorial-fx__edge--right" />
    </div>
  )
}
