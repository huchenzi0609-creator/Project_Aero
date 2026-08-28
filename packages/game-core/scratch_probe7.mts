// 临时探针 7：参数扫描 —— 内联实现 chooseShot 变体，测击毁 3 机总步数
import { DEFAULT_PLANE_SHAPE } from '@aero/shared'
import { generateFleet, mulberry32, type ShotKnowledge, type Rng } from './src/ai/index.js'
import { occupiedCells, rotateShape } from './src/index.js'

const W = 10
const H = 10
const N = 3

const HIT_W = 8
const MISS_W = 2

function headOf(plane: { rotation: 0 | 1 | 2 | 3; origin: { r: number; c: number } }): string {
  const h = rotateShape(DEFAULT_PLANE_SHAPE, plane.rotation).head
  return `${h.r + plane.origin.r},${h.c + plane.origin.c}`
}

interface Variants {
  deadHit: 'boost' | 'half' | 'ignore' // 死 hit 在热图中的加权
  pruneHunt: boolean // 围杀候选是否剪掉死 hit
  excludeDensity: boolean // 密度候选是否排除残骸格
  pickMode: 'max' | 'linear' | 'square' | 'cube' // 密度选取方式
  uniform?: boolean // 搜索阶段纯均匀随机（不走热图）
}

function chooseVariant(knowledge: ShotKnowledge, rng: Rng, v: Variants): { r: number; c: number } {
  const shotMap = new Map<string, string>()
  for (const s of knowledge.shots) shotMap.set(`${s.coord.r},${s.coord.c}`, s.outcome)
  // 残骸多解
  const wreckage = new Set<string>()
  for (const s of knowledge.shots) {
    if (s.outcome !== 'kill') continue
    for (let rot = 0; rot < 4; rot++) {
      const r = rotateShape(knowledge.planeShape, rot as 0 | 1 | 2 | 3)
      const dr = s.coord.r - r.head.r
      const dc = s.coord.c - r.head.c
      for (const cell of r.cells) {
        const ar = cell.r + dr
        const ac = cell.c + dc
        if (ar >= 0 && ar < knowledge.height && ac >= 0 && ac < knowledge.width) wreckage.add(`${ar},${ac}`)
      }
    }
  }
  // 热图
  const scores = new Map<string, number>()
  for (let rot = 0; rot < 4; rot++) {
    const r = rotateShape(knowledge.planeShape, rot as 0 | 1 | 2 | 3)
    let maxR = -1
    let maxC = -1
    for (const c of r.cells) {
      if (c.r > maxR) maxR = c.r
      if (c.c > maxC) maxC = c.c
    }
    for (let r0 = 0; r0 <= knowledge.height - 1 - maxR; r0++) {
      for (let c0 = 0; c0 <= knowledge.width - 1 - maxC; c0++) {
        let weight = 1
        let invalid = false
        const covered: string[] = []
        for (const cell of r.cells) {
          const key = `${cell.r + r0},${cell.c + c0}`
          covered.push(key)
          const o = shotMap.get(key)
          if (!o) continue
          if (o === 'kill') {
            invalid = true
            break
          } else if (o === 'hit') {
            if (v.deadHit === 'ignore' && wreckage.has(key)) continue
            weight += v.deadHit === 'half' && wreckage.has(key) ? HIT_W / 2 : HIT_W
          } else {
            weight -= MISS_W
          }
        }
        if (invalid) continue
        for (const key of covered) scores.set(key, (scores.get(key) ?? 0) + weight)
      }
    }
  }
  for (const key of wreckage) {
    const cur = scores.get(key)
    if (cur !== undefined && cur > 0) scores.set(key, cur * 0.5)
  }
  // 围杀候选
  const shot = new Set(shotMap.keys())
  const seen = new Set<string>()
  const hunt: Array<{ r: number; c: number }> = []
  for (const s of knowledge.shots) {
    if (s.outcome !== 'hit') continue
    if (v.pruneHunt && wreckage.has(`${s.coord.r},${s.coord.c}`)) continue
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nr = s.coord.r + dr
      const nc = s.coord.c + dc
      const key = `${nr},${nc}`
      if (nr >= 0 && nr < knowledge.height && nc >= 0 && nc < knowledge.width && !shot.has(key) && !seen.has(key)) {
        seen.add(key)
        hunt.push({ r: nr, c: nc })
      }
    }
  }
  let pool: Array<{ r: number; c: number }>
  if (hunt.length > 0) {
    pool = hunt
  } else {
    const unshot: Array<{ r: number; c: number }> = []
    for (let r = 0; r < knowledge.height; r++) {
      for (let c = 0; c < knowledge.width; c++) {
        if (!shot.has(`${r},${c}`)) unshot.push({ r, c })
      }
    }
    pool = v.excludeDensity ? unshot.filter((cell) => !wreckage.has(`${cell.r},${cell.c}`)) : unshot
    if (pool.length === 0) pool = unshot
  }
  if (v.uniform && hunt.length === 0) {
    return pool[Math.floor(rng() * pool.length)]!
  }
  // 选取：max 最高分随机破平；linear/square/cube 按权重随机抽样（避免 max 粘滞）
  let best: Array<{ r: number; c: number; w: number }> = []
  let bestScore = -Infinity
  const weightOf = (sc: number): number => {
    if (v.pickMode === 'linear') return Math.max(sc, 0.5)
    if (v.pickMode === 'square') return Math.max(sc, 0.5) ** 2
    if (v.pickMode === 'cube') return Math.max(sc, 0.5) ** 3
    return 1
  }
  for (const cell of pool) {
    const sc = scores.get(`${cell.r},${cell.c}`) ?? 0
    if (v.pickMode === 'max') {
      if (sc > bestScore) {
        bestScore = sc
        best = [{ r: cell.r, c: cell.c, w: 1 }]
      } else if (sc === bestScore) {
        best.push({ r: cell.r, c: cell.c, w: 1 })
      }
    } else {
      best.push({ r: cell.r, c: cell.c, w: weightOf(sc) })
    }
  }
  if (v.pickMode === 'max') return best[Math.floor(rng() * best.length)]!
  let total = 0
  for (const b of best) total += b.w
  let x = rng() * total
  for (const b of best) {
    x -= b.w
    if (x <= 0) return { r: b.r, c: b.c }
  }
  return { r: best[best.length - 1]!.r, c: best[best.length - 1]!.c }
}

