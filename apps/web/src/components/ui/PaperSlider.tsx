import { useId } from 'react'
import type { InputHTMLAttributes } from 'react'

export interface PaperSliderProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> {
  label: string
  /** 0..1 */
  value: number
  onChange: (v: number) => void
  hint?: string
}

/** 纸槽滑杆：墨线轨道 + 纸片滑块（带刻度线） */
export function PaperSlider({
  label,
  value,
  onChange,
  hint,
  min = 0,
  max = 1,
  step = 0.01,
  id,
  className,
  ...rest
}: PaperSliderProps) {
  const uid = useId()
  const inputId = id ?? uid
  return (
    <label className={['paper-slider', className].filter(Boolean).join(' ')} htmlFor={inputId}>
      <span className="paper-slider__head">
        <span className="paper-slider__label">{label}</span>
        <span className="paper-slider__value">{Math.round(value * 100)}%</span>
      </span>
      <input
        id={inputId}
        type="range"
        className="paper-slider__input"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        {...rest}
      />
      {hint ? <span className="paper-slider__hint">{hint}</span> : null}
    </label>
  )
}
