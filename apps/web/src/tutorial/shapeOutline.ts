/**
 * tutorial/shapeOutline —— 三次贝塞尔「轮廓库」+ 稠密点对点形变（v0.3.18-beta6）。
 *
 * 目标（任务 1）：用三次贝塞尔拟合对话气泡 / 按钮纸卡 / 空洞圆角矩形的外轮廓，
 * 并以**轮廓**作为几何唯一来源，提供连续稠密的点对点映射，供空洞形变动画使用。
 *
 * - `roundedRectOutline(w,h,r)`：4 条直线 + 4 段 kappa 圆弧（κ=0.5522847498…）→ **8 段**，
 *   对圆角矩形是**解析等价**（误差 ≈0）。
 * - `bubbleOutline(w,h,r,tail)`：圆角矩形轮廓 + 小尾巴 → **9 段**（底边在尾巴处断开，
 *   尾巴由 2 段贝塞尔表示，尖角留极小圆角贴合 CSS 观感）。
 *   尾巴几何按 CSS 反推：`.tutorial-bubble::after` 为 14×14、`left:24px; bottom:-7px`、`rotate(45deg)`
 *   → 旋转后可见部分为三角形：顶点 `x = left+31px`、底边 `x ∈ [left+21.1, left+40.9]`、顶点 `y = bottom+9.9px`；
 *   `--top` 变体上下镜像。
 * - `sampleOutline(outline, N)`：按**弧长等距**采样 N 点（默认 96，可被 4 整除便于圆角对应）。
 * - `morphPoints(a, b, p)`：先相似变换归一 + 循环移位对齐（最小化点距平方和），再逐点插值。
 */

export interface Pt {
  x: number
  y: number
}
export interface CubicSeg {
  p0: Pt
  c1: Pt
  c2: Pt
  p1: Pt
}
export interface Outline {
  segs: CubicSeg[]
}

/** 圆弧的三次贝塞尔逼近系数（1 - cos(45°) 的经典 kappa 值） */
export const KAPPA = 0.5522847498307936
/** 气泡尾巴可见深度（CSS `::after` 14×14 / rotate45 / bottom:-7px 反推） */
export const BUBBLE_TAIL_DEPTH = 9.9
/** 气泡尾巴底部可见 x 区间（相对元素左边；CSS left:24px + 14px 旋转后） */
export const BUBBLE_TAIL_X0 = 21.1
export const BUBBLE_TAIL_X1 = 40.9

const P = (x: number, y: number): Pt => ({ x, y })
const line = (a: Pt, b: Pt): CubicSeg => ({ p0: a, c1: a, c2: b, p1: b })
/**
 * 90° 圆弧（半径 `k`）的三次贝塞尔逼近。
 *
 * v0.3.18-beta6 修复：旧实现把控制点硬编码为 `c1=a+(κk,0) / c2=b+(0,-κk)`，
 * **只对「右上角」这一个朝向成立**；右下/左下/左上三个角会被画成严重畸形的曲线
 * （实测气泡左上角被切掉 ≈3.4px，气泡/空洞四角全部错位）。
 * 这里按「圆心 = a、b 两个候选交点中位于 a→b 右手侧者（本库所有轮廓均为顺时针绕向）」
 * 求出真正的端点切向，再取切线上的 κk 控制点 ⇒ 四个朝向统一正确。
 */
const arc = (a: Pt, b: Pt, k: number): CubicSeg => {
  const K = k * KAPPA
  const candA = P(a.x, b.y)
  const candB = P(b.x, a.y)
  // 叉积 > 0 ⇒ 该候选圆心在 a→b 的右手侧（顺时针绕向的内侧）
  const cross = (o: Pt) => (b.x - a.x) * (o.y - a.y) - (b.y - a.y) * (o.x - a.x)
  const c = cross(candA) > 0 ? candA : candB
  /** 端点处的前进切向（单位向量）：垂直于半径，且与弦同向 */
  const tan = (p: Pt): Pt => {
    let tx = p.y - c.y
    let ty = -(p.x - c.x)
    if (tx * (b.x - a.x) + ty * (b.y - a.y) < 0) {
      tx = -tx
      ty = -ty
    }
    const L = Math.hypot(tx, ty) || 1
    return P(tx / L, ty / L)
  }
  const ta = tan(a)
  const tb = tan(b)
  return {
    p0: a,
    c1: P(a.x + ta.x * K, a.y + ta.y * K),
    c2: P(b.x - tb.x * K, b.y - tb.y * K),
    p1: b,
  }
}

