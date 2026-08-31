/**
 * @aero/server —— HTTP（Express，健康检查 + /api/auth）+ Socket.IO 装配。
 *
 * 启动方式：
 *   PORT（默认 3001）、DATA_DIR（默认 ./data，已 gitignore）
 *   例：PORT=3001 DATA_DIR=./data pnpm --filter @aero/server dev
 */
import { createServer, type Server as HttpServer } from 'node:http'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import express, { type Express } from 'express'
import { Server } from 'socket.io'
import type { ClientToServerEvents, RoomSummary, ServerToClientEvents } from '@aero/shared'
import { Store } from './db'
import { IdentityService } from './identity'
import { RoomManager, type RoomManagerOptions, type ServerIO, type SocketData } from './rooms'

export interface StartOptions {
  port?: number
  dataDir?: string
  store?: Store
  identityService?: IdentityService
  roomManagerOptions?: RoomManagerOptions
}

export interface ServerHandle {
  httpServer: HttpServer
  io: ServerIO
  store: Store
  identityService: IdentityService
  roomManager: RoomManager
  /** 实际监听地址（port 0 时为系统分配端口） */
  url: string
  port: number
  close: () => Promise<void>
}

function corsMiddleware(_req: express.Request, res: express.Response, next: express.NextFunction): void {
  // 联机场景（局域网/公网前端）允许跨域；无凭据，反射来源即可
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (_req.method === 'OPTIONS') {
    res.sendStatus(204)
    return
  }
  next()
}

function buildApp(store: Store, identityService: IdentityService): Express {
  const app = express()
  app.use(express.json())
  app.use(corsMiddleware)

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'aero-server', uptime: process.uptime(), timestamp: Date.now() })
  })

  // 身份：POST /api/auth {token?} → {identity}；旧 token 命中复用，否则新建
  app.post('/api/auth', (req, res) => {
    const body = req.body
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      res.status(400).json({ error: '请求体应为 JSON 对象，如 { "token": "..." }' })
      return
    }
    const token = typeof body.token === 'string' && body.token.length > 0 ? body.token : undefined
    try {
      const { identity } = identityService.resolveIdentity(token)
      res.json({ identity })
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : '身份创建失败' })
    }
  })

  // 生产静态托管：存在前端构建产物（apps/web/dist）时，同端口直接服务页面。
  // /api 与 /socket.io 不受影响；未构建前端时此段自动跳过（开发/测试无感）。
  const webDist = fileURLToPath(new URL('../../web/dist', import.meta.url))
  if (existsSync(webDist)) {
    app.use(express.static(webDist))
    app.use((req, res, next) => {
      if (req.method !== 'GET') return next()
      if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) return next()
      if (!req.accepts('html')) return next()
      res.sendFile(join(webDist, 'index.html'))
    })
  }

  return app
}

