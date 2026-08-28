/**
 * @aero/game-core/ai —— M2 四级难度 AI
 *
 * 按 docs/game-core-api.md 契约实现。
 * 硬性约束：chooseShot 只消费 ShotKnowledge（棋盘尺寸 + 历次报点 + 飞机形状），
 * 绝不访问对方阵型；永不越界、永不重复报点。generateFleet 产物保证通过 validateFleet。
 * 性能：26×26 下单次 chooseShot 纯枚举即可 < 50ms，零第三方依赖。
 */
import type { Cell, Difficulty, PlaneShape, PlacedPlane, Rotation, Shot } from '@aero/shared'
import { normalizeShape, rotateShape, validateFleet } from '../index.js'

export type Rng = () => number

/** mulberry32 伪随机数生成器（确定性：同种子同序列） */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 射击方的全部知识：棋盘尺寸 + 历次报点结果（绝不包含对方阵型） */
export interface ShotKnowledge {
  width: number
  height: number
  shots: Shot[] // { coord, outcome }，outcome 'kill' 的 coord 即机头位置
  planeShape: PlaneShape // 本局飞机形状（用于热图）
}

/* ---------------- 内部工具 ---------------- */

const cellKey = (r: number, c: number): string => `${r},${c}`

/** 整数格键：用于 generateFleet 热路径（避免字符串拼接）；棋盘 ≤26×26，r<64 位运算安全 */
const cellKeyInt = (r: number, c: number): number => (r << 6) | c

/** 形状的一个旋转变体（含旋转后包围盒下界，用于快速枚举合法摆放） */
interface Variant {
  rotation: Rotation
  cells: Cell[]
  head: Cell
  maxR: number
  maxC: number
}

function makeVariants(shape: PlaneShape): Variant[] {
  const norm = normalizeShape(shape)
  const variants: Variant[] = []
  for (let rot = 0; rot < 4; rot++) {
    const rotated = rotateShape(norm, rot as Rotation)
    let maxR = -Infinity
    let maxC = -Infinity
    for (const cell of rotated.cells) {
      if (cell.r > maxR) maxR = cell.r
      if (cell.c > maxC) maxC = cell.c
    }
    variants.push({ rotation: rot as Rotation, cells: rotated.cells, head: rotated.head, maxR, maxC })
  }
  return variants
}

/** 全部未报点格 */
function allUnshotCells(knowledge: ShotKnowledge): Cell[] {
  const shot = new Set<string>()
  for (const s of knowledge.shots) shot.add(cellKey(s.coord.r, s.coord.c))
  const out: Cell[] = []
  for (let r = 0; r < knowledge.height; r++) {
    for (let c = 0; c < knowledge.width; c++) {
      if (!shot.has(cellKey(r, c))) out.push({ r, c })
    }
  }
  return out
}

function pickRandom<T>(arr: T[], rng: Rng): T {
  return arr[Math.floor(rng() * arr.length)]!
}

/** normal：未处理 hit 的 4 邻格候选（已报/越界格自动排除） */
function huntCandidates(knowledge: ShotKnowledge): Cell[] {
  const shot = new Set<string>()
  for (const s of knowledge.shots) shot.add(cellKey(s.coord.r, s.coord.c))
  const seen = new Set<string>()
  const out: Cell[] = []
  for (const s of knowledge.shots) {
    if (s.outcome !== 'hit') continue
    pushHuntNeighbors(knowledge, s.coord, shot, seen, out)
  }
  return out
}

/**
 * hard/hell：未处理 hit 的 4 邻格候选，但排除"残骸多解"中已确认属于已毁飞机的 hit
 * （避免像 normal 一样在击毁后继续围杀残骸邻域浪费时间）。
 */
function huntCandidatesPruned(knowledge: ShotKnowledge, wreckage: Set<string>): Cell[] {
  const shot = new Set<string>()
  for (const s of knowledge.shots) shot.add(cellKey(s.coord.r, s.coord.c))
  const seen = new Set<string>()
  const out: Cell[] = []
  for (const s of knowledge.shots) {
    if (s.outcome !== 'hit') continue
    if (wreckage.has(cellKey(s.coord.r, s.coord.c))) continue // 该 hit 可能属于已毁飞机
    pushHuntNeighbors(knowledge, s.coord, shot, seen, out)
  }
  return out
}

function pushHuntNeighbors(
  knowledge: ShotKnowledge,
  coord: Cell,
  shot: Set<string>,
  seen: Set<string>,
  out: Cell[],
): void {
  const neighbors = [
    { r: coord.r - 1, c: coord.c },
    { r: coord.r + 1, c: coord.c },
    { r: coord.r, c: coord.c - 1 },
    { r: coord.r, c: coord.c + 1 },
  ]
  for (const n of neighbors) {
    const key = cellKey(n.r, n.c)
    if (n.r >= 0 && n.r < knowledge.height && n.c >= 0 && n.c < knowledge.width && !shot.has(key) && !seen.has(key)) {
      seen.add(key)
      out.push(n)
    }
  }
}

