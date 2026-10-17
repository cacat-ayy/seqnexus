/**
 * The parts going into a design, and what to do with each.
 *
 * A part is a sequence, or a stretch of one. Each sits on one line (its
 * colour, name, size and role) with a second line saying what it goes into
 * the reaction as, and anything set away from the default. Clicking its name
 * brings its map to the front, which is where it is cut. The settings that
 * are rarely touched (which way round it may go, whether its ends were
 * dephosphorylated) open beneath it from the arrow.
 */

import { useEffect, useRef, useState } from 'react'
import { ChevronRight, Crosshair, Trash2, TriangleAlert } from 'lucide-react'
import type { Fragment } from '../../cloning/fragment'
import { endLabel } from '../../cloning/ends'
import { keptFragment } from '../../cloning/outcome'
import {
  partLength,
  partTopology,
  type CloningDesign,
  type DesignPart,
  type PartOrientation,
} from '../../cloning/design'
import { annealOligos, duplexLines, type OligoDuplex } from '../../cloning/duplex'
import { partColor } from './colors'
import { formatBp } from '../../utils/format'

interface Props {
  design: CloningDesign
  fragments: Fragment[]
  /** Name and fingerprint of every open sequence, for spotting stale parts. */
  sources: ReadonlyMap<string, { name: string; hash: string }>
  hovered: string | null
  onHover: (id: string | null) => void
  /** The part whose map is in front. */
  selected: string
  /** Bring a part's map to the front. */
  onSelect: (id: string) => void
  onChange: (id: string, patch: Partial<DesignPart>, coalesceKey?: string) => void
  onRemove: (id: string) => void
  onRefresh: (id: string) => void
  onReveal: (part: DesignPart) => void
}

const ORIENTATION_NOTE: Record<PartOrientation, string | null> = {
  auto: null,
  forward: 'only as given',
  reverse: 'reverse complement',
}

/**
 * The two oligos a duplex part is made of. There is nothing to pick here:
 * the overhangs come out of how the strands pair, so what is shown back is
 * the pair written out as it will go into the tube (see cloning/duplex).
 */
function DuplexFields({ duplex, onChange }: {
  duplex: OligoDuplex
  onChange: (duplex: OligoDuplex) => void
}) {
  const annealed = annealOligos(duplex)
  const lines = duplexLines(duplex)
  const both = duplex.top.trim().length > 0 && duplex.bottom.trim().length > 0

  return (
    <div className="cw-duplex-fields">
      <label className="cw-detail">
        <span>Top oligo 5’→3’</span>
        <textarea
          className="input cw-oligo-input"
          rows={2}
          spellCheck={false}
          value={duplex.top}
          placeholder="CACCG…"
          onChange={e => onChange({ ...duplex, top: e.target.value })}
        />
      </label>
      <label className="cw-detail">
        <span>Bottom oligo 5’→3’</span>
        <textarea
          className="input cw-oligo-input"
          rows={2}
          spellCheck={false}
          value={duplex.bottom}
          placeholder="AAAC…"
          onChange={e => onChange({ ...duplex, bottom: e.target.value })}
        />
      </label>
      <label className="cw-detail-check" title="Synthetic oligos come without one unless ordered phosphorylated">
        <input
          type="checkbox"
          checked={duplex.phosphate ?? false}
          onChange={e => onChange({ ...duplex, phosphate: e.target.checked })}
        />
        Ordered 5’ phosphorylated
      </label>
      {both && (
        <pre className="cw-duplex-strands" aria-label="The annealed pair">
          {`5’ ${lines.top}\n3’ ${lines.bottom}`}
        </pre>
      )}
      {both && annealed.warnings.length > 0 && (
        <ul className="cw-product-warnings">
          {annealed.warnings.map((w, i) => <li key={i}><TriangleAlert size={12} />{w}</li>)}
        </ul>
      )}
      {!both && (
        <p className="cw-detail-note">
          Paste both strands as they would be ordered. The overhangs follow from where they pair.
        </p>
      )}
    </div>
  )
}

