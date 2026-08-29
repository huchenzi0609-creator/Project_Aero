/**
 * ColoringTool —— 对局着色工具（v0.2.0，单机 + 联机）。
 *
 * - useColoring：着色状态 hook（色块列表 / 模式开关 / 当前颜色 / 调色板开关），
 *   每局独立、新对局由调用方 reset 清空，不持久化；
 * - ColoringToolButton：仅图标（无任何说明性文字）的着色按钮：
 *   点击 = 切换着色模式；长按（约 500ms）= 弹出调色板（黄/蓝/绿）选择当前颜色，
 *   选色后自动进入着色模式；
 * - 棋盘着色交互（点按染色 / 长按拖动画线 / 同色擦除）由 PaperGrid 的 coloring 属性承载，
 *   本组件只负责工具按钮与调色板。
 *
 * v0.2.1 微调：染色按触发类型区分——
 * - 点击（click）：三态——无色→染色；同色→擦除；异色→更新为当前色；
 * - 拖拽经过（drag）：两态——无色→染色；同色→保持不变（不再擦除）；异色→更新为当前色。
 *   手势判定在 PaperGrid 指针处理中完成（拖拽路径一律走 drag，纯点击在松手时补发 click 擦除）。
 */
import { useEffect, useRef, useState } from 'react'
import type { Cell } from '@aero/shared'
import '../../styles/coloring.css'

export type ColoringColor = 'yellow' | 'blue' | 'green'

/** 染色触发类型：click=点击（三态：染/擦/覆写）；drag=拖拽经过（两态：染/覆写，同色保持） */
export type PaintKind = 'click' | 'drag'

export interface ColoredCell {
  coord: Cell
  color: ColoringColor
}

export const COLORING_COLORS: ReadonlyArray<{ color: ColoringColor; label: string }> = [
  { color: 'yellow', label: '黄色' },
  { color: 'blue', label: '蓝色' },
  { color: 'green', label: '绿色' },
]

export interface ColoringState {
  /** 已染色格（渲染到对手棋盘，位于盖章标记下层） */
  coloredCells: ColoredCell[]
  coloringMode: boolean
  currentColor: ColoringColor
  paletteOpen: boolean
  setPaletteOpen: (open: boolean) => void
  /** 选择颜色：设定当前色、进入着色模式并关闭调色板 */
  selectColor: (color: ColoringColor) => void
  toggleMode: () => void
  /**
   * 按触发类型染色：
   * - click：三态——无色→染色；同色→擦除；异色→更新为当前色；
   * - drag：两态——无色→染色；同色→保持不变；异色→更新为当前色。
   */
  paintCell: (coord: Cell, kind?: PaintKind) => void
  /** 新对局清空（每局独立） */
  reset: () => void
}

export function useColoring(): ColoringState {
  const [coloredCells, setColoredCells] = useState<ColoredCell[]>([])
  const [coloringMode, setColoringMode] = useState(false)
  const [currentColor, setCurrentColor] = useState<ColoringColor>('yellow')
  const [paletteOpen, setPaletteOpen] = useState(false)

  const paintCell = (coord: Cell, kind: PaintKind = 'click') => {
    setColoredCells((prev) => {
      const idx = prev.findIndex((c) => c.coord.r === coord.r && c.coord.c === coord.c)
      if (idx === -1) return [...prev, { coord, color: currentColor }]
      const existing = prev[idx]!
      if (existing.color === currentColor) {
        // 同色：点击=擦除；拖拽经过=保持不变
        return kind === 'click' ? prev.filter((_, i) => i !== idx) : prev
      }
      // 异色 → 更新为当前色
      const next = prev.slice()
      next[idx] = { coord, color: currentColor }
      return next
    })
  }

  const selectColor = (color: ColoringColor) => {
    setCurrentColor(color)
    setColoringMode(true)
    setPaletteOpen(false)
  }

  const reset = () => {
    setColoredCells([])
    setColoringMode(false)
    setPaletteOpen(false)
  }

  return {
    coloredCells,
    coloringMode,
    currentColor,
    paletteOpen,
    setPaletteOpen,
    selectColor,
    toggleMode: () => setColoringMode((m) => !m),
    paintCell,
    reset,
  }
}