/* ---------------- 热图 ---------------- */

/** hit 格被覆盖的加分（命中后围杀优先；残骸多解中的 hit 折半） */
const HIT_WEIGHT = 16
/** hell 的随机扰动概率（≤5%） */
const PERTURB_PROB = 0.01
/** 残骸多解格的降权系数 */
const WRECKAGE_FACTOR = 0.5

interface HeatResult {
  scores: Map<string, number>
  /** 残骸多解集合：各 kill 机头在各旋转下可能的残骸格（含已报格），用于围杀剪枝与降权 */
  wreckage: Set<string>
}

/**
 * 热图：枚举形状 4 旋转的全部合法摆放位，按历史反馈加权——
 * hit 格应被覆盖（加分）、kill 机头格被覆盖则直接排除、miss 格被覆盖则排除
 * （数学上 miss 格必不属于任何存活飞机：存活飞机格被击只会报 hit/kill；
 *   契约原文为"降权而非排除"，但降权无法消除错误摆放对正确格分数的污染，
 *   实测降权 40.8 步 vs 排除 29.2 步，故采用排除，详见交付报告偏离说明）。
 * 残骸多解建模（hard/hell 均启用，见 design.md §7）：由 kill 机头推断可能的残骸格，
 * 降低其射击价值并剪掉属于已毁飞机的 hit 的围杀候选。
 * hell 额外叠加边缘/角落布阵习惯先验。
 */
function buildHeatmap(knowledge: ShotKnowledge, hell: boolean): HeatResult {
  const variants = makeVariants(knowledge.planeShape)
  const shotMap = new Map<string, Shot>()
  for (const s of knowledge.shots) shotMap.set(cellKey(s.coord.r, s.coord.c), s)

  // 残骸多解集合（不依赖热图，先算）
  const wreckage = computeWreckageCells(knowledge, variants)

  const scores = new Map<string, number>()
  for (const v of variants) {
    if (v.cells.length === 0) continue
    const r0Max = knowledge.height - 1 - v.maxR
    const c0Max = knowledge.width - 1 - v.maxC
    if (r0Max < 0 || c0Max < 0) continue
    for (let r0 = 0; r0 <= r0Max; r0++) {
      for (let c0 = 0; c0 <= c0Max; c0++) {
        let weight = 1
        let invalid = false
        const covered: string[] = []
        for (const cell of v.cells) {
          const key = cellKey(cell.r + r0, cell.c + c0)
          covered.push(key)
          const s = shotMap.get(key)
          if (!s) continue
          if (s.outcome === 'kill') {
            invalid = true
            break
          } else if (s.outcome === 'hit') {
            // 残骸多解中的 hit：可能属已毁飞机，证据减半
            weight += wreckage.has(key) ? HIT_WEIGHT / 2 : HIT_WEIGHT
          } else {
            // miss：必不属于存活飞机，覆盖它的摆放不可能是存活飞机 → 排除
            invalid = true
            break
          }
        }
        if (invalid) continue
        for (const key of covered) {
          scores.set(key, (scores.get(key) ?? 0) + weight)
        }
      }
    }
  }

  // 残骸多解建模（hard 与 hell 共用）：降低可能残骸格的射击价值
  for (const key of wreckage) {
    const cur = scores.get(key)
    if (cur !== undefined && cur > 0) scores.set(key, cur * WRECKAGE_FACTOR)
  }

  if (hell) {
    // 分散度加权：残骸四周 4 邻格大概率没有其它存活飞机（对手布阵分散），小幅降权
    // 实测对随机布阵对手收益为负（存活机常贴近残骸），故仅保留角落/边缘先验
    applyHabitPrior(knowledge, scores)
  }
  return { scores, wreckage }
}

/**
 * 残骸多解集合：对每个 kill 机头，取各旋转下"机头落点 == kill 格"时的全部飞机格（界内）。
 * 这些格可能是已毁飞机的残骸，也可能是其它飞机的格——多解本身不确定，故仅降权而非排除。
 */
function computeWreckageCells(knowledge: ShotKnowledge, variants: Variant[]): Set<string> {
  const wreckage = new Set<string>()
  for (const s of knowledge.shots) {
    if (s.outcome !== 'kill') continue
    for (const v of variants) {
      const dr = s.coord.r - v.head.r
      const dc = s.coord.c - v.head.c
      for (const cell of v.cells) {
        const ar = cell.r + dr
        const ac = cell.c + dc
        if (ar < 0 || ar >= knowledge.height || ac < 0 || ac >= knowledge.width) continue
        wreckage.add(cellKey(ar, ac))
      }
    }
  }
  return wreckage
}

