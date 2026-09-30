/**
 * What has been picked, whichever task picked it: each oligo in an
 * inspector, the two primers checked as a pair, and the ways out: simulate
 * the PCR, or save them as primers.
 */

import { useMemo, useState, type ReactNode } from 'react'
import { useEditorStore } from '../../../store'
import { primerConstraints, probeConstraints, type DesignSettings } from '../../../primers/design/settings'
import { evaluatePair } from '../../../primers/design/pairing'
import { scorePrimer } from '../../../primers/scoring'
import { bestDimer } from '../../../primers/structure'
import { oligoTm } from '../../../primers/display'
import { newPrimerId, type PrimerData } from '../../../primers/oligo'
import { useDesignPreview, designOligoId, type DesignRole } from '../../../primers/usePrimerSites'
import type { BindingSite } from '../../../primers/binding'
import { notify } from '../../../toast'
import OligoInspector from '../OligoInspector'
import { openPcrProduct } from './openProduct'

const ROLE_LABEL: Record<DesignRole, string> = { forward: 'Forward', reverse: 'Reverse', probe: 'Probe' }
const ROLE_SUFFIX: Record<DesignRole, string> = { forward: 'fwd', reverse: 'rev', probe: 'probe' }

export default function PicksPanel({ settings, note, actions }: {
  settings: DesignSettings
  /** Added to every saved primer's notes, e.g. what a mutagenesis pair does. */
  note?: string
  /** Task-specific buttons beside Save, e.g. "Open mutant". */
  actions?: ReactNode
}) {
  const doc = useEditorStore(s => s.doc)
  const readOnly = useEditorStore(s => s.readOnly)
  const picks = useEditorStore(s => s.primerDesign.picks)
  const setDesignPicks = useEditorStore(s => s.setDesignPicks)
  const addPrimers = useEditorStore(s => s.addPrimers)
  const [name, setName] = useState('')

  const n = doc.sequence.length
  const circular = doc.sequence.topology === 'circular'
  const bases = doc.sequence.bases
  const template = useMemo(() => bases.toUpperCase(), [bases])
  const constraints = primerConstraints(settings)

  const preview = useDesignPreview(doc, picks)
  const oligoOf = (role: DesignRole) => preview.oligos.find(o => o.id === designOligoId(role)) ?? null
  const sitesOf = (role: DesignRole) => preview.sites.get(designOligoId(role)) ?? []
  const firstSite = (role: DesignRole, strand: 1 | -1): BindingSite | null =>
    sitesOf(role).find(s => s.strand === strand) ?? null

  const fwdSite = firstSite('forward', 1)
  const revSite = firstSite('reverse', -1)

  const pairCheck = useMemo(() => {
    const f = picks.forward
    const r = picks.reverse
    if (!f || !r || !fwdSite || !revSite) return null
    // From the forward primer's 5' end to the reverse primer's, tails
    // included: a tail is copied into the product.
    const from = fwdSite.start - fwdSite.tail5.length
    const to = revSite.end + revSite.tail5.length
    let size = to - from
    if (circular) size = ((size % n) + n) % n || n
    if (size <= 0) return { error: 'The reverse primer sits upstream of the forward primer, so they do not face each other.' }
    const fScore = scorePrimer(f.slice(fwdSite.annealFrom, fwdSite.annealTo), 0, 1, constraints)
    const rScore = scorePrimer(r.slice(revSite.annealFrom, revSite.annealTo), 0, -1, constraints)
    const evaluation = evaluatePair(
      { sequence: f, tm: oligoTm(f.slice(fwdSite.annealFrom, fwdSite.annealTo)), penalty: fScore.penalty },
      { sequence: r, tm: oligoTm(r.slice(revSite.annealFrom, revSite.annealTo)), penalty: rScore.penalty },
      size,
      { minProductSize: settings.minProduct, maxProductSize: settings.maxProduct },
    )
    return { evaluation, dimer: bestDimer(f, r) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picks.forward, picks.reverse, fwdSite, revSite, circular, n, settings])

  if (!picks.forward && !picks.reverse && !picks.probe) return null

  const nextIndex = Math.floor((doc.primers?.length ?? 0) / 2) + 1
  const asPrimer = (role: DesignRole, id = newPrimerId()): PrimerData | null => {
    const seq = picks[role]
    if (!seq) return null
    return { id, name: `${name.trim() || `P${nextIndex}`} ${ROLE_SUFFIX[role]}`, sequence: seq, role: role === 'probe' ? 'probe' : 'primer' }
  }

  const save = () => {
    const product = pairCheck && 'evaluation' in pairCheck && pairCheck.evaluation
      ? `, product ${pairCheck.evaluation.productSize} bp` : ''
    const oligos: PrimerData[] = []
    for (const role of ['forward', 'reverse', 'probe'] as const) {
      const p = asPrimer(role)
      if (!p) continue
      const site = sitesOf(role)[0]
      const tm = oligoTm(site ? p.sequence.slice(site.annealFrom, site.annealTo) : p.sequence)
      p.notes = [note, `Designed: Tm ${tm.toFixed(1)}°C${product}`].filter(Boolean).join('\n')
      oligos.push(p)
    }
    if (oligos.length === 0) return
    addPrimers(oligos)
    setDesignPicks({ forward: null, reverse: null, probe: null })
    setName('')
    notify.success(`Saved ${oligos.length} primer${oligos.length === 1 ? '' : 's'}`, {
      action: { label: 'Undo', onClick: () => useEditorStore.getState().undo() },
    })
  }

  const simulate = () => {
    const f = asPrimer('forward')
    const r = asPrimer('reverse')
    if (f && r) openPcrProduct(f, r)
  }

  return (
    <section className="wb-section">
      {(['forward', 'reverse', 'probe'] as const).map(role => {
        const oligo = oligoOf(role)
        if (!oligo) return null
        return (
          <OligoInspector
            key={role}
            label={ROLE_LABEL[role]}
            oligo={oligo}
            sites={sitesOf(role)}
            constraints={role === 'probe' ? probeConstraints(settings) : constraints}
            template={template}
            circular={circular}
            onChange={seq => setDesignPicks({ [role]: seq })}
            onClear={() => setDesignPicks({ [role]: null })}
          />
        )
      })}

      {pairCheck && 'error' in pairCheck && <div className="pl-error">{pairCheck.error}</div>}
      {pairCheck && 'evaluation' in pairCheck && pairCheck.evaluation && (
        <div className="wb-pair-check">
          <div className="wb-oligo-label">Pair</div>
          <dl className="wb-stats">
            <div><dt>Product</dt><dd>{pairCheck.evaluation.productSize} bp</dd></div>
            <div><dt>ΔTm</dt><dd>{pairCheck.evaluation.tmDiff.toFixed(1)} °C</dd></div>
            <div><dt>Penalty</dt><dd>{pairCheck.evaluation.penalty.toFixed(1)}</dd></div>
          </dl>
          {pairCheck.evaluation.warnings.map(w => <div key={w} className="wb-problem">{w}</div>)}
          {pairCheck.dimer && pairCheck.dimer.run >= 4 && (
            <figure className="wb-structure">
              <figcaption>
                Cross-dimer · {pairCheck.dimer.run} bp, ΔG {pairCheck.dimer.dG.toFixed(1)} kcal/mol
                {pairCheck.dimer.threePrime ? ' · at a 3′ end' : ''}
              </figcaption>
              <pre>{pairCheck.dimer.lines.join('\n')}</pre>
            </figure>
          )}
        </div>
      )}

      <div className="wb-save">
        {!readOnly && (
          <input
            className="input ft-input"
            placeholder={`P${nextIndex}`}
            value={name}
            onChange={e => setName(e.target.value)}
            aria-label="Name for the saved primers"
          />
        )}
        {!readOnly && <button className="btn btn-sm btn-primary" onClick={save}>Save to primers</button>}
        <button className="btn btn-sm" onClick={() => setDesignPicks({ forward: null, reverse: null, probe: null })}>
          Discard
        </button>
      </div>
      <div className="wb-save">
        {picks.forward && picks.reverse && (
          <button className="btn btn-sm" onClick={simulate} title="Open what these primers amplify as a new sequence, tails included">
            Simulate PCR
          </button>
        )}
        {actions}
      </div>
    </section>
  )
}
