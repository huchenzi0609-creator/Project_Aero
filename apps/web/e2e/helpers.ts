/**
 * e2e 公共工具：控制台错误收集 / 棋盘坐标生成 / 网格定位 / v0.3.0 菜单导航。
 * （no-undef 因 evaluate 回调内使用 document/window 等浏览器全局而关闭）
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

/** 监听页面的 console error 与 pageerror，返回快照函数供测试末尾断言 */
export function watchErrors(page: Page): () => string[] {
  const errs: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error') errs.push(m.text())
  })
  page.on('pageerror', (e) => errs.push(String(e)))
  return () => errs
}

/** 生成 width×height 棋盘全部坐标（行优先，A1 起始），与 formatCoord 一致 */
export function allCoords(width = 10, height = 10): string[] {
  const out: string[] = []
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      out.push(`${String.fromCharCode(65 + c)}${r + 1}`)
    }
  }
  return out
}

/** 对角序坐标（r+c 升序、r 降序）：任一朝向的飞机在机头前至少有一个无歧义机身格 */
export function diagCoords(width = 10, height = 10): string[] {
  const cell = (coord: string) => ({ r: Number(coord.slice(1)) - 1, c: coord.charCodeAt(0) - 65 })
  return allCoords(width, height).sort((a, b) => {
    const ca = cell(a)
    const cb = cell(b)
    const da = ca.r + ca.c
    const db = cb.r + cb.c
    if (da !== db) return da - db
    return cb.r - ca.r
  })
}

/** 我方回合判定：状态条「轮到我方报点」/「对方报点 X：…」（排除「等待对方报点…」） */
export function isMyTurnText(st: string): boolean {
  const t = st.trim()
  return t.includes('轮到我方报点') || t.includes('绝地反击') || /^对方报点/.test(t)
}

/** 等轮到我方（结算/弹窗出现亦返回，供调用方收尾判断） */
export async function waitMyTurn(page: Page, timeoutMs = 25_000): Promise<void> {
  const status = page.locator('.game__status-text')
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if ((await page.locator('.result').count()) > 0) return
    if ((await page.locator('.paper-modal__dialog').count()) > 0) return
    const st = (await status.textContent().catch(() => '')) ?? ''
    if (isMyTurnText(st)) return
    await page.waitForTimeout(120)
  }
  throw new Error('等待我方回合超时')
}

/** 对手网格中的指定坐标格（限定 .game__opp，避免与我方小网格的 aria-label 冲突） */
export function oppCell(page: Page, coord: string) {
  return page.locator(`.game__opp .paper-grid__board button[aria-label="${coord}"]`)
}

/* ---------------- v0.3.15：确定性种子 + 会话快照（e2e 提速） ---------------- */

/**
 * 注入确定性种子：脚本 `scripts/e2e-local.sh` 导出 E2E_SEED → 写入 `localStorage['aero.e2eSeed']`。
 * 须在 `page.goto` 之前调用（addInitScript）。E2E_SEED 未设置或为 0 时不注入（随机 AI）。
 */
export async function useE2eSeed(page: Page): Promise<void> {
  const seed = process.env.E2E_SEED
  if (!seed || seed === '0') return
  await page.addInitScript((s: string) => {
    try {
      localStorage.setItem('aero.e2eSeed', s)
    } catch {
      /* ignore */
    }
  }, seed)
}

export interface FleetPlane {
  id: number
  rotation: number
  origin: { r: number; c: number }
}
export interface FleetHead {
  id: number
  rotation: number
  /** 机头绝对坐标 */
  head: { r: number; c: number }
  /** 机头坐标文本（A1 式） */
  coord: string
}
export interface BattleSnapshot {
  /** 对手全部真实飞机（含朝向/origin） */
  oppPlanes: FleetPlane[]
  /** 对手各飞机机头（一击命中所需） */
  oppHeads: FleetHead[]
  destroyedPlaneIds: number[]
  phase: string
  turn: number
  /** 我方已收到的对方报点（AI 已出手记录） */
  myReceived: Array<{ r: number; c: number; outcome: string }>
}

/**
 * 读页面内 Vite 模块实例（与应用同实例）取 gameStore 会话快照：
 * 通过 performance 资源条目定位 `/src/store/gameStore.ts`（优先带 `?t=` 的 HMR 实例），
 * 动态 import 该 URL 命中浏览器 ESM 缓存 → `useGameStore.getState()`。
 * 无会话（未开局）或模块不可达时返回 null（调用方走回退逻辑）。
 */
