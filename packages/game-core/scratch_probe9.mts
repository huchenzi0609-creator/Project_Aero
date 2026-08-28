// 临时探针 9：量化 k2→k3 阶段 —— 首命中延迟 / 命中数 / miss 数
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

function probeLastPhase(diff: Difficulty, aiRng: ReturnType<typeof mulberry32>, fleetRng: ReturnType<typeof mulberry32>): { total: number; firstHitLatency: number; phaseLen: number } {
  const fleet = generateFleet(W, H, N, DEFAULT_PLANE_SHAPE, 'easy', fleetRng)
  const cellMap = new Map<string, number>()
  for (const p of fleet) for (const c of occupiedCells(p, DEFAULT_PLANE_SHAPE)) cellMap.set(`${c.r},${c.c}`, p.id)
  const heads = new Map(fleet.map((p) => [headOf(p), p.id]))
  const alive = new Set(fleet.map((p) => p.id))
  const shots: ShotKnowledge['shots'] = []
  let count = 0
  let phaseLen = 0
  let firstHitLatency = -1
  const lastPlaneId = -1
  void lastPlaneId
  while (alive.size > 0 && count < 3000) {
    const cell = chooseShot({ width: W, height: H, shots, planeShape: DEFAULT_PLANE_SHAPE }, diff, aiRng)
    const key = `${cell.r},${cell.c}`
    const pid = cellMap.get(key)
    let outcome: 'miss' | 'hit' | 'kill' = 'miss'
    if (pid !== undefined && alive.has(pid)) {
      outcome = heads.get(key) === pid ? 'kill' : 'hit'
      if (outcome === 'kill') alive.delete(pid)
    }
    shots.push({ coord: cell, outcome })
    count++
    if (alive.size === 1) {
      // 进入最后一架阶段
      phaseLen++
      if (outcome !== 'miss' && firstHitLatency === -1) firstHitLatency = phaseLen
    }
  }
  return { total: count, firstHitLatency, phaseLen }
}

for (const diff of ['easy', 'normal', 'hard'] as Difficulty[]) {
  const G = 400
  let total = 0
  let phase = 0
  let fh = 0
  let fhOk = 0
  for (let i = 0; i < G; i++) {
    const r = probeLastPhase(diff, mulberry32(5000 + i), mulberry32(700000 + i))
    total += r.total
    phase += r.phaseLen
    if (r.firstHitLatency > 0) {
      fh += r.firstHitLatency
      fhOk++
    }
  }
  console.log(
    diff,
    `总: ${(total / G).toFixed(2)}`,
    `最后一架阶段: ${(phase / G).toFixed(2)}`,
    `阶段内首命中延迟: ${(fh / Math.max(fhOk, 1)).toFixed(2)}`,
  )
}
