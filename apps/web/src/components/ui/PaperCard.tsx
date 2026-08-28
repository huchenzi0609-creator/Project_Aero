import type { HTMLAttributes, ReactNode } from 'react'

export interface PaperCardProps extends HTMLAttributes<HTMLDivElement> {
  /** 顶部胶带装饰 */
  tape?: boolean
  /** 右上图钉装饰 */
  pin?: boolean
  children?: ReactNode
}

/** 纸卡：微折角阴影 + 极轻圆角；可选胶带 / 图钉纸桌装饰 */
export function PaperCard({ tape = false, pin = false, className, children, ...rest }: PaperCardProps) {
  const cls = [
    'paper-card',
    tape ? 'paper-card--taped' : '',
    pin ? 'paper-card--pinned' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <div className={cls} {...rest}>
      {children}
    </div>
  )
}