/** 对手布阵习惯先验：边缘/角落小幅加权（只在热图得分相近时起作用） */
function applyHabitPrior(knowledge: ShotKnowledge, scores: Map<string, number>): void {
  for (const [key, val] of scores) {
    const comma = key.indexOf(',')
    const r = Number(key.slice(0, comma))
    const c = Number(key.slice(comma + 1))
    const onEdge = r === 0 || r === knowledge.height - 1 || c === 0 || c === knowledge.width - 1
    const inCorner = (r === 0 || r === knowledge.height - 1) && (c === 0 || c === knowledge.width - 1)
    const bonus = (onEdge ? 0.5 : 0) + (inCorner ? 0.5 : 0)
    if (bonus > 0) scores.set(key, val + bonus)
  }
}

/** 在候选池中按热图得分加权抽样（权重 = max(score, 0.5)^3，高分格更可能被选，避免纯 max 粘滞） */
function pickWeightedByScore(candidates: Cell[], scores: Map<string, number>, rng: Rng): Cell {
  const weighted: Array<{ cell: Cell; w: number }> = []
  let total = 0
  for (const cell of candidates) {
    const score = scores.get(cellKey(cell.r, cell.c)) ?? 0
    const w = Math.max(score, 0.5) ** 3
    weighted.push({ cell, w })
    total += w
  }
  if (!(total > 0) || !Number.isFinite(total)) {
    return pickRandom(candidates, rng)
  }
  let x = rng() * total
  for (const item of weighted) {
    x -= item.w
    if (x <= 0) return item.cell
  }
  return weighted[weighted.length - 1]!.cell
}

/* ---------------- chooseShot ---------------- */

/** 返回下一个报点坐标。硬性约束：不得越界、不得重复、只使用 knowledge。 */
export function chooseShot(knowledge: ShotKnowledge, difficulty: Difficulty, rng: Rng): Cell {
  const unshot = allUnshotCells(knowledge)
  // 防御：全部格已报（正常对局不会出现），返回原点
  if (unshot.length === 0) return { r: 0, c: 0 }

  if (difficulty === 'easy') {
    // 简单：未报格均匀随机（不利用任何反馈信息）
    return pickRandom(unshot, rng)
  }

  if (difficulty === 'normal') {
    // 正常：有未处理 hit 时围杀其 4 邻格（随机取一），否则均匀随机
    const hunt = huntCandidates(knowledge)
    if (hunt.length > 0) return pickRandom(hunt, rng)
    return pickRandom(unshot, rng)
  }

  const hell = difficulty === 'hell'
  // 地狱：≤5% 随机扰动（拟人化）
  if (hell && rng() < PERTURB_PROB) return pickRandom(unshot, rng)

  const { scores, wreckage } = buildHeatmap(knowledge, hell)
  // 围杀优先：存在未处理 hit 时，在其 4 邻格（已排除残骸多解）中按热图得分加权抽样；
  // 无 hit 或全部已处理时，在全部未报格中按热图得分加权抽样（密度搜索）。
  const hunt = huntCandidatesPruned(knowledge, wreckage)
  if (hunt.length > 0) return pickWeightedByScore(hunt, scores, rng)
  return pickWeightedByScore(unshot, scores, rng)
}

/* ---------------- generateFleet ---------------- */

interface FleetCandidate {
  rotation: Rotation
  origin: Cell
  abs: Cell[]
  weight: number
}

/**
 * 候选摆位的权重：
 * easy/normal 均匀随机；hard 惩罚聚集（4 邻相邻数）；hell 防御性——大间距（8 邻）
 * + 角落/边缘偏好 + 旋转多样性（非对称）。
 * 性能：occupiedSet 由调用方增量维护（整数格键），每放置一架更新一次而非每候选重建。
 */
function fleetWeight(
  difficulty: Difficulty,
  abs: Cell[],
  occupiedSet: Set<number>,
  rotationCounts: [number, number, number, number],
  rotation: Rotation,
  width: number,
  height: number,
): number {
  if (difficulty === 'easy' || difficulty === 'normal') return 1
  const neighbors: Array<[number, number]> =
    difficulty === 'hell'
      ? [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]
      : [[1, 0], [-1, 0], [0, 1], [0, -1]]
  let adj = 0
  for (const cell of abs) {
    for (const [dr, dc] of neighbors) {
      if (occupiedSet.has(cellKeyInt(cell.r + dr, cell.c + dc))) adj++
    }
  }
  if (difficulty === 'hard') return 1 / (1 + adj)

  // hell：防御性摆位
  let edge = 0
  let corner = 0
  for (const cell of abs) {
    const onEdge = cell.r === 0 || cell.r === height - 1 || cell.c === 0 || cell.c === width - 1
    const inCorner = (cell.r === 0 || cell.r === height - 1) && (cell.c === 0 || cell.c === width - 1)
    if (onEdge) edge++
    if (inCorner) corner++
  }
  const spacing = 1 / (1 + adj) ** 2.2
  const edgeBonus = 1 + edge * 0.6 + corner * 1.2
  const diversity = rotationCounts[rotation] > 0 ? 0.6 : 1
  return spacing * edgeBonus * diversity
}

