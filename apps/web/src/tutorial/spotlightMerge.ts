/**
 * tutorial/spotlightMerge —— 突显洞矩形并集合并（v0.3.5）。
 *
 * TutorialSpotlight 用单层 SVG（fill-rule=evenodd）挖洞：外圈整屏 + 每目标一个洞子路径。
 * evenodd 下若两个洞子路径【重叠】，重叠区 winding 为偶数 → 被重新填充 → 变暗。
 * 修复：构建洞 path 前先对（已含 PAD 外扩的）矩形做**并集合并**——两两相交/包含即合并为
 * 包围盒并迭代至稳定，保证洞互不重叠，任意重叠目标亮度都与单洞一致。
 * 目标数量少（≤3），贪心 O(n²) 合并足够。
 */
export interface BoxRect {
  left: number
  top: number
  width: number
  height: number
}

function intersects(a: BoxRect, b: BoxRect): boolean {
  return (
    a.left < b.left + b.width &&
    a.left + a.width > b.left &&
    a.top < b.top + b.height &&
    a.top + a.height > b.top
  )
}

/** 两矩形并集包围盒 */
function unionOf(a: BoxRect, b: BoxRect): BoxRect {
  const left = Math.min(a.left, b.left)
  const top = Math.min(a.top, b.top)
  const right = Math.max(a.left + a.width, b.left + b.width)
  const bottom = Math.max(a.top + a.height, b.top + b.height)
  return { left, top, width: right - left, height: bottom - top }
}

/**
 * 矩形并集合并（贪心迭代至无相交）：返回互不重叠的矩形列表。
 * 相交/包含的矩形并入结果中的并集包围盒；迭代至稳定后直接用于洞 path（evenodd 亮度一致）。
 */
export function mergeHoleRects(rects: BoxRect[]): BoxRect[] {
  let out: BoxRect[] = rects.map((r) => ({ ...r }))
  let changed = true
  let guard = 0
  while (changed && guard++ < 32) {
    changed = false
    const next: BoxRect[] = []
    for (const r of out) {
      const hit = next.findIndex((x) => intersects(x, r))
      if (hit >= 0) {
        next[hit] = unionOf(next[hit]!, r)
        changed = true
      } else {
        next.push(r)
      }
    }
    out = next
  }
  return out
}

/**
 * 洞矩形去重叠分解（v0.3.17-beta3）：返回**互不重叠**且并集与原矩形集合完全一致的矩形列表。
 *
 * 与 mergeHoleRects 的区别：合并会把两矩形"一步吞掉"成包围盒（边界突变、且中间空隙被点亮），
 * 本函数按 x 边界切片、逐片合并 y 区间，得到无重叠、无缝隙膨胀的等价并集——
 * 洞的可见边界 = 原始矩形的并集边界，随动画连续变化（不会出现融合瞬间的跳变）。
 * 数量少（≤4 目标）时 O(n²) 足够，输出矩形数 ≤ 约 (2n-1)·n。
 */
export function disjointHoleRects(rects: BoxRect[]): BoxRect[] {
  // v0.3.18-beta1：丢弃亚像素碎片（<0.5px）。它们来自「引擎动画中的洞」与「同元素的实时豁免测量」
  // 之间的微小差值（同一元素测两次，left 差 0.1px 就会切出 0.1px 宽的条带）——
  // 矩形分解下不可见，但会让圆角并集边界的串联出现退化环（seam 无法配对）。
  const rs = rects.filter((r) => r.width > 0.5 && r.height > 0.5)
  if (rs.length <= 1) return rs.map((r) => ({ ...r }))
  const xs = Array.from(new Set(rs.flatMap((r) => [r.left, r.left + r.width]))).sort((a, b) => a - b)
  const out: BoxRect[] = []
  for (let i = 0; i < xs.length - 1; i++) {
    const x0 = xs[i]!
    const x1 = xs[i + 1]!
    const w = x1 - x0
    if (w <= 0.5) continue
    const spans = rs
      .filter((r) => r.left < x1 && r.left + r.width > x0)
      .map((r) => [r.top, r.top + r.height] as [number, number])
      .sort((a, b) => a[0] - b[0])
    let cur: [number, number] | null = null
    for (const s of spans) {
      if (!cur) cur = [s[0], s[1]]
      else if (s[0] <= cur[1] + 0.01) cur = [cur[0], Math.max(cur[1], s[1])]
      else {
        out.push({ left: x0, top: cur[0], width: w, height: cur[1] - cur[0] })
        cur = [s[0], s[1]]
      }
    }
    if (cur) out.push({ left: x0, top: cur[0], width: w, height: cur[1] - cur[0] })
  }
  return out
}

