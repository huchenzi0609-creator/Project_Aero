/**
 * M2 AI 测试：mulberry32 确定性 / chooseShot 合法性模拟 / 难度梯度 / generateFleet 有效性 / 26×26 性能
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_PLANE_SHAPE, type Cell, type Difficulty } from '@aero/shared'
import { chooseShot, generateFleet, mulberry32, type Rng, type ShotKnowledge } from '@aero/game-core/ai'
import { applyShot, createGame, setFleet, validateFleet } from '@aero/game-core'

describe('mulberry32', () => {
  it('同种子同序列，输出在 [0,1)', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    const seqA = Array.from({ length: 30 }, () => a())
    const seqB = Array.from({ length: 30 }, () => b())
    expect(seqA).toEqual(seqB)
    for (const x of seqA) {
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThan(1)
    }
  })

  it('不同种子序列不同', () => {
    const a = mulberry32(1)
    const b = mulberry32(2)
    expect(Array.from({ length: 30 }, () => a())).not.toEqual(Array.from({ length: 30 }, () => b()))
  })
})

/**
 * 模拟一局完整对局：
 * - 玩家 0 为被测难度 AI（先手），玩家 1 为 easy 随机对手；
 * - 双方机队由各自 rng 生成；
 * - 每一步都断言 chooseShot 结果不越界、不重复，且 applyShot 成功；
 * - 返回终局回合数与 AI 全部报点。
 */
function playGame(
  width: number,
  height: number,
  planeCount: number,
  aiDiff: Difficulty,
  oppDiff: Difficulty,
  aiRng: Rng,
  oppRng: Rng,
): { turns: number; winner: 0 | 1; aiShots: Cell[] } {
  const aiFleet = generateFleet(width, height, planeCount, DEFAULT_PLANE_SHAPE, aiDiff, aiRng)
  const oppFleet = generateFleet(width, height, planeCount, DEFAULT_PLANE_SHAPE, oppDiff, oppRng)
  expect(validateFleet(width, height, planeCount, DEFAULT_PLANE_SHAPE, aiFleet).ok).toBe(true)
  expect(validateFleet(width, height, planeCount, DEFAULT_PLANE_SHAPE, oppFleet).ok).toBe(true)

  let g = createGame(width, height, DEFAULT_PLANE_SHAPE, planeCount, 0)
  const s0 = setFleet(g, 0, aiFleet)
  const s1 = setFleet(s0.ok ? s0.state : g, 1, oppFleet)
  if (!s1.ok) throw new Error('setFleet 失败: ' + s1.errors.join('；'))
  g = s1.state

  const aiShots: Cell[] = []
  const aiShotKeys = new Set<string>()
  let turns = 0
  while (g.phase !== 'ended' && turns < 5000) {
    const shooter = g.turn
    const board = g.players[shooter]
    const knowledge: ShotKnowledge = {
      width,
      height,
      shots: board.shotsFired,
      planeShape: DEFAULT_PLANE_SHAPE,
    }
    const cell = chooseShot(knowledge, shooter === 0 ? aiDiff : oppDiff, shooter === 0 ? aiRng : oppRng)
    // 合法性断言：不越界、不重复
    expect(cell.r).toBeGreaterThanOrEqual(0)
    expect(cell.r).toBeLessThan(height)
    expect(cell.c).toBeGreaterThanOrEqual(0)
    expect(cell.c).toBeLessThan(width)
    const key = `${cell.r},${cell.c}`
    expect(board.shotsFired.some((s) => s.coord.r === cell.r && s.coord.c === cell.c)).toBe(false)
    if (shooter === 0) {
      expect(aiShotKeys.has(key)).toBe(false)
      aiShotKeys.add(key)
      aiShots.push(cell)
    }
    const res = applyShot(g, cell)
    expect(res.ok).toBe(true)
    g = res.state!
    turns++
  }
  expect(g.phase).toBe('ended')
  expect(g.winner).not.toBeNull()
  return { turns, winner: g.winner!, aiShots }
}

describe('chooseShot 合法性（100 局随机模拟）', () => {
  it('全部报点不越界、不重复，游戏正常终局', { timeout: 60_000 }, () => {
    const diffs: Difficulty[] = ['easy', 'normal', 'hard', 'hell']
    for (let i = 0; i < 100; i++) {
      const diff = diffs[i % 4]!
      const aiRng = mulberry32(1000 + i)
      const oppRng = mulberry32(900_000 + i)
      const { turns, winner, aiShots } = playGame(10, 10, 3, diff, 'easy', aiRng, oppRng)
      expect(winner === 0 || winner === 1).toBe(true)
      expect(turns).toBeGreaterThan(0)
      expect(aiShots.length).toBeGreaterThan(0)
    }
  })
})

