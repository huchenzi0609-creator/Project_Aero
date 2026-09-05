/**
 * online/protocol —— v0.3.0 联机扩展契约（本地类型层）。
 *
 * 背景：M5（服务端）与 M6（本客户端）并行开发，契约以派单 / docs/qa-checklist-v030.md 为准。
 * shared 包（packages/shared）的协议类型由 M5 侧负责扩展；在 shared 落地前，本文件按相同
 * 事件名与 payload 先行声明本地类型，落地后仅需把下列类型替换为 shared 导出（或删掉本文件
 * 改用 shared），事件处理无需改动。差异点见交付报告。
 */
import type { GridConfig, PlacedPlane } from '@aero/shared'

/* ---------- 模式与匹配 ---------- */

/** 勾选档位（棋盘宽高均为该值，正方形） */
export type MatchGridSize = 10 | 15 | 20

/** 单个匹配组合：网格尺寸 + 架数 + 模式开关（经典 = 双 false） */
export interface MatchCombo {
  gridSize: MatchGridSize
  planes: number
  blitz: boolean
  blind: boolean
}

/** 房间携带 v0.3 模式开关（经典模式两者为 false / 缺省） */
export interface GridConfigV030 extends GridConfig {
  blitz?: boolean
  blind?: boolean
}

/* ---------- v0.3 新增 Socket 事件（C→S / S→C） ---------- */

export interface QuickMatchWaitingPayload {
  /** 服务端匹配等待提示文案可选字段（预留） */
  message?: string
}

export interface RoomJoinedPayload {
  roomCode: string
  config: GridConfigV030
}

export interface ClockUpdatePayload {
  /** 0/1 席位；与 roomUpdate.players 下标一致 */
  player: 0 | 1
  /** 该席位剩余毫秒数 */
  ms: number
}

/** 结算原因扩展：超快棋超时判负 */
export type GameOverReason = 'blitz-timeout' | 'blitz-opp-timeout'

/** gameOver 事件 payload（v0.3 结算事件；与 v0.2 gameEnd 结构尽量对齐，由服务端填充） */
export interface GameOverPayload {
  winner: 0 | 1
  reason: GameOverReason
  layouts?: { player0: PlacedPlane[]; player1: PlacedPlane[] }
  stats?: {
    turnCount: number
    shotsFired: number
    hitCount: number
    killCount: number
  }
}

/** 服务端 → 客户端：v0.3 新增事件名与 payload */
export interface ServerV030Events {
  'match:waiting': (p: QuickMatchWaitingPayload) => void
  'room:joined': (p: RoomJoinedPayload) => void
  'clock:update': (p: ClockUpdatePayload) => void
  gameOver: (p: GameOverPayload) => void
}

/** 客户端 → 服务端：v0.3 新增事件名与 payload */
export interface ClientV030Events {
  'match:quick': (p: { combos: MatchCombo[] }) => void
  'match:cancel': () => void
}

/* ---------- v0.2 事件的重申（本层桥接用，与 shared 同构） ---------- */

export type LegacyServerEventName =
  | 'identity'
  | 'roomUpdate'
  | 'phaseChange'
  | 'turnStart'
  | 'shotResult'
  | 'timerUpdate'
  | 'machineTakeover'
  | 'opponentDisconnected'
  | 'opponentReconnected'
  | 'gameEnd'
