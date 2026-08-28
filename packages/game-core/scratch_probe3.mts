// 临时探针 3：正确模拟残骸=miss，测量各难度真实击毁报点数 + 完整对局中 AI 获胜时的 AI 报点数
import { DEFAULT_PLANE_SHAPE, type Difficulty } from '@aero/shared'
import { chooseShot, generateFleet, mulberry32, type ShotKnowledge } from './src/ai/index.js'
import { applyShot, createGame, setFleet, occupiedCells, rotateShape } from './src/index.js'

const W = 10
const H = 10
const N = 3

function headOf(plane: { rotation: 0 | 1 | 2 | 3; origin: { r: number; c: number } }): string {
  const h = rotateShape(DEFAULT_PLANE_SHAPE, plane.rotation).head
  return `${h.r + plane.origin.r},${h.c + plane.origin.c}`
}

// 纯射击测量：AI 独自击毁一个 easy 随机机队，残骸按 miss 反馈
function shotsToDestroy(diff: Difficulty, aiRng: ReturnType<typeof mulberry32>, fleetRng: ReturnType<typeof mulberry32>): number {
  const fleet = generateFleet(W, H, N, DEFAULT_PLANE_SHAPE, 'easy', fleetRng)
  const cellMap = new Map<string, number>() // key -> planeId
  for (const p of fleet) for (const c of occupiedCells(p, DEFAULT_PLANE_SHAPE)) cellMap.set(`${c.r},${c.c}`, p.id)
  const heads = new Map(fleet.map((p) => [headOf(p), p.id]))
  const alive = new Set(fleet.map((p) => p.id))
  const shots: ShotKnowledge['shots'] = []
  let count = 0
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
  }
  return count
}

for (const diff of ['easy', 'normal', 'hard', 'hell'] as Difficulty[]) {
  let total = 0
  const G = 300
  for (let i = 0; i < G; i++) total += shotsToDestroy(diff, mulberry32(5000 + i), mulberry32(700000 + i))
  console.log('纯射击', diff, '平均击毁报点数:', (total / G).toFixed(2))
}