describe('难度梯度（同一批固定种子，≥300 局）', () => {
  it('平均终局回合数 easy > normal > hard > hell（允许 hell≈hard）', { timeout: 120_000 }, () => {
    const GAMES = 320
    const results: Record<Difficulty, number[]> = { easy: [], normal: [], hard: [], hell: [] }
    for (const diff of ['easy', 'normal', 'hard', 'hell'] as Difficulty[]) {
      for (let i = 0; i < GAMES; i++) {
        const aiRng = mulberry32(5000 + i)
        const oppRng = mulberry32(700_000 + i)
        const { turns } = playGame(10, 10, 3, diff, 'easy', aiRng, oppRng)
        results[diff].push(turns)
      }
    }
    const avg = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length
    const e = avg(results.easy)
    const n = avg(results.normal)
    const h = avg(results.hard)
    const x = avg(results.hell)
    expect(e).toBeGreaterThan(n)
    expect(n).toBeGreaterThan(h)
    // hell ≈ hard：允许小幅波动，但不允许明显差于 hard
    expect(x).toBeLessThanOrEqual(h + 1.0)
    expect(x).toBeGreaterThanOrEqual(h - 3.0)
  })
})

describe('generateFleet', () => {
  it('各难度产物通过 validateFleet（多棋盘/多数量/多种子）', { timeout: 60_000 }, () => {
    const configs: Array<[number, number, number]> = [
      [10, 10, 3],
      [15, 15, 5],
      [20, 20, 7],
      [26, 26, 10],
    ]
    for (const diff of ['easy', 'normal', 'hard', 'hell'] as Difficulty[]) {
      for (const [w, h, n] of configs) {
        for (let i = 0; i < 15; i++) {
          const fleet = generateFleet(w, h, n, DEFAULT_PLANE_SHAPE, diff, mulberry32(i * 1000 + w * 7 + h))
          const v = validateFleet(w, h, n, DEFAULT_PLANE_SHAPE, fleet)
          expect(v, `${diff} ${w}×${h} n=${n} i=${i}`).toEqual({ ok: true })
          // id 唯一且为 0..n-1
          expect(fleet.map((p) => p.id).sort((a, b) => a - b)).toEqual(Array.from({ length: n }, (_, i) => i))
          // 机队不随调用次数改变（确定性：同种子同机队）
          const again = generateFleet(w, h, n, DEFAULT_PLANE_SHAPE, diff, mulberry32(i * 1000 + w * 7 + h))
          expect(again).toEqual(fleet)
        }
      }
    }
  })

  it('高密度（26×26 摆 26 架）仍能生成合法机队', { timeout: 60_000 }, () => {
    for (const diff of ['easy', 'normal', 'hard', 'hell'] as Difficulty[]) {
      const fleet = generateFleet(26, 26, 26, DEFAULT_PLANE_SHAPE, diff, mulberry32(1234))
      expect(validateFleet(26, 26, 26, DEFAULT_PLANE_SHAPE, fleet).ok).toBe(true)
    }
  })

  it('26×26 摆 10 架单次耗时 < 150ms（timeit 输出）', { timeout: 30_000 }, () => {
    const samples = 10
    const rng = mulberry32(99)
    const t0 = performance.now()
    for (let i = 0; i < samples; i++) {
      const fleet = generateFleet(26, 26, 10, DEFAULT_PLANE_SHAPE, 'hell', rng)
      expect(validateFleet(26, 26, 10, DEFAULT_PLANE_SHAPE, fleet).ok).toBe(true)
    }
    const avgMs = (performance.now() - t0) / samples
    // timeit 输出：供组长核对 26×26 摆阵耗时
    console.log(`[timeit] generateFleet(26×26, 10架, hell) 单次平均: ${avgMs.toFixed(2)}ms`)
    expect(avgMs).toBeLessThan(150)
  })
})

describe('性能', () => {
  it('26×26 热图单次 chooseShot < 50ms', () => {
    const rng = mulberry32(7)
    const width = 26
    const height = 26
    // 构造中局知识：约 300 个随机报点（含 miss/hit/kill）
    const cells: Cell[] = []
    for (let r = 0; r < height; r++) {
      for (let c = 0; c < width; c++) cells.push({ r, c })
    }
    for (let i = cells.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      ;[cells[i], cells[j]] = [cells[j]!, cells[i]!]
    }
    const shots = cells.slice(0, 300).map((coord, i) => ({
      coord,
      outcome: (i % 3 === 0 ? 'miss' : i % 3 === 1 ? 'hit' : 'kill') as ShotKnowledge['shots'][number]['outcome'],
    }))
    const knowledge: ShotKnowledge = { width, height, shots, planeShape: DEFAULT_PLANE_SHAPE }
    const t0 = performance.now()
    for (let i = 0; i < 10; i++) {
      const cell = chooseShot(knowledge, 'hard', rng)
      expect(cell.r).toBeGreaterThanOrEqual(0)
      expect(cell.r).toBeLessThan(height)
      expect(cell.c).toBeGreaterThanOrEqual(0)
      expect(cell.c).toBeLessThan(width)
    }
    const avgMs = (performance.now() - t0) / 10
    // timeit 输出：供组长核对 26×26 热图耗时
    console.log(`[timeit] 26×26 热图 chooseShot(hard) 单次平均: ${avgMs.toFixed(3)}ms`)
    expect(avgMs).toBeLessThan(50)
  })
})
