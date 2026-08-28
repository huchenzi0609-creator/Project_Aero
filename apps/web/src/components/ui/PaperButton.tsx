import type { ButtonHTMLAttributes, ReactNode } from 'react'

export interface PaperButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary' | 'danger' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
  children: ReactNode
}

/** 纸卡按钮：微阴影 + 按压下沉 2px + 禁用态变灰纸片 */
export function PaperButton({
  variant = 'default',
  size = 'md',
  className,
  children,
  ...rest
}: PaperButtonProps) {
  const cls = ['paper-btn', `paper-btn--${variant}`, `paper-btn--${size}`, className]
    .filter(Boolean)
    .join(' ')
  return (
    <button type="button" className={cls} {...rest}>
      {children}
    </button>
  )
}
