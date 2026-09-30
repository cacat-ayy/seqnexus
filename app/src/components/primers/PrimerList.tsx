/**
 * The Primers tab of the right sidebar: the document's oligos.
 *
 * Every row is an oligo, not a location. Where it binds is shown, not
 * edited: change the sequence and the sites follow. A primer that no longer
 * binds (after a template edit, or one pasted in for another plasmid) stays
 * in the list, flagged, rather than disappearing.
 */

import { useEffect, useMemo, useState } from 'react'
import { Copy, AlertTriangle } from 'lucide-react'
import { useEditorStore } from '../../store'
import { usePrimerSites } from '../../primers/usePrimerSites'
import { findBindingSites, type BindingSite } from '../../primers/binding'
import { cleanOligo, newPrimerId, primerColor, type OligoRole, type PrimerData } from '../../primers/oligo'
import { primerItemId, summarizeOligo } from '../../primers/display'
import { copyText } from '../../utils/clipboard'
import { notify } from '../../toast'
import OligoSequence from './OligoSequence'
import { OligoExportDialog, OligoImportDialog } from './OligoDialogs'
import { useLibraryMatches, toDocumentPrimer, type LibraryMatch } from '../../primers/library'
import './primers.css'

const fmtTm = (t: number | null) => (t === null || !Number.isFinite(t) ? '–' : `${t.toFixed(1)}°`)

function tailLabel(site: BindingSite): string | null {
  const parts: string[] = []
  if (site.tail5) parts.push(`5′ tail ${site.tail5.length}`)
  if (site.tail3) parts.push(`3′ tail ${site.tail3.length}`)
  return parts.length ? parts.join(' · ') : null
}

function siteLabel(site: BindingSite): string {
  return `${site.start + 1}..${site.end} ${site.strand === 1 ? '(+)' : '(−)'}`
}

