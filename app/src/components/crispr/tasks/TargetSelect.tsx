/**
 * The control that asks what a task is aimed at. Coding features come first
 * in the list, since most of these tasks only make sense inside a gene.
 */

import { useTargetOptions, SELECTION_VALUE, WHOLE_VALUE, CODING_TYPES } from './target'

interface Props {
  value: string
  onChange: (value: string) => void
  /** Offer only the features a gene-shaped task can use. */
  codingOnly?: boolean
  /** Offer the whole molecule as a choice. */
  whole?: boolean
  label?: string
}

export default function TargetSelect({ value, onChange, codingOnly = false, whole = false, label = 'Target' }: Props) {
  const options = useTargetOptions()
  const shown = codingOnly ? options.filter(a => CODING_TYPES.has(a.type)) : options
  return (
    <div className="gp-field gp-field-wide">
      <label htmlFor="gp-target">{label}</label>
      <select id="gp-target" value={value} onChange={e => onChange(e.target.value)}>
        {whole && <option value={WHOLE_VALUE}>The whole sequence</option>}
        <option value={SELECTION_VALUE}>The selection</option>
        {shown.map(a => (
          <option key={a.id} value={a.id}>{a.name} ({a.type})</option>
        ))}
      </select>
    </div>
  )
}
