/**
 * 飞机 SVG：由 PlaneShape（cells + head）生成，严格占满所属格位。
 * - 机体：围绕格位并集描出的平滑贝塞尔轮廓（淡纸色填充 + 墨线描边）
 * - 机头：深色圆形座舱 + 沿头尾方向突出的鼻尖
 * - rotation 支持四向旋转；wrecked 变体为残骸暗色 + 斜叉
 */
import { useId } from 'react'
import type { PlaneShape, Rotation } from '@aero/shared'
import { rotateShape, shapeBBox } from '../../lib/shape'

export interface PlaneGlyphProps {
  shape: PlaneShape
  rotation?: Rotation
  wrecked?: boolean
  className?: string
}

interface Pt {
  x: number
  y: number
}

/**
 * 对格位并集做边缘追踪，再用二次贝塞尔圆角生成平滑闭合轮廓。
 * 返回可包含多子路径（fill-rule: evenodd 处理孔洞）的 path data。
 */
function smoothOutline(cells: { r: number; c: number }[]): string {
  const cellSet = new Set(cells.map((p) => `${p.r},${p.c}`))
  const has = (r: number, c: number) => cellSet.has(`${r},${c}`)
  // 定向边界边：start(键) -> end(键)，沿并集外沿
  const edges = new Map<string, string>()
  for (const { r, c } of cells) {
    if (!has(r - 1, c)) edges.set(`${c},${r}`, `${c + 1},${r}`)
    if (!has(r, c + 1)) edges.set(`${c + 1},${r}`, `${c + 1},${r + 1}`)
    if (!has(r + 1, c)) edges.set(`${c + 1},${r + 1}`, `${c},${r + 1}`)
    if (!has(r, c - 1)) edges.set(`${c},${r + 1}`, `${c},${r}`)
  }
  if (edges.size === 0) return ''

  const loops: string[][] = []
  const visited = new Set<string>()
  for (const start of edges.keys()) {
    if (visited.has(start)) continue
    const loop: string[] = []
    let cur = start
    let guard = 0
    while (!visited.has(cur) && guard++ < edges.size + 2) {
      visited.add(cur)
      loop.push(cur)
      const end = edges.get(cur)
      if (!end) break
      cur = end
    }
    if (loop.length >= 3) loops.push(loop)
  }

  const rr = 0.16
  const parts: string[] = []
  for (const loop of loops) {
    const pts: Pt[] = loop.map((k) => {
      const [x, y] = k.split(',').map(Number)
      return { x: x!, y: y! }
    })
    const n = pts.length
    let d = ''
    for (let i = 0; i < n; i++) {
      const prev = pts[(i - 1 + n) % n]!
      const cur = pts[i]!
      const next = pts[(i + 1) % n]!
      const d1 = Math.hypot(cur.x - prev.x, cur.y - prev.y) || 1
      const d2 = Math.hypot(next.x - cur.x, next.y - cur.y) || 1
      const r = Math.min(rr, d1 / 2, d2 / 2)
      const ux = (cur.x - prev.x) / d1
      const uy = (cur.y - prev.y) / d1
      const vx = (next.x - cur.x) / d2
      const vy = (next.y - cur.y) / d2
      const ax = cur.x - ux * r
      const ay = cur.y - uy * r
      const bx = cur.x + vx * r
      const by = cur.y + vy * r
      if (i === 0) d += `M ${ax.toFixed(3)} ${ay.toFixed(3)} `
      d += `Q ${cur.x.toFixed(3)} ${cur.y.toFixed(3)} ${bx.toFixed(3)} ${by.toFixed(3)} `
    }
    d += 'Z'
    parts.push(d)
  }
  return parts.join(' ')
}

export function PlaneGlyph({ shape, rotation = 0, wrecked = false, className }: PlaneGlyphProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const fillId = `plane-fill-${uid}`
  const rotated = rotateShape(shape, rotation)
  const b = shapeBBox(rotated.cells)
  if (!b) return null
  const w = b.c1 - b.c0 + 1
  const h = b.r1 - b.r0 + 1
  const pad = 0.26

  const outline = smoothOutline(rotated.cells)

  // 质心 -> 机头方向（鼻尖突出）
  const cx = rotated.cells.reduce((s, p) => s + p.c + 0.5, 0) / rotated.cells.length
  const cy = rotated.cells.reduce((s, p) => s + p.r + 0.5, 0) / rotated.cells.length
  const hx = rotated.head.c + 0.5
  const hy = rotated.head.r + 0.5
  let dx = hx - cx
  let dy = hy - cy
  const len = Math.hypot(dx, dy) || 1
  dx /= len
  dy /= len
  const px = -dy
  const py = dx
  const noseW = 0.32
  const tipX = hx + dx * 0.62
  const tipY = hy + dy * 0.62
  const nose = `M ${tipX.toFixed(3)} ${tipY.toFixed(3)} L ${(hx + px * noseW).toFixed(3)} ${(hy + py * noseW).toFixed(3)} L ${(hx - px * noseW).toFixed(3)} ${(hy - py * noseW).toFixed(3)} Z`

  const bodyFill = wrecked ? '#6f6757' : `url(#${fillId})`
  const bodyStroke = wrecked ? '#332d22' : 'var(--ink)'

  return (
    <svg
      className={className}
      viewBox={`${-pad} ${-pad} ${w + pad * 2} ${h + pad * 2}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      style={{ display: 'block', width: '100%', height: '100%' }}
    >
      <defs>
        <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fdf9ec" />
          <stop offset="100%" stopColor="#ece1c2" />
        </linearGradient>
      </defs>
      <path
        d={outline}
        fill={bodyFill}
        stroke={bodyStroke}
        strokeWidth={0.13}
        strokeLinejoin="round"
        fillRule="evenodd"
      />
      <path d={nose} fill={bodyFill} stroke={bodyStroke} strokeWidth={0.11} strokeLinejoin="round" />
      {/* 座舱（机头） */}
      <circle cx={hx} cy={hy} r={0.26} fill={wrecked ? '#2e2920' : '#332c1f'} />
      <circle cx={hx} cy={hy} r={0.15} fill="none" stroke={wrecked ? '#6f6757' : '#f7f1de'} strokeWidth={0.05} />
      {/* 残骸暗色斜叉 */}
      {wrecked ? (
        <g stroke="#2b261d" strokeWidth={0.15} strokeLinecap="round" opacity={0.85}>
          <path d={`M 0.25 0.25 L ${(w - 0.25).toFixed(3)} ${(h - 0.25).toFixed(3)}`} />
          <path d={`M ${(w - 0.25).toFixed(3)} 0.25 L 0.25 ${(h - 0.25).toFixed(3)}`} />
        </g>
      ) : null}
    </svg>
  )
}