/**
 * 圆角矩形轮廓（**8 段**：上/右/下/左 4 直线 + 4 段 90° 圆弧贝塞尔）。
 * 与浏览器 `border-radius` 的圆弧解析等价（误差仅来自 kappa 逼近 ~2.7e-4·r）。
 */
export function roundedRectOutline(w: number, h: number, r: number): Outline {
  const k = Math.max(0, Math.min(r, w / 2, h / 2))
  const segs: CubicSeg[] = []
  // 顺时针：上边 → 右上角 → 右边 → 右下角 → 下边 → 左下角 → 左边 → 左上角
  segs.push(line(P(k, 0), P(w - k, 0)))
  segs.push(arc(P(w - k, 0), P(w, k), k))
  segs.push(line(P(w, k), P(w, h - k)))
  segs.push(arc(P(w, h - k), P(w - k, h), k))
  segs.push(line(P(w - k, h), P(k, h)))
  segs.push(arc(P(k, h), P(0, h - k), k))
  segs.push(line(P(0, h - k), P(0, k)))
  segs.push(arc(P(0, k), P(k, 0), k))
  return { segs }
}

/**
 * 对话气泡轮廓（**9 段**）：圆角矩形 + 小尾巴。
 * 尾巴三角形（相对元素左上角，尾巴在下）：底边 `x∈[21.1,40.9]`、顶点 `(31, h+9.9)`；
 * 底边在此处断开，用 2 段贝塞尔（尖角圆角 0.4px）连接，与 CSS `::after` 菱形下探部分一致。
 * `tail = 'bottom' | 'top'` 决定尾巴在下/在上（`--top` 变体镜像）。
 */
export interface TailGeom {
  /** 尾巴底边（与气泡底边相交处）左右 x */
  x0: number
  x1: number
  /** 顶点 x 与深度 */
  apex: number
  depth: number
  /** 尖角极小圆角 */
  tip?: number
}
/** 组长给定的尾巴近似（洞轮廓默认） */
export const TAIL_APPROX: TailGeom = { x0: BUBBLE_TAIL_X0, x1: BUBBLE_TAIL_X1, apex: 31, depth: BUBBLE_TAIL_DEPTH, tip: 0.4 }
/**
 * **CSS 精确**尾巴（用于把气泡元素本身画成同一轮廓，保证像素零回归）：
 * `::after` 为 14×14、`left:24px`（相对 padding box，故 border-box 相对为 25.5）、
 * `bottom:-7px`、`rotate(45deg)` ⇒ 菱形中心 (32.5, h−1.5)、半对角 9.9；
 * 与 box 底边相交处 x ∈ [24.1, 40.9]、顶点 (32.5, h+8.4)。
 */
export const TAIL_CSS: TailGeom = { x0: 24.1, x1: 40.9, apex: 32.5, depth: 8.4, tip: 0.4 }

/** 整条轮廓平移（不改变形状） */
export function translateOutline(o: Outline, dx: number, dy: number): Outline {
  const t = (p: Pt): Pt => P(p.x + dx, p.y + dy)
  return { segs: o.segs.map((sg) => ({ p0: t(sg.p0), c1: t(sg.c1), c2: t(sg.c2), p1: t(sg.p1) })) }
}

