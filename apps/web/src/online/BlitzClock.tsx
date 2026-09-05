/**
 * BlitzClock —— 超快棋双方倒计时（v0.3.0，临时占位实现）。
 *
 * ⚠️ M3 将在 apps/web/src/components/v030/ 提供正式共享组件（props 约定相同），
 * 落地后请把本组件的 import 路径改到 v030 并删除本文件。
 *
 * props 约定：{ ms: number, active: boolean }；剩余 <10s 红字轻微闪烁已内置。
 */
import { useEffect } from 'react'

export interface BlitzClockProps {
  /** 剩余毫秒（服务端 clock:update 驱动） */
  ms: number
  /** 该时钟当前是否在走表（对应席位回合中） */
  active: boolean
}

function fmt(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const s = total % 60
  const m = Math.floor(total / 60)
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`
}

let injected = false
function ensureKeyframes(): void {
  if (injected || typeof document === 'undefined') return
  injected = true
  const style = document.createElement('style')
  style.textContent = `@keyframes blitz-critical-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}`
  document.head.appendChild(style)
}

export function BlitzClock({ ms, active }: BlitzClockProps) {
  useEffect(ensureKeyframes, [])
  const critical = ms < 10_000
  return (
    <span
      className="blitz-clock"
      role="timer"
      aria-label={`剩余 ${fmt(ms)}`}
      style={{
        fontVariantNumeric: 'tabular-nums',
        color: critical ? 'var(--danger, #a8362f)' : undefined,
        opacity: critical ? undefined : active ? 1 : 0.72,
        animation: critical && active ? 'blitz-critical-blink 0.8s ease-in-out infinite' : undefined,
      }}
    >
      {fmt(ms)}
    </span>
  )
}
