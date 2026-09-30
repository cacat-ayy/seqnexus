/**
 * Cloning: primers whose binding parts start exactly at the ends of the
 * insert, each behind a tail that carries what the cloning method needs.
 *
 * Restriction cloning: padding plus a recognition site on each primer, and a
 * warning if the enzyme also cuts inside the insert (it would cut the insert
 * in two). Seamless assembly (Gibson, In-Fusion): homology arms copied from
 * the vector either side of where the insert goes.
 */

import { useEffect, useMemo, useState } from 'react'
import { useEditorStore } from '../../../store'
import { ENZYME_DB, ENZYME_GROUPS, getEnzyme } from '../../../enzymes/db'
import {
  designTailedPair, findSite, homologyArms, restrictionTail, type TailedPair,
} from '../../../primers/design/cloning'
import { primerConstraints, type DesignSettings } from '../../../primers/design/settings'
import { calcTm } from '../../../primers/thermodynamics'
import { TargetField } from './TargetField'
import { useSelectionTarget } from './target'
import { NumField } from './SettingsSection'
import PicksPanel from './PicksPanel'

type Method = 'restriction' | 'homology'

type CloningDesign =
  | { error: string }
  | { pair: TailedPair; warnings: string[]; info: string[] }

const COMMON = new Set(ENZYME_GROUPS['Common (6-cutters)'] ?? [])
const ENZYME_NAMES = [
  ...ENZYME_DB.filter(e => COMMON.has(e.name)),
  ...ENZYME_DB.filter(e => !COMMON.has(e.name)),
].map(e => e.name)

/** An enzyme name, or a recognition site typed directly. */
function siteOf(text: string): { site: string; label: string } | null {
  const t = text.trim()
  if (!t) return null
  const e = getEnzyme(t)
  if (e) return { site: e.recognition.toUpperCase(), label: e.name }
  if (/^[ACGTRYSWKMBDHVN]{4,}$/i.test(t)) return { site: t.toUpperCase(), label: t.toUpperCase() }
  return null
}

