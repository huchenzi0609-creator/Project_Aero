/**
 * @aero/server —— SQLite 持久层。
 *
 * 使用 Node 内置 `node:sqlite`（DatabaseSync），不使用 better-sqlite3。
 * 表结构（docs/design.md §6 身份与数据）：
 *   users(id, name, token_hash, created_at, wins, losses, games)
 *   games(id, room_code, config_json, fleet0_json, fleet1_json, moves_json, result, reason, started_at, ended_at)
 */
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export interface UserRow {
  id: number
  name: string
  token_hash: string
  created_at: number
  wins: number
  losses: number
  games: number
}

export interface GameRow {
  id: number
  room_code: string
  config_json: string
  fleet0_json: string | null
  fleet1_json: string | null
  moves_json: string
  result: string | null
  reason: string | null
  started_at: number
  ended_at: number | null
}

export interface InsertGameInput {
  roomCode: string
  configJson: string
  fleet0Json: string | null
  fleet1Json: string | null
  movesJson: string
  result: string | null
  reason: string | null
  startedAt: number
  endedAt: number | null
}

/**
 * SQLite 存储门面。`dbPath` 可为文件路径或 ':memory:'（测试用）。
 */
export class Store {
  readonly db: DatabaseSync

  constructor(dbPath: string) {
    if (dbPath !== ':memory:') {
      mkdirSync(dirname(dbPath), { recursive: true })
    }
    this.db = new DatabaseSync(dbPath)
    this.migrate()
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT NOT NULL UNIQUE,
        token_hash TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        wins       INTEGER NOT NULL DEFAULT 0,
        losses     INTEGER NOT NULL DEFAULT 0,
        games      INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS games (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        room_code   TEXT NOT NULL,
        config_json TEXT NOT NULL,
        fleet0_json TEXT,
        fleet1_json TEXT,
        moves_json  TEXT NOT NULL,
        result      TEXT,
        reason      TEXT,
        started_at  INTEGER NOT NULL,
        ended_at    INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_games_room_code ON games (room_code);
      CREATE INDEX IF NOT EXISTS idx_games_started_at ON games (started_at);
    `)
  }

  /** 新建用户；name/token_hash 有 UNIQUE 约束 */
  createUser(name: string, tokenHash: string): UserRow {
    const now = Date.now()
    const stmt = this.db.prepare(
      'INSERT INTO users (name, token_hash, created_at, wins, losses, games) VALUES (?, ?, ?, 0, 0, 0)',
    )
    const res = stmt.run(name, tokenHash, now)
    const id = Number(res.lastInsertRowid)
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined
    if (!row) throw new Error('创建用户失败：无法读取新行')
    return row
  }

  findByTokenHash(tokenHash: string): UserRow | undefined {
    return this.db.prepare('SELECT * FROM users WHERE token_hash = ?').get(tokenHash) as UserRow | undefined
  }

  findByName(name: string): UserRow | undefined {
    return this.db.prepare('SELECT * FROM users WHERE name = ?').get(name) as UserRow | undefined
  }

  findUserById(id: number): UserRow | undefined {
    return this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined
  }

  /** 全部用户（测试用） */
  allUsers(): UserRow[] {
    return this.db.prepare('SELECT * FROM users ORDER BY id').all() as UserRow[]
  }

  /** 写入一盘对局 */
  insertGame(input: InsertGameInput): GameRow {
    const stmt = this.db.prepare(
      `INSERT INTO games (room_code, config_json, fleet0_json, fleet1_json, moves_json, result, reason, started_at, ended_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    const res = stmt.run(
      input.roomCode,
      input.configJson,
      input.fleet0Json,
      input.fleet1Json,
      input.movesJson,
      input.result,
      input.reason,
      input.startedAt,
      input.endedAt,
    )
    const id = Number(res.lastInsertRowid)
    const row = this.db.prepare('SELECT * FROM games WHERE id = ?').get(id) as GameRow | undefined
    if (!row) throw new Error('写入对局失败：无法读取新行')
    return row
  }

  /** 对局（测试用） */
  allGames(): GameRow[] {
    return this.db.prepare('SELECT * FROM games ORDER BY id').all() as GameRow[]
  }

  /** 更新用户战绩（wins/losses/games 增量） */
  updateStats(userId: number, winsDelta: number, lossesDelta: number, gamesDelta: number): void {
    this.db
      .prepare('UPDATE users SET wins = wins + ?, losses = losses + ?, games = games + ? WHERE id = ?')
      .run(winsDelta, lossesDelta, gamesDelta, userId)
  }

  close(): void {
    this.db.close()
  }
}