function wireSocketEvents(io: ServerIO, roomManager: RoomManager, identityService: IdentityService): void {
  io.on('connection', (socket) => {
    // 身份：token 命中复用，否则新建；可携带 gameId 触发断线重连恢复
    socket.on('auth', (p, ack) => {
      const token = typeof p?.token === 'string' && p.token.length > 0 ? p.token : undefined
      const { identity } = identityService.resolveIdentity(token)
      socket.data.userId = identity.id
      socket.data.userName = identity.name
      socket.emit('identity', identity)
      ack?.({ identity })
      const gameId = typeof p?.gameId === 'string' && p.gameId.trim().length > 0 ? p.gameId.trim() : undefined
      if (gameId) {
        // 若正处于该对局的断线宽限期，自动恢复（与 reconnect 同一路径）
        roomManager.reconnect(identity.id, gameId, socket.id)
      }
    })

    // 建房（协议事件：config + match?；match: true 表示进入公网匹配，见 rooms.ts）
    socket.on('createRoom', (p, ack) => {
      if (!socket.data.userId) {
        ack?.({ error: '请先认证身份' } as unknown as { roomCode?: string })
        return
      }
      const userId = socket.data.userId
      const name = socket.data.userName ?? '游客'
      const res: { ok: boolean; code?: string; error?: string } = p?.match
        ? roomManager.matchmake(userId, name, socket.id, p?.config)
        : roomManager.createRoom(userId, name, socket.id, p?.config)
      if (!res.ok) {
        // 协议 ack 未声明 error 字段，这里运行时附加以便前端诊断（M6 可按需断言）
        ack?.({ error: res.error } as unknown as { roomCode?: string })
        return
      }
      ack?.({ roomCode: res.code })
    })

    socket.on('joinRoom', (p, ack) => {
      if (!socket.data.userId) {
        ack?.({ error: '请先认证身份' } as unknown as { room?: RoomSummary })
        return
      }
      const code = typeof p?.code === 'string' ? p.code.trim().toUpperCase() : ''
      const res = roomManager.joinRoom(socket.data.userId, socket.data.userName ?? '游客', socket.id, code)
      if (!res.ok) {
        ack?.({ error: res.error } as unknown as { room?: RoomSummary })
        return
      }
      const room = roomManager.roomSummaryOfCode(code)
      ack?.({ room })
    })

    socket.on('leaveRoom', () => {
      roomManager.leaveRoom(socket.id)
    })

    socket.on('placeFleet', (p, ack) => {
      if (!socket.data.userId) {
        ack?.({ errors: ['请先认证身份'] })
        return
      }
      const res = roomManager.placeFleet(socket.data.userId, p?.planes)
      ack?.({ errors: res.ok ? [] : [res.error] })
    })

    socket.on('ready', (ack) => {
      if (!socket.data.userId) {
        ack?.({ ok: false, error: '请先认证身份' })
        return
      }
      const res = roomManager.ready(socket.data.userId)
      ack?.(res.ok ? { ok: true } : { ok: false, error: res.error })
    })

    socket.on('shoot', (p, ack) => {
      if (!socket.data.userId) {
        ack?.({ ok: false, error: '请先认证身份' })
        return
      }
      const res = roomManager.shoot(socket.data.userId, p?.coord)
      ack?.(res.ok ? { ok: true } : { ok: false, error: res.error })
    })

    socket.on('resign', () => {
      if (socket.data.userId) roomManager.resign(socket.data.userId)
    })

    socket.on('reconnect', (p, ack) => {
      const token = typeof p?.token === 'string' ? p.token : ''
      const gameId = typeof p?.gameId === 'string' ? p.gameId.trim() : ''
      if (!token || !gameId) {
        ack?.({ ok: false, error: '缺少 token 或 gameId' })
        return
      }
      const user = identityService.findByToken(token)
      if (!user) {
        ack?.({ ok: false, error: '无效身份' })
        return
      }
      socket.data.userId = String(user.id)
      socket.data.userName = user.name
      const res = roomManager.reconnect(String(user.id), gameId, socket.id)
      ack?.(res.ok ? { ok: true } : { ok: false, error: res.error })
    })

    socket.on('disconnect', () => {
      roomManager.onDisconnect(socket.id)
    })
  })
}

/** 启动服务器（测试可传入 port: 0 / 内存库 / 自定义 RoomManager 选项） */
export async function startServer(options: StartOptions = {}): Promise<ServerHandle> {
  const port = options.port ?? Number(process.env.PORT ?? 3001)
  const dataDir = options.dataDir ?? process.env.DATA_DIR ?? './data'
  // ':memory:' 作为特殊值直接交给 Store（否则 join 会把它当目录，生成共享文件库）
  const store = options.store ?? new Store(dataDir === ':memory:' ? ':memory:' : join(dataDir, 'aero.db'))
  const identityService = options.identityService ?? new IdentityService(store)

  const app = buildApp(store, identityService)
  const httpServer = createServer(app)
  const io = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>(httpServer, {
    cors: { origin: true },
    serveClient: false,
  })
  // 注入 store：RoomManager 落盘/战绩依赖它（调用方也可显式传 store 覆盖）
  const roomManager = new RoomManager(io, { ...(options.roomManagerOptions ?? {}), store })
  wireSocketEvents(io, roomManager, identityService)

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject)
    httpServer.listen(port, resolve)
  })

  const addr = httpServer.address()
  const actualPort = typeof addr === 'object' && addr !== null ? addr.port : port

  const handle: ServerHandle = {
    httpServer,
    io,
    store,
    identityService,
    roomManager,
    url: `http://127.0.0.1:${actualPort}`,
    port: actualPort,
    close: async () => {
      roomManager.shutdown()
      await new Promise<void>((resolve) => io.close(() => resolve()))
      await new Promise<void>((resolve) => httpServer.close(() => resolve()))
      try {
        store.close()
      } catch {
        /* 已关闭 */
      }
    },
  }
  return handle
}

/** 独立启动（tsx src/index.ts / dev 脚本） */
export async function main(): Promise<void> {
  const handle = await startServer()
  console.log(`[aero-server] 已启动：${handle.url}（健康检查 GET /health，Socket.IO 同端口）`)
  const shutdown = async (): Promise<void> => {
    console.log('[aero-server] 正在关闭…')
    await handle.close()
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown())
  process.on('SIGTERM', () => void shutdown())
}

// 直接作为入口运行时（tsx src/index.ts）才启动
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  void main()
}
