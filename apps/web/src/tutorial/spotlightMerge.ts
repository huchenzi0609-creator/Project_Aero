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
  const rs = rects.filter((r) => r.width > 0.01 && r.height > 0.01)
  if (rs.length <= 1) return rs.map((r) => ({ ...r }))
  const xs = Array.from(new Set(rs.flatMap((r) => [r.left, r.left + r.width]))).sort((a, b) => a - b)
  const out: BoxRect[] = []
  for (let i = 0; i < xs.length - 1; i++) {
    const x0 = xs[i]!
    const x1 = xs[i + 1]!
    const w = x1 - x0
    if (w <= 0.01) continue
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
