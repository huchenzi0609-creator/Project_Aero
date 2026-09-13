/**
 * spotlightCarry —— 遮罩洞几何的跨阶段交接（v0.3.17-beta2）。
 *
 * 场景：教程单元之间会整体替换页面组件（摆阵页 → 对局页），TutorialSpotlight 实例随之卸载重建。
 * 若新实例从“整页洞”起步，跨单元那次过渡就会表现为“从边缘收缩”，而不是从上一单元的洞位续接。
 * 本模块让旧实例在卸载时把当前洞几何暂存下来，新实例首帧直接沿用（≈2.5s 内有效），
 * 从而使跨单元切换是**连续的 transfer**（如：摆阵页「确认布阵」按钮的洞 → 对局页对话气泡的洞）。
 */
import type { TargetRect } from './TutorialSpotlight'

interface Carry {
  rects: TargetRect[]
  t: number
}

const CARRY_TTL_MS = 2500
let carry: Carry | null = null

/** 卸载时暂存当前洞几何（无洞或整页洞不暂存，避免污染下一阶段） */
export function rememberSpotlightRects(rects: TargetRect[]): void {
  if (rects.length === 0) return
  const pageOnly =
    rects.length === 1 &&
    rects[0]!.left <= 1 &&
    rects[0]!.top <= 1 &&
    rects[0]!.width >= (typeof window !== 'undefined' ? window.innerWidth : 0) - 1
  if (pageOnly) return
  carry = { rects: rects.map((r) => ({ ...r })), t: Date.now() }
}

/** 首帧读取（只读，不消费；供 useState 初始化用，StrictMode 双调用安全） */
export function peekSpotlightCarry(): TargetRect[] | null {
  if (!carry) return null
  if (Date.now() - carry.t > CARRY_TTL_MS) {
    carry = null
    return null
  }
  return carry.rects.map((r) => ({ ...r }))
}

/** 首帧提交后清空（不重复消费） */
export function clearSpotlightCarry(): void {
  carry = null
}
