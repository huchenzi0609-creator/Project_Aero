// 临时探针 6：同种子对比 normal vs hard 的逐机击杀步数与总步数
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

function probe(diff: Difficulty, aiRng: ReturnType<typeof mulberry32>, fleetRng: ReturnType<typeof mulberry32>): { shots: number; killTimes: number[] } {
  const fleet = generateFleet(W, H, N, DEFAULT_PLANE_SHAPE, 'easy', fleetRng)
  const cellMap = new Map<string, number>()
  for (const p of fleet) for (const c of occupiedCells(p, DEFAULT_PLANE_SHAPE)) cellMap.set(`${c.r},${c.c}`, p.id)
  const heads = new Map(fleet.map((p) => [headOf(p), p.id]))
  const alive = new Set(fleet.map((p) => p.id))
  const shots: ShotKnowledge['shots'] = []
  let count = 0
  const killTimes: number[] = []
  while (alive.size > 0 && count < 3000) {
    const cell = chooseShot({ width: W, height: H, shots, planeShape: DEFAULT_PLANE_SHAPE }, diff, aiRng)
    const key = `${cell.r},${cell.c}`
    const pid = cellMap.get(key)
    let outcome: 'miss' | 'hit' | 'kill' = 'miss'
    if (pid !== undefined && alive.has(pid)) {
      outcome = heads.get(key) === pid ? 'kill' : 'hit'
      if (outcome === 'kill') {
        alive.delete(pid)
        killTimes.push(count + 1)
      }
    }
    shots.push({ coord: cell, outcome })
    count++
  }
  return { shots: count, killTimes }
}

for (const diff of ['normal', 'hard', 'hell'] as Difficulty[]) {
  const G = 400
  let total = 0
  let k1 = 0
  let k2 = 0
  let k3 = 0
  for (let i = 0; i < G; i++) {
    const r = probe(diff, mulberry32(5000 + i), mulberry32(700000 + i))
    total += r.shots
    k1 += r.killTimes[0] ?? 0
    k2 += r.killTimes[1] ?? 0
    k3 += r.killTimes[2] ?? 0
  }
  console.log(diff, `总: ${(total / G).toFixed(2)}  首杀@${(k1 / G).toFixed(2)}  二杀@${(k2 / G).toFixed(2)}  三杀@${(k3 / G).toFixed(2)}`)
}
