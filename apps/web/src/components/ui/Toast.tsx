import { useToastStore } from '../../store/toastStore'

/** 纸片 Toast 容器（aria-live 提示区） */
export function ToastRegion() {
  const items = useToastStore((s) => s.items)
  return (
    <div className="toast-region" role="region" aria-label="提示" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast toast--${t.kind}`} role="status">
          {t.message}
        </div>
      ))}
    </div>
  )
}