/* ============ v0.3.18-beta1：并集边界 + 圆角路径 ============ */

interface Pt {
  x: number
  y: number
}

interface Edge {
  from: Pt
  to: Pt
  /** 已使用标记（串联环时用） */
  used: boolean
}

const EPS = 0.01
const key = (p: Pt) => `${Math.round(p.x * 100) / 100},${Math.round(p.y * 100) / 100}`

/**
 * 生成「多矩形并集」的**圆角**边界路径（v0.3.18-beta1）。
 *
 * 为什么不能逐片圆角：`disjointHoleRects` 会把并集切成 x 条带，条带之间的**内部接缝**若也做圆角，
 * 会出现“糖葫芦”式缺口/缝隙。这里先把切片还原成**并集边界**（丢弃与邻片共享的内部边 → 有向边串联成环），
 * 再对边界顶点做圆角：凸角切角、凹角（融合产生的内角）外扩，半径 r 被相邻边长/2 夹取，
 * 因此接缝处没有顶点、天然不会出现缺口。
 *
 * - 顶点落在视口边上时不做圆角：基础态「整页洞」四角若圆角，屏幕四角会留下 4 个暗角（视觉伪影）。
 * - 输出恒定每个环一个 `M`（`-holes` 计数与既有 `' M'` 契约兼容）。
 */
