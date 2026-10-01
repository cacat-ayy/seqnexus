/**
 * The alignment's side panel.
 *
 * "Selection" shows statistics for whatever is selected (the whole alignment
 * when nothing is), recomputed on every edit and selection change, and the
 * actions that apply to it. "Display" holds the view settings.
 */

import { memo, useDeferredValue, useMemo, useState } from 'react'
import {
  ClipboardCopy, Combine, Crosshair, Eraser, FileOutput, Scissors, SortAsc, Repeat, Trash2,
} from 'lucide-react'
import { width, type AlnDoc } from '../../msa/model'
import { columnsMatching, docProfile, pairIdentity, selectionStats, type StripRule } from '../../msa/stats'
import { cellColorer } from '../../msa/colors'
import {
  CONSENSUS_THRESHOLDS, DNA_SCHEMES, PROTEIN_SCHEMES, ZOOM_LEVELS, schemeFor,
  type AlnView, type CompareTo, type HighlightMode,
} from '../../msa/view'
import { GENETIC_CODES } from '../../codon/genetic-codes'
import type { JoinConflict } from '../../msa/edit'
import type { Selection } from './paint'

export interface InspectorActions {
  copy: () => void
  extract: () => void
  join: (conflict: JoinConflict) => void
  setReference: (rowId: string | null) => void
  deleteColumns: () => void
  erase: () => void
  strip: (rule: StripRule) => void
  sortRows: (by: 'name' | 'identity') => void
  reverseComplement: () => void
}

interface Props {
  doc: AlnDoc
  view: AlnView
  selection: Selection | null
  editing: boolean
  tab: 'selection' | 'display'
  onTab: (t: 'selection' | 'display') => void
  onView: (patch: Partial<AlnView>) => void
  actions: InspectorActions
}

const pct = (v: number | null, digits = 1) => (v === null ? '—' : `${(v * 100).toFixed(digits)}%`)

function AlignmentInspector({ doc, view, selection, editing, tab, onTab, onView, actions }: Props) {
  return (
    <aside className="aw-inspector" aria-label="Alignment inspector">
      <div className="aw-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'selection'} className={`aw-tab ${tab === 'selection' ? 'active' : ''}`} onClick={() => onTab('selection')}>
          {selection ? 'Selection' : 'Statistics'}
        </button>
        <button role="tab" aria-selected={tab === 'display'} className={`aw-tab ${tab === 'display' ? 'active' : ''}`} onClick={() => onTab('display')}>
          Display
        </button>
      </div>
      <div className="aw-inspector-body">
        {tab === 'selection'
          ? <SelectionPanel doc={doc} selection={selection} editing={editing} actions={actions} />
          : <DisplayPanel doc={doc} view={view} onView={onView} />}
      </div>
    </aside>
  )
}

export default memo(AlignmentInspector)

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

