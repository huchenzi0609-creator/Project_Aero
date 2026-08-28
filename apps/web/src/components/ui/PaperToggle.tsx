import { useId } from 'react'
import type { InputHTMLAttributes } from 'react'

export interface PaperToggleProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'checked' | 'onChange'> {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
  description?: string
}

/** 纸材开关（role="switch"）：纸槽 + 纸片滑块 */
export function PaperToggle({
  label,
  checked,
  onChange,
  description,
  id,
  className,
  ...rest
}: PaperToggleProps) {
  const uid = useId()
  const inputId = id ?? uid
  return (
    <div className={['paper-toggle', className].filter(Boolean).join(' ')}>
      <input
        id={inputId}
        type="checkbox"
        role="switch"
        className="paper-toggle__input"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        {...rest}
      />
      <span className="paper-toggle__track" aria-hidden="true">
        <span className="paper-toggle__knob" />
      </span>
      <span className="paper-toggle__body">
        <label className="paper-toggle__label" htmlFor={inputId}>
          {label}
        </label>
        {description ? <span className="paper-toggle__desc">{description}</span> : null}
      </span>
    </div>
  )
}