export function unionOutlinePath(
  rects: BoxRect[],
  opts: { width: number; height: number; radius: number; onPathEdge?: number },
): string {
  // 与 disjointHoleRects 同口径：亚像素碎片不参与边界（否则会形成退化环）
  const rs = rects.filter((r) => r.width > 0.5 && r.height > 0.5)
  if (rs.length === 0) return ''
  const { width: W, height: H, radius } = opts
  const onEdge = opts.onPathEdge ?? 0.5

  /** 点是否被某片（除 skip 外）覆盖 */
  const coveredByOther = (x: number, y: number, skip: number) =>
    rs.some(
      (r, i) =>
        i !== skip && x > r.left + EPS && x < r.left + r.width - EPS && y > r.top + EPS && y < r.top + r.height - EPS,
    )

  const edges: Edge[] = []
  const push = (from: Pt, to: Pt) => {
    if (Math.abs(from.x - to.x) <= EPS && Math.abs(from.y - to.y) <= EPS) return
    edges.push({ from, to, used: false })
  }
  /** 把区间 [lo,hi] 按其它矩形的边界切成若干段（同一条边可能只有一部分被邻片覆盖） */
  const splits = (lo: number, hi: number, vals: number[]) =>
    Array.from(new Set([lo, hi, ...vals.filter((v) => v > lo + EPS && v < hi - EPS)])).sort((a, b) => a - b)
  const xsOf = (lo: number, hi: number) => splits(lo, hi, rs.flatMap((o) => [o.left, o.left + o.width]))
  const ysOf = (lo: number, hi: number) => splits(lo, hi, rs.flatMap((o) => [o.top, o.top + o.height]))

  rs.forEach((r, i) => {
    const l = r.left
    const t = r.top
    const rt = r.left + r.width
    const b = r.top + r.height
    const xs = xsOf(l, rt)
    const ys = ysOf(t, b)
    for (let k = 0; k < xs.length - 1; k++) {
      const mx = (xs[k]! + xs[k + 1]!) / 2
      // 内部恒在行进方向右侧（屏幕坐标 y 向下 → 顺时针环）
      if (!coveredByOther(mx, t - 0.5, i)) push({ x: xs[k]!, y: t }, { x: xs[k + 1]!, y: t }) // 上边 →
      if (!coveredByOther(mx, b + 0.5, i)) push({ x: xs[k + 1]!, y: b }, { x: xs[k]!, y: b }) // 下边 ←
    }
    for (let k = 0; k < ys.length - 1; k++) {
      const my = (ys[k]! + ys[k + 1]!) / 2
      if (!coveredByOther(rt + 0.5, my, i)) push({ x: rt, y: ys[k]! }, { x: rt, y: ys[k + 1]! }) // 右边 ↓
      if (!coveredByOther(l - 0.5, my, i)) push({ x: l, y: ys[k + 1]! }, { x: l, y: ys[k]! }) // 左边 ↑
    }
  })
  if (edges.length === 0) return ''

  // 起点 → 出边（并集边界每个端点通常恰好一条；T 形顶点容错为多值）
  const outMap = new Map<string, Edge[]>()
  for (const e of edges) {
    const k = key(e.from)
    const list = outMap.get(k)
    if (list) list.push(e)
    else outMap.set(k, [e])
  }

  const loops: Pt[][] = []
  for (const seed of edges) {
    if (seed.used) continue
    const loop: Pt[] = []
    let cur: Edge | undefined = seed
    let guard = 0
    while (cur && !cur.used && guard++ < edges.length + 2) {
      cur.used = true
      loop.push(cur.from)
      const next: Edge | undefined = (outMap.get(key(cur.to)) ?? []).find((e) => !e.used)
      cur = next
    }
    if (loop.length >= 3) loops.push(loop)
  }

  const fmt = (v: number) => `${Math.round(v * 100) / 100}`
  const parts: string[] = []
  for (const loop of loops) {
    const n = loop.length
    const segLen = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y)
    const unit = (a: Pt, b: Pt): Pt => {
      const d = segLen(a, b) || 1
      return { x: (b.x - a.x) / d, y: (b.y - a.y) / d }
    }
    let started = false
    for (let i = 0; i < n; i++) {
      const prev = loop[(i - 1 + n) % n]!
      const cur = loop[i]!
      const next = loop[(i + 1) % n]!
      const inV = unit(prev, cur)
      const outV = unit(cur, next)
      const cross = inV.x * outV.y - inV.y * outV.x
      let k = radius
      if (Math.abs(cross) < 0.01) k = 0
      k = Math.min(k, segLen(prev, cur) / 2, segLen(cur, next) / 2)
      // 视口边上的顶点不圆角（避免基础态整页洞在屏幕四角留暗角）
      if (cur.x <= onEdge || cur.y <= onEdge || cur.x >= W - onEdge || cur.y >= H - onEdge) k = 0
      const p1 = { x: cur.x - inV.x * k, y: cur.y - inV.y * k }
      const p2 = { x: cur.x + outV.x * k, y: cur.y + outV.y * k }
      if (!started) {
        parts.push(`M${fmt(p1.x)} ${fmt(p1.y)}`)
        started = true
      } else {
        parts.push(`L${fmt(p1.x)} ${fmt(p1.y)}`)
      }
      if (k > 0.01) {
        // 屏幕坐标 y 向下：cross>0 = 顺时针 → SVG sweep-flag 1
        parts.push(`A${fmt(k)} ${fmt(k)} 0 0 ${cross > 0 ? 1 : 0} ${fmt(p2.x)} ${fmt(p2.y)}`)
      }
    }
    parts.push('Z')
  }
  return parts.join(' ')
}