export async function readBattleSnapshot(page: Page): Promise<BattleSnapshot | null> {
  return page.evaluate(async () => {
    const urls = performance
      .getEntriesByType('resource')
      .map((e) => e.name)
      .filter((n) => n.includes('/src/store/gameStore.ts'))
    const ordered = [
      ...urls.filter((u) => u.includes('?t=')),
      ...urls.filter((u) => !u.includes('?t=')),
    ]
    for (const url of ordered) {
      try {
        const mod = (await import(/* @vite-ignore */ url)) as {
          useGameStore?: { getState: () => { session?: { state?: unknown } | null } }
        }
        const st = mod.useGameStore?.getState?.()
        const session = st?.session as
          | {
              state?: {
                players: Array<{
                  planes: FleetPlane[]
                  shape: { head: { r: number; c: number } }
                  receivedShots: Array<{ coord: { r: number; c: number }; outcome: string }>
                  destroyedPlaneIds: number[]
                }>
                phase: string
                turn: number
              }
            }
          | null
          | undefined
        const state = session?.state
        if (!state) continue
        const letters = 'ABCDEFGHIJ'
        const oppHeads = state.players[1].planes.map((p) => {
          let h = { r: state.players[1].shape.head.r, c: state.players[1].shape.head.c }
          for (let i = 0; i < p.rotation; i++) h = { r: h.c, c: 4 - h.r }
          const head = { r: h.r + p.origin.r, c: h.c + p.origin.c }
          return {
            id: p.id,
            rotation: p.rotation,
            head,
            coord: `${letters[head.c]}${head.r + 1}`,
          }
        })
        return {
          oppPlanes: state.players[1].planes,
          oppHeads,
          destroyedPlaneIds: state.players[1].destroyedPlaneIds,
          phase: state.phase,
          turn: state.turn,
          myReceived: state.players[0].receivedShots.map((x) => ({ ...x.coord, outcome: x.outcome })),
        }
      } catch {
        /* 尝试下一个 URL */
      }
    }
    return null
  })
}

/* ---------------- v0.3.0 导航（练习模式面板 / 对战模式） ---------------- */

export type PracticeMode = '经典模式' | '超快棋模式' | '盲棋模式'

/** 主页 → 练习模式（面板页） */
export async function openPractice(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByRole('button', { name: '练习模式' }).click()
  await expect(page.getByRole('heading', { name: '练习模式' })).toBeVisible()
}

/** 练习模式 → 子模式 → 尺寸档位 → 「开始摆阵」→ 摆阵页（经典/超快棋/盲棋共用路径） */
export async function practiceToPlacement(
  page: Page,
  mode: PracticeMode,
  size = /小型 · 10×10/,
): Promise<void> {
  await openPractice(page)
  await page.getByRole('button', { name: mode }).click()
  await expect(page.getByRole('heading', { name: mode })).toBeVisible()
  await page.getByRole('button', { name: size }).click()
  await page.getByRole('button', { name: '开始摆阵' }).click()
  await expect(page.getByRole('heading', { name: '摆阵 · 单人对局' })).toBeVisible()
}

/** 摆阵页：随机摆阵 → 校验通过 → 确认布阵（进入对局） */
export async function confirmRandomFleet(page: Page): Promise<void> {
  await page.getByRole('button', { name: '随机摆阵' }).click()
  await expect(page.locator('.placement__status')).toContainText('校验通过')
  await page.getByRole('button', { name: '确认布阵' }).click()
}

/** 单机小型档开局（经典/超快棋/盲棋通用）：导航 → 摆阵 → 确认 → 先后手横幅结束 */
export async function startSingleSmallGame(page: Page, mode: PracticeMode = '经典模式'): Promise<void> {
  await practiceToPlacement(page, mode)
  await confirmRandomFleet(page)
  await expect(page.locator('.game-banner')).toBeVisible()
  await expect(page.locator('.game-banner')).toBeHidden({ timeout: 8000 })
}

/** 主页 → 对战模式（联机菜单） */
export async function openOnline(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByRole('button', { name: '对战模式' }).click()
  await expect(page.getByRole('heading', { name: '对战模式' })).toBeVisible()
}

/** 对战模式（自定义房间卡）：房主建房（默认小型，可选开超快棋/盲棋）→ 返回房码并停留摆阵页 */
export async function createRoomHost(page: Page, opts: { blitz?: boolean; blind?: boolean } = {}) {
  await openOnline(page)
  if (opts.blitz) await page.locator('.online__customcard label.online__check', { hasText: /^超快棋$/ }).click()
  if (opts.blind) await page.locator('.online__customcard label.online__check', { hasText: /^盲棋$/ }).click()
  const createBtn = page.getByRole('button', { name: '创建房间' })
  await expect(createBtn).toBeEnabled({ timeout: 15000 }) // 等 v0.3 客户端连上服务器
  await createBtn.click()
  await expect(page.locator('.online__roomcode')).toBeVisible({ timeout: 10000 })
  const code = (await page.locator('.online__roomcode').innerText()).trim()
  expect(code).toMatch(/^[A-Z0-9]{6}$/)
  return code
}

/** 对战模式：凭房码加入（摆阵页）；连接建立等待放宽（不重试——重试会先触发离开房间） */
export async function joinRoomByCode(page: Page, code: string): Promise<void> {
  await openOnline(page)
  await page.getByLabel('房码输入').fill(code)
  const joinBtn = page.getByRole('button', { name: '加入已有对局' })
  await expect(joinBtn).toBeEnabled({ timeout: 20000 })
  await joinBtn.click()
  await expect(page.locator('.online__roomcode')).toHaveText(code, { timeout: 20000 })
}

/** 双人房：双方随机摆阵并就绪（回到联机对局） */
export async function bothReadyOnline(a: Page, b: Page): Promise<void> {
  for (const p of [a, b]) {
    await p.getByRole('button', { name: '随机摆阵' }).click()
    await expect(p.getByRole('button', { name: '确认布阵并就绪' })).toBeEnabled({ timeout: 10000 })
    await p.getByRole('button', { name: '确认布阵并就绪' }).click()
  }
  await expect(a.locator('.game__opp .paper-grid__board')).toBeVisible({ timeout: 20000 })
  await expect(b.locator('.game__opp .paper-grid__board')).toBeVisible({ timeout: 20000 })
}
