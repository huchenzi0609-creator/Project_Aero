/**
 * @aero/game-core —— WIP 占位（M1 核心 Agent 将按 docs/game-core-api.md 契约实现本文件）。
 * 占位目的：让 apps/server、apps/web 在 M1 完成前即可按契约通过类型检查。
 */
import type {
  Cell,
  Difficulty,
  GridConfig,
  PlaneShape,
  PlacedPlane,
  Rotation,
  Shot,
  ShotOutcome,
} from '@aero/shared'

export type { Cell, PlaneShape, PlacedPlane, Rotation, Shot, ShotOutcome, GridConfig, Difficulty } from '@aero/shared'

export const SHAPE_SIZE = 5

const WIP = (): never => {
  throw new Error('WIP: game-core 尚未实现（M1）')
}

export function normalizeShape(shape: PlaneShape): PlaneShape {
  return WIP()
}
export function validateShape(shape: PlaneShape): { ok: true } | { ok: false; errors: string[] } {
  return WIP()
}
export function rotateShape(shape: PlaneShape, times: Rotation): PlaneShape {
  return WIP()
}
export function boundingBox(shape: PlaneShape, rotation: Rotation): { w: number; h: number } {
  return WIP()
}
export function occupiedCells(plane: PlacedPlane, shape: PlaneShape): Cell[] {
  return WIP()
}
export function inBounds(coord: Cell, width: number, height: number): boolean {
  return WIP()
}
export function parseCoord(input: string): Cell | null {
  return WIP()
}
export function formatCoord(coord: Cell): string {
  return WIP()
}
export function validateFleet(
  width: number,
  height: number,
  planeCount: number,
  shape: PlaneShape,
  planes: PlacedPlane[],
): { ok: true } | { ok: false; errors: string[] } {
  return WIP()
}

export interface PlayerBoard {
  width: number
  height: number
  shape: PlaneShape
  planes: PlacedPlane[]
  destroyedPlaneIds: number[]
  receivedShots: Shot[]
  shotsFired: Shot[]
}

export type GamePhase = 'placing' | 'playing' | 'counterattack' | 'ended'

export interface GameState {
  phase: GamePhase
  players: [PlayerBoard, PlayerBoard]
  turn: 0 | 1
  firstMover: 0 | 1
  turnNo: number
  winner: 0 | 1 | null
}

export function createGame(
  width: number,
  height: number,
  shape: PlaneShape,
  planeCount: number,
  firstMover: 0 | 1,
): GameState {
  return WIP()
}
export function setFleet(
  state: GameState,
  player: 0 | 1,
  planes: PlacedPlane[],
): { ok: true; state: GameState } | { ok: false; errors: string[] } {
  return WIP()
}
export function isGameOver(state: GameState): boolean {
  return WIP()
}
export function remainingPlanes(board: PlayerBoard): number {
  return WIP()
}

export interface ShotResult {
  ok: boolean
  error?: string
  outcome?: ShotOutcome
  killedPlaneId?: number
  state?: GameState
  winner?: 0 | 1 | null
}

export function applyShot(state: GameState, coord: Cell): ShotResult {
  return WIP()
}
