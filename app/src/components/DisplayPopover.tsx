/**
 * Sequence-view display settings.
 *
 * Sits with the ORFs / REs / Primers toggles because everything in it controls
 * what the sequence view draws. Unlike those, the settings here are global
 * preferences rather than per-document state, so the popover says so rather
 * than leaving the user to discover it.
 */

import { useRef, useCallback, useState, useEffect } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { useEditorStore } from '../store'
import {
  COLOR_SCHEMES, COLOR_TARGETS, buildBasePalette,
  type ColorSchemeId, type ColorTarget,
} from '../utils/base-colors'
import { contrastText } from '../utils/color'
import { PLASMID_STYLES, type PlasmidStyleId } from '../plasmid/styles'
import { GENETIC_CODES } from '../codon/genetic-codes'
import {
  AMINO_ACID_STYLES, TRANSLATION_FRAMES, aminoAcidColor,
  type AminoAcidStyleId, type TranslationFrameId,
} from '../codon/translation-display'
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

/** The residues previewed in the amino acid palette list. */
const AA_PREVIEW = ['A', 'R', 'N', 'D', '*']

/**
 * The palette previewed the way the base schemes are.
 *
 * Reading a palette name tells you nothing; seeing D red and A grey does. The
 * residues are the same five in every row, so the rows differ only by colour
 * and can be compared down the column.
 */
function AminoAcidSwatch({ styleId }: { styleId: AminoAcidStyleId }) {
  // "By annotation" has no palette of its own: it takes each feature's colour,
  // so the preview borrows two feature colours to say so rather than looking
  // identical to Plain.
  const FEATURE_SAMPLE = ['#4dabf7', '#51cf66', '#4dabf7', '#51cf66', '#4dabf7']

  return (
    <span className="dp-swatch" aria-hidden="true">
      {AA_PREVIEW.map((aa, i) => (
        <span
          key={aa}
          style={{
            color: styleId === 'annotation' && aa !== '*'
              ? FEATURE_SAMPLE[i]
              : aminoAcidColor(styleId, aa, 'currentColor'),
          }}
        >
          {aa}
        </span>
      ))}
    </span>
  )
}

/**
 * The frame menu, cut into the groups the list reads in.
 *
 * TRANSLATION_FRAMES marks where each group starts, so the grouping lives with
 * the options rather than being restated here.
 */