export default function CloningTask({ settings }: { settings: DesignSettings }) {
  const doc = useEditorStore(s => s.doc)
  const tabs = useEditorStore(s => s.tabs)
  const activeTabId = useEditorStore(s => s.activeTabId)
  const setDesignPicks = useEditorStore(s => s.setDesignPicks)
  const n = doc.sequence.length
  const t = useSelectionTarget()

  const [method, setMethod] = useState<Method>('restriction')
  const [enzyme5, setEnzyme5] = useState('EcoRI')
  const [enzyme3, setEnzyme3] = useState('BamHI')
  const [padding, setPadding] = useState('TAAGCA')
  const [vectorId, setVectorId] = useState<string>('')
  const [cut, setCut] = useState(1)
  const [replaceTo, setReplaceTo] = useState<number | ''>('')
  const [arm, setArm] = useState(20)

  const vector = tabs.find(x => x.id === (vectorId || activeTabId))?.doc ?? null
  const vectorBases = vector?.sequence.bases ?? ''
  const bases = doc.sequence.bases
  const constraints = primerConstraints(settings)

  const design = useMemo((): CloningDesign | null => {
    const insert = t.target
    if (!insert || insert.start === insert.end) return null
    const template = doc.sequence.bases
    const warnings: string[] = []
    let fwdTail = ''
    let revTail = ''
    let info: string[] = []

    if (method === 'restriction') {
      const s5 = siteOf(enzyme5)
      const s3 = siteOf(enzyme3)
      if (!s5 || !s3) return { error: 'Choose an enzyme (or type a recognition site) for each end.' }
      const pad = padding.toUpperCase().replace(/[^ACGT]/g, '')
      fwdTail = restrictionTail(s5.site, pad)
      revTail = restrictionTail(s3.site, pad)
      const insertSeq = insert.start < insert.end
        ? template.slice(insert.start, insert.end)
        : template.slice(insert.start) + template.slice(0, insert.end)
      for (const s of s5.label === s3.label ? [s5] : [s5, s3]) {
        const hits = findSite(insertSeq, s.site)
        if (hits.length > 0) {
          warnings.push(`${s.label} also cuts inside the insert (at ${hits.slice(0, 3).map(h => (h + insert.start) % n + 1).join(', ')}): the insert would be cut in two.`)
        }
      }
      if (s5.label === s3.label) warnings.push('The same enzyme at both ends gives non-directional cloning.')
      info = [`5′ ${s5.label} · 3′ ${s3.label} · ${pad.length} nt padding`]
    } else {
      if (!vector) return { error: 'Choose the vector.' }
      const vLen = vector.sequence.length
      const c = Math.max(0, Math.min(vLen, cut))
      const to = replaceTo === '' ? c : Math.max(c, Math.min(vLen, replaceTo))
      const arms = homologyArms(vector.sequence.bases, vector.sequence.topology, c, to, arm)
      if ('error' in arms) return { error: arms.error }
      fwdTail = arms.fwdTail
      revTail = arms.revTail
      const tmL = calcTm(arms.left, { naConc: settings.naConc, mgConc: settings.mgConc, dntpConc: settings.dntpConc, primerConc: settings.primerConc })
      const tmR = calcTm(arms.right, { naConc: settings.naConc, mgConc: settings.mgConc, dntpConc: settings.dntpConc, primerConc: settings.primerConc })
      // gibson.ts holds overlaps to the same 48 °C floor.
      if (Math.min(tmL, tmR) < 48) warnings.push(`An overlap melts at ${Math.min(tmL, tmR).toFixed(1)} °C; Gibson overlaps should reach 48 °C. Lengthen the arms.`)
      info = [
        `Into ${vector.name} ${to > c ? `replacing ${c + 1}..${to}` : `after ${c}`}`,
        `Overlaps ${arm} bp · Tm ${tmL.toFixed(1)} / ${tmR.toFixed(1)} °C`,
      ]
    }

    const pair = designTailedPair(template, doc.sequence.topology, insert, fwdTail, revTail, constraints)
    if ('error' in pair) return { error: pair.error }
    return { pair, warnings: [...warnings, ...pair.warnings], info }
    // `bases` rather than `doc.sequence`: the Sequence is edited in place and
    // keeps its identity, the bases string does not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t.target?.start, t.target?.end, method, enzyme5, enzyme3, padding, vector, vectorBases, cut, replaceTo, arm, bases, doc.sequence.topology, settings])

  // The design is deterministic, so it is simply applied as the inputs change.
  useEffect(() => {
    if (design && 'pair' in design) {
      setDesignPicks({ forward: design.pair.forward.sequence, reverse: design.pair.reverse.sequence, probe: null })
    }
  }, [design, setDesignPicks])

  return (
    <>
    <section className="wb-section">
      <TargetField label="Insert" hint="Select the part to clone: its ends are where the primers start." t={t} n={n} />

      <div className="wb-row">
        <label>Method</label>
        <select className="input ft-select" value={method} onChange={e => setMethod(e.target.value as Method)}>
          <option value="restriction">Restriction sites</option>
          <option value="homology">Homology arms (Gibson / In-Fusion)</option>
        </select>
      </div>

      {method === 'restriction' ? (
        <>
          <datalist id="wb-enzymes">
            {ENZYME_NAMES.map(name => <option key={name} value={name} />)}
          </datalist>
          <div className="wb-row">
            <label htmlFor="wb-enz5">5′ site</label>
            <input id="wb-enz5" className="input ft-input" list="wb-enzymes" value={enzyme5} onChange={e => setEnzyme5(e.target.value)} />
          </div>
          <div className="wb-row">
            <label htmlFor="wb-enz3">3′ site</label>
            <input id="wb-enz3" className="input ft-input" list="wb-enzymes" value={enzyme3} onChange={e => setEnzyme3(e.target.value)} />
          </div>
          <div className="wb-row">
            <label htmlFor="wb-pad">Padding</label>
            <input
              id="wb-pad" className="input ft-input pl-seq-input" value={padding} spellCheck={false}
              onChange={e => setPadding(e.target.value)}
              title="Extra bases outside the site so the enzyme can cut near the end of the product"
            />
          </div>
        </>
      ) : (
        <>
          <div className="wb-row">
            <label htmlFor="wb-vector">Vector</label>
            <select id="wb-vector" className="input ft-select" value={vectorId || activeTabId || ''} onChange={e => setVectorId(e.target.value)}>
              {tabs.map(x => <option key={x.id} value={x.id}>{x.doc.name}{x.id === activeTabId ? ' (this sequence)' : ''}</option>)}
            </select>
          </div>
          <div className="wb-conc">
            <NumField label="Insert after" value={cut} min={0} onChange={v => setCut(Math.round(v))} />
            <label className="wb-num">
              <span>Replace to</span>
              <input
                type="number" className="input ft-input ft-num" min={0} value={replaceTo}
                placeholder="–"
                onChange={e => setReplaceTo(e.target.value === '' ? '' : Math.round(parseFloat(e.target.value)))}
              />
            </label>
            <NumField label="Arm bp" value={arm} min={10} onChange={v => setArm(Math.max(10, Math.round(v)))} />
          </div>
          <div className="wb-hint">In-Fusion uses 15 bp arms; Gibson 20–40 bp.</div>
        </>
      )}

      {design && 'error' in design && <div className="pl-error">{design.error}</div>}
      {design && 'info' in design && design.info.map(line => <div key={line} className="wb-hint">{line}</div>)}
      {design && 'warnings' in design && design.warnings.map(w => <div key={w} className="wb-problem">{w}</div>)}
    </section>
    <PicksPanel settings={settings} note={design && 'info' in design ? `Cloning: ${design.info.join('; ')}` : undefined} />
    </>
  )
}