export interface ColoringToolButtonProps {
  /** 当前是否处于着色模式 */
  active: boolean
  color: ColoringColor
  paletteOpen: boolean
  /** 调色板展开方向（footer 处向上，避免被底部裁切） */
  paletteDir?: 'up' | 'down'
  onToggle: () => void
  onOpenPalette: () => void
  onClosePalette: () => void
  onSelectColor: (color: ColoringColor) => void
  className?: string
}

/** 长按判定阈值（ms） */
const LONG_PRESS_MS = 500

export function ColoringToolButton({
  active,
  color,
  paletteOpen,
  paletteDir = 'down',
  onToggle,
  onOpenPalette,
  onClosePalette,
  onSelectColor,
  className,
}: ColoringToolButtonProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const pressTimer = useRef(0)
  const longPressFired = useRef(false)

  // 调色板打开时：点击外部 / Esc 关闭。
  // 注意：页面会同时渲染横/竖两个按钮实例（按方向隐藏其一），两个实例都注册了本监听；
  // 因此"外部"必须按全局判定（目标不在任何 .coloring-tool 内），否则另一实例的监听
  // 会把本实例调色板里的点击误判为外部点击而提前关闭。
  useEffect(() => {
    if (!paletteOpen) return
    const onDown = (e: PointerEvent) => {
      const target = e.target as Element | null
      if (!target || !target.closest('.coloring-tool')) onClosePalette()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClosePalette()
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [paletteOpen, onClosePalette])

  const cancelPress = () => window.clearTimeout(pressTimer.current)

  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault()
    longPressFired.current = false
    cancelPress()
    pressTimer.current = window.setTimeout(() => {
      longPressFired.current = true
      onOpenPalette()
    }, LONG_PRESS_MS)
  }

  const handlePointerUp = () => {
    cancelPress()
    if (longPressFired.current) return // 长按已弹出调色板：松开不再切换模式
    onToggle()
  }

  return (
    <div ref={rootRef} className={['coloring-tool', className].filter(Boolean).join(' ')}>
      <button
        type="button"
        className={['coloring-btn', active ? 'coloring-btn--active' : ''].filter(Boolean).join(' ')}
        aria-label="着色工具"
        aria-pressed={active}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerLeave={cancelPress}
        onPointerCancel={cancelPress}
      >
        <PaletteIcon color={color} />
      </button>
      {paletteOpen ? (
        <div
          className={`coloring-palette coloring-palette--${paletteDir}`}
          role="group"
          aria-label="选择着色颜色"
        >
          {COLORING_COLORS.map(({ color: c, label }) => (
            <button
              key={c}
              type="button"
              className={[
                'coloring-swatch',
                `coloring-swatch--${c}`,
                c === color ? 'coloring-swatch--current' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              aria-label={label}
              aria-pressed={c === color}
              onClick={() => onSelectColor(c)}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

/** 调色盘图标（当前颜色圆点带描边环指示） */
function PaletteIcon({ color }: { color: ColoringColor }) {
  const dot = color === 'yellow' ? [8.3, 9.2] : color === 'blue' ? [12.6, 6.9] : [16.1, 10.3]
  return (
    <svg
      className="coloring-icon"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      aria-hidden="true"
    >
      <path
        d="M12 2.5a9.5 9.5 0 1 0 0 19c1.7 0 2.7-1.2 2-2.5-.4-.8-.2-1.5.3-2 .6-.5 1.5-.4 2.1.1.6.5 1.4.6 2.2.2.9-.5 1.4-1.4 1.4-2.5 0-6.6-4.3-12.3-10-12.3z"
        fill="var(--paper-sheet)"
        stroke="var(--ink)"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <circle className="coloring-icon__dot--yellow" cx="8.3" cy="9.2" r="1.8" />
      <circle className="coloring-icon__dot--blue" cx="12.6" cy="6.9" r="1.8" />
      <circle className="coloring-icon__dot--green" cx="16.1" cy="10.3" r="1.8" />
      <circle className="coloring-icon__ring" cx={dot[0]} cy={dot[1]} r="2.5" />
    </svg>
  )
}
