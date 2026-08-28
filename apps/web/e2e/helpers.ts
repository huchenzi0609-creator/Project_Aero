/**
 * e2e 公共工具：控制台错误收集 / 棋盘坐标生成 / 网格定位。
 * （no-undef 因 evaluate 回调内使用 document/window 等浏览器全局而关闭）
 */
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

/** 对手网格中的指定坐标格（限定 .game__opp，避免与我方小网格的 aria-label 冲突） */
export function oppCell(page: Page, coord: string) {
  return page.locator(`.game__opp .paper-grid__board button[aria-label="${coord}"]`)
}
