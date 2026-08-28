/**
 * onlineStore —— 联机会话状态（M6）。
 *
 * 单一数据源：socket 事件（含断线重连回放）经 handleEvent 幂等写入本 store；
 * 渲染层（OnlineMenu / OnlinePlacement / OnlineGame）只读本 store，
 * 一切写操作（建房/入房/摆阵/就绪/报点/投降/退出）经 net/socket 的 onlineApi 发出。
 *
 * 幂等纪律（回放安全）：
 * - shotResult 按 by+coord 去重；machineTakeover 按席位去重；
 * - roomUpdate 同房间码只合并（保留棋盘），换码才整局复位；
 * - players: [] 视为房间关闭；reconnect ack 失败置 sessionError 供页面提示。
 */
import { create } from 'zustand'
import type {
  GameEndPayload,
  GamePhase,
  GridConfig,
  GuestIdentity,
  PlacedPlane,
  RoomUpdate,
  ServerToClientEvents,
  Shot,
  ShotOutcome,
  ShotResultPayload,
} from '@aero/shared'
import { clearPersistedFleet, persistGameId, readPersistedFleet, writePersistedFleet, writeToken } from '../net/storage'
import { useGuestStore } from './guestStore'

export type SocketStatus = 'idle' | 'connecting' | 'connected' | 'disconnected'

export interface MatchStatus {
  status: 'queued' | 'matched' | 'timeout'
  at: number
}

export interface LastShotInfo {
  by: 'you' | 'opponent'
  coord: { r: number; c: number }
  outcome: ShotOutcome
  seq: number
}

export interface OppDisconnectInfo {
  graceMs: number
  since: number
}

interface OnlineState {
  /* ---------- 连接与身份 ---------- */
  socketStatus: SocketStatus
  identity: GuestIdentity | null
  sessionError: string | null

  /* ---------- 房间与阶段 ---------- */
  room: RoomUpdate | null
  config: GridConfig | null
  you: 0 | 1
  phase: GamePhase

  /* ---------- 回合计时 ---------- */
  turnPlayer: 0 | 1 | null
  yourTurn: boolean
  /** 本回合截止时间（绝对 ms 时间戳）；0 = 无计时（机器回合等） */
  deadline: number
  turnNo: number
  /** 当前回合方剩余超时机会（0..3） */
  chancesLeft: number

  /* ---------- 棋盘视图 ---------- */
  /** 我方报点（渲染在对手网格） */
  myShots: Shot[]
  /** 对手报点（渲染在我方网格） */
  oppShots: Shot[]
  /** 最近一条报点结果（状态条 / 0.8s 高亮动画） */
  lastShot: LastShotInfo | null
  /** 我方阵型（本地持久化，刷新恢复用；仅自己的阵型） */
  myFleet: PlacedPlane[] | null

  /* ---------- 接管 / 断线 / 匹配 / 终局 ---------- */
  takeovers: Array<0 | 1>
  oppDisconnect: OppDisconnectInfo | null
  matchmaking: MatchStatus | null
  gameEnd: GameEndPayload | null

  /* ---------- 动作 ---------- */
  setSocketStatus: (status: SocketStatus) => void
  handleEvent: <K extends keyof ServerToClientEvents>(
    event: K,
    payload: Parameters<ServerToClientEvents[K]>[0],
  ) => void
  handleReconnectFailed: (error: string) => void
  noteRoomCode: (code: string) => void
  setMyFleet: (planes: PlacedPlane[]) => void
  handleLeftRoom: () => void
  resetSession: () => void
}

let shotSeq = 0

/** 按坐标去重追加报点（回放幂等：已存在的格不再追加） */
function upsertShot(list: Shot[], shot: Shot): Shot[] {
  const exists = list.some((x) => x.coord.r === shot.coord.r && x.coord.c === shot.coord.c)
  return exists ? list : [...list, shot]
}

function restoreFleet(roomCode: string): PlacedPlane[] | null {
  const raw = readPersistedFleet(roomCode)
  if (!Array.isArray(raw)) return null
  const planes = raw.filter(
    (p): p is PlacedPlane =>
      typeof p === 'object' &&
      p !== null &&
      typeof (p as PlacedPlane).id === 'number' &&
      typeof (p as PlacedPlane).rotation === 'number' &&
      typeof (p as PlacedPlane).origin === 'object',
  )
  return planes.length > 0 ? planes : null
}

const EMPTY_TURN = {
  turnPlayer: null as 0 | 1 | null,
  yourTurn: false,
  deadline: 0,
  turnNo: 0,
  chancesLeft: 0,
}

