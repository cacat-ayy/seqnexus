/**
 * Tag editor for one item.
 *
 * Existing tags are chips you toggle, so the common case (reusing a tag you
 * already made) is one click and cannot introduce a near-duplicate by typo.
 * The field only creates when you type something new.
 */

import { useRef, useState } from 'react'
import { Check } from 'lucide-react'
import ContextMenuPopup from '../ContextMenuPopup'
import { usePopoverDismiss } from '../../hooks/usePopoverDismiss'
import { PRESET_COLORS } from '../../utils/annotation-constants'

interface Props {
  x: number
  y: number
  itemName: string
  /** Tags on this item. */
  active: string[]
  /** Every tag in the session, so one can be reused rather than retyped. */
  all: string[]
  colors: Record<string, string>
  onToggle: (tag: string) => void
  onCreate: (tag: string) => void
  onSetColor: (tag: string, color: string) => void
  onClose: () => void
}

export default function ExplorerTagEditor({
  x, y, itemName, active, all, colors, onToggle, onCreate, onSetColor, onClose,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState('')
  // Which tag the swatch row recolours. Defaults to the last one touched, so
  // creating a tag and then picking a colour does what it looks like it does.
  const [colorTarget, setColorTarget] = useState<string | null>(active[0] ?? null)
  usePopoverDismiss(true, onClose, ref)

  const activeSet = new Set(active)
  const submit = () => {
    const name = draft.trim()
    if (!name) return
    onCreate(name)
    setColorTarget(name)
    setDraft('')
  }

  return (
    <div ref={ref}>
      <ContextMenuPopup x={x} y={y}>
        <div className="ex-tag-editor">
          <div className="ctx-menu-header">Tags on {itemName}</div>

          {all.length > 0 && (
            <div className="ex-tag-list">
              {all.map(tag => (
                <button
                  key={tag}
                  className={`ex-chip ${activeSet.has(tag) ? 'on' : ''}`}
                  aria-pressed={activeSet.has(tag)}
                  style={{ '--chip-color': colors[tag] } as React.CSSProperties}
                  onClick={() => { onToggle(tag); setColorTarget(tag) }}
                >
                  <span className="ex-chip-dot" />
                  {tag}
                  {activeSet.has(tag) && <Check size={10} />}
                </button>
              ))}
            </div>
          )}

          <input
            className="ex-tag-input"
            placeholder="New tag"
            value={draft}
            autoFocus
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); submit() }
              else if (e.key === 'Escape') onClose()
            }}
          />

          {colorTarget && (
            <div className="ex-swatches" role="group" aria-label={`Colour for ${colorTarget}`}>
              {PRESET_COLORS.slice(0, 16).map(color => (
                <button
                  key={color}
                  className={`ex-swatch ${colors[colorTarget] === color ? 'on' : ''}`}
                  style={{ background: color }}
                  aria-label={color}
                  onClick={() => onSetColor(colorTarget, color)}
                />
              ))}
            </div>
          )}
        </div>
      </ContextMenuPopup>
    </div>
  )
}