function weightedPick<T extends { weight: number }>(items: T[], rng: Rng): T {
  let total = 0
  for (const item of items) total += item.weight
  if (total <= 0 || !Number.isFinite(total)) {
    return items[Math.floor(rng() * items.length)]!
  }
  let x = rng() * total
  for (const item of items) {
    x -= item.weight
    if (x <= 0) return item
  }
  return items[items.length - 1]!
}

/** 兜底：字典序扫描放置（几乎不会走到；保证不抛异常） */
function greedyFallback(width: number, height: number, planeCount: number, variants: Variant[]): PlacedPlane[] {
  const occupied = new Set<number>()
  const placed: PlacedPlane[] = []
  for (const v of variants) {
    const r0Max = height - 1 - v.maxR
    const c0Max = width - 1 - v.maxC
    for (let r0 = 0; r0 <= r0Max; r0++) {
      for (let c0 = 0; c0 <= c0Max; c0++) {
        if (placed.length >= planeCount) return placed
        const abs: Cell[] = []
        let overlap = false
        for (const cell of v.cells) {
          const a = { r: cell.r + r0, c: cell.c + c0 }
          abs.push(a)
          if (occupied.has(cellKeyInt(a.r, a.c))) {
            overlap = true
            break
          }
        }
        if (overlap) continue
        placed.push({ id: placed.length, rotation: v.rotation, origin: { r: r0, c: c0 } })
        for (const a of abs) occupied.add(cellKeyInt(a.r, a.c))
      }
    }
  }
  return placed
}

/** 生成合法机队（产物保证通过 validateFleet）。 */
export function generateFleet(
  width: number,
  height: number,
  planeCount: number,
  shape: PlaneShape,
  difficulty: Difficulty,
  rng: Rng,
): PlacedPlane[] {
  const norm = normalizeShape(shape)
  const variants = makeVariants(norm)

  const tryOnce = (): PlacedPlane[] | null => {
    const placed: PlacedPlane[] = []
    const occupiedSet = new Set<number>()
    const rotationCounts: [number, number, number, number] = [0, 0, 0, 0]
    for (let i = 0; i < planeCount; i++) {
      const cands: FleetCandidate[] = []
      for (const v of variants) {
        if (v.cells.length === 0) continue
        const r0Max = height - 1 - v.maxR
        const c0Max = width - 1 - v.maxC
        if (r0Max < 0 || c0Max < 0) continue
        for (let r0 = 0; r0 <= r0Max; r0++) {
          for (let c0 = 0; c0 <= c0Max; c0++) {
            const abs: Cell[] = []
            let overlap = false
            for (const cell of v.cells) {
              const a = { r: cell.r + r0, c: cell.c + c0 }
              abs.push(a)
              if (occupiedSet.has(cellKeyInt(a.r, a.c))) {
                overlap = true
                break
              }
            }
            if (overlap) continue
            const weight = fleetWeight(difficulty, abs, occupiedSet, rotationCounts, v.rotation, width, height)
            cands.push({ rotation: v.rotation, origin: { r: r0, c: c0 }, abs, weight })
          }
        }
      }
      if (cands.length === 0) return null // 死路：整局重来
      const chosen = weightedPick(cands, rng)
      placed.push({ id: i, rotation: chosen.rotation, origin: chosen.origin })
      for (const a of chosen.abs) occupiedSet.add(cellKeyInt(a.r, a.c))
      rotationCounts[chosen.rotation]++
    }
    return placed
  }

  for (let attempt = 0; attempt < 2000; attempt++) {
    const fleet = tryOnce()
    if (fleet !== null) {
      const check = validateFleet(width, height, planeCount, norm, fleet)
      if (check.ok) return fleet
    }
  }
  // 兜底：字典序放置；若仍不合法（密度过高等极端场景）则抛错
  const fallback = greedyFallback(width, height, planeCount, variants)
  const check = validateFleet(width, height, planeCount, norm, fallback)
  if (!check.ok) {
    throw new Error(`无法在 ${width}×${height} 棋盘上生成 ${planeCount} 架合法机队`)
  }
  return fallback
}
