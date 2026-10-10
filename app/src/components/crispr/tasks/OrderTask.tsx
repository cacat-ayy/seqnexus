/**
 * Order: the exact oligos, and how you will tell afterwards whether it
 * worked.
 *
 * The two belong on one screen because they are decided together. A guide
 * that cannot be screened cheaply is worth knowing about before the oligos
 * are ordered, not after, and the screening primers are themselves something
 * to order at the same time.
 *
 * Every base the app adds to the spacer is shown as an addition rather than
 * folded into the sequence, since those are exactly the bases people get
 * wrong.
 */

import { useMemo, useState } from 'react'
import { ClipboardCopy, FlaskConical, Save } from 'lucide-react'
import { useEditorStore } from '../../../store'
import { buildOrder, orderCsv, VECTOR_PRESETS, vectorPreset, type OrderFormat } from '../../../crispr/order'
import { defaultScaffold, scaffoldsFor } from '../../../crispr/scaffolds'
import { screeningPrimers, rflpOptions, rflpBands, DEFAULT_SCREEN } from '../../../crispr/screen'
import { cutPosition } from '../../../crispr/finder'
import { recordFromCandidate } from '../../../crispr/library'
import { guideKey, guideName } from '../../../utils/guide-features'
import { displayPosition } from '../../../models/Document'
import { notify } from '../../../toast'
import type { GuideCandidate, Nuclease } from '../../../crispr/types'

interface Props {
  candidates: readonly GuideCandidate[]
  nuclease: Nuclease
}

const FORMATS: { id: OrderFormat; label: string }[] = [
  { id: 'annealed', label: 'Oligo pair for a vector' },
  { id: 'template', label: 'Template to transcribe' },
  { id: 'synthetic', label: 'Synthetic guide RNA' },
  { id: 'peg', label: 'pegRNA' },
]

