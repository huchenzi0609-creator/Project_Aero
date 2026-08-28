// 临时探针 8：打印 hard(cube加权) 与 normal 二杀之后(找第3架)的轨迹
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

function traceLastPhase(diff: Difficulty, seed: number): void {
  const fleet = generateFleet(W, H, N, DEFAULT_PLANE_SHAPE, 'easy', mulberry32(seed + 700000))
  const cellMap = new Map<string, number>()
  for (const p of fleet) for (const c of occupiedCells(p, DEFAULT_PLANE_SHAPE)) cellMap.set(`${c.r},${c.c}`, p.id)
  const heads = new Map(fleet.map((p) => [headOf(p), p.id]))
  const alive = new Set(fleet.map((p) => p.id))
  const shots: ShotKnowledge['shots'] = []
  const rng = mulberry32(seed + 5000)
  let kills = 0
  let line = ''
  for (let i = 0; i < 60; i++) {
    const cell = chooseShot({ width: W, height: H, shots, planeShape: DEFAULT_PLANE_SHAPE }, diff, rng)
    const key = `${cell.r},${cell.c}`
    const pid = cellMap.get(key)
    let outcome: 'miss' | 'hit' | 'kill' = 'miss'
    if (pid !== undefined && alive.has(pid)) {
      outcome = heads.get(key) === pid ? 'kill' : 'hit'
      if (outcome === 'kill') {
        alive.delete(pid)
        kills++
      }
    }
    shots.push({ coord: cell, outcome })
    if (kills >= 2) line += ` ${formatCoord(cell)}:${outcome === 'kill' ? 'K' : outcome === 'hit' ? 'H' : '.'}`
    if (alive.size === 0) {
      console.log(`${diff} seed=${seed} 全歼于 ${i + 1} 步；二杀后轨迹:${line}`)
      return
    }
  }
  console.log(`${diff} seed=${seed} 60 步未全歼；二杀后轨迹:${line}`)
}

traceLastPhase('normal', 7)
traceLastPhase('hard', 7)
traceLastPhase('normal', 9)
traceLastPhase('hard', 9)
