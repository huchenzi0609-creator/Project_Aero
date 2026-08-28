import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

export interface PaperModalProps {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}

/** 纸片弹窗：Esc 关闭、点击遮罩关闭、打开时聚焦关闭按钮 */
export function PaperModal({ open, title, onClose, children, footer }: PaperModalProps) {
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    closeRef.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="paper-modal__backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="paper-modal__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="paper-modal-title"
      >
        <div className="paper-modal__head">
          <h2 id="paper-modal-title" className="paper-modal__title">
            {title}
          </h2>
          <button
            ref={closeRef}
            type="button"
            className="paper-modal__close"
            onClick={onClose}
            aria-label="关闭对话框"
          >
            ✕
          </button>
        </div>
        <div className="paper-modal__body">{children}</div>
        {footer ? <div className="paper-modal__foot">{footer}</div> : null}
      </div>
    </div>
  )
}
