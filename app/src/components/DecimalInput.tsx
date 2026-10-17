/**
 * A number field that always shows and reads a decimal point. A number
 * input of type "number" is formatted by the browser in the system locale,
 * so on a German or Dutch machine "0.05" showed as "0,05" while every other
 * number in the app is written the en-US way. This is a text field with a
 * decimal keyboard on phones; it accepts a comma when typed and commits on
 * blur or Enter, clamped to the range.
 */
import { useEffect, useState } from 'react'

interface Props {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  className?: string
  placeholder?: string
  disabled?: boolean
  'aria-label'?: string
  /** How the value is written back after a commit (default: as JavaScript writes it). */
  format?: (v: number) => string
}

export default function DecimalInput({ value, onChange, min, max, className, placeholder, disabled, format, 'aria-label': label }: Props) {
  const show = format ?? String
  const [draft, setDraft] = useState(show(value))
  useEffect(() => { setDraft(show(value)) }, [value]) // eslint-disable-line react-hooks/exhaustive-deps
  const commit = () => {
    const n = Number(draft.trim().replace(',', '.'))
    if (draft.trim() === '' || !Number.isFinite(n)) { setDraft(show(value)); return }
    const v = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n))
    setDraft(show(v))
    if (v !== value) onChange(v)
  }
  return (
    <input
      className={className}
      type="text"
      inputMode="decimal"
      value={draft}
      placeholder={placeholder}
      disabled={disabled}
      aria-label={label}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit() } }}
    />
  )
}
