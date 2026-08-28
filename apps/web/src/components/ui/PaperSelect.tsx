import { useId } from 'react'
import type { SelectHTMLAttributes } from 'react'

export interface PaperSelectOption<T extends string> {
  value: T
  label: string
  description?: string
}

export interface PaperSelectProps<T extends string>
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange'> {
  label: string
  value: T
  onChange: (value: T) => void
  options: ReadonlyArray<PaperSelectOption<T>>
  /** 固定说明文字；缺省时展示当前选项的 description */
  description?: string
}

/** 纸材选单：纸片下拉 + 手绘箭头 */
export function PaperSelect<T extends string>({
  label,
  value,
  onChange,
  options,
  description,
  id,
  className,
  ...rest
}: PaperSelectProps<T>) {
  const uid = useId()
  const inputId = id ?? uid
  const current = options.find((o) => o.value === value)
  return (
    <div className={['paper-select', className].filter(Boolean).join(' ')}>
      <label className="paper-select__label" htmlFor={inputId}>
        {label}
      </label>
      <div className="paper-select__wrap">
        <select
          id={inputId}
          className="paper-select__control"
          value={value}
          onChange={(e) => onChange(e.target.value as T)}
          {...rest}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      {(description ?? current?.description) ? (
        <span className="paper-select__desc">{description ?? current?.description}</span>
      ) : null}
    </div>
  )
}