function SelectionPanel({ doc, selection: liveSelection, editing, actions }: {
  doc: AlnDoc
  selection: Selection | null
  editing: boolean
  actions: InspectorActions
}) {
  // Dragging a selection over a large alignment would otherwise recompute on every pointer move.
  const selection = useDeferredValue(liveSelection)
  const deferredDoc = useDeferredValue(doc)
  const w = width(deferredDoc)
  const stats = useMemo(
    () => selectionStats(deferredDoc, selection?.rowIds ?? null, selection?.c0 ?? 0, selection?.c1 ?? w),
    [deferredDoc, selection, w],
  )
  const rows = useMemo(() => {
    const ids = selection ? new Set(selection.rowIds) : null
    return ids ? deferredDoc.rows.filter(r => ids.has(r.id)) : deferredDoc.rows
  }, [deferredDoc, selection])
  const allRows = !selection || selection.rowIds.length === doc.rows.length
  const allCols = !selection || (selection.c0 === 0 && selection.c1 >= w)
  const singleRow = selection && selection.rowIds.length === 1 ? selection.rowIds[0] : null

  const where = !selection
    ? 'Whole alignment'
    : allCols ? `${selection.rowIds.length} row${selection.rowIds.length === 1 ? '' : 's'}, all columns`
    : `Columns ${(selection.c0 + 1).toLocaleString()}–${selection.c1.toLocaleString()}${allRows ? ', all rows' : `, ${selection.rowIds.length} row${selection.rowIds.length === 1 ? '' : 's'}`}`

  const colorer = useMemo(() => cellColorer(doc.kind === 'dna' ? 'nucleotide' : 'zappo', doc.kind, docProfile(deferredDoc), () => '-'), [doc.kind, deferredDoc])
  const totalResidues = stats.composition.reduce((a, c) => a + c.count, 0)

  return (
    <div className="aw-panel">
      <div className="aw-sel-head">
        <div className="aw-sel-title">{where}</div>
        <div className="aw-sel-sub">{stats.rows.toLocaleString()} × {stats.columns.toLocaleString()} · {stats.residues.toLocaleString()} residues</div>
      </div>

      <dl className="aw-stats">
        <Stat label="Pairwise identity" value={pct(stats.pairwiseIdentity)} hint="Mean over every pair of rows; a gap against a residue counts as a difference" strong />
        {doc.kind === 'protein' && <Stat label="Pairwise similarity" value={pct(stats.pairwiseSimilarity)} hint="Identical or similar (BLOSUM62 > 0)" />}
        <Stat
          label="Identical sites"
          value={`${stats.identicalSites.toLocaleString()} (${pct(stats.columns ? stats.identicalSites / stats.columns : null, 0)})`}
          hint="Columns where every row has the same residue and none has a gap"
        />
        <Stat label="Variable sites" value={stats.variableSites.toLocaleString()} hint="Columns with more than one residue type" />
        <Stat label="Informative sites" value={stats.informativeSites.toLocaleString()} hint="Parsimony-informative: at least two residue types, each in at least two rows" />
        <Stat label="Gaps" value={pct(stats.gapFraction)} hint={`${stats.gapCells.toLocaleString()} gap cells`} />
        {doc.kind === 'dna' && <Stat label="GC content" value={pct(stats.gc)} />}
        <Stat
          label="Length"
          value={stats.lengths.min === stats.lengths.max
            ? stats.lengths.max.toLocaleString()
            : `${stats.lengths.min.toLocaleString()}–${stats.lengths.max.toLocaleString()}`}
          hint={`Ungapped residues per row; mean ${stats.lengths.mean.toFixed(1)}`}
        />
      </dl>

      {totalResidues > 0 && (
        <div className="aw-comp">
          <div className="aw-section-label">Composition</div>
          <div className="aw-comp-bar" role="img" aria-label="Residue composition">
            {stats.composition.map(c => (
              <span
                key={c.ch}
                style={{ flexGrow: c.count, background: colorer(c.ch, 0) ?? 'var(--text-muted)' }}
                title={`${c.ch}: ${c.count.toLocaleString()} (${(c.count / totalResidues * 100).toFixed(1)}%)`}
              />
            ))}
          </div>
          <div className="aw-comp-legend">
            {stats.composition.slice(0, doc.kind === 'dna' ? 6 : 10).map(c => (
              <span key={c.ch}>
                <i style={{ background: colorer(c.ch, 0) ?? 'var(--text-muted)' }} />
                {c.ch} {(c.count / totalResidues * 100).toFixed(c.count / totalResidues < 0.1 ? 1 : 0)}%
              </span>
            ))}
          </div>
        </div>
      )}

      {rows.length >= 2 && rows.length <= 12 && (
        <IdentityMatrix rows={rows} c0={selection?.c0 ?? 0} c1={selection?.c1 ?? w} />
      )}

      <div className="aw-section-label">Selection</div>
      <div className="aw-actions">
        <button className="aw-action" onClick={actions.copy}><ClipboardCopy size={13} /> Copy as FASTA</button>
        <button className="aw-action" onClick={actions.extract} disabled={rows.length === 0}>
          <FileOutput size={13} /> {rows.length > 1 ? `Extract ${rows.length} sequences` : 'Extract as sequence'}
        </button>
        {rows.length >= 2 && <JoinButton count={rows.length} onJoin={actions.join} />}
        {singleRow && (
          doc.referenceId === singleRow
            ? <button className="aw-action" onClick={() => actions.setReference(null)}><Crosshair size={13} /> Clear reference</button>
            : <button className="aw-action" onClick={() => actions.setReference(singleRow)}><Crosshair size={13} /> Set as reference</button>
        )}
        {selection && allRows && (
          <button className="aw-action danger" onClick={actions.deleteColumns}><Trash2 size={13} /> Delete {selection.c1 - selection.c0 === 1 ? 'column' : `${(selection.c1 - selection.c0).toLocaleString()} columns`}</button>
        )}
        {selection && editing && !allRows && (
          <button className="aw-action" onClick={actions.erase}><Eraser size={13} /> Replace with gaps</button>
        )}
      </div>

      <div className="aw-section-label">Alignment</div>
      <StripColumns doc={deferredDoc} onStrip={actions.strip} />
      <div className="aw-actions">
        <button className="aw-action" onClick={() => actions.sortRows('name')}><SortAsc size={13} /> Sort rows by name</button>
        <button className="aw-action" onClick={() => actions.sortRows('identity')}>
          <SortAsc size={13} /> Sort by identity to {doc.referenceId ? 'reference' : 'consensus'}
        </button>
        {doc.kind === 'dna' && (
          <button className="aw-action" onClick={actions.reverseComplement}><Repeat size={13} /> Reverse complement</button>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value, hint, strong }: { label: string; value: string; hint?: string; strong?: boolean }) {
  return (
    <div className={`aw-stat${strong ? ' strong' : ''}`} title={hint}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

function IdentityMatrix({ rows, c0, c1 }: { rows: AlnDoc['rows']; c0: number; c1: number }) {
  const m = useMemo(() => rows.map(a => rows.map(b => (a === b ? 1 : pairIdentity(a.seq, b.seq, c0, c1)))), [rows, c0, c1])
  return (
    <div className="aw-matrix-wrap">
      <div className="aw-section-label">Pairwise identity</div>
      <table className="aw-matrix">
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id}>
              <th title={r.name}>{r.name}</th>
              {m[i].map((v, j) => (
                <td
                  key={j}
                  title={`${r.name} vs ${rows[j].name}: ${v === null ? 'nothing to compare' : `${(v * 100).toFixed(1)}%`}`}
                  style={{ background: v === null || i === j ? undefined : `color-mix(in srgb, var(--accent) ${Math.round(Math.max(0, (v - 0.5) * 2) * 70)}%, transparent)` }}
                >
                  {i === j ? '' : v === null ? '–' : Math.round(v * 100)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function JoinButton({ count, onJoin }: { count: number; onJoin: (c: JoinConflict) => void }) {
  const [open, setOpen] = useState(false)
  const [conflict, setConflict] = useState<JoinConflict>('ambiguity')
  if (!open) {
    return <button className="aw-action" onClick={() => setOpen(true)}><Combine size={13} /> Join {count} rows…</button>
  }
  return (
    <div className="aw-subpanel">
      <div className="aw-subpanel-title">Join {count} rows into one</div>
      <p className="aw-note">Where only one row has a residue it is kept. Where rows disagree:</p>
      <label className="aw-radio"><input type="radio" checked={conflict === 'ambiguity'} onChange={() => setConflict('ambiguity')} /> Use an ambiguity code (N or X for protein)</label>
      <label className="aw-radio"><input type="radio" checked={conflict === 'first'} onChange={() => setConflict('first')} /> Keep the upper row's residue</label>
      <div className="aw-subpanel-buttons">
        <button className="btn btn-sm" onClick={() => setOpen(false)}>Cancel</button>
        <button className="btn btn-sm btn-primary" onClick={() => { onJoin(conflict); setOpen(false) }}>Join</button>
      </div>
    </div>
  )
}

type StripKind = StripRule['kind']

function StripColumns({ doc, onStrip }: { doc: AlnDoc; onStrip: (r: StripRule) => void }) {
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<StripKind>('gap-only')
  const [gapPct, setGapPct] = useState(50)
  const [idPct, setIdPct] = useState(30)
  const rule: StripRule = kind === 'gappy' ? { kind, fraction: gapPct / 100 }
    : kind === 'low-identity' ? { kind, fraction: idPct / 100 }
    : { kind }
  const count = useMemo(() => {
    if (!open) return 0
    const mask = columnsMatching(doc, rule)
    let n = 0
    for (let i = 0; i < mask.length; i++) n += mask[i]
    return n
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, doc, kind, gapPct, idPct])
  const w = width(doc)
  if (!open) {
    return <div className="aw-actions"><button className="aw-action" onClick={() => setOpen(true)}><Scissors size={13} /> Strip columns…</button></div>
  }
  return (
    <div className="aw-subpanel">
      <div className="aw-subpanel-title">Strip columns</div>
      <label className="aw-radio"><input type="radio" checked={kind === 'gap-only'} onChange={() => setKind('gap-only')} /> Gaps in every row</label>
      <label className="aw-radio">
        <input type="radio" checked={kind === 'gappy'} onChange={() => setKind('gappy')} /> Gaps in at least
        <input className="aw-num" type="number" min={1} max={100} value={gapPct} onChange={e => { setGapPct(Math.max(1, Math.min(100, Number(e.target.value) || 1))); setKind('gappy') }} />% of rows
      </label>
      <label className="aw-radio">
        <input type="radio" checked={kind === 'low-identity'} onChange={() => setKind('low-identity')} /> Identity below
        <input className="aw-num" type="number" min={1} max={100} value={idPct} onChange={e => { setIdPct(Math.max(1, Math.min(100, Number(e.target.value) || 1))); setKind('low-identity') }} />%
      </label>
      <label className="aw-radio"><input type="radio" checked={kind === 'invariant'} onChange={() => setKind('invariant')} /> Identical in every row (keep variable sites)</label>
      <p className="aw-note">{count === 0 ? 'No columns match.' : `Removes ${count.toLocaleString()} of ${w.toLocaleString()} columns.`}</p>
      <div className="aw-subpanel-buttons">
        <button className="btn btn-sm" onClick={() => setOpen(false)}>Cancel</button>
        <button className="btn btn-sm btn-primary" disabled={count === 0 || count === w} onClick={() => { onStrip(rule); setOpen(false) }}>Strip</button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

function Segmented<T extends string | number>({ value, options, onChange, label }: {
  value: T
  options: readonly { value: T; label: string; disabled?: boolean; title?: string }[]
  onChange: (v: T) => void
  label: string
}) {
  return (
    <div className="aw-seg" role="radiogroup" aria-label={label}>
      {options.map(o => (
        <button
          key={String(o.value)}
          role="radio"
          aria-checked={value === o.value}
          className={value === o.value ? 'active' : ''}
          disabled={o.disabled}
          title={o.title}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function HighlightControl({ view, hasReference, onView }: { view: AlnView; hasReference: boolean; onView: (p: Partial<AlnView>) => void }) {
  return (
    <>
      <Segmented<HighlightMode>
        label="Highlight"
        value={view.highlight}
        onChange={highlight => onView({ highlight })}
        options={[
          { value: 'all', label: 'All', title: 'Colour every residue' },
          { value: 'differences', label: 'Differences', title: 'Colour only residues that differ from the comparison' },
          { value: 'matches', label: 'Matches', title: 'Colour only residues that agree with the comparison' },
        ]}
      />
      <Segmented<CompareTo>
        label="Compare with"
        value={hasReference ? view.compareTo : 'consensus'}
        onChange={compareTo => onView({ compareTo })}
        options={[
          { value: 'consensus', label: 'Consensus' },
          { value: 'reference', label: 'Reference', disabled: !hasReference, title: hasReference ? undefined : 'Right-click a row name to make it the reference' },
        ]}
      />
    </>
  )
}

function DisplayPanel({ doc, view, onView }: { doc: AlnDoc; view: AlnView; onView: (p: Partial<AlnView>) => void }) {
  const schemes = doc.kind === 'dna' ? DNA_SCHEMES : PROTEIN_SCHEMES
  const scheme = schemeFor(view, doc.kind)
  const hasRef = !!doc.referenceId
  return (
    <div className="aw-panel">
      <div className="aw-section-label">Colour</div>
      <select
        className="select aw-select-full"
        value={scheme}
        aria-label="Colour scheme"
        onChange={e => onView(doc.kind === 'dna' ? { dnaScheme: e.target.value as AlnView['dnaScheme'] } : { proteinScheme: e.target.value as AlnView['proteinScheme'] })}
      >
        {schemes.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
      </select>
      <p className="aw-note">{schemes.find(s => s.id === scheme)?.description}</p>
      <Segmented
        label="Colour target"
        value={view.colorTarget}
        onChange={colorTarget => onView({ colorTarget })}
        options={[{ value: 'background', label: 'Cell background' }, { value: 'letters', label: 'Letters' }]}
      />

      <div className="aw-section-label">Highlight</div>
      <div className="aw-stack">
        <HighlightControl view={view} hasReference={hasRef} onView={onView} />
        <label className="aw-check">
          <input type="checkbox" checked={view.dots} onChange={e => onView({ dots: e.target.checked })} />
          Show residues that match as dots
        </label>
      </div>

      <div className="aw-section-label">Tracks</div>
      <div className="aw-stack">
        <label className="aw-check">
          <input type="checkbox" checked={view.tracks.consensus} onChange={e => onView({ tracks: { ...view.tracks, consensus: e.target.checked } })} />
          Consensus
        </label>
        <div className="aw-indent">
          <select
            className="select aw-select-sm"
            value={view.consensusThreshold}
            aria-label="Consensus threshold"
            onChange={e => onView({ consensusThreshold: Number(e.target.value) })}
          >
            {CONSENSUS_THRESHOLDS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <label className="aw-check small">
            <input type="checkbox" checked={view.consensusIgnoreGaps} onChange={e => onView({ consensusIgnoreGaps: e.target.checked })} />
            Ignore gaps
          </label>
        </div>
        <label className="aw-check">
          <input type="checkbox" checked={view.tracks.identity} onChange={e => onView({ tracks: { ...view.tracks, identity: e.target.checked } })} />
          {doc.kind === 'protein' ? 'Similarity graph' : 'Identity graph'}
        </label>
        <div className="aw-indent">
          <select className="select aw-select-sm" value={view.graphWindow} aria-label="Smoothing" onChange={e => onView({ graphWindow: Number(e.target.value) })}>
            {[1, 5, 11, 21, 51].map(n => <option key={n} value={n}>{n === 1 ? 'No smoothing' : `Smooth over ${n} columns`}</option>)}
          </select>
        </div>
        <label className="aw-check">
          <input type="checkbox" checked={view.tracks.logo} onChange={e => onView({ tracks: { ...view.tracks, logo: e.target.checked } })} />
          Sequence logo
        </label>
        <label className="aw-check" title={hasRef ? undefined : 'Set a reference row first'}>
          <input type="checkbox" checked={view.pinReference} disabled={!hasRef} onChange={e => onView({ pinReference: e.target.checked })} />
          Keep the reference row on top
        </label>
      </div>

      {doc.kind === 'dna' && (
        <>
          <div className="aw-section-label">Translation</div>
          <div className="aw-stack">
            <label className="aw-check">
              <input type="checkbox" checked={view.translate} onChange={e => onView({ translate: e.target.checked })} />
              Show translation under each row
            </label>
            <Segmented<0 | 1 | 2>
              label="Reading frame"
              value={view.frame}
              onChange={frame => onView({ frame })}
              options={[{ value: 0, label: 'Frame 1' }, { value: 1, label: 'Frame 2' }, { value: 2, label: 'Frame 3' }]}
            />
            <select className="select aw-select-full" value={view.geneticCode} aria-label="Genetic code" onChange={e => onView({ geneticCode: Number(e.target.value) })}>
              {GENETIC_CODES.map(c => <option key={c.id} value={c.id}>{c.id}. {c.name}</option>)}
            </select>
            <p className="aw-note">Frames count from each row's first base. Gaps that are not a multiple of three are underlined in red: they shift the frame.</p>
          </div>
        </>
      )}

      <div className="aw-section-label">Zoom</div>
      <input
        type="range"
        className="aw-range"
        min={0}
        max={ZOOM_LEVELS.length - 1}
        value={view.zoom}
        aria-label="Zoom"
        onChange={e => onView({ zoom: Number(e.target.value) })}
      />
    </div>
  )
}
