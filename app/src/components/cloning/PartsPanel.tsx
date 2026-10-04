/**
 * The parts going into a design, and what to do with each.
 *
 * A part is a sequence, or a stretch of one. Which role it plays decides what
 * the engine makes of it — the vector is the backbone a product is named
 * after and reads from — and the rest of the controls are the handful of
 * things that genuinely change the outcome: which way round it may go, which
 * fragment of its digest is being used, and whether its ends were
 * dephosphorylated.
 */

import { ArrowLeftRight, Crosshair, Trash2, TriangleAlert } from 'lucide-react'
import type { Fragment } from '../../cloning/fragment'
import { endLabel } from '../../cloning/ends'
import {
  partLength,
  partTopology,
  type CloningDesign,
  type DesignPart,
  type PartOrientation,
} from '../../cloning/design'
import { partColor } from './colors'

interface Props {
  design: CloningDesign
  fragments: Fragment[]
  /** Name and fingerprint of every open sequence, for spotting stale parts. */
  sources: ReadonlyMap<string, { name: string; hash: string }>
  hovered: string | null
  onHover: (id: string | null) => void
  onChange: (id: string, patch: Partial<DesignPart>, coalesceKey?: string) => void
  onRemove: (id: string) => void
  onRefresh: (id: string) => void
  onReveal: (part: DesignPart) => void
}

function formatBp(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)} kb` : `${n} bp`
}

/** The digest fragments a part could contribute, longest first. */
function fragmentsOf(part: DesignPart, fragments: Fragment[]): Fragment[] {
  return fragments
    .filter(f => f.id.startsWith(`${part.id}:`) && f.topology === 'linear')
    .sort((a, b) => b.top.length - a.top.length)
}

export default function PartsPanel({
  design,
  fragments,
  sources,
  hovered,
  onHover,
  onChange,
  onRemove,
  onRefresh,
  onReveal,
}: Props) {
  const cut = design.method === 'restriction' || design.method === 'golden-gate'

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
        const options = cut ? fragmentsOf(part, fragments) : []
        const chosen = part.keep
          ? options.find(f => f.source.start === part.keep!.start && f.source.end === part.keep!.end)
          : options[0]

        return (
          <div
            key={part.id}
            className={`cw-part ${hovered === part.id ? 'hovered' : ''}`}
            onMouseEnter={() => onHover(part.id)}
            onMouseLeave={() => onHover(null)}
          >
            <span className="cw-part-swatch" style={{ background: partColor(index) }} aria-hidden="true" />

            <div className="cw-part-main">
              <div className="cw-part-top">
                <input
                  className="cw-part-name"
                  value={part.name}
                  aria-label="Part name"
                  onChange={e => onChange(part.id, { name: e.target.value }, `name-${part.id}`)}
                />
                <select
                  className="select cw-part-role"
                  value={part.role}
                  aria-label="Role"
                  onChange={e => onChange(part.id, { role: e.target.value as DesignPart['role'] })}
                >
                  <option value="vector">Vector</option>
                  <option value="insert">Insert</option>
                </select>
              </div>

              <div className="cw-part-meta">
                <span>{formatBp(partLength(part))}</span>
                <span>{partTopology(part) === 'circular' ? 'circular' : 'linear'}</span>
                {part.region && <span className="cw-part-region">region</span>}
                {source && <span className="cw-part-source">from {source.name}</span>}
              </div>

              {stale && (
                <button className="cw-part-stale" onClick={() => onRefresh(part.id)}>
                  <TriangleAlert size={12} />
                  {source?.name} has been edited since. Use the current sequence?
                </button>
              )}

              <div className="cw-part-controls">
                <label className="cw-part-field">
                  <ArrowLeftRight size={12} />
                  <select
                    className="select"
                    value={part.orientation}
                    aria-label="Orientation"
                    onChange={e => onChange(part.id, { orientation: e.target.value as PartOrientation })}
                  >
                    <option value="auto">Either way round</option>
                    <option value="forward">As given</option>
                    <option value="reverse">Reverse complement</option>
                  </select>
                </label>

                {cut && options.length > 1 && (
                  <label className="cw-part-field">
                    <span className="cw-part-label">Use</span>
                    <select
                      className="select"
                      value={chosen ? `${chosen.source.start}:${chosen.source.end}` : ''}
                      aria-label="Which fragment to use"
                      onChange={e => {
                        const [start, end] = e.target.value.split(':').map(Number)
                        onChange(part.id, { keep: { start, end } })
                      }}
                    >
                      {options.map(f => (
                        <option key={f.id} value={`${f.source.start}:${f.source.end}`}>
                          {formatBp(f.top.length)} · {endLabel(f.left!)} – {endLabel(f.right!)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                {design.method === 'restriction' && (
                  <label className="cw-part-check" title="Stops this part closing on itself">
                    <input
                      type="checkbox"
                      checked={part.dephosphorylated ?? false}
                      onChange={e => onChange(part.id, { dephosphorylated: e.target.checked })}
                    />
                    Dephosphorylated
                  </label>
                )}
              </div>

              {cut && chosen && (
                <p className="cw-part-ends">
                  Ends: {endLabel(chosen.left!)} and {endLabel(chosen.right!)}
                </p>
              )}
            </div>

            <div className="cw-part-actions">
              {part.source && sources.has(part.source.id) && (
                <button
                  className="cw-icon-btn"
                  onClick={() => onReveal(part)}
                  title="Show this part on its sequence"
                >
                  <Crosshair size={13} />
                </button>
              )}
              <button className="cw-icon-btn" onClick={() => onRemove(part.id)} title="Remove this part">
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