export default function PartsPanel({
  design,
  fragments,
  sources,
  hovered,
  onHover,
  selected,
  onSelect,
  onChange,
  onRemove,
  onRefresh,
  onReveal,
}: Props) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const cut = design.method === 'restriction' || design.method === 'golden-gate'

  // A duplex part is nothing but its two oligos, so a new one opens on them.
  // It is opened once, when it appears, rather than kept open while they are
  // empty: deriving it from the oligos would fold the fields away under the
  // cursor as soon as the first strand was pasted.
  const greeted = useRef<ReadonlySet<string>>(new Set())
  useEffect(() => {
    const fresh = design.parts
      .filter(p => p.duplex && !p.duplex.top && !p.duplex.bottom && !greeted.current.has(p.id))
      .map(p => p.id)
    if (fresh.length === 0) return
    greeted.current = new Set([...greeted.current, ...fresh])
    setExpanded(current => new Set([...current, ...fresh]))
  }, [design.parts])

  const toggle = (id: string) => setExpanded(current => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  return (
    <div className="cw-parts">
      {design.parts.length === 0 && (
        <p className="cw-hint">
          Nothing to clone yet. Add a sequence, or select part of one and add that.
        </p>
      )}

      {design.parts.map((part, index) => {
        const source = part.source ? sources.get(part.source.id) : undefined
        const stale = !!part.source && !!source && source.hash !== part.source.hash
        const chosen = cut ? keptFragment(part, fragments) : null
        const open = expanded.has(part.id)

        const summary = [
          design.method === 'restriction' && part.enzymes && !part.duplex
            ? (part.enzymes.length > 0 ? `cut with ${part.enzymes.join(' + ')}` : 'not cut')
            : null,
          part.duplex && chosen
            ? `annealed oligos, ends ${endLabel(chosen.left!)} · ${endLabel(chosen.right!)}`
            : cut && chosen ? `${formatBp(chosen.top.length)} piece, ends ${endLabel(chosen.left!)} · ${endLabel(chosen.right!)}` : null,
          ORIENTATION_NOTE[part.orientation],
          part.region ? 'selection only' : null,
          design.method === 'restriction' && !part.duplex && part.dephosphorylated ? 'dephosphorylated' : null,
          part.duplex?.phosphate ? '5’ phosphorylated' : null,
        ].filter((s): s is string => !!s)

        return (
          <div
            key={part.id}
            className={`cw-part ${hovered === part.id ? 'hovered' : ''} ${open ? 'open' : ''} ${selected === part.id ? 'selected' : ''}`}
            onMouseEnter={() => onHover(part.id)}
            onMouseLeave={() => onHover(null)}
          >
            <span className="cw-part-swatch" style={{ background: partColor(index) }} aria-hidden="true" />

            <div className="cw-part-main">
              <div className="cw-part-top">
                <button
                  className="cw-part-toggle"
                  onClick={() => toggle(part.id)}
                  aria-expanded={open}
                  aria-label={open ? 'Hide settings' : 'Show settings'}
                  title={open ? 'Hide settings' : 'Show settings'}
                >
                  <ChevronRight size={14} className="cw-chevron" />
                </button>
                <button
                  className="cw-part-name"
                  onClick={() => onSelect(part.id)}
                  title={`Show ${part.name} on the map`}
                >
                  <span className="cw-part-title">{part.name}</span>
                </button>
                <span className="cw-part-size">
                  {formatBp(partLength(part))}{partTopology(part) === 'circular' ? ' circular' : ''}
                </span>
                <select
                  className="select cw-part-role"
                  value={part.role}
                  aria-label="Role"
                  onChange={e => onChange(part.id, { role: e.target.value as DesignPart['role'] })}
                >
                  <option value="vector">Vector</option>
                  <option value="insert">Insert</option>
                </select>
                <span className="cw-part-actions">
                  {part.source && sources.has(part.source.id) && (
                    <button
                      className="cw-icon-btn"
                      onClick={() => onReveal(part)}
                      title="Show this part on its sequence"
                      aria-label="Show this part on its sequence"
                    >
                      <Crosshair size={14} />
                    </button>
                  )}
                  <button
                    className="cw-icon-btn"
                    onClick={() => onRemove(part.id)}
                    title="Remove this part"
                    aria-label="Remove this part"
                  >
                    <Trash2 size={14} />
                  </button>
                </span>
              </div>

              {summary.length > 0 && <p className="cw-part-summary">{summary.join(' · ')}</p>}

              {stale && (
                <button className="cw-part-stale" onClick={() => onRefresh(part.id)}>
                  <TriangleAlert size={13} />
                  {source?.name} has been edited since. Use the current sequence?
                </button>
              )}

              {open && (
                <div className="cw-part-details">
                  <label className="cw-detail">
                    <span>Name</span>
                    <input
                      className="input"
                      value={part.name}
                      onChange={e => onChange(part.id, { name: e.target.value }, `name-${part.id}`)}
                    />
                  </label>
                  <label className="cw-detail">
                    <span>Goes in</span>
                    <select
                      className="select"
                      value={part.orientation}
                      onChange={e => onChange(part.id, { orientation: e.target.value as PartOrientation })}
                    >
                      <option value="auto">Either way round</option>
                      <option value="forward">As given</option>
                      <option value="reverse">Reverse complement</option>
                    </select>
                  </label>
                  {design.method === 'restriction' && !part.duplex && (
                    <label className="cw-detail-check" title="Stops this part closing on itself">
                      <input
                        type="checkbox"
                        checked={part.dephosphorylated ?? false}
                        onChange={e => onChange(part.id, { dephosphorylated: e.target.checked })}
                      />
                      Dephosphorylated
                    </label>
                  )}
                  {part.duplex && (
                    <DuplexFields
                      duplex={part.duplex}
                      onChange={duplex => onChange(part.id, {
                        duplex,
                        // The top strand is what the part is, so it follows
                        // the oligos rather than being edited beside them.
                        bases: annealOligos(duplex).top,
                      }, `duplex-${part.id}`)}
                    />
                  )}
                  {source && <p className="cw-detail-note">From {source.name}{part.region ? ', the selected stretch' : ''}</p>}
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
