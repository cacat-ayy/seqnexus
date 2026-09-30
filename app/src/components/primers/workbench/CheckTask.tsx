/**
 * Check a primer you already have: paste it and see where it binds in every
 * open sequence, with the Tm it has at each site (mismatches and tails
 * counted), and any weaker places its 3' end could still prime.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { DocumentState } from '../../../models/Document'
import { useEditorStore } from '../../../store'
import { cleanOligo, newPrimerId, type OligoRole, type PrimerData } from '../../../primers/oligo'
import { offTargets } from '../../../primers/offtarget'
import { siteTm } from '../../../primers/thermo/site'
import { primerConstraints, type DesignSettings } from '../../../primers/design/settings'
import type { BindingSite } from '../../../primers/binding'
import OligoSequence from '../OligoSequence'

export default function CheckTask({ settings }: { settings: DesignSettings }) {
  const tabs = useEditorStore(s => s.tabs)
  const activeTabId = useEditorStore(s => s.activeTabId)
  const [text, setText] = useState('')
  const [role, setRole] = useState<OligoRole>('primer')

  // Opened from the library: check that oligo.
  const checkRequest = useEditorStore(s => s.checkRequest)
  useEffect(() => {
    if (!checkRequest) return
    setText(checkRequest.sequence)
    setRole(checkRequest.role)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkRequest?.at])
  const oligo = text.trim() ? cleanOligo(text) : null
  const c = primerConstraints(settings)
  const conditions = { oligoConc: c.primerConc, mono: c.naConc, mg: c.mgConc, dntp: c.dntpConc }

  // `tabs` is a new array on every selection change; the documents in it
  // only change when edited. Rescan every open sequence only then.
  const docsRef = useRef<DocumentState[]>([])
  const docs = tabs.map(tab => tab.doc)
  if (docs.length !== docsRef.current.length || docs.some((d, i) => d !== docsRef.current[i])) {
    docsRef.current = docs
  }
  const stableDocs = docsRef.current

  const results = useMemo(() => {
    if (!oligo) return []
    const primer: PrimerData = { id: 'check', name: 'check', sequence: oligo, role }
    return stableDocs.map((doc, i) => {
      const { bases, topology } = doc.sequence
      const report = offTargets(primer, bases, topology)
      return {
        tabId: tabs[i]?.id ?? '',
        name: doc.name,
        sites: report.sites.map(site => ({ site, tm: siteTm(oligo, site, bases, topology, conditions) })),
        weak: report.weak,
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oligo, role, stableDocs, settings])

  const show = (tabId: string, site: BindingSite) => {
    const s = useEditorStore.getState()
    if (s.activeTabId !== tabId) s.setActiveTab(tabId)
    useEditorStore.getState().setSelection({ anchor: site.start, caret: site.end })
  }

  const add = (tabId: string) => {
    if (!oligo) return
    const s = useEditorStore.getState()
    if (s.activeTabId !== tabId) s.setActiveTab(tabId)
    useEditorStore.getState().addPrimers([{ id: newPrimerId(), name: `Primer ${(s.doc.primers?.length ?? 0) + 1}`, sequence: oligo, role }])
  }

  const binding = results.filter(r => r.sites.length > 0)

  return (
    <section className="wb-section">
      <div className="wb-row pl-seq-row">
        <label htmlFor="wb-check-oligo">Oligo</label>
        <textarea
          id="wb-check-oligo"
          className="input ft-input pl-seq-input"
          rows={3}
          placeholder="Paste a primer or probe, 5′→3′"
          spellCheck={false}
          value={text}
          onChange={e => setText(e.target.value)}
        />
      </div>
      <div className="wb-row">
        <label>Type</label>
        <select className="input ft-select" value={role} onChange={e => setRole(e.target.value as OligoRole)}>
          <option value="primer">Primer</option>
          <option value="probe">Probe</option>
        </select>
      </div>
      {text.trim() && !oligo && <div className="pl-error">Only A, C, G, T and IUPAC ambiguity codes.</div>}

      {oligo && (
        <div className="wb-status">
          {binding.length === 0
            ? `Binds none of the ${tabs.length} open sequence${tabs.length === 1 ? '' : 's'}.`
            : `Binds ${binding.length} of ${tabs.length} open sequence${tabs.length === 1 ? '' : 's'}.`}
        </div>
      )}

      {results.filter(r => r.sites.length > 0 || r.weak.length > 0).map(({ tabId, name, sites, weak }) => (
        <div key={tabId} className="wb-oligo">
          <header className="wb-oligo-head">
            <span className="wb-oligo-label">{name}</span>
            <span className="wb-oligo-meta">{sites.length} site{sites.length === 1 ? '' : 's'}</span>
            {sites.length > 0 && (
              <button className="btn btn-sm" onClick={() => add(tabId)} title="Save this oligo as a primer on that sequence">
                Add{tabId === activeTabId ? '' : ' there'}
              </button>
            )}
          </header>
          {sites.map(({ site, tm }, i) => (
            <button key={i} className="pl-site" onClick={() => show(tabId, site)} title="Go to this site">
              <span>{site.start + 1}..{site.end} {site.strand === 1 ? '(+)' : '(−)'}</span>
              <span className="pl-site-note">Tm {Number.isFinite(tm) ? tm.toFixed(1) : '–'} °C</span>
              {site.tail5 && <span className="pl-site-note">5′ tail {site.tail5.length}</span>}
              {site.mismatches.length > 0 && (
                <span className="pl-site-note pl-mm">{site.mismatches.length} mismatch{site.mismatches.length === 1 ? '' : 'es'}</span>
              )}
            </button>
          ))}
          {sites[0] && (
            <div className="ft-tooltip-bases pl-oligo">
              <OligoSequence sequence={oligo!} site={sites[0].site} />
            </div>
          )}
          {weak.length > 0 && (
            <div className="wb-problem">
              3′ end could also prime at {weak.slice(0, 3).map(w => `${w.start + 1}..${w.end} ${w.strand === 1 ? '(+)' : '(−)'}`).join(', ')}
              {weak.length > 3 ? ` and ${weak.length - 3} more` : ''}
            </div>
          )}
        </div>
      ))}
    </section>
  )
}
