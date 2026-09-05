/**
 * 新手教程 · 步骤机（v0.3.0，docs/tutorial-spec-v030.md §2）。
 *
 * 状态机以 ref 为唯一真相、同步推进（同一事件批次内连发多个事件也按序正确匹配）；
 * 渲染经 tick 触发。
 *
 * 每步 = { text?: string[] | (e?) => string[]; wait?: 事件类型 | 谓词; highlight?: selector }。
 * - 文本步：气泡点击翻段，点完最后一段自动进下一步；
 * - 等待步（wait）：同样展示文本（点击翻段），事件条件满足才自动推进；
 * - 事件只喂给"当前等待步"，多余动作不打断步骤。
 * - 文本函数解析为空数组且无 wait 的步 = 瞬态步，自动跳过。
 */
import { useCallback, useEffect, useReducer, useRef } from 'react'
import type { TutorialGameEvent } from './events'

export interface TutorialStep {
  key: string
  text?: string[] | ((e: TutorialGameEvent | null) => string[])
  wait?: TutorialGameEvent['type'] | ((e: TutorialGameEvent) => boolean)
  highlight?: string
  onEnter?: () => void
}

interface MachineState {
  idx: number // -1 = 完成
  seg: number
  segs: string[]
}

export interface StepHandle {
  index: number
  step: TutorialStep | null
  segments: string[]
  seg: number
  click: () => void
  dispatch: (e: TutorialGameEvent) => void
  restart: () => void
}

/** 从某步解析文本段（函数步依赖最近事件） */
function resolveSegments(steps: TutorialStep[], i: number, lastEvent: TutorialGameEvent | null): string[] {
  const s = steps[i]
  if (!s) return []
  if (typeof s.text === 'function') {
    const arr = s.text(lastEvent)
    return Array.isArray(arr) ? arr : []
  }
  return s.text ?? []
}

function isWaiting(steps: TutorialStep[], i: number): boolean {
  return Boolean(steps[i]?.wait)
}

export function useSteps(
  steps: TutorialStep[],
  onDone?: () => void,
): StepHandle {
  const [, tick] = useReducer((x: number) => x + 1, 0)
  const stRef = useRef<MachineState>({ idx: 0, seg: 0, segs: [] })
  const lastEventRef = useRef<TutorialGameEvent | null>(null)
  const doneFiredRef = useRef(false)
  const stepsRef = useRef(steps)
  stepsRef.current = steps
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone

  const refreshSegments = useCallback((idx: number) => {
    stRef.current.segs = resolveSegments(stepsRef.current, idx, lastEventRef.current)
    stRef.current.seg = 0
  }, [])

  /** 进入 idx 步；瞬态步（无文本且无等待）自动跳过；越界 = 完成 */
  const enterIdx = useCallback(
    (idx: number) => {
      // 连续瞬态步安全上限（防异常循环）
      let guard = 0
      while (idx < stepsRef.current.length) {
        const s = stepsRef.current[idx]
        if (!s || guard++ > 64) break
        refreshSegments(idx)
        const instant = stRef.current.segs.length === 0 && !isWaiting(stepsRef.current, idx)
        if (s.onEnter) s.onEnter()
        if (instant) {
          idx += 1
          continue
        }
        break
      }
      if (idx >= stepsRef.current.length) {
        stRef.current = { idx: -1, seg: 0, segs: [] }
        if (!doneFiredRef.current) {
          doneFiredRef.current = true
          onDoneRef.current?.()
        }
        tick()
        return
      }
      doneFiredRef.current = false
      stRef.current.idx = idx
      tick()
    },
    [refreshSegments],
  )

  useEffect(() => {
    // 挂载 / steps 变化 → 从第一步开始
    doneFiredRef.current = false
    stRef.current = { idx: 0, seg: 0, segs: [] }
    enterIdx(0)
  }, [steps])

  const click = useCallback(() => {
    const st = stRef.current
    const s = stepsRef.current[st.idx]
    if (!s) return
    // 还有段 → 翻段
    if (st.seg + 1 < st.segs.length) {
      st.seg += 1
      tick()
      return
    }
    // 点完最后一段：文本步推进；等待步停留
    if (s.wait) return
    enterIdx(st.idx + 1)
  }, [enterIdx])

  const dispatch = useCallback(
    (e: TutorialGameEvent) => {
      lastEventRef.current = e
      const st = stRef.current
      if (st.idx < 0) return
      const s = stepsRef.current[st.idx]
      if (!s?.wait) return
      let matched = false
      if (typeof s.wait === 'string') matched = e.type === s.wait
      else matched = s.wait(e)
      if (matched) enterIdx(st.idx + 1)
    },
    [enterIdx],
  )

  const restart = useCallback(() => {
    doneFiredRef.current = false
    lastEventRef.current = null
    enterIdx(0)
  }, [enterIdx])

  const idx = stRef.current.idx
  const step: TutorialStep | null = idx >= 0 ? (steps[idx] ?? null) : null
  return {
    index: idx,
    step,
    segments: stRef.current.segs,
    seg: stRef.current.seg,
    click,
    dispatch,
    restart,
  }
}