function shotsToDestroy(v: Variants, aiRng: ReturnType<typeof mulberry32>, fleetRng: ReturnType<typeof mulberry32>): number {
  const fleet = generateFleet(W, H, N, DEFAULT_PLANE_SHAPE, 'easy', fleetRng)
  const cellMap = new Map<string, number>()
  for (const p of fleet) for (const c of occupiedCells(p, DEFAULT_PLANE_SHAPE)) cellMap.set(`${c.r},${c.c}`, p.id)
  const heads = new Map(fleet.map((p) => [headOf(p), p.id]))
  const alive = new Set(fleet.map((p) => p.id))
  const shots: ShotKnowledge['shots'] = []
  let count = 0
  while (alive.size > 0 && count < 3000) {
    const cell = chooseVariant({ width: W, height: H, shots, planeShape: DEFAULT_PLANE_SHAPE }, aiRng, v)
    const key = `${cell.r},${cell.c}`
    const pid = cellMap.get(key)
    let outcome: 'miss' | 'hit' | 'kill' = 'miss'
    if (pid !== undefined && alive.has(pid)) {
      outcome = heads.get(key) === pid ? 'kill' : 'hit'
      if (outcome === 'kill') alive.delete(pid)
    }
    shots.push({ coord: cell, outcome })
    count++
  }
  return count
}

const combos: Array<[string, Variants]> = [
  // 搜索阶段选取方式 × 死hit处理 × 残骸排除
  ['boost+prune+rand+noexcl', { deadHit: 'boost', pruneHunt: true, excludeDensity: false, pickMode: 'max' }],
  ['boost+prune+linear+noexcl', { deadHit: 'boost', pruneHunt: true, excludeDensity: false, pickMode: 'linear' }],
  ['boost+prune+square+noexcl', { deadHit: 'boost', pruneHunt: true, excludeDensity: false, pickMode: 'square' }],
  ['boost+prune+cube+noexcl', { deadHit: 'boost', pruneHunt: true, excludeDensity: false, pickMode: 'cube' }],
  ['half+prune+square+noexcl', { deadHit: 'half', pruneHunt: true, excludeDensity: false, pickMode: 'square' }],
  ['half+prune+cube+noexcl', { deadHit: 'half', pruneHunt: true, excludeDensity: false, pickMode: 'cube' }],
  // 随机搜索（纯均匀，仅排除已报）
  ['boost+prune+rand_uniform', { deadHit: 'boost', pruneHunt: true, excludeDensity: false, pickMode: 'linear', uniform: true }],
  ['half+prune+rand_uniform', { deadHit: 'half', pruneHunt: true, excludeDensity: false, pickMode: 'linear', uniform: true }],
]

for (const [name, v] of combos) {
  const G = 300
  let total = 0
  for (let i = 0; i < G; i++) total += shotsToDestroy(v, mulberry32(5000 + i), mulberry32(700000 + i))
  console.log(name.padEnd(22), '平均击毁报点数:', (total / G).toFixed(2))
}
