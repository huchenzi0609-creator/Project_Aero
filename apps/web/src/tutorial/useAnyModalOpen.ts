/**
 * useAnyModalOpen —— 教程纵深防护：文档中只要存在已打开的弹窗（`.paper-modal__dialog`），
 * 即返回 true，教程层据此【不渲染】交互阻断带与暗层。
 *
 * 背景（v0.3.13 加固）：教程 <突显> 为模态，其阻断带 z-index 高于旧版弹窗；
 * 一旦弹窗与突显同时存在，弹窗按钮会被阻断带拦截。M3 在 components.css 提升弹窗层级
 * 做根因修复，本 hook 为教程侧第二道防线：即使未来层级再变动、或弹窗由教程域之外
 * 的组件（如 GameScreen 的对局内退出确认）打开，教程层也不参与遮挡。
 *
 * 说明：PaperModal 关闭时返回 null（`.paper-modal__dialog` 不存在），故以 DOM 存在性判定即可；
 * 外部弹窗的打开与本 hook 的感知之间最多相差一帧（MutationObserver 回调），
 * 教程自身持有的弹窗态（exitOpen / doneOpen 等）仍由调用方按 state 同步门控。
 */
import { useEffect, useState } from 'react'

const OPEN_MODAL_SELECTOR = '.paper-modal__dialog'

function anyModalOpen(): boolean {
  if (typeof document === 'undefined') return false
  return Boolean(document.querySelector(OPEN_MODAL_SELECTOR))
}

export function useAnyModalOpen(): boolean {
  const [open, setOpen] = useState(anyModalOpen)

  useEffect(() => {
    const sync = () => setOpen(anyModalOpen())
    sync()
    const mo = new MutationObserver(sync)
    mo.observe(document.body, { childList: true, subtree: true })
    return () => mo.disconnect()
  }, [])

  return open
}
