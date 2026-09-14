/**
 * tutorial/holeOutline —— 空洞轮廓（多边形）表示与「任意形状 → 任意形状」平滑形变（v0.3.18-beta5）。
 *
 * 算法选型（任务 1，采用组长建议的混合式，理由见报告）：
 *  ① 形状统一为**轮廓多边形**（圆角矩形 / 气泡轮廓各自按弧长均匀采样 N 点）；
 *  ② 相似变换归一：两者都以其 bbox 归一（平移对齐中心 + 按尺寸缩放），消除“平移/缩放”分量；
 *  ③ 弧长重采样到同一 N（本模块固定 N，天然对齐），再用**循环移位最小化点对距离平方和**自动挑选
 *     “位置相似的特殊点”作为对齐起点（比人工挑点鲁棒）；
 *  ④ 逐点线性插值，进度由调用方用解析阻尼弹簧（HOLE_EASE）给出；
 *  ⑤ 自交校验：插值结果若非简单多边形，调用方回退为“按 bbox 的圆角矩形”渲染（兜底）。
 *
 * 为什么要“归一后再插值”：直接对两形状的原始坐标插值，会混入平移/缩放分量，
 * 在周长差大时出现整体绕圈/扭曲的伪影；归一后插值只表达“形状差异”，
 * 平移与缩放由矩形插值（引擎现有 rect 管线）单独承担，两者叠加即得自然变形。
 */
export interface Pt {
  x: number
  y: number
}
export interface BoxRect {
  left: number
  top: number
  width: number
  height: number
}

/** 轮廓采样点数（48 在 60fps 下足够平滑，且自交校验 O(N²) 仅 1128 对） */
export const OUTLINE_N = 48

/** 圆角矩形轮廓（按弧长均匀采样，起点固定为「上边左端起」→ 保证同一矩形两次采样完全一致） */
export function roundRectOutline(rect: BoxRect, radius: number, n = OUTLINE_N, inset = 0): Pt[] {
  const l = rect.left + inset
  const t = rect.top + inset
  const r = rect.left + rect.width - inset
  const b = rect.top + rect.height - inset
  const k = Math.max(0, Math.min(radius, (r - l) / 2, (b - t) / 2))
  const pts: Pt[] = []
  const push = (x: number, y: number) => pts.push({ x, y })
  // 顺时针：上边（左→右）→ 右上角 → 右边 → 右下角 → 下边（右→左）→ 左下角 → 左边 → 左上角
  const arc = (cx: number, cy: number, from: number, to: number) => {
    const steps = 5
    for (let i = 0; i <= steps; i++) {
      const a = from + ((to - from) * i) / steps
      push(cx + Math.cos(a) * k, cy + Math.sin(a) * k)
    }
  }
  const H = Math.PI / 2
  push(l + k, t)
  push(r - k, t)
  arc(r - k, t + k, -H, 0)
  push(r, b - k)
  arc(r - k, b - k, 0, H)
  push(l + k, b)
  arc(l + k, b - k, H, Math.PI)
  push(l, t + k)
  arc(l + k, t + k, Math.PI, Math.PI + H)
  return resample(pts, n)
}

/**
 * 对话气泡轮廓 = 圆角矩形 + 小尾巴（CSS `.tutorial-bubble::after`：14×14、rotate(45deg)、
 * bottom:-7px / left:24px、`--top` 时尾巴在上）。尾巴用三角凸起近似（顶点外探 ~10px、
 * x 覆盖 21..41px），与 CSS 实际可见范围一致；阴影留白由调用方在 bbox 上计入。
 */
export function bubbleOutline(rect: BoxRect, tailTop: boolean, n = OUTLINE_N, radius = 12): Pt[] {
  const base = roundRectOutline(rect, radius, n)
  // 尾巴位置（相对 bbox 左侧）：CSS left:24px + 14px 宽 → 覆盖 24..38，旋转后约 21..41
  const x0 = 21
  const x1 = 41
  const peak = 10
  const edgeY = tailTop ? rect.top : rect.top + rect.height
  return base.map((p) => {
    if (p.x < x0 || p.x > x1) return p
    const u = Math.abs(p.x - (x0 + x1) / 2) / ((x1 - x0) / 2)
    const w = Math.max(0, 1 - u) // 三角/余弦型凸起
    const onEdge = Math.abs(p.y - edgeY) <= 2.5
    if (!onEdge) return p
    return { x: p.x, y: p.y + (tailTop ? -peak * w : peak * w) }
  })
}

