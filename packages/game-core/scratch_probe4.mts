// 临时探针 4：分解 hard 的瓶颈 —— 首次命中前/后，并试验不同权重
import { DEFAULT_PLANE_SHAPE, type Difficulty } from '@aero/shared'
import { chooseShot, generateFleet, mulberry32, type ShotKnowledge } from './src/ai/index.js'
import { occupiedCells, rotateShape } from './src/index.js'

const W = 10
const H = 10
const N = 3

function headOf(plane: { rotation: 0 | 1 | 2 | 3; origin: { r: number; c: number } }): string {
  const h = rotateShape(DEFAULT_PLANE_SHAPE, plane.rotation).head
  return `${h.r + plane.origin.r},${h.c + plane.origin.c}`
}

interface ProbeResult {
  shots: number
  firstHitAt: number
}

function probe(diff: Difficulty, aiRng: ReturnType<typeof mulberry32>, fleetRng: ReturnType<typeof mulberry32>): ProbeResult {
  const fleet = generateFleet(W, H, N, DEFAULT_PLANE_SHAPE, 'easy', fleetRng)
  const cellMap = new Map<string, number>()
  for (const p of fleet) for (const c of occupiedCells(p, DEFAULT_PLANE_SHAPE)) cellMap.set(`${c.r},${c.c}`, p.id)
  const heads = new Map(fleet.map((p) => [headOf(p), p.id]))
  const alive = new Set(fleet.map((p) => p.id))
  const shots: ShotKnowledge['shots'] = []
  let count = 0
  let firstHitAt = -1
  while (alive.size > 0 && count < 3000) {
    const cell = chooseShot({ width: W, height: H, shots, planeShape: DEFAULT_PLANE_SHAPE }, diff, aiRng)
    const key = `${cell.r},${cell.c}`
    const pid = cellMap.get(key)
    let outcome: 'miss' | 'hit' | 'kill' = 'miss'
    if (pid !== undefined && alive.has(pid)) {
      outcome = heads.get(key) === pid ? 'kill' : 'hit'
      if (outcome === 'kill') alive.delete(pid)
    }
    if (outcome !== 'miss' && firstHitAt === -1) firstHitAt = count + 1
    shots.push({ coord: cell, outcome })
    count++
  }
  return { shots: count, firstHitAt }
}

function run(diff: Difficulty, G: number): void {
  let s = 0
  let fh = 0
  for (let i = 0; i < G; i++) {
    const r = probe(diff, mulberry32(5000 + i), mulberry32(700000 + i))
    s += r.shots
    fh += r.firstHitAt
  }
  console.log(diff, `平均报点: ${(s / G).toFixed(2)}  首次命中: ${(fh / G).toFixed(2)}`)
}

run('easy', 300)
run('normal', 300)
run('hard', 300)
run('hell', 300)