export default function PrimerList({ adding, onAddingChange }: {
  adding: boolean
  onAddingChange: (v: boolean) => void
}) {
  const doc = useEditorStore(s => s.doc)
  const readOnly = useEditorStore(s => s.readOnly)
  const focusedPrimerId = useEditorStore(s => s.focusedPrimerId)
  const setFocusedPrimer = useEditorStore(s => s.setFocusedPrimer)
  const setSelection = useEditorStore(s => s.setSelection)
  const setHoveredAnnotation = useEditorStore(s => s.setHoveredAnnotation)
  const convertFeaturesToPrimers = useEditorStore(s => s.convertFeaturesToPrimers)

  const sites = usePrimerSites(doc)
  const primers = doc.primers ?? []
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)

  const library = useEditorStore(s => s.oligos)
  const addLibraryOligos = useEditorStore(s => s.addLibraryOligos)
  const addPrimers = useEditorStore(s => s.addPrimers)
  const matches = useLibraryMatches(library, doc)

  const addFromLibrary = (list: LibraryMatch[]) => {
    if (list.length === 0) return
    addPrimers(list.map(m => toDocumentPrimer(m.oligo, newPrimerId())))
    notify.success(`Added ${list.length} primer${list.length === 1 ? '' : 's'} from the library`, {
      action: { label: 'Undo', onClick: () => useEditorStore.getState().undo() },
    })
  }

  const toLibrary = (list: PrimerData[]) => {
    const ids = addLibraryOligos(list.map(({ name, sequence, role, notes, color, mods }) =>
      ({ name, sequence, role, ...(notes ? { notes } : {}), ...(color ? { color } : {}), ...(mods ? { mods } : {}) })))
    notify.success(ids.length === 0
      ? 'Already in the library'
      : `Added ${ids.length} to the library${ids.length < list.length ? ` (${list.length - ids.length} already there)` : ''}`)
  }

  const legacyIds = useMemo(
    () => doc.annotations.filter(a => a.type === 'primer_bind').map(a => a.id),
    [doc.annotations],
  )

  // Opened from the sequence or map (double-click, or a primer just made
  // from a selection): expand it and bring it into view.
  useEffect(() => {
    if (!focusedPrimerId) return
    setExpandedId(focusedPrimerId)
    requestAnimationFrame(() => {
      // Ids are generated (letters, digits, underscores), so no escaping.
      document.querySelector(`[data-primer-id="${focusedPrimerId}"]`)
        ?.scrollIntoView({ block: 'nearest' })
    })
    setFocusedPrimer(null)
  }, [focusedPrimerId, setFocusedPrimer])

  const q = filter.trim().toLowerCase()
  const shown = q
    ? primers.filter(p => p.name.toLowerCase().includes(q) || p.sequence.toLowerCase().includes(q))
    : primers

  const selectSite = (site: BindingSite | undefined) => {
    if (site) setSelection({ anchor: site.start, caret: site.end })
  }

  return (
    <>
      <div className="fs-search">
        <input
          className="fs-search-input"
          placeholder="Filter primers…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
        />
      </div>

      <div className="pl-toolbar">
        {!readOnly && (
          <button className="btn btn-sm" onClick={() => setImportOpen(true)} title="Paste or import a list of oligos">
            Add from list…
          </button>
        )}
        <button className="btn btn-sm" disabled={primers.length === 0} onClick={() => toLibrary(primers)}
          title="Keep these primers in the library, to use on other sequences">
          To library
        </button>
        <button className="btn btn-sm" disabled={primers.length === 0} onClick={() => setExportOpen(true)}>
          Export…
        </button>
      </div>

      <OligoImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        targetLabel={readOnly ? undefined : doc.name}
        onImport={(list, where) => {
          setImportOpen(false)
          if (where === 'library') {
            const ids = addLibraryOligos(list)
            notify.success(`Added ${ids.length} oligo${ids.length === 1 ? '' : 's'} to the library`)
          } else {
            addPrimers(list.map(o => ({ ...o, id: newPrimerId() })))
            notify.success(`Added ${list.length} primer${list.length === 1 ? '' : 's'} to ${doc.name}`, {
              action: { label: 'Undo', onClick: () => useEditorStore.getState().undo() },
            })
          }
        }}
      />
      <OligoExportDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        oligos={primers}
        baseName={`${doc.name} primers`}
      />

      <div className="fs-list">
        {matches.length > 0 && !readOnly && (
          <div className="pl-library" aria-label="Library primers that bind this sequence">
            <div className="pl-library-head">
              <span>
                {matches.length} library primer{matches.length === 1 ? '' : 's'} bind{matches.length === 1 ? 's' : ''} this sequence
              </span>
              <button className="btn btn-sm" onClick={() => addFromLibrary(matches)}>Add all</button>
            </div>
            {matches.slice(0, 8).map(m => (
              <div key={m.oligo.id} className="pl-library-row">
                <span className="ft-name">{m.oligo.name}</span>
                <span className="pl-sites">{siteLabel(m.site)}{m.siteCount > 1 ? ` +${m.siteCount - 1}` : ''}</span>
                <button className="btn btn-sm" onClick={() => addFromLibrary([m])}>Add</button>
              </div>
            ))}
            {matches.length > 8 && <div className="wb-hint">…and {matches.length - 8} more</div>}
          </div>
        )}

        {adding && !readOnly && (
          <PrimerAddForm
            existing={primers.length}
            onDone={id => {
              onAddingChange(false)
              if (id) setExpandedId(id)
            }}
          />
        )}

        {legacyIds.length > 0 && !readOnly && (
          <div className="pl-legacy">
            <span>
              {legacyIds.length} primer_bind feature{legacyIds.length === 1 ? '' : 's'} can become
              {legacyIds.length === 1 ? ' a primer' : ' primers'}, keeping any recorded tail.
            </span>
            <button
              className="btn btn-sm"
              onClick={() => {
                const n = convertFeaturesToPrimers(legacyIds)
                if (n > 0) {
                  notify.success(`Converted ${n} feature${n === 1 ? '' : 's'} to primers`, {
                    action: { label: 'Undo', onClick: () => useEditorStore.getState().undo() },
                  })
                }
              }}
            >
              Convert
            </button>
          </div>
        )}

        {shown.map(p => {
          const pSites = sites.get(p.id) ?? []
          const first = pSites[0]
          const expanded = expandedId === p.id
          const tails = first ? tailLabel(first) : null
          return (
            <div
              key={p.id}
              data-primer-id={p.id}
              className={`ft-item ${expanded ? 'expanded' : ''}`}
            >
              <div
                className="ft-summary"
                onClick={() => {
                  selectSite(first)
                  setExpandedId(expanded ? null : p.id)
                }}
                onMouseEnter={() => { if (first) setHoveredAnnotation(primerItemId(p.id, 0)) }}
                onMouseLeave={() => setHoveredAnnotation(null)}
              >
                <span className="ann-swatch" style={{ backgroundColor: primerColor(p, first?.strand ?? 1) }} />
                <span className="ft-name">{p.name}</span>
                {p.role === 'probe' && <span className="ft-type-badge">probe</span>}
                {tails && <span className="ft-type-badge" title={tails}>tail</span>}
                <span className="pl-sites">
                  {pSites.length === 0
                    ? <span className="pl-unbound" title="Does not bind this sequence"><AlertTriangle size={11} /> unbound</span>
                    : pSites.length === 1 ? siteLabel(first) : `${pSites.length} sites`}
                </span>
              </div>
              {expanded && (
                <PrimerEditor
                  primer={p}
                  sites={pSites}
                  readOnly={readOnly}
                  onSelectSite={selectSite}
                  onClose={() => setExpandedId(null)}
                />
              )}
            </div>
          )
        })}

        {shown.length === 0 && !adding && (
          <div className="ft-empty">
            {q
              ? 'No matching primers.'
              : 'No primers. Click + to paste one, or select bases and right-click → New Forward Primer.'}
          </div>
        )}
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------

function PrimerEditor({ primer, sites, readOnly, onSelectSite, onClose }: {
  primer: PrimerData
  sites: BindingSite[]
  readOnly: boolean
  onSelectSite: (site: BindingSite) => void
  onClose: () => void
}) {
  const updatePrimer = useEditorStore(s => s.updatePrimer)
  const removePrimers = useEditorStore(s => s.removePrimers)
  const [name, setName] = useState(primer.name)
  const [seqText, setSeqText] = useState(primer.sequence)
  const [notes, setNotes] = useState(primer.notes ?? '')
  const [seqError, setSeqError] = useState<string | null>(null)

  // An undo or a rename elsewhere replaces the primer; follow it.
  useEffect(() => { setName(primer.name) }, [primer.name])
  useEffect(() => { setSeqText(primer.sequence); setSeqError(null) }, [primer.sequence])
  useEffect(() => { setNotes(primer.notes ?? '') }, [primer.notes])

  const first = sites[0] ?? null
  const sequence = useEditorStore(st => st.doc.sequence)
  const s = summarizeOligo(primer, first, { bases: sequence.bases, topology: sequence.topology })

  const commitName = () => {
    const v = name.trim()
    if (v && v !== primer.name) updatePrimer(primer.id, { name: v })
    else setName(primer.name)
  }
  const commitSeq = () => {
    const clean = cleanOligo(seqText)
    if (!clean) { setSeqError('Only A, C, G, T and IUPAC ambiguity codes.'); return }
    setSeqError(null)
    if (clean !== primer.sequence) updatePrimer(primer.id, { sequence: clean })
    else setSeqText(primer.sequence)
  }
  const commitNotes = () => {
    const v = notes.trim()
    if (v !== (primer.notes ?? '')) updatePrimer(primer.id, { notes: v || undefined })
  }

  return (
    <div className="ft-editor" onClick={e => e.stopPropagation()}>
      <div className="ft-row">
        <label>Name</label>
        <input
          className="input ft-input"
          value={name}
          disabled={readOnly}
          onChange={e => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        />
      </div>
      <div className="ft-row pl-seq-row">
        <label>Oligo</label>
        <textarea
          className="input ft-input pl-seq-input"
          value={seqText}
          disabled={readOnly}
          rows={2}
          spellCheck={false}
          onChange={e => setSeqText(e.target.value)}
          onBlur={commitSeq}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLTextAreaElement).blur() }
          }}
        />
      </div>
      {seqError && <div className="pl-error">{seqError}</div>}
      <div className="ft-row">
        <label>Type</label>
        <select
          className="input ft-select"
          value={primer.role}
          disabled={readOnly}
          onChange={e => updatePrimer(primer.id, { role: e.target.value as OligoRole })}
        >
          <option value="primer">Primer (must pair at its 3′ end)</option>
          <option value="probe">Probe (may carry tails at both ends)</option>
        </select>
      </div>

      <div className="pl-stats">
        <span>{s.length} nt</span>
        <span>GC {s.gc.toFixed(0)}%</span>
        {first && (first.tail5 || first.tail3 || first.mismatches.length > 0)
          ? <span>Tm {fmtTm(s.tmAnneal)} annealed · {fmtTm(s.tmFull)} full</span>
          : <span>Tm {fmtTm(s.tmFull)}</span>}
      </div>

      <div className="ft-tooltip-bases pl-oligo">
        <OligoSequence sequence={primer.sequence} site={first} />
      </div>

      {sites.length === 0 ? (
        <div className="pl-error">
          <AlertTriangle size={11} /> Does not bind this sequence
          {primer.role === 'primer' ? ' with its 3′ end paired.' : '.'}
        </div>
      ) : (
        <div className="pl-site-list">
          {sites.map((site, i) => (
            <button key={i} className="pl-site" onClick={() => onSelectSite(site)} title="Select the annealed bases">
              <span>{siteLabel(site)}</span>
              {tailLabel(site) && <span className="pl-site-note">{tailLabel(site)}</span>}
              {site.mismatches.length > 0 && (
                <span className="pl-site-note pl-mm">
                  {site.mismatches.length} mismatch{site.mismatches.length === 1 ? '' : 'es'}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      <div className="ft-row">
        <label>Notes</label>
        <textarea
          className="input ft-input"
          value={notes}
          rows={2}
          disabled={readOnly}
          onChange={e => setNotes(e.target.value)}
          onBlur={commitNotes}
        />
      </div>

      <div className="ft-actions">
        <button className="btn btn-sm" onClick={onClose}>Done</button>
        <button
          className="btn btn-sm"
          onClick={() => copyText(primer.sequence, `Copied ${primer.name} (${primer.sequence.length} nt)`)}
        >
          <Copy size={12} /> Copy
        </button>
        <button
          className="btn btn-sm"
          title="Keep a copy in the library, to use on other sequences"
          onClick={() => {
            const ids = useEditorStore.getState().addLibraryOligos([{
              name: primer.name, sequence: primer.sequence, role: primer.role,
              ...(primer.notes ? { notes: primer.notes } : {}),
            }])
            notify.success(ids.length ? `Added "${primer.name}" to the library` : `"${primer.name}" is already in the library`)
          }}
        >
          To library
        </button>
        {!readOnly && (
          <button className="btn btn-sm ft-del-btn" onClick={() => removePrimers([primer.id])}>
            Delete
          </button>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

/**
 * Paste an oligo and see, before adding it, where it binds and what of it
 * is tail. Adding an oligo that binds nowhere is allowed: it may be meant
 * for a construct that does not exist yet.
 */
function PrimerAddForm({ existing, onDone }: { existing: number; onDone: (id: string | null) => void }) {
  const addPrimers = useEditorStore(s => s.addPrimers)
  const sequence = useEditorStore(s => s.doc.sequence)
  const [name, setName] = useState(`Primer ${existing + 1}`)
  const [text, setText] = useState('')
  const [role, setRole] = useState<OligoRole>('primer')

  const oligo = text.trim() ? cleanOligo(text) : null
  const invalid = text.trim().length > 0 && !oligo

  const preview = useMemo(() => {
    if (!oligo) return null
    const probe: PrimerData = { id: 'preview', name, sequence: oligo, role }
    return findBindingSites([probe], sequence.bases, sequence.topology).get('preview') ?? []
  }, [oligo, role, name, sequence])

  const add = () => {
    if (!oligo) return
    const id = newPrimerId()
    addPrimers([{ id, name: name.trim() || `Primer ${existing + 1}`, sequence: oligo, role }])
    onDone(id)
  }

  return (
    <div className="ft-add-form fs-add-form">
      <div className="ft-editor">
        <div className="ft-row">
          <label>Name</label>
          <input className="input ft-input" value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div className="ft-row pl-seq-row">
          <label>Oligo</label>
          <textarea
            className="input ft-input pl-seq-input"
            placeholder="5′-GAATTCATGGCTAGCAAAGGAG-3′"
            value={text}
            rows={3}
            autoFocus
            spellCheck={false}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); add() }
              if (e.key === 'Escape') onDone(null)
            }}
          />
        </div>
        <div className="ft-row">
          <label>Type</label>
          <select className="input ft-select" value={role} onChange={e => setRole(e.target.value as OligoRole)}>
            <option value="primer">Primer</option>
            <option value="probe">Probe</option>
          </select>
        </div>

        {invalid && <div className="pl-error">Only A, C, G, T and IUPAC ambiguity codes.</div>}
        {oligo && preview && (
          preview.length === 0 ? (
            <div className="pl-hint">
              <AlertTriangle size={11} /> Does not bind this sequence. It can still be added.
            </div>
          ) : (
            <div className="pl-hint">
              <div className="ft-tooltip-bases pl-oligo">
                <OligoSequence sequence={oligo} site={preview[0]} />
              </div>
              Binds {preview.length === 1 ? siteLabel(preview[0]) : `at ${preview.length} sites`}
              {tailLabel(preview[0]) && ` · ${tailLabel(preview[0])}`}
            </div>
          )
        )}

        <div className="ft-actions">
          <button className="btn btn-sm btn-primary" disabled={!oligo} onClick={add}>Add primer</button>
          <button className="btn btn-sm" onClick={() => onDone(null)}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