const FRAME_GROUPS = (() => {
  const labels = ['Automatic', 'Several frames', 'One frame', 'Two frames']
  const groups: { label: string; options: typeof TRANSLATION_FRAMES }[] = []
  for (const option of TRANSLATION_FRAMES) {
    if (groups.length === 0 || option.startsGroup) {
      groups.push({ label: labels[groups.length] ?? '', options: [] })
    }
    groups[groups.length - 1].options.push(option)
  }
  return groups
})()

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
  const plasmidStyle = useEditorStore(s => s.plasmidStyle)
  const setPlasmidStyle = useEditorStore(s => s.setPlasmidStyle)
  const showGcRing = useEditorStore(s => s.showGcRing)
  const toggleGcRing = useEditorStore(s => s.toggleGcRing)
  const showPlasmidLegend = useEditorStore(s => s.showPlasmidLegend)
  const togglePlasmidLegend = useEditorStore(s => s.togglePlasmidLegend)
  const showTranslation = useEditorStore(s => s.showTranslation)
  const toggleTranslation = useEditorStore(s => s.toggleTranslation)
  const translationFrame = useEditorStore(s => s.translationFrame)
  const setTranslationFrame = useEditorStore(s => s.setTranslationFrame)
  const translationCodeId = useEditorStore(s => s.translationCodeId)
  const setTranslationCode = useEditorStore(s => s.setTranslationCode)
  const aminoAcidStyle = useEditorStore(s => s.aminoAcidStyle)
  const setAminoAcidStyle = useEditorStore(s => s.setAminoAcidStyle)
  const threeLetterAminoAcids = useEditorStore(s => s.threeLetterAminoAcids)
  const toggleThreeLetterAminoAcids = useEditorStore(s => s.toggleThreeLetterAminoAcids)

  const [aaMenuOpen, setAaMenuOpen] = useState(false)
  const [aaMenuUp, setAaMenuUp] = useState(false)
  const aaPickerRef = useRef<HTMLDivElement | null>(null)
  const aminoAcidStyleLabel =
    AMINO_ACID_STYLES.find(s => s.id === aminoAcidStyle)?.label ?? aminoAcidStyle

  // The palette menu closes with the popover, and with Escape, which would
  // otherwise close the whole popover while the menu stayed open underneath.
  useEffect(() => { if (!open) setAaMenuOpen(false) }, [open])
  useEffect(() => {
    if (!aaMenuOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); setAaMenuOpen(false) }
    }
    const onDown = (e: MouseEvent) => {
      if (!aaPickerRef.current?.contains(e.target as Node)) setAaMenuOpen(false)
    }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('mousedown', onDown)
    }
  }, [aaMenuOpen])

  /**
   * Open upwards when there is no room below.
   *
   * The popover is a scroll container, so a menu that runs past its bottom
   * edge is clipped rather than overflowing onto the page.
   */
  useEffect(() => {
    if (!aaMenuOpen) return
    const trigger = aaPickerRef.current
    const popover = ref.current
    if (!trigger || !popover) return
    const t = trigger.getBoundingClientRect()
    const box = popover.getBoundingClientRect()
    const MENU_MAX = 232
    const bottomEdge = Math.min(box.bottom, window.innerHeight)
    setAaMenuUp(t.bottom + MENU_MAX > bottomEdge && t.top - MENU_MAX > box.top)
  }, [aaMenuOpen])

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
              <Check size={13} className="dp-scheme-check" aria-hidden="true" />
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

      <div className="dp-sep" />

      <div className="dp-section">
        <div className="dp-section-label">Translation</div>
        <label className="dp-check">
          <input type="checkbox" checked={showTranslation} onChange={toggleTranslation} />
          <span>Show amino acids</span>
        </label>

        {/* The rest only makes sense once there is a translation to configure,
            and hiding it keeps the popover from growing a block of controls
            that do nothing. */}
        {showTranslation && (
          <div className="dp-fields">
            <label className="dp-field">
              <span className="dp-field-label">Frame</span>
              <select
                className="select dp-select"
                value={translationFrame}
                onChange={e => setTranslationFrame(e.target.value as TranslationFrameId)}
              >
                {FRAME_GROUPS.map(group => (
                  <optgroup key={group.label} label={group.label}>
                    {group.options.map(f => (
                      <option key={f.id} value={f.id}>{f.label}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>

            <label className="dp-field">
              <span className="dp-field-label">Genetic code</span>
              <select
                className="select dp-select"
                value={translationCodeId}
                onChange={e => setTranslationCode(Number(e.target.value))}
              >
                {GENETIC_CODES.map(c => (
                  <option key={c.id} value={c.id}>{c.id}. {c.name}</option>
                ))}
              </select>
            </label>

            {/* A dropdown rather than the open list the base colours use: it
                sits in the same column as the two selects above it, and eight
                palettes below them would push the plasmid settings off the
                popover. The trigger previews the chosen palette, so the
                colours are still visible without opening it. */}
            <div className="dp-field">
              <span className="dp-field-label" id="dp-aa-label">Colours</span>
              <div className="dp-aa-picker" ref={aaPickerRef}>
                <button
                  className={`dp-aa-trigger ${aaMenuOpen ? 'open' : ''}`}
                  onClick={() => setAaMenuOpen(v => !v)}
                  aria-haspopup="listbox"
                  aria-expanded={aaMenuOpen}
                  aria-labelledby="dp-aa-label"
                >
                  <AminoAcidSwatch styleId={aminoAcidStyle} />
                  <span className="dp-aa-name">{aminoAcidStyleLabel}</span>
                  <ChevronDown size={12} className="dp-aa-caret" aria-hidden="true" />
                </button>

                {aaMenuOpen && (
                  <div
                    className={`dp-aa-menu ${aaMenuUp ? 'up' : ''}`}
                    role="listbox"
                    aria-labelledby="dp-aa-label"
                  >
                    {AMINO_ACID_STYLES.map(s => (
                      <button
                        key={s.id}
                        className={`dp-scheme ${aminoAcidStyle === s.id ? 'active' : ''}`}
                        role="option"
                        aria-selected={aminoAcidStyle === s.id}
                        title={s.description}
                        onClick={() => { setAminoAcidStyle(s.id); setAaMenuOpen(false) }}
                      >
                        <AminoAcidSwatch styleId={s.id} />
                        <span className="dp-scheme-label">{s.label}</span>
                        <Check size={13} className="dp-scheme-check" aria-hidden="true" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <label className="dp-check">
              <input
                type="checkbox"
                checked={threeLetterAminoAcids}
                onChange={toggleThreeLetterAminoAcids}
              />
              <span>Three-letter codes (Ala, not A)</span>
            </label>
          </div>
        )}
      </div>

      <div className="dp-sep" />

      <div className="dp-section">
        <div className="dp-section-label" id="dp-plasmid-label">Plasmid map</div>
        <div className="dp-style-list" role="radiogroup" aria-labelledby="dp-plasmid-label">
          {PLASMID_STYLES.map(s => (
            <button
              key={s.id}
              className={`dp-style ${plasmidStyle === s.id ? 'active' : ''}`}
              role="radio"
              aria-checked={plasmidStyle === s.id}
              onClick={() => setPlasmidStyle(s.id as PlasmidStyleId)}
            >
              <span className="dp-style-text">
                <span className="dp-style-name">{s.label}</span>
                <span className="dp-style-desc">{s.description}</span>
              </span>
              {/* Always rendered, hidden when inactive: a tick that appears
                  and disappears would resize the popover as the selection
                  moves between rows. */}
              <Check size={13} className="dp-style-check" aria-hidden="true" />
            </button>
          ))}
        </div>
        <label className="dp-check">
          <input type="checkbox" checked={showGcRing} onChange={toggleGcRing} />
          <span>GC content and skew ring</span>
        </label>
        <label className="dp-check">
          <input type="checkbox" checked={showPlasmidLegend} onChange={togglePlasmidLegend} />
          <span>Feature colour key</span>
        </label>
      </div>

    </div>
  )
}
