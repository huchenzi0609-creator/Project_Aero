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
