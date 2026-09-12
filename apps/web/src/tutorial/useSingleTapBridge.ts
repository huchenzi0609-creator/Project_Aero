/**
 * useSingleTapBridge —— 教程内「单击报点」兼容（v0.3.16）。
 *
 * 背景：GameScreen 的单击报点按 `singleTapShot && !onGameEvent` 判定 —— 教程对局注入了
 * onGameEvent（教程需要事件流），因此教程内仍保持“两步：选中 → 再点确认”的旧语义。
 * 本 hook 在教程域补一层桥接：**玩家单击空网格时，于下一帧补发一次同格点击**，
 * 使“单击”与原来的“双击”完全等价（引擎裁决、事件、音效都走同一条既有路径，不新造报点逻辑）。
 *
 * 作用范围仅 `.game__opp .paper-grid__cell`（对手空网格）：
 * - 我方回合 → 等价双击 = 立即报点；
 * - 对方回合 → 等价双击 = 创建预报点（与 singleTapShot 在非教程对局的语义一致）。
 * 只处理真实点击（isTrusted），补发事件被忽略，避免自触发递归；补发前校验元素仍在文档中。
 */
import { useEffect } from 'react'

export function useSingleTapBridge(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return
    const onDocClick = (e: MouseEvent) => {
      if (!e.isTrusted) return
      const target = e.target as HTMLElement | null
      const cell = target?.closest?.('.game__opp .paper-grid__cell') as HTMLElement | null
      if (!cell || !cell.classList.contains('paper-grid__cell--clickable')) return
      // 下一帧补一次同格点击：此时 GameScreen 已完成“选中”状态提交 → 命中“再点确认”分支
      window.setTimeout(() => {
        if (document.contains(cell)) cell.click()
      }, 30)
    }
    document.addEventListener('click', onDocClick, true)
    return () => document.removeEventListener('click', onDocClick, true)
  }, [enabled])
}
