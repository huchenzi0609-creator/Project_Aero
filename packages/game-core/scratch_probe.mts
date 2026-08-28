// 临时探针：测量各难度 AI 击毁一个随机机队所需的报点数（AI 独自射击，只消费自身报点知识）
import { DEFAULT_PLANE_SHAPE } from '@aero/shared'
import { chooseShot, generateFleet, mulberry32, type ShotKnowledge } from './src/ai/index.js'
import { occupiedCells } from './src/index.js'

const W = 10
const H = 10
const N = 3

function shotsToDestroy(diff: string, aiRng: ReturnType<typeof mulberry32>, fleetRng: ReturnType<typeof mulberry32>): number {
  const fleet = generateFleet(W, H, N, DEFAULT_PLANE_SHAPE, 'easy', fleetRng)
  const cells = fleet.flatMap((p) => occupiedCells(p, DEFAULT_PLANE_SHAPE).map((c) => `${c.r},${c.c}`))
  const cellSet = new Set(cells)
  const headCells = new Set(
    fleet.map((p) => {
      const cs = occupiedCells(p, DEFAULT_PLANE_SHAPE)
      const rotated = rotateShape(DEFAULT_PLANE_SHAPE, p.rotation).head
      return `${rotated.r + p.origin.r},${rotated.c + p.origin.c}`
    }),
  )
  const alive = new Set(fleet.map((p) => p.id))
  const shots: ShotKnowledge['shots'] = []
  let count = 0
  while (alive.size > 0 && count < 2000) {
    const cell = chooseShot({ width: W, height: H, shots, planeShape: DEFAULT_PLANE_SHAPE }, diff as any, aiRng)
    const key = `${cell.r},${cell.c}`
    let outcome: 'miss' | 'hit' | 'kill' = 'miss'
    if (cellSet.has(key)) {
      outcome = headCells.has(key) ? 'kill' : 'hit'
      if (outcome === 'kill') {
        // 找出机头在该格的飞机并击毁
        for (const p of fleet) {
          const cs = occupiedCells(p, DEFAULT_PLANE_SHAPE)
          const rotated = rotateShape(DEFAULT_PLANE_SHAPE, p.rotation).head
          if (`${rotated.r + p.origin.r},${rotated.c + p.origin.c}` === key && alive.has(p.id)) {
            alive.delete(p.id)
          }
        }
      }
    }
    shots.push({ coord: cell, outcome })
    count++
  }
  return count
}

function rotateShape(shape: any, times: number) {
  const t = ((times % 4) + 4) % 4
  let cells = shape.cells.map((c: any) => ({ ...c }))
  let head = { ...shape.head }
  for (let i = 0; i < t; i++) {
    cells = cells.map((c: any) => ({ r: c.c, c: 4 - c.r }))
    head = { r: head.c, c: 4 - head.r }
  }
  return { cells, head }
}

for (const diff of ['easy', 'normal', 'hard', 'hell']) {
  let total = 0
  const G = 300
  for (let i = 0; i < G; i++) {
    total += shotsToDestroy(diff, mulberry32(5000 + i), mulberry32(700000 + i))
  }
  console.log(diff, '平均击毁报点数:', (total / G).toFixed(2))
}
