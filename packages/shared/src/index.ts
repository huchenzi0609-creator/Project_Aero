import { z } from 'zod'

/* ---------- 基础类型 ---------- */

/** 0-based 格位；棋盘 (0,0) 在左上 */
export interface Cell {
  r: number
  c: number
}

/** 飞机形状，以 5×5 编辑器坐标系（0..4）描述 */
export interface PlaneShape {
  cells: Cell[]
  head: Cell
}

export type Rotation = 0 | 1 | 2 | 3

/** 摆放后的飞机：origin 为旋转后包围盒左上角在棋盘中的位置 */
export interface PlacedPlane {
  id: number
  rotation: Rotation
  origin: Cell
}

export type ShotOutcome = 'miss' | 'hit' | 'kill'

export interface Shot {
  coord: Cell
  outcome: ShotOutcome
}

export type Difficulty = 'easy' | 'normal' | 'hard' | 'hell'
export type GameMode = 'small' | 'medium' | 'large' | 'custom'
export type GamePhase = 'placing' | 'playing' | 'counterattack' | 'ended'

/* ---------- 常量 ---------- */

export const GRID_MIN = 10
export const GRID_MAX = 26
export const SHAPE_SIZE = 5
export const SHAPE_MIN_CELLS = 2
export const SHAPE_MAX_CELLS = 15

/** 联机计时（围棋读秒制） */
export const TURN_LIMIT_MS = 30_000
export const OVERTIME_CHANCES = 3
export const REDUCED_TURN_LIMIT_MS = 10_000
export const RECONNECT_GRACE_MS = 60_000
export const MACHINE_TAKEOVER_DIFFICULTY: Difficulty = 'normal'

/** 默认飞机：4 行 × 5 列，共 10 格（机头 1、机翼 5、机身 1、机尾 3） */
export const DEFAULT_PLANE_SHAPE: PlaneShape = {
  cells: [
    { r: 0, c: 2 },
    { r: 1, c: 0 },
    { r: 1, c: 1 },
    { r: 1, c: 2 },
    { r: 1, c: 3 },
    { r: 1, c: 4 },
    { r: 2, c: 2 },
    { r: 3, c: 1 },
    { r: 3, c: 2 },
    { r: 3, c: 3 },
  ],
  head: { r: 0, c: 2 },
}

export interface GridConfig {
  width: number
  height: number
  planeCount: number
  shape: PlaneShape
  /** 是否允许在对局中拖拽移动样式参考飞机；缺省时由客户端设置项（默认 true）决定 */
  allowMoveRefPlane?: boolean
}

export const PRESETS: Record<'small' | 'medium' | 'large', GridConfig> = {
  small: { width: 10, height: 10, planeCount: 3, shape: DEFAULT_PLANE_SHAPE },
  medium: { width: 15, height: 15, planeCount: 5, shape: DEFAULT_PLANE_SHAPE },
  large: { width: 20, height: 20, planeCount: 7, shape: DEFAULT_PLANE_SHAPE },
}

export const PRESET_LABELS: Record<'small' | 'medium' | 'large', string> = {
  small: '10×10，3架飞机',
  medium: '15×15，5架飞机',
  large: '20×20，7架飞机',
}

/* ---------- zod schema（运行时校验） ---------- */

export const cellSchema = z.object({
  r: z.number().int().min(0),
  c: z.number().int().min(0),
})

export const planeShapeSchema = z.object({
  cells: z.array(cellSchema).min(1).max(SHAPE_MAX_CELLS),
  head: cellSchema,
})

export const placedPlaneSchema = z.object({
  id: z.number().int().nonnegative(),
  rotation: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  origin: cellSchema,
})

export const gridConfigSchema = z.object({
  width: z.number().int().min(GRID_MIN).max(GRID_MAX),
  height: z.number().int().min(GRID_MIN).max(GRID_MAX),
  planeCount: z.number().int().min(1),
  shape: planeShapeSchema,
  allowMoveRefPlane: z.boolean().optional(),
})

export const coordInputSchema = z
  .string()
  .regex(/^[A-Za-z]\d{1,2}$/, '坐标格式应为字母+数字，如 A5')

export const difficultySchema = z.enum(['easy', 'normal', 'hard', 'hell'])

/* ---------- 身份 ---------- */

export interface GuestIdentity {
  id: string
  name: string
  token: string
}

/** 前端 localStorage 中保存游客 token 的键名（web 与 server 契约） */
export const GUEST_TOKEN_KEY = 'aero:guest:token'

/** 房间码长度（6 位大写字母数字） */
export const ROOM_CODE_LENGTH = 6

/* ---------- Socket.IO 事件协议 ---------- */

export type Ack<T = { ok: boolean; error?: string }> = (res: T) => void

export interface RoomSummary {
  code: string
  config: GridConfig
  players: Array<{
    index: 0 | 1
    name: string
    ready: boolean
    connected: boolean
  }>
  phase: GamePhase
}

export interface RoomUpdate extends RoomSummary {
  you: 0 | 1
}

export interface ShotResultPayload {
  by: 'you' | 'opponent'
  coord: Cell
  outcome: ShotOutcome
}

export interface GameEndPayload {
  winner: 0 | 1
  reason: 'all-destroyed' | 'counterattack' | 'resign' | 'disconnect' | 'timeout-takeover'
  layouts: { player0: PlacedPlane[]; player1: PlacedPlane[] }
  stats: {
    turnCount: number
    /** 本局双方总报点数 */
    shotsFired: number
    /** 命中（hit+kill）总数 */
    hitCount: number
    /** 击毁飞机架数 */
    killCount: number
  }
}

export interface ServerToClientEvents {
  identity: (p: GuestIdentity) => void
  roomUpdate: (p: RoomUpdate) => void
  phaseChange: (p: { phase: GamePhase }) => void
  turnStart: (p: { yourTurn: boolean; deadline: number; turnNo: number; chancesLeft: number }) => void
  shotResult: (p: ShotResultPayload) => void
  timerUpdate: (p: { player: 0 | 1; remainingMs: number; chancesLeft: number }) => void
  machineTakeover: (p: { player: 0 | 1 }) => void
  opponentDisconnected: (p: { reconnectGraceMs: number }) => void
  opponentReconnected: () => void
  matchmakingStatus: (p: { status: 'queued' | 'matched' | 'timeout' }) => void
  gameEnd: (p: GameEndPayload) => void
}

export interface ClientToServerEvents {
  auth: (p: { token?: string; gameId?: string }, ack?: Ack<{ identity?: GuestIdentity }>) => void
  createRoom: (
    p: { config: GridConfig; match?: boolean },
    ack?: Ack<{ roomCode?: string }>,
  ) => void
  joinRoom: (p: { code: string }, ack?: Ack<{ room?: RoomSummary }>) => void
  leaveRoom: () => void
  placeFleet: (p: { planes: PlacedPlane[] }, ack?: Ack<{ errors?: string[] }>) => void
  ready: (ack?: Ack) => void
  shoot: (p: { coord: Cell }, ack?: Ack) => void
  resign: () => void
  reconnect: (p: { token: string; gameId: string }, ack?: Ack) => void
}
