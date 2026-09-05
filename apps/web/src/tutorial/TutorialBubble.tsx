/**
 * TutorialBubble —— 纸感对话气泡（v0.3.0）。
 * - 富文本：`*…*` 手稿强调 → 加粗；`[控件名]` → 加粗示意（按键化样式）；
 * - 定位锚：竖版底部（避开输入栏/空网格下方空间），横版右下参考网格下方；
 *   有突显目标（spotlight）时不与其重叠（气泡尽量置于洞口同侧之外）；
 * - 点击气泡推进（由步骤机 click 处理；段未翻完时同一气泡换段）。
 */
import { useEffect, useRef, useState } from 'react'

export function TutorialBubble({
  text,
  onClick,
  skipLabel,
  onSkip,
}: {
  text: string
  onClick: () => void
  skipLabel: string
  onSkip: () => void
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ left?: number; top?: number; right?: number; bottom?: number } | null>(null)

  // 首次显示后测量自身大小，动态摆放（尽量避开 inputbar 顶部区域）
  useEffect(() => {
    setPos(null)
    const el = ref.current
    if (!el) return
    const place = () => {
      const stage = document.querySelector('.app-stage')?.getBoundingClientRect()
      const bubble = el.getBoundingClientRect()
      if (!stage) return
      // 默认竖版：舞台底部；横版：参考网格下方右侧
      const portrait = stage.height > stage.width
      if (portrait) {
        setPos({ left: stage.left + (stage.width - bubble.width) / 2, bottom: 12 })
      } else {
        setPos({ right: 16, bottom: 64 })
      }
    }
    const t = window.setTimeout(place, 0)
    window.addEventListener('resize', place)
    return () => {
      window.clearTimeout(t)
      window.removeEventListener('resize', place)
    }
  }, [text])

  return (
    <div
      ref={ref}
      className="tutorial-bubble"
      style={pos ?? undefined}
      role="dialog"
      aria-label="教程提示"
      onClick={onClick}
    >
      <div className="tutorial-bubble__text">
        <RichTutorial text={text} />
      </div>
      <div className="tutorial-bubble__foot">
        <span className="tutorial-bubble__hint">点击继续</span>
        <button type="button" className="tutorial-bubble__skip" onClick={(e) => {
          e.stopPropagation()
          onSkip()
        }}>
          {skipLabel}
        </button>
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
