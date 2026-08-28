/**
 * @aero/game-core/ai —— WIP 占位（M2 核心 Agent 将按 docs/game-core-api.md 契约实现本文件）。
 */
import type { Cell, Difficulty, PlaneShape, PlacedPlane, Shot } from '@aero/shared'

export type Rng = () => number

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

export interface ShotKnowledge {
  width: number
  height: number
  shots: Shot[]
  planeShape: PlaneShape
}

export function chooseShot(knowledge: ShotKnowledge, difficulty: Difficulty, rng: Rng): Cell {
  throw new Error('WIP: game-core AI 尚未实现（M2）')
}

export function generateFleet(
  width: number,
  height: number,
  planeCount: number,
  shape: PlaneShape,
  difficulty: Difficulty,
  rng: Rng,
): PlacedPlane[] {
  throw new Error('WIP: game-core AI 尚未实现（M2）')
}
