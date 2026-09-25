/**
 * Sequence-view display settings.
 *
 * Sits with the ORFs / REs / Primers toggles because everything in it controls
 * what the sequence view draws. Unlike those, the settings here are global
 * preferences rather than per-document state, so the popover says so rather
 * than leaving the user to discover it.
 */

import { useRef, useCallback } from 'react'
import { Check } from 'lucide-react'
import { useEditorStore } from '../store'
import {
  COLOR_SCHEMES, COLOR_TARGETS, buildBasePalette,
  type ColorSchemeId, type ColorTarget,
} from '../utils/base-colors'
import { contrastText } from '../utils/color'
import { usePopoverDismiss } from '../hooks/usePopoverDismiss'
import { useClampedPosition } from '../hooks/useClampedPosition'
import './DisplayPopover.css'

interface Props {
  open: boolean
  onClose: () => void
  triggerRef: React.RefObject<HTMLElement | null>
}

/**
 * The four bases previewed exactly as the canvas will draw them.
 *
 * The preview follows the current target, so switching to Background
 * immediately shows filled blocks in the list — picking a scheme should not
 * require imagining what it will look like.
 */
function SchemeSwatch({ schemeId, target }: { schemeId: ColorSchemeId; target: ColorTarget }) {
  // Previews sit on the popover background, so the "text colour" a scheme
  // falls back to is the popover's foreground, not the canvas's.
  const palette = buildBasePalette(schemeId, 'currentColor')
  const filled = target === 'background' && schemeId !== 'none'

  return (
    <span className={`dp-swatch ${filled ? 'filled' : ''}`} aria-hidden="true">
      {['A', 'C', 'G', 'T'].map(b => {
        const color = palette[b]
        const isPlain = color === 'currentColor'
        return (
          <span
            key={b}
            style={filled && !isPlain
              ? { background: color, color: contrastText(color) }
              : { color }}
          >
            {b}
          </span>
        )
      })}
    </span>
  )
}

export default function DisplayPopover({ open, onClose, triggerRef }: Props) {
  const ref = useRef<HTMLDivElement | null>(null)

  // Positioned fixed and clamped to the viewport rather than absolutely inside
  // the panel bar. The trigger is pinned to the bar's right edge, so an
  // absolutely-positioned popover ran off the screen — and .main-area is
  // overflow:hidden, so it was clipped as well as overflowing. Anchoring to the
  // trigger's left edge and letting the clamp pull it back keeps it on screen
  // at any window size, on both axes.
  const rect = open ? triggerRef.current?.getBoundingClientRect() : undefined
  const { ref: clampRef, pos } = useClampedPosition(rect?.left ?? 0, (rect?.bottom ?? 0) + 4)

  // One node, two hooks: the dismiss handler needs an object ref, the clamp
  // needs a callback ref to measure on mount.
  const setNode = useCallback((node: HTMLDivElement | null) => {
    ref.current = node
    clampRef(node)
  }, [clampRef])

  usePopoverDismiss(open, onClose, ref, triggerRef)

  const colorScheme = useEditorStore(s => s.colorScheme)
  const setColorScheme = useEditorStore(s => s.setColorScheme)
  const colorTarget = useEditorStore(s => s.colorTarget)
  const setColorTarget = useEditorStore(s => s.setColorTarget)
  const showComplement = useEditorStore(s => s.showComplement)
  const toggleComplement = useEditorStore(s => s.toggleComplement)
  const showAnnotationTracks = useEditorStore(s => s.showAnnotationTracks)
  const toggleAnnotationTracks = useEditorStore(s => s.toggleAnnotationTracks)

  if (!open) return null

  return (
    <div
      className="dp-popover"
      ref={setNode}
      style={{ left: pos.left, top: pos.top }}
      role="dialog"
      aria-label="Display settings"
    >
      <div className="dp-section">
        <div className="dp-target-row">
          <span className="dp-section-label" id="dp-scheme-label">Base colours</span>
          {/* Applies to whichever scheme is chosen, so it sits above the list
              rather than duplicating every scheme in two variants. */}
          <div className="dp-target" role="radiogroup" aria-label="Apply colour to">
            {COLOR_TARGETS.map(t => (
              <button
                key={t.id}
                className={`dp-target-btn ${colorTarget === t.id ? 'active' : ''}`}
                role="radio"
                aria-checked={colorTarget === t.id}
                disabled={colorScheme === 'none'}
                title={colorScheme === 'none'
                  ? 'Choose a colour scheme first'
                  : `Colour the ${t.id === 'letters' ? 'letters' : 'cell behind each base'}`}
                onClick={() => setColorTarget(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <div className="dp-scheme-list" role="radiogroup" aria-labelledby="dp-scheme-label">
          {COLOR_SCHEMES.map(scheme => (
            <button
              key={scheme.id}
              className={`dp-scheme ${colorScheme === scheme.id ? 'active' : ''}`}
              role="radio"
              aria-checked={colorScheme === scheme.id}
              title={scheme.description}
              onClick={() => setColorScheme(scheme.id)}
            >
              <SchemeSwatch schemeId={scheme.id} target={colorTarget} />
              <span className="dp-scheme-label">{scheme.label}</span>
              {colorScheme === scheme.id && <Check size={13} className="dp-scheme-check" />}
            </button>
          ))}
        </div>
      </div>

      <div className="dp-sep" />

      <div className="dp-section">
        <div className="dp-section-label">Show</div>
        <label className="dp-check">
          <input type="checkbox" checked={showComplement} onChange={toggleComplement} />
          <span>Complement strand</span>
        </label>
        <label className="dp-check">
          <input type="checkbox" checked={showAnnotationTracks} onChange={toggleAnnotationTracks} />
          <span>Annotation tracks</span>
        </label>
      </div>

      <div className="dp-note">Applies to all sequences and is remembered.</div>
    </div>
  )
}