export default function OrderTask({ candidates, nuclease }: Props) {
  const doc = useEditorStore(s => s.doc)
  const selectedKey = useEditorStore(s => s.selectedGuideKey)
  const picks = useEditorStore(s => s.guidePicks)
  const customScaffolds = useEditorStore(s => s.customScaffolds)
  const scaffoldId = useEditorStore(s => s.crisprScaffoldId)
  const format = useEditorStore(s => s.crisprOrderFormat)
  const vectorId = useEditorStore(s => s.crisprVectorId)
  const setOrderParams = useEditorStore(s => s.setOrderParams)
  const addGuides = useEditorStore(s => s.addGuides)
  const activeTabId = useEditorStore(s => s.activeTabId)
  const [screening, setScreening] = useState(false)
  const origin = doc.metadata?.displayOrigin ?? 0
  const at = (i: number) => displayPosition(i, origin, doc.sequence.length)

  const offered = scaffoldsFor(nuclease, customScaffolds)
  const scaffold = offered.find(s => s.id === scaffoldId) ?? defaultScaffold(nuclease, customScaffolds)

  // The picked guides, or the selected one when nothing is picked.
  const chosen = useMemo(() => {
    const byPick = candidates.filter(c => picks.has(guideKey(c.site)))
    if (byPick.length > 0) return byPick
    const one = candidates.find(c => guideKey(c.site) === selectedKey)
    return one ? [one] : []
  }, [candidates, picks, selectedKey])

  const orders = useMemo(
    () => chosen.map(candidate => ({
      candidate,
      order: buildOrder(format, {
        name: guideName(candidate.site, nuclease).replace(/\s+/g, '_'),
        spacer: candidate.site.spacer,
        nuclease,
        scaffold,
        promoter: format === 'template' ? 't7' : (nuclease.promoter ?? 'u6'),
        vector: vectorPreset(vectorId),
      }),
    })),
    [chosen, format, nuclease, scaffold, vectorId],
  )

  const screen = useMemo(() => {
    if (!screening || chosen.length !== 1) return null
    const candidate = chosen[0]
    const cut = cutPosition(candidate.site, doc.sequence.length, doc.sequence.topology === 'circular')
    const pairs = screeningPrimers(doc.sequence.bases, doc.sequence.topology, cut, DEFAULT_SCREEN)
    const best = pairs[0]
    const amplicon = best
      ? { start: best.forward.start, end: best.forward.start + best.productSize }
      : { start: Math.max(0, cut - 300), end: Math.min(doc.sequence.length, cut + 300) }
    return {
      cut,
      pairs: pairs.slice(0, 3),
      rflp: rflpOptions(doc.sequence.bases, cut, amplicon).slice(0, 5),
      bands: best ? rflpBands(best.productSize, best.cutOffset) : [],
    }
  }, [screening, chosen, doc.sequence])

  const saveToLibrary = () => {
    const ids = addGuides(chosen.map(candidate => ({
      ...recordFromCandidate(candidate, nuclease, guideName(candidate.site, nuclease), activeTabId, doc.name, 'x'),
    })).map(({ id: _id, createdAt: _createdAt, ...rest }) => rest))
    notify.success(`${ids.length} kept in the library`)
  }

  return (
    <>
      <div className="gp-settings gp-settings-tight">
        <div className="gp-field gp-field-wide">
          <label htmlFor="gp-format">Order as</label>
          <select
            id="gp-format"
            value={format}
            onChange={e => setOrderParams({ crisprOrderFormat: e.target.value as OrderFormat })}
          >
            {FORMATS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select>
        </div>
        {format === 'annealed' && (
          <div className="gp-field gp-field-wide">
            <label htmlFor="gp-vector">Vector</label>
            <select
              id="gp-vector"
              value={vectorId}
              onChange={e => setOrderParams({ crisprVectorId: e.target.value })}
            >
              {VECTOR_PRESETS.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>
        )}
        {format !== 'annealed' && (
          <div className="gp-field gp-field-wide">
            <label htmlFor="gp-scaffold">Scaffold</label>
            <select
              id="gp-scaffold"
              value={scaffold?.id ?? ''}
              onChange={e => setOrderParams({ crisprScaffoldId: e.target.value })}
            >
              {offered.length === 0 && <option value="">None ships for this nuclease</option>}
              {offered.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        )}
        {format !== 'annealed' && !scaffold && (
          <p className="gp-note gp-warn">
            No scaffold ships for {nuclease.name}. Paste the one from your vector in the library view, and it will
            be offered here.
          </p>
        )}
      </div>

      {chosen.length === 0 && (
        <p className="gp-note gp-warn gp-note-row">
          Select a guide, or pick several with Ctrl-click, and they are ordered together.
        </p>
      )}

      {orders.length > 0 && (
        <div className="gp-status">
          <span className="gp-status-count">
            {orders.length} guide{orders.length === 1 ? '' : 's'}, {orders[0].order.title}
          </span>
          <div className="gi-actions">
            <button
              className="btn btn-sm"
              onClick={() => {
                navigator.clipboard.writeText(orderCsv(orders.map(o => o.order)))
                  .then(() => notify.success('Order copied'))
                  .catch(() => notify.error('Could not copy the order'))
              }}
            >
              <ClipboardCopy size={12} /> Table
            </button>
            <button className="btn btn-sm" onClick={saveToLibrary}>
              <Save size={12} /> Keep
            </button>
          </div>
        </div>
      )}

      <ul className="gp-list">
        {orders.map(({ candidate, order }) => (
          <li key={guideKey(candidate.site)} className="gp-order">
            <div className="gp-order-head">{guideName(candidate.site, nuclease)}</div>
            {order.oligos.map(o => (
              <div key={o.name} className="gp-oligo">
                <span className="gp-oligo-name">{o.name}</span>
                <span className="gp-oligo-seq">
                  {o.addedPrefix && <span className="gi-insert">{o.addedPrefix}</span>}
                  {o.sequence.slice(o.addedPrefix.length, o.sequence.length - o.addedSuffix.length)}
                  {o.addedSuffix && <span className="gi-insert">{o.addedSuffix}</span>}
                </span>
                <span className="gp-oligo-len">{o.length} nt</span>
              </div>
            ))}
            {order.notes.map(n => <p key={n} className="gi-caveat">{n}</p>)}
          </li>
        ))}
      </ul>

      {chosen.length === 1 && (
        <div className="gp-section">
          <div className="gp-run-row">
            <button className="btn btn-sm" onClick={() => setScreening(v => !v)}>
              <FlaskConical size={12} /> {screening ? 'Hide screening' : 'How to screen it'}
            </button>
          </div>

          {screen && (
            <div className="gi">
              <div className="gi-section">
                <div className="gi-section-title">Amplicon across the cut</div>
                {screen.pairs.length === 0 ? (
                  <p className="gi-caveat">No primer pair fits around this cut at the usual sizes.</p>
                ) : (
                  screen.pairs.map(p => (
                    <div key={p.forward.sequence} className="gp-oligo">
                      <span className="gp-oligo-name">{p.productSize} bp</span>
                      <span className="gp-oligo-seq">{p.forward.sequence} / {p.reverse.sequence}</span>
                      <span className="gp-oligo-len">cut {p.cutOffset} in</span>
                    </div>
                  ))
                )}
              </div>

              <div className="gi-section">
                <div className="gi-section-title">Cut by an enzyme, uncut once edited</div>
                {screen.rflp.length === 0 ? (
                  <p className="gi-caveat">
                    No enzyme has a single site in the amplicon that the cut falls inside, so this one needs
                    sequencing rather than a gel.
                  </p>
                ) : (
                  <>
                    <div className="gp-chips">
                      {screen.rflp.map(r => (
                        <span key={r.enzyme.name} className="gp-chip" title={`${r.enzyme.recognition} at ${at(r.site.position)}`}>
                          {r.enzyme.name}
                        </span>
                      ))}
                    </div>
                    {screen.bands.length > 0 && (
                      <p className="gi-caveat">
                        {screen.bands.map(b => `${b.label}: ${b.sizes.join(' and ')} bp`).join('. ')}.
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  )
}
