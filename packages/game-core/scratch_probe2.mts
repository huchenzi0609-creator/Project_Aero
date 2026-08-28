// 临时探针 2：复现 playGame 完整对局，打印各难度回合数分布与胜率
import { DEFAULT_PLANE_SHAPE, type Cell, type Difficulty } from '@aero/shared'
import { chooseShot, generateFleet, mulberry32, type ShotKnowledge } from './src/ai/index.js'
import { applyShot, createGame, setFleet } from './src/index.js'

const W = 10
const H = 10
const N = 3

function playGame(
  aiDiff: Difficulty,
  aiRng: ReturnType<typeof mulberry32>,
  oppRng: ReturnType<typeof mulberry32>,
): { turns: number; winner: 0 | 1 } {
  const aiFleet = generateFleet(W, H, N, DEFAULT_PLANE_SHAPE, aiDiff, aiRng)
  const oppFleet = generateFleet(W, H, N, DEFAULT_PLANE_SHAPE, 'easy', oppRng)
  let g = createGame(W, H, DEFAULT_PLANE_SHAPE, N, 0)
  const s0 = setFleet(g, 0, aiFleet)
  const s1 = setFleet(s0.ok ? s0.state : g, 1, oppFleet)
  if (!s1.ok) throw new Error('setFleet failed')
  g = s1.state
  let turns = 0
  while (g.phase !== 'ended' && turns < 5000) {
    const shooter = g.turn
    const board = g.players[shooter]
    const knowledge: ShotKnowledge = { width: W, height: H, shots: board.shotsFired, planeShape: DEFAULT_PLANE_SHAPE }
    const cell = chooseShot(knowledge, shooter === 0 ? aiDiff : 'easy', shooter === 0 ? aiRng : oppRng)
    const res = applyShot(g, cell)
    if (!res.ok) throw new Error('illegal shot: ' + JSON.stringify(cell) + ' ' + res.error)
    g = res.state!
    turns++
  }
  return { turns, winner: g.winner! }
}

for (const diff of ['easy', 'normal', 'hard', 'hell'] as Difficulty[]) {
  let total = 0
  let wins = 0
  const G = 320
  const hist: Record<string, number> = {}
  for (let i = 0; i < G; i++) {
    const r = playGame(diff, mulberry32(5000 + i), mulberry32(700000 + i))
    total += r.turns
    if (r.winner === 0) wins++
    const bucket = Math.floor(r.turns / 20) * 20
    hist[`${bucket}-${bucket + 20}`] = (hist[`${bucket}-${bucket + 20}`] ?? 0) + 1
  }
  console.log(diff, '平均回合:', (total / G).toFixed(2), 'AI胜率:', (wins / G * 100).toFixed(1) + '%', '分布:', JSON.stringify(hist))
}