/** 按弧长均匀重采样为 n 点（闭合折线） */
export function resample(poly: Pt[], n = OUTLINE_N): Pt[] {
  if (poly.length < 3) return poly
  const seg: number[] = []
  let total = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!
    const b = poly[(i + 1) % poly.length]!
    const d = Math.hypot(b.x - a.x, b.y - a.y)
    seg.push(d)
    total += d
  }
  if (total <= 0) return poly
  const out: Pt[] = []
  const step = total / n
  let idx = 0
  let acc = 0
  for (let i = 0; i < n; i++) {
    const target = i * step
    while (idx < seg.length - 1 && acc + seg[idx]! < target) {
      acc += seg[idx]!
      idx++
    }
    const a = poly[idx]!
    const b = poly[(idx + 1) % poly.length]!
    const d = seg[idx]! || 1
    const u = (target - acc) / d
    out.push({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u })
  }
  return out
}

/** 归一化到「单位 bbox + 居中」（消除平移/缩放分量，只保留形状差异） */
function normalize(poly: Pt[]): Pt[] {
  const xs = poly.map((p) => p.x)
  const ys = poly.map((p) => p.y)
  const x0 = Math.min(...xs)
  const x1 = Math.max(...xs)
  const y0 = Math.min(...ys)
  const y1 = Math.max(...ys)
  const s = Math.max(x1 - x0, y1 - y0) || 1
  return poly.map((p) => ({ x: (p.x - (x0 + x1) / 2) / s, y: (p.y - (y0 + y1) / 2) / s }))
}

/** 循环移位对齐：返回 b 的最佳旋转版本（最小化逐点距离平方和 ≈ 自动挑“位置相似的特殊点”） */
export function alignCyclic(a: Pt[], b: Pt[]): Pt[] {
  const n = Math.min(a.length, b.length)
  if (n === 0) return b
  const an = normalize(a)
  const bn = normalize(b)
  let best = 0
  let bestCost = Infinity
  for (let shift = 0; shift < n; shift++) {
    let cost = 0
    for (let i = 0; i < n; i++) {
      const p = an[i]!
      const q = bn[(i + shift) % n]!
      cost += (p.x - q.x) ** 2 + (p.y - q.y) ** 2
      if (cost >= bestCost) break
    }
    if (cost < bestCost) {
      bestCost = cost
      best = shift
    }
  }
  const out: Pt[] = []
  for (let i = 0; i < n; i++) out.push(b[(i + best) % n]!)
  return out
}

/** 逐点线性插值（p ∈ [0,1]；调用方给弹簧进度） */
export function lerpPoly(a: Pt[], b: Pt[], p: number): Pt[] {
  const n = Math.min(a.length, b.length)
  const out: Pt[] = []
  for (let i = 0; i < n; i++) {
    const pa = a[i]!
    const pb = b[i]!
    out.push({ x: pa.x + (pb.x - pa.x) * p, y: pa.y + (pb.y - pa.y) * p })
  }
  return out
}

export function polyToPath(poly: Pt[]): string {
  if (poly.length === 0) return ''
  return (
    poly.map((p, i) => `${i === 0 ? 'M' : 'L'}${Math.round(p.x * 100) / 100} ${Math.round(p.y * 100) / 100}`).join(' ') +
    ' Z'
  )
}

export function polyBBox(poly: Pt[]): BoxRect {
  const xs = poly.map((p) => p.x)
  const ys = poly.map((p) => p.y)
  const l = Math.min(...xs)
  const t = Math.min(...ys)
  return { left: l, top: t, width: Math.max(...xs) - l, height: Math.max(...ys) - t }
}

export function polyArea(poly: Pt[]): number {
  let s = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!
    const b = poly[(i + 1) % poly.length]!
    s += a.x * b.y - b.x * a.y
  }
  return Math.abs(s) / 2
}

export function polyPerimeter(poly: Pt[]): number {
  let s = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!
    const b = poly[(i + 1) % poly.length]!
    s += Math.hypot(b.x - a.x, b.y - a.y)
  }
  return s
}

/** 简单多边形（无自交）校验：O(N²) 线段相交测试 */
export function isSimple(poly: Pt[]): boolean {
  const n = poly.length
  if (n < 4) return true
  const inter = (a: Pt, b: Pt, c: Pt, d: Pt) => {
    const o = (p: Pt, q: Pt, r: Pt) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)
    const o1 = o(a, b, c)
    const o2 = o(a, b, d)
    const o3 = o(c, d, a)
    const o4 = o(c, d, b)
    return o1 * o2 < 0 && o3 * o4 < 0
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue
      if (inter(poly[i]!, poly[(i + 1) % n]!, poly[j]!, poly[(j + 1) % n]!)) return false
    }
  }
  return true
}