/**
 * v0.3.18-beta6 尾巴几何修正（两个**真实几何错误**的修复）：
 *
 * 1) `tailShiftedForSnap(g, dy)`：CSS 的 `.tutorial-bubble::after` 是按**未吸附**的布局盒定位的
 *    （`bottom:-7px` 相对 padding box 底边 = 72.297px），而气泡的 `background/border` 会被浏览器
 *    **按设备像素向下取整**（底边 735.0 而非 735.297）。若直接用吸附后的盒子画尾巴，尾巴的两条 45°
 *    边会整体右移 0.297px。这里把「相对盒底边」的几何换算到吸附后的盒子上，使**尾巴的线保持不动**：
 *    `x0-dy`、`x1+dy`、`depth+dy`（45° 边在固定 y 下 x 位移 = dy）。
 * 2) `tailInset(g, t)`：描边层是整条轮廓**向内等距 t** 的同心轮廓。盒子部分由 `(w-2t, h-2t, r-t)`
 *    自然得到，但尾巴两条边必须**沿法向**内缩 t —— 旧实现只把盒子缩小并整体平移 (t,t)，
 *    结果左边多缩 0.207px、右边**完全没缩**（描边一半跑到轮廓外）。45° 边的法向内缩 t
 *    ⇔ 固定 y 下 x 位移 t√2，故：`x0+t(√2−1)`、`x1−t(√2−1)`，顶点深度 `−t(√2−1)`；
 *    配合 `bubbleOutline(..., origin=(t,t))` 即得正确的同心轮廓。
 */
export function tailShiftedForSnap(g: TailGeom, dy: number): TailGeom {
  return { ...g, x0: g.x0 - dy, x1: g.x1 + dy, depth: g.depth + dy }
}

export function tailInset(g: TailGeom, t: number): TailGeom {
  // 局部坐标 = 原坐标平移 (t,t)：x−y 不变、x+y 减 2t；根部落在局部底边 y = h−2t 上。
  // 两条 45° 边法向内缩 t ⇔ 直线常数 ±t√2，代入 y = h−2t 得：
  //   x0' = x0 − 2t + t√2 ，x1' = x1 − t√2 ，顶点 x' = apex − t ，深度 −= t(√2−1)
  return {
    ...g,
    x0: g.x0 - 2 * t + t * Math.SQRT2,
    x1: g.x1 - t * Math.SQRT2,
    apex: g.apex - t,
    depth: g.depth - t * (Math.SQRT2 - 1),
  }
}

export function bubbleOutline(
  w: number,
  h: number,
  r: number,
  tail: 'bottom' | 'top' = 'bottom',
  geom: TailGeom = TAIL_APPROX,
  origin: Pt = { x: 0, y: 0 },
): Outline {
  const k = Math.max(0, Math.min(r, w / 2, h / 2))
  const x0 = geom.x0
  const x1 = geom.x1
  const apexX = geom.apex
  const depth = geom.depth
  // 注：`geom.tip`（默认 0.4px）自 v0.3.18-beta6 起**不再参与几何**——尾巴两侧改为严格直线后，
  // 顶点的极小圆角由描边 `stroke-linejoin: round`（≈0.5px）自然产生，与 CSS 菱形尖角一致。
  const segs: CubicSeg[] = []
  if (tail === 'bottom') {
    // 上边 + 右上角 + 右边 + 右下角 …… 左下角之前
    segs.push(line(P(k, 0), P(w - k, 0)))
    segs.push(arc(P(w - k, 0), P(w, k), k))
    segs.push(line(P(w, k), P(w, h - k)))
    segs.push(arc(P(w, h - k), P(w - k, h), k))
    // 下边（右→左）直到尾巴右根
    segs.push(line(P(w - k, h), P(x1, h)))
    // 尾巴：右根 → 顶点 → 左根（2 段贝塞尔，尖角圆角 tip）
    // v0.3.18-beta6：两段贝塞尔 = **严格直线**（控制点取 1/3、2/3 处，三次贝塞尔退化为线段）。
    // 旧实现取 c1 水平 0.35 / 垂直 0.75 ⇒ 曲线向**外鼓** ~3.4px，尾巴两侧各差 0.5~1px
    //（实测 ±8 交替色带），而 CSS `::after` 菱形两侧就是 45° 直线。顶点不额外倒角，
    // 交由描边 `stroke-linejoin: round`（≈0.5px）与旧观感一致。
    segs.push({
      p0: P(x1, h),
      c1: P(x1 - ((x1 - apexX) * 1) / 3, h + depth / 3),
      c2: P(x1 - ((x1 - apexX) * 2) / 3, h + (depth * 2) / 3),
      p1: P(apexX, h + depth),
    })
    segs.push({
      p0: P(apexX, h + depth),
      c1: P(apexX + ((x0 - apexX) * 1) / 3, h + (depth * 2) / 3),
      c2: P(apexX + ((x0 - apexX) * 2) / 3, h + depth / 3),
      p1: P(x0, h),
    })
    // 下边（继续向左）+ 左下角 + 左边 + 左上角
    segs.push(line(P(x0, h), P(k, h)))
    segs.push(arc(P(k, h), P(0, h - k), k))
    segs.push(line(P(0, h - k), P(0, k)))
    segs.push(arc(P(0, k), P(k, 0), k))
  } else {
    // 尾巴在上：镜像（顶点 y = -9.9）
    segs.push(line(P(k, 0), P(x0, 0)))
    // 同上：`--top` 变体两侧亦为严格直线（上下镜像）
    segs.push({
      p0: P(x0, 0),
      c1: P(x0 + ((apexX - x0) * 1) / 3, -depth / 3),
      c2: P(x0 + ((apexX - x0) * 2) / 3, (-depth * 2) / 3),
      p1: P(apexX, -depth),
    })
    segs.push({
      p0: P(apexX, -depth),
      c1: P(apexX + ((x1 - apexX) * 1) / 3, (-depth * 2) / 3),
      c2: P(apexX + ((x1 - apexX) * 2) / 3, -depth / 3),
      p1: P(x1, 0),
    })
    segs.push(line(P(x1, 0), P(w - k, 0)))
    segs.push(arc(P(w - k, 0), P(w, k), k))
    segs.push(line(P(w, k), P(w, h - k)))
    segs.push(arc(P(w, h - k), P(w - k, h), k))
    segs.push(line(P(w - k, h), P(k, h)))
    segs.push(arc(P(k, h), P(0, h - k), k))
    segs.push(line(P(0, h - k), P(0, k)))
    segs.push(arc(P(0, k), P(k, 0), k))
  }
  const o: Outline = { segs }
  return origin.x || origin.y ? translateOutline(o, origin.x, origin.y) : o
}

