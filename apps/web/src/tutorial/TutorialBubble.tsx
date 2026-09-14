/**
 * TutorialBubble —— 纸感对话气泡（v0.3.0）。
 * - 富文本：`*…*` 手稿强调 → 加粗；`[控件名]` → 加粗示意（按键化样式）；
 * - 定位锚：竖版底部（避开输入栏/空网格下方空间），横版右下参考网格下方；
 *   有突显目标（spotlight）时不与其重叠（气泡尽量置于洞口同侧之外）；
 * - 点击气泡推进（由步骤机 click 处理；段未翻完时同一气泡换段）。
 */
import { useLayoutEffect, useRef, useState } from 'react'
import {
  TAIL_CSS,
  bubbleOutline,
  outlineToPath,
  roundedRectOutline,
  tailInset,
  tailShiftedForSnap,
} from './shapeOutline'

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
  /**
   * v0.3.18-beta6：气泡**形状由贝塞尔轮廓绘制**（`bubbleOutline`，9 段：圆角矩形 + 尾巴），
   * 取代原来的 `border-radius: 12px` + `::after` 尾巴。这里测量 border-box 尺寸后生成路径；
   * 尾巴用 **CSS 精确几何**（TAIL_CSS）以保证与旧外观像素一致。
   */
  const [shape, setShape] = useState<{
    d: string
    strokeD: string
    rectD: string
    softD: string
    w: number
    h: number
  } | null>(null)
  const tailTop = anchor === 'top'
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    /** 轮廓 → path：直接用贝塞尔段（精确），不做 N 点折线化（折线会切掉尾巴尖角与圆角）。 */
    const pathOf = (o: Parameters<typeof outlineToPath>[0], dx = 0, dy = 0) => outlineToPath(o, dx, dy)
    const build = (rw: number, rh: number) => {
      if (!(rw > 0 && rh > 0)) return
      /**
       * 关键：CSS 的 `background`/`border` 与 `box-shadow` 都按**设备像素向下取整对齐**
       * （元素 border-box 高 72.297px 时，实际绘制的高 = 72px、底边 735.0 而非 735.297），
       * 而 SVG path 不会自动吸附 ⇒ 若直接用 offsetHeight/rect 尺寸绘制，四边都会差 0.3px 并被抗锯齿糊开
       * （实测：气泡底边描边比基线低 0.5px、顶边高 0.5px，单像素差最高 129）。
       * 这里按 DPR 向下取整到设备像素网格，令 path 边缘与旧 CSS 边界逐设备像素重合。
       */
      const dpr = window.devicePixelRatio || 1
      const snap = (v: number) => Math.floor(v * dpr) / dpr
      const w = snap(rw)
      const h = snap(rh)
      const tail = tailTop ? 'top' : 'bottom'
      // 尾巴的线按**未吸附**的布局盒定位（CSS `::after` 的 bottom 相对布局盒），故先把几何换算到吸附后的盒子
      const geom = tailShiftedForSnap(TAIL_CSS, rh - h)
      const d = pathOf(bubbleOutline(w, h, BUBBLE_RADIUS_PX, tail, geom))
      /**
       * 描边层 = 整条轮廓**向内等距 t=0.5px** 的同心轮廓（旧 `border:1px` 完全画在 border-box 内侧；
       * 居中的 1px 描边会露出 0.5px 到盒外 ⇒ 顶/底/左/右各偏 0.5px）。
       * 盒子由 (w−1, h−1, r−0.5) 得到，且整体位于 (0.5, 0.5)；尾巴两条 45° 边用法向内缩处理。
       */
      const t = STROKE_WIDTH / 2
      const strokeD = pathOf(
        bubbleOutline(
          Math.max(1, w - 2 * t),
          Math.max(1, h - 2 * t),
          Math.max(0.5, BUBBLE_RADIUS_PX - t),
          tail,
          tailInset(geom, t),
          { x: t, y: t },
        ),
      )
      // 投影层：旧 box-shadow 三层 = 硬 1px + 硬 3px + 柔(blur 18 / spread −4)
      // spread −4 ⇒ 柔投影轮廓 = 盒内缩 4px、圆角 12−4=8（旧 `::after` 尾巴本身无投影）
      const rectD = pathOf(roundedRectOutline(w, h, BUBBLE_RADIUS_PX))
      const softD = pathOf(
        roundedRectOutline(
          Math.max(1, w - 8),
          Math.max(1, h - 8),
          Math.max(0, BUBBLE_RADIUS_PX - 4),
        ),
        4,
        4,
      )
      setShape((prev) =>
        prev && prev.w === w && prev.h === h && prev.d === d && prev.strokeD === strokeD
          ? prev
          : { d, strokeD, rectD, softD, w, h },
      )
    }
    const measure = (bw?: number, bh?: number) => build(bw ?? el.offsetWidth, bh ?? el.offsetHeight)
    measure()
    // ResizeObserver 的 borderBoxSize 是**布局**尺寸（不受 transform 影响）且保留小数：
    // offsetHeight 会把 72.3px 取整成 72，导致轮廓底边比真实盒底边高 0.3px。
    const ro = new ResizeObserver((entries) => {
      const bs = entries[0]?.borderBoxSize?.[0]
      measure(bs?.inlineSize, bs?.blockSize)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [text, tailTop])
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
      {/* 气泡形状层由 `bubbleOutline`（9 段贝塞尔）绘制：填充 = 纸色 + 顶部白色渐变；描边 1px；
          投影 = 逐层 drop-shadow 复刻旧 box-shadow（互不串联，避免第二层把第一层再投影一次） */}
      {shape ? (
        <svg className="tutorial-bubble__shape" width={shape.w} height={shape.h} aria-hidden="true">
          <defs>
            <linearGradient id={GRAD_ID} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#fff" stopOpacity="0.65" />
              <stop offset="72%" stopColor="#fff" stopOpacity="0" />
              <stop offset="100%" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path className="tutorial-bubble__shadow tutorial-bubble__shadow--soft" d={shape.softD} fill="var(--paper-sheet)" />
          <path className="tutorial-bubble__shadow tutorial-bubble__shadow--hard2" d={shape.rectD} fill="var(--paper-sheet)" />
          <path className="tutorial-bubble__shadow tutorial-bubble__shadow--hard1" d={shape.rectD} fill="var(--paper-sheet)" />
          <path d={shape.d} fill="var(--paper-sheet)" />
          <path d={shape.d} fill={`url(#${GRAD_ID})`} />
          <path d={shape.strokeD} fill="none" stroke="rgba(96, 78, 50, 0.55)" strokeWidth={STROKE_WIDTH} strokeLinejoin="round" />
        </svg>
      ) : null}
      <div className="tutorial-bubble__text">
        <RichTutorial text={text} />
      </div>
      <div className="tutorial-bubble__foot">
        {showHint ? <span className="tutorial-bubble__hint">点击继续</span> : null}
      </div>
    </div>
  )
}

/** 气泡圆角（与旧 CSS `border-radius: 12px` 一致） */
const BUBBLE_RADIUS_PX = 12
/** 气泡描边宽度（= 旧 `border:1.5px` 在 Chromium 下的**计算值/实际绘制值** 1px，见验收报告） */
const STROKE_WIDTH = 1
const GRAD_ID = 'tutorial-bubble-grad'

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
