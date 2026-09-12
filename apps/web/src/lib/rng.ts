/**
 * rng —— 确定性随机源（v0.3.15，e2e 提速用）。
 *
 * 目标：为自动化测试提供可复现的随机序列，**不影响真实玩家玩法**：
 * - 优先读取 `location.search` 的 `e2eSeed` 查询参数；
 * - 其次读取 `localStorage['aero.e2eSeed']`；
 * - 都没有（生产默认）→ 返回 null，`makeRng` 退回现有随机来源（Date.now() ^ Math.random()）。
 *
 * 不自造第二套随机数实现：种子路径直接复用 @aero/game-core/ai 的 mulberry32。
 */
import { mulberry32 } from '@aero/game-core/ai'
import type { Rng } from '@aero/game-core/ai'

/** 读取 e2e 固定种子：查询参数 → localStorage → null（数值化失败按 null） */
export function e2eSeed(): number | null {
  let raw: string | null = null
  try {
    if (typeof location !== 'undefined' && location.search) {
      raw = new URLSearchParams(location.search).get('e2eSeed')
    }
  } catch {
    raw = null
  }
  if (raw == null || raw === '') {
    try {
      raw = typeof localStorage !== 'undefined' ? localStorage.getItem('aero.e2eSeed') : null
    } catch {
      raw = null
    }
  }
  if (raw == null || raw.trim() === '') return null
  const n = Number(raw)
  if (!Number.isFinite(n)) return null
  return Math.floor(Math.abs(n)) >>> 0
}

/**
 * 种子存在时同步接管全局 Math.random（仅测试注入种子时；真实玩家无副作用）。
 * 目的：让尚未改造的消费方（如 gameStore 的先后手抽取、AI 摆阵等既有 Math.random 调用）
 * 在 e2e 种子下同样确定，避免"AI 报点序列"因首手/其它随机而漂移。
 */
let globalPatched = false
function patchGlobalRandom(seed: number): void {
  if (globalPatched) return
  globalPatched = true
  const stream = mulberry32((seed >>> 0) || 1)
  try {
    Math.random = () => stream()
  } catch {
    /* 环境只读：忽略 */
  }
}

/**
 * 生成随机源。
 * - 有 e2e 种子：`mulberry32(seed + salt)`（salt 用于同一局内区分不同用途/回合）；
 * - 无种子：沿用既有随机来源 `Date.now() ^ Math.random()`（真实玩家不受影响）。
 */
export function makeRng(salt = 0): Rng {
  const seed = e2eSeed()
  if (seed != null) {
    patchGlobalRandom(seed)
    return mulberry32(((seed + (salt | 0)) >>> 0) || 1)
  }
  return mulberry32(((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0) || 1)
}
