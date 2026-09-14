/**
 * TutorialTopLayer —— 教程豁免对象的**结构化置顶**（v0.3.18-beta2 item 4）。
 *
 * 问题：`.tutorial-escape`（退出教程按钮）与对话气泡虽然 z-index 高于遮罩（130）与阻断带（150），
 * 但它们都在**页面 DOM 内部**——只要任一祖先带 `transform / filter / opacity<1 / contain /
 * isolation / will-change` 等属性，就会形成**堆叠上下文**，把整棵子树压到遮罩之下
 * （v0.3.17-beta3 已修过一次同类问题；本次用户再次遇到“有概率被遮罩遮挡”）。
 *
 * 方案：在 `document.body` 上挂一个 `position: fixed; inset: 0; z-index: 200` 的**顶层容器**
 * （位于所有页面堆叠上下文之外、遮罩之上、弹窗 backdrop z240 之下），
 * 把豁免对象 portal 进去。此后无论页面祖先怎么变换，豁免对象恒在遮罩/阻断带之上。
 *
 * - `TutorialEscape`：给「退出教程」按钮用——原地保留一个 **visibility:hidden 的占位**
 *   （布局与 .tutorial-escape 测量基准不变），真实可点元素出现在顶层容器中，并按占位实测矩形定位；
 * - `TutorialTopLayerPortal`：给对话气泡等自带 fixed 定位（视口坐标）的豁免对象用。
 *
 * 弹窗期间：遮罩本身不渲染（既有逻辑），但顶层容器仍存在 → 组件内检测弹窗时会**隐藏**置顶内容，
 * 避免覆盖弹窗 backdrop（z240）。
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useAnyModalOpen } from './useAnyModalOpen'

const HOST_ID = 'tutorial-top-layer'

/** 顶层容器（懒创建；多次调用复用同一节点） */
export function useTutorialTopLayer(): HTMLElement | null {
  const [host, setHost] = useState<HTMLElement | null>(null)
  useEffect(() => {
    let el = document.getElementById(HOST_ID)
    if (!el) {
      el = document.createElement('div')
      el.id = HOST_ID
      el.className = 'tutorial-top-layer'
      // 插到 body 最前：让置顶的真实元素成为 DOM 中**第一个** .tutorial-escape，
      // 这样 `page.locator('.tutorial-escape').first()` / querySelector 命中的是可点的那一份，
      // 而不是仅用于占位的 visibility:hidden 副本（避免既有 e2e 选择器点到隐藏元素而超时）。
      document.body.insertBefore(el, document.body.firstChild)
    }
    setHost(el)
  }, [])
  return host
}

/** 把任意豁免内容置顶（内容自带 fixed 定位时坐标仍是视口坐标：容器为 inset:0 的 fixed 层） */
export function TutorialTopLayerPortal({ children }: { children: ReactNode }) {
  const host = useTutorialTopLayer()
  const modalOpen = useAnyModalOpen()
  if (!host || modalOpen) return null
  return createPortal(children, host)
}

interface Rect {
  left: number
  top: number
  width: number
  height: number
}

const sameRect = (a: Rect | null, b: Rect) =>
  !!a &&
  Math.abs(a.left - b.left) < 0.5 &&
  Math.abs(a.top - b.top) < 0.5 &&
  Math.abs(a.width - b.width) < 0.5 &&
  Math.abs(a.height - b.height) < 0.5

/**
 * 「退出教程」等页内豁免按钮：原地占位（保持布局与 `.tutorial-escape` 测量基准）+ 顶层真实元素。
 * 占位保持 `visibility: hidden`（不参与命中/绘制），因此不会双份可点。
 */
export function TutorialEscape({ children }: { children: ReactNode }) {
  const slotRef = useRef<HTMLSpanElement | null>(null)
  const [rect, setRect] = useState<Rect | null>(null)
  const modalOpen = useAnyModalOpen()

  useLayoutEffect(() => {
    const measure = () => {
      const el = slotRef.current?.firstElementChild as HTMLElement | null
      if (!el) return
      const r = el.getBoundingClientRect()
      if (r.width <= 0 || r.height <= 0) return
      const next = { left: r.left, top: r.top, width: r.width, height: r.height }
      setRect((prev) => (sameRect(prev, next) ? prev : next))
    }
    measure()
    const t1 = window.setTimeout(measure, 60)
    const t2 = window.setTimeout(measure, 320)
    window.addEventListener('resize', measure)
    const ro = new ResizeObserver(measure)
    const child = slotRef.current?.firstElementChild
    if (child) ro.observe(child)
    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
      window.removeEventListener('resize', measure)
      ro.disconnect()
    }
  }, [])

  return (
    <>
      <span ref={slotRef} className="tutorial-escape-slot">
        {children}
      </span>
      {rect && !modalOpen ? (
        <TutorialTopLayerPortal>
          <div
            className="tutorial-escape-host"
            style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
          >
            {children}
          </div>
        </TutorialTopLayerPortal>
      ) : null}
    </>
  )
}
