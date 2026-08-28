// 临时探针 5：轨迹对比 hard vs normal 同一局中的报点序列
import { DEFAULT_PLANE_SHAPE, type Difficulty } from '@aero/shared'
import { chooseShot, generateFleet, mulberry32, type ShotKnowledge } from './src/ai/index.js'
import { occupiedCells, rotateShape, formatCoord } from './src/index.js'

const W = 10
const H = 10
const N = 3

function headOf(plane: { rotation: 0 | 1 | 2 | 3; origin: { r: number; c: number } }): string {
  const h = rotateShape(DEFAULT_PLANE_SHAPE, plane.rotation).head
  return `${h.r + plane.origin.r},${h.c + plane.origin.c}`
}

function trace(diff: Difficulty, seed: number): void {
  const fleet = generateFleet(W, H, N, DEFAULT_PLANE_SHAPE, 'easy', mulberry32(seed + 700000))
  console.log(`\n=== ${diff} seed=${seed} ===`)
  for (const p of fleet) console.log('  机队:', JSON.stringify(p), '机头', formatCoord({ r: p.origin.r, c: p.origin.c }))
  const cellMap = new Map<string, number>()
  for (const p of fleet) for (const c of occupiedCells(p, DEFAULT_PLANE_SHAPE)) cellMap.set(`${c.r},${c.c}`, p.id)
  const heads = new Map(fleet.map((p) => [headOf(p), p.id]))
  const alive = new Set(fleet.map((p) => p.id))
  const shots: ShotKnowledge['shots'] = []
  const rng = mulberry32(seed + 5000)
  for (let i = 0; i < 45; i++) {
    const cell = chooseShot({ width: W, height: H, shots, planeShape: DEFAULT_PLANE_SHAPE }, diff, rng)
    const key = `${cell.r},${cell.c}`
    const pid = cellMap.get(key)
    let outcome: 'miss' | 'hit' | 'kill' = 'miss'
    if (pid !== undefined && alive.has(pid)) {
      outcome = heads.get(key) === pid ? 'kill' : 'hit'
      if (outcome === 'kill') alive.delete(pid)
    }
    shots.push({ coord: cell, outcome })
    console.log(`  ${String(i + 1).padStart(2)} ${formatCoord(cell)} → ${outcome}${outcome !== 'miss' ? ' (机' + pid + ')' : ''}`)
    if (alive.size === 0) {
      console.log(`  --- 全歼于第 ${i + 1} 步`)
      return
    }
  }
  console.log('  --- 45 步未全歼')
}

trace('normal', 3)
trace('hard', 3)