export const useOnlineStore = create<OnlineState>()((set, get) => ({
  socketStatus: 'idle',
  identity: null,
  sessionError: null,
  room: null,
  config: null,
  you: 0,
  phase: 'placing',
  ...EMPTY_TURN,
  myShots: [],
  oppShots: [],
  lastShot: null,
  myFleet: null,
  takeovers: [],
  oppDisconnect: null,
  matchmaking: null,
  gameEnd: null,

  setSocketStatus: (socketStatus) => set({ socketStatus }),

  handleEvent: (event, payload) => {
    const s = get()
    switch (event) {
      case 'identity': {
        const p = payload as GuestIdentity
        writeToken(p.token)
        useGuestStore.getState().applyIdentity(p)
        set({ identity: p })
        return
      }
      case 'roomUpdate': {
        const p = payload as RoomUpdate
        // 房间关闭约定：players=[] 表示解散/已退出
        if (p.players.length === 0) {
          persistGameId(null)
          set({
            room: p,
            config: null,
            phase: 'placing',
            gameEnd: null,
            oppDisconnect: null,
            matchmaking: null,
          })
          return
        }
        const isNewRoom = s.room?.code !== p.code
        if (isNewRoom) {
          persistGameId(p.code)
          set({
            room: p,
            config: p.config,
            you: p.you,
            phase: p.phase,
            ...EMPTY_TURN,
            myShots: [],
            oppShots: [],
            lastShot: null,
            myFleet: restoreFleet(p.code),
            takeovers: [],
            oppDisconnect: null,
            gameEnd: null,
            matchmaking: null,
          })
          return
        }
        // 同房间：仅合并（保留棋盘视图）
        set({ room: p, config: p.config, you: p.you, phase: p.phase })
        return
      }
      case 'phaseChange': {
        const p = payload as { phase: GamePhase }
        set({ phase: p.phase })
        return
      }
      case 'turnStart': {
        const p = payload as { yourTurn: boolean; deadline: number; turnNo: number; chancesLeft: number }
        const turnPlayer = p.yourTurn ? s.you : ((1 - s.you) as 0 | 1)
        set({
          yourTurn: p.yourTurn,
          turnPlayer,
          deadline: p.deadline,
          turnNo: p.turnNo,
          chancesLeft: p.chancesLeft,
        })
        return
      }
      case 'timerUpdate': {
        const p = payload as { player: 0 | 1; remainingMs: number; chancesLeft: number }
        if (p.player !== s.turnPlayer) return
        set({
          chancesLeft: p.chancesLeft,
          deadline: p.remainingMs > 0 ? Date.now() + p.remainingMs : s.deadline,
        })
        return
      }
      case 'shotResult': {
        const p = payload as ShotResultPayload
        const shot: Shot = { coord: p.coord, outcome: p.outcome }
        const myShots = p.by === 'you' ? upsertShot(s.myShots, shot) : s.myShots
        const oppShots = p.by === 'opponent' ? upsertShot(s.oppShots, shot) : s.oppShots
        set({
          myShots,
          oppShots,
          lastShot: { by: p.by, coord: p.coord, outcome: p.outcome, seq: ++shotSeq },
        })
        return
      }
      case 'machineTakeover': {
        const p = payload as { player: 0 | 1 }
        if (s.takeovers.includes(p.player)) return
        set({ takeovers: [...s.takeovers, p.player] })
        return
      }
      case 'opponentDisconnected': {
        const p = payload as { reconnectGraceMs: number }
        set({ oppDisconnect: { graceMs: p.reconnectGraceMs, since: Date.now() } })
        return
      }
      case 'opponentReconnected': {
        set({ oppDisconnect: null })
        return
      }
      case 'matchmakingStatus': {
        const p = payload as { status: 'queued' | 'matched' | 'timeout' }
        set({ matchmaking: { status: p.status, at: Date.now() } })
        return
      }
      case 'gameEnd': {
        const p = payload as GameEndPayload
        if (s.room?.code) clearPersistedFleet(s.room.code)
        set({ gameEnd: p, phase: 'ended' })
        return
      }
      default:
        return
    }
  },

  handleReconnectFailed: (error) => {
    persistGameId(null)
    set({
      room: null,
      config: null,
      phase: 'placing',
      ...EMPTY_TURN,
      myShots: [],
      oppShots: [],
      lastShot: null,
      myFleet: null,
      takeovers: [],
      oppDisconnect: null,
      gameEnd: null,
      sessionError: error,
    })
  },

  noteRoomCode: (code) => {
    persistGameId(code)
  },

  setMyFleet: (planes) => {
    const code = get().room?.code
    if (code) writePersistedFleet(code, planes)
    set({ myFleet: planes })
  },

  handleLeftRoom: () => {
    const code = get().room?.code
    if (code) clearPersistedFleet(code)
    persistGameId(null)
    set({
      room: null,
      config: null,
      phase: 'placing',
      ...EMPTY_TURN,
      myShots: [],
      oppShots: [],
      lastShot: null,
      myFleet: null,
      takeovers: [],
      oppDisconnect: null,
      matchmaking: null,
      gameEnd: null,
    })
  },

  resetSession: () => {
    get().handleLeftRoom()
  },
}))