/** 轮廓段数（自检用：圆角矩形 8、气泡 9） */
export const segmentCount = (o: Outline) => o.segs.length

/** 三次贝塞尔求值 */
function cubic(p0: Pt, c1: Pt, c2: Pt, p1: Pt, t: number): Pt {
  const u = 1 - t
  const a = u * u * u
  const b = 3 * u * u * t
  const c = 3 * u * t * t
  const d = t * t * t
  return {
    x: a * p0.x + b * c1.x + c * c2.x + d * p1.x,
    y: a * p0.y + b * c1.y + c * c2.y + d * p1.y,
  }
}

/** 按弧长等距采样 N 点（闭合轮廓；返回点序与轮廓方向一致） */
/**
 * 轮廓 → SVG `d`（**精确三次贝塞尔**：`M` + 逐段 `C` + `Z`，不做折线化）。
 *
 * 与 `sampleOutline`+`pointsToPath` 的区别：后者是 N 点折线近似，96 点时点距 ≈6.7px，
 * 会把**尖角**（气泡尾巴顶点，实测深度只剩 6.0px / 应为 8.4px）和**圆角**（弦切 0.5px）切掉；
 * 而「把气泡元素本身画成同一条轮廓」不需要点对点映射，直接用原始贝塞尔段即可做到**解析等价**。
 */
export function outlineToPath(outline: Outline, dx = 0, dy = 0): string {
  const f = (v: number) => {
    const r = Math.round((v + 0) * 1000) / 1000
    return Object.is(r, -0) ? '0' : String(r)
  }
  const at = (p: Pt) => `${f(p.x + dx)} ${f(p.y + dy)}`
  const segs = outline.segs
  const first = segs[0]
  if (!first) return ''
  let d = `M ${at(first.p0)}`
  for (const sg of segs) d += ` C ${at(sg.c1)} ${at(sg.c2)} ${at(sg.p1)}`
  return `${d} Z`
}

