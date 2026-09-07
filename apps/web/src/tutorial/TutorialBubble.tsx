/**
 * TutorialBubble —— 纸感对话气泡（v0.3.0）。
 * - 富文本：`*…*` 手稿强调 → 加粗；`[控件名]` → 加粗示意（按键化样式）；
 * - 定位锚：竖版底部（避开输入栏/空网格下方空间），横版右下参考网格下方；
 *   有突显目标（spotlight）时不与其重叠（气泡尽量置于洞口同侧之外）；
 * - 点击气泡推进（由步骤机 click 处理；段未翻完时同一气泡换段）。
 */
import { useLayoutEffect, useRef, useState } from 'react'

export function TutorialBubble({
  text,
  onClick,
  showHint = true,
  anchor = 'bottom',
}: {
  text: string
  onClick: () => void
  /** 仅纯文本步（点击推进）显示「点击继续」；等待游戏事件的条件步不显示（v0.3.1） */
  showHint?: boolean
  /** 锚点：底部（默认）／顶部（突显目标在输入栏/底部工具栏时上置，避免气泡遮挡） */
  anchor?: 'bottom' | 'top'
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ left?: number; top?: number; right?: number; bottom?: number } | null>(null)
  // v0.3.9：定位稳定前不可见（opacity 0）——杜绝任何“先错位/漂移后到位”的可见位移
  const [ready, setReady] = useState(false)

  // v0.3.9：用 useLayoutEffect 在绘制前测量并置位——首帧即在正确位置（杜绝"先错位后跳回"）；
  // 文本/锚点变化亦在布局阶段同帧重定位；resize 时才走异步兜底。
  const posRef = useRef(pos)
  posRef.current = pos
  const place = () => {
    const el = ref.current
    if (!el) return
    const stage = document.querySelector('.app-stage')?.getBoundingClientRect()
    if (!stage) return
    // 用 offsetWidth/Height（不含 transform/scale 动画）测量布局尺寸，动画期间定位不抖动
    const w = el.offsetWidth
    const h = el.offsetHeight
    const portrait = stage.height > stage.width
    // v0.3.9：竖版舞台在视口内居中留白——气泡锚定舞台底部（fixed top 换算）；
    // v0.3.11：横屏气泡水平居中、垂直偏下（不再贴右下角）
    const next =
      anchor === 'top'
        ? { left: stage.left + (stage.width - w) / 2, top: stage.top + 12 }
        : portrait
          ? { left: stage.left + (stage.width - w) / 2, top: stage.bottom - h - 12 }
          : { left: stage.left + (stage.width - w) / 2, top: stage.bottom - h - 10 }
    const cur = posRef.current
    if (cur && cur.left === next.left && cur.top === next.top) return
    setPos(next)
  }

  // 挂载/换段：布局阶段立即定位；再用双 rAF 等首帧布局稳定后复测一次再放行显示
  useLayoutEffect(() => {
    place()
    setReady(false)
    let alive = true
    const raf1 = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (!alive) return
        place()
        setReady(true)
      }),
    )
    return () => {
      alive = false
      cancelAnimationFrame(raf1)
    }
  }, [text, anchor])

  useLayoutEffect(() => {
    const onResize = () => place()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [anchor, text])

  return (
    <div
      ref={ref}
      className={anchor === 'top' ? 'tutorial-bubble tutorial-bubble--top' : 'tutorial-bubble'}
      style={{ ...(pos ?? {}), opacity: ready ? 1 : 0, transition: ready ? 'opacity 120ms ease' : 'none' }}
      role="dialog"
      aria-label="教程提示"
      onClick={onClick}
    >
      <div className="tutorial-bubble__text">
        <RichTutorial text={text} />
      </div>
      <div className="tutorial-bubble__foot">
        {showHint ? <span className="tutorial-bubble__hint">点击继续</span> : null}
      </div>
    </div>
  )
}

/** 富文本：`*强调*` → <em>；`[控件名]` → <b>（无样式化语义，纯可读性） */
export function RichTutorial({ text }: { text: string }) {
  const parts: React.ReactNode[] = []
  const re = /(\*[^*]+\*|\[[^\]]+\])/g
  let last = 0
  let m: RegExpExecArray | null
  let k = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    const tok = m[0]
    if (tok.startsWith('*')) parts.push(<em key={k++}>{tok.slice(1, -1)}</em>)
    else parts.push(<b key={k++}>{tok.slice(1, -1)}</b>)
    last = m.index + tok.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return <>{parts}</>
}
