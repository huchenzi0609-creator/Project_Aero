/**
 * SQLite 存储（db.ts）与游客身份（identity.ts）单测 + HTTP 端点测试。
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Store } from '../src/db'
import { generateGuestName, IdentityService, sha256Hex } from '../src/identity'
import { startServer, type ServerHandle } from '../src/index'

describe('SQLite 存储（db.ts）', () => {
  it('建表与用户写入/查询', () => {
    const store = new Store(':memory:')
    const u = store.createUser('游客00001', 'hash-abc')
    expect(u.id).toBeGreaterThan(0)
    expect(u.name).toBe('游客00001')
    expect(u.wins).toBe(0)
    expect(u.losses).toBe(0)
    expect(u.games).toBe(0)
    expect(store.findByName('游客00001')?.id).toBe(u.id)
    expect(store.findByTokenHash('hash-abc')?.id).toBe(u.id)
    expect(store.findByTokenHash('不存在')).toBeUndefined()
    expect(store.findByName('不存在')).toBeUndefined()
    store.close()
  })

  it('name / token_hash 唯一约束', () => {
    const store = new Store(':memory:')
    store.createUser('游客00001', 'h1')
    expect(() => store.createUser('游客00001', 'h2')).toThrow()
    expect(() => store.createUser('游客00002', 'h1')).toThrow()
    store.close()
  })

  it('updateStats 战绩累计', () => {
    const store = new Store(':memory:')
    const u = store.createUser('游客00001', 'h')
    store.updateStats(u.id, 1, 0, 1)
    store.updateStats(u.id, 0, 1, 1)
    const row = store.findUserById(u.id) as NonNullable<ReturnType<Store['findUserById']>>
    expect(row.wins).toBe(1)
    expect(row.losses).toBe(1)
    expect(row.games).toBe(2)
    store.close()
  })

  it('games 表写入与读取', () => {
    const store = new Store(':memory:')
    const g = store.insertGame({
      roomCode: 'ABC123',
      configJson: '{"width":10}',
      fleet0Json: '[]',
      fleet1Json: '[]',
      movesJson: '[{"by":0,"coord":{"r":0,"c":0},"outcome":"miss"}]',
      result: '0',
      reason: 'all-destroyed',
      startedAt: 1,
      endedAt: 2,
    })
    expect(g.id).toBeGreaterThan(0)
    expect(g.room_code).toBe('ABC123')
    expect(store.allGames()).toHaveLength(1)
    store.close()
  })

  it('持久化到文件后重新打开仍可读（DATA_DIR 落盘）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aero-db-'))
    const path = join(dir, 'test.db')
    const s1 = new Store(path)
    s1.createUser('游客12345', 'h1')
    s1.close()
    const s2 = new Store(path)
    expect(s2.findByName('游客12345')?.token_hash).toBe('h1')
    s2.close()
  })
})

describe('游客身份（identity.ts）', () => {
  it('游客名格式 游客+5 位数字，且库内唯一', () => {
    const store = new Store(':memory:')
    const svc = new IdentityService(store)
    for (let i = 0; i < 200; i++) {
      const { identity } = svc.resolveIdentity()
      expect(identity.name).toMatch(/^游客\d{5}$/)
      expect(identity.id).toMatch(/^\d+$/)
    }
    const names = store.allUsers().map((u) => u.name)
    expect(new Set(names).size).toBe(names.length)
    const ids = store.allUsers().map((u) => u.id)
    expect(new Set(ids).size).toBe(ids.length)
    store.close()
  })

  it('token 为 64 位 hex；服务端只存 sha256，不存明文', () => {
    const store = new Store(':memory:')
    const svc = new IdentityService(store)
    const { identity } = svc.resolveIdentity()
    expect(identity.token).toMatch(/^[0-9a-f]{64}$/)
    const row = store.findByName(identity.name) as NonNullable<ReturnType<Store['findByName']>>
    expect(row.token_hash).not.toBe(identity.token)
    expect(row.token_hash).toBe(sha256Hex(identity.token))
    store.close()
  })

  it('旧 token 命中复用同一账号', () => {
    const store = new Store(':memory:')
    const svc = new IdentityService(store)
    const first = svc.resolveIdentity().identity
    const again = svc.resolveIdentity(first.token).identity
    expect(again.id).toBe(first.id)
    expect(again.name).toBe(first.name)
    expect(again.token).toBe(first.token)
    expect(store.allUsers()).toHaveLength(1)
    store.close()
  })

  it('无效/过期 token 视为新账号（预期行为：换浏览器/清缓存即新账号）', () => {
    const store = new Store(':memory:')
    const svc = new IdentityService(store)
    const stale = svc.resolveIdentity('f'.repeat(64)).identity
    const fresh = svc.resolveIdentity().identity
    expect(stale.id).not.toBe(fresh.id)
    expect(store.allUsers()).toHaveLength(2)
    store.close()
  })

  it('generateGuestName 恒为 游客+5 位数字', () => {
    for (let i = 0; i < 100; i++) {
      expect(generateGuestName()).toMatch(/^游客\d{5}$/)
    }
  })
})

describe('HTTP 端点（/health + /api/auth）', () => {
  let server: ServerHandle
  beforeAll(async () => {
    server = await startServer({ port: 0, dataDir: ':memory:' })
  })
  afterAll(async () => {
    await server.close()
  })

  it('GET /health → 200 { ok: true }', async () => {
    const res = await fetch(`${server.url}/health`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean }
    expect(body.ok).toBe(true)
  })

  it('POST /api/auth 无 token 新建身份；携带旧 token 复用', async () => {
    const r1 = await fetch(`${server.url}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(r1.status).toBe(200)
    const b1 = (await r1.json()) as { identity: { id: string; name: string; token: string } }
    expect(b1.identity.name).toMatch(/^游客\d{5}$/)
    expect(b1.identity.token).toMatch(/^[0-9a-f]{64}$/)

    const r2 = await fetch(`${server.url}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: b1.identity.token }),
    })
    expect(r2.status).toBe(200)
    const b2 = (await r2.json()) as { identity: { id: string; name: string; token: string } }
    expect(b2.identity.id).toBe(b1.identity.id)
    expect(b2.identity.name).toBe(b1.identity.name)
  })

  it('POST /api/auth 非法请求体 → 400', async () => {
    const res = await fetch(`${server.url}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify('not-an-object'),
    })
    expect(res.status).toBe(400)
  })
})