export function sampleOutline(outline: Outline, n = 96): Pt[] {
  const flat: Pt[] = []
  const STEPS = 16 // 每段折线化步数（弧长积分近似）
  for (const s of outline.segs) {
    for (let i = 0; i < STEPS; i++) flat.push(cubic(s.p0, s.c1, s.c2, s.p1, i / STEPS))
  }
  const m = flat.length
  const segLen: number[] = []
  let total = 0
  for (let i = 0; i < m; i++) {
    const a = flat[i]!
    const b = flat[(i + 1) % m]!
    const d = Math.hypot(b.x - a.x, b.y - a.y)
    segLen.push(d)
    total += d
  }
  if (total <= 0) return flat.slice(0, n)
  const out: Pt[] = []
  const step = total / n
  let idx = 0
  let acc = 0
  for (let i = 0; i < n; i++) {
    const target = i * step
    while (idx < m - 1 && acc + segLen[idx]! < target) {
      acc += segLen[idx]!
      idx++
    }
    const a = flat[idx]!
    const b = flat[(idx + 1) % m]!
    const d = segLen[idx]! || 1
    const u = (target - acc) / d
    out.push({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u })
  }
  return out
}

/** 归一化到单位 bbox 且居中（消除平移/缩放分量，只比形状） */
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

/** 循环移位对齐（最小化点距平方和 ≈ 自动挑“位置相似的特殊点”） */
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

/** 建立两轮廓的稠密点对映射（a 为源、b 为目标；已对齐） */
export function matchOutlines(a: Outline, b: Outline, n = 96): { a: Pt[]; b: Pt[] } {
  const pa = sampleOutline(a, n)
  const pb = sampleOutline(b, n)
  return { a: pa, b: alignCyclic(pa, pb) }
}

/** 逐点插值（p ∈ [0,1]；调用方给弹簧进度） */
export function morphPoints(a: Pt[], b: Pt[], p: number): Pt[] {
  const n = Math.min(a.length, b.length)
  const out: Pt[] = []
  for (let i = 0; i < n; i++) {
    const pa = a[i]!
    const pb = b[i]!
    out.push({ x: pa.x + (pb.x - pa.x) * p, y: pa.y + (pb.y - pa.y) * p })
  }
  return out
}

export const pointsToPath = (pts: Pt[]): string =>
  pts.length === 0
    ? ''
    : pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${Math.round(p.x * 100) / 100} ${Math.round(p.y * 100) / 100}`).join(' ') + ' Z'

export function pointsBBox(pts: Pt[]) {
  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  const l = Math.min(...xs)
  const t = Math.min(...ys)
  return { left: l, top: t, width: Math.max(...xs) - l, height: Math.max(...ys) - t }
}

export function isSimple(pts: Pt[]): boolean {
  const n = pts.length
  if (n < 4) return true
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const inter = (a: Pt, b: Pt, c: Pt, d: Pt) =>
    cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue
      if (inter(pts[i]!, pts[(i + 1) % n]!, pts[j]!, pts[(j + 1) % n]!)) return false
    }
  }
  return true
}

/**
 * 轮廓 ↔ 元素可见轮廓的**等价性度量**（验收 1）：
 * 对应半径参数的圆角矩形用 CSS `border-radius` 渲染时的可见轮廓 = 圆角矩形；
 * 这里给出贝塞尔采样点到「理想圆角矩形边界」（CSS 圆弧）的最大偏差。
 * 做法：对每个采样点，若落在四角圆弧区则算到圆弧的径向偏差，否则算到最近直边的距离。
 */
export function deviationFromRoundedRect(outline: Outline, w: number, h: number, r: number, n = 256): number {
  const k = Math.max(0, Math.min(r, w / 2, h / 2))
  const pts = sampleOutline(outline, n)
  let worst = 0
  for (const p of pts) {
    const cx = Math.min(Math.max(p.x, k), w - k)
    const cy = Math.min(Math.max(p.y, k), h - k)
    const inCorner = (p.x < k || p.x > w - k) && (p.y < k || p.y > h - k)
    if (inCorner && k > 0) {
      const ccx = p.x < k ? k : w - k
      const ccy = p.y < k ? k : h - k
      worst = Math.max(worst, Math.abs(Math.hypot(p.x - ccx, p.y - ccy) - k))
    } else {
      // 直边区：到矩形边界的最近距离（取不到圆弧的部分用 clamp 后的距离）
      worst = Math.max(worst, Math.hypot(p.x - cx, p.y - cy))
    }
  }
  // 气泡尾巴不属于圆角矩形：调用方需先排除尾巴段（本函数用于纯圆角矩形等价性）
  return worst
}
