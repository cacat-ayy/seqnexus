import './BlastDrawer.css'
/**
 * The BLAST drawer: searches and their results docked under the editor.
 *
 * Full width, so the hit table and 60-column alignments fit, and below the
 * map and sequence rather than over them, so a hit can be pointed at in the
 * sequence while its row is read. The header is the search form; the body
 * shows one of the open document's searches, which are kept with it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlignLeft, ChevronDown, ChevronUp, Copy, Download, ExternalLink, FilePlus, FileSpreadsheet, FileText, Globe, History,
  Loader2, Maximize2, Minimize2, MousePointer2, Plus, Search, SlidersHorizontal, Tag, Trash2, Upload, X,
} from 'lucide-react'
import { useEditorStore, selectionSegments } from '../../store'
import {
  useBlastStore, openDrawer, closeDrawer, setCollapsed, setMaximized, setDrawerHeight, showSearch, setQuerySource,
  updateDraft, resetOptions, changedOptions, startBlast, cancelBlast, clearFailure, requestAlignment, searchAtNcbi,
  DRAWER_MIN_HEIGHT, type BlastRequest, type SettingsDraft,
} from '../../blast/session'
import { PROTEIN_QUERY_PROGRAMS, type BlastProgram, type BlastQuery, type BlastSearch } from '../../blast/types'
import {
  DEFAULT_SETTINGS, EVALUES, MATRICES, MAX_HITS, evalueParam, maxHitsParam, usesMatrix,
} from '../../blast/params'
import { databaseLabel, databasesFor, dbXref, ncbiDatabaseFor, recordUrl } from '../../blast/databases'
import { ebiJobUrl } from '../../blast/ebi'
import { fingerprint, hitRangeOnDoc, hitStrandOnDoc, placementOf, queryBases } from '../../blast/query'
import type { AnnotationData } from '../../models/Annotation'
import { useClampedPosition } from '../../hooks/useClampedPosition'
import { usePopoverDismiss } from '../../hooks/usePopoverDismiss'
import ContextMenuPopup, { MenuItem, MenuSeparator } from '../ContextMenuPopup'
import { copyText } from '../../utils/clipboard'
import HitTable from './HitTable'
import HitMap from './HitMap'
import { centerSequenceViewOn } from '../sequence-view-controls'
import { formatEvalue, hitMatches, timeAgo } from '../../blast/format'
import SkeletonRows from '../SkeletonRows'
import {
  alignmentEntries, canAlignWithQuery, canOpenRecord, copyHitFasta, downloadHitsCsv, downloadHitsFasta, importNcbiResultFile,
  openHitRecord,
} from '../../blast/actions'

const PROGRAMS: { id: BlastProgram; label: string; protein: boolean }[] = [
  { id: 'megablast', label: 'megablast: highly similar', protein: false },
  { id: 'blastn', label: 'blastn: somewhat similar', protein: false },
  { id: 'blastx', label: 'blastx: translated query, protein database', protein: false },
  { id: 'tblastx', label: 'tblastx: translated query, translated database', protein: false },
  { id: 'blastp', label: 'blastp: protein database', protein: true },
  { id: 'tblastn', label: 'tblastn: translated nucleotide database', protein: true },
]

/** Seconds as m:ss. */
const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`

/** The program a search ran, as it was chosen (megablast, not the blastn NCBI reports). */
const programOf = (s: BlastSearch) => s.settings.program

/**
 * `embedded` is BLAST as a tab of the features panel along the bottom: the
 * same search and results, without a frame of its own. The panel resizes
 * and closes it; only Maximize stays, letting the panel take the view's room.
 */
export default function BlastDrawer({ containerRef, embedded = false }: { containerRef: React.RefObject<HTMLElement | null>; embedded?: boolean }) {
  const open = useBlastStore(s => s.open)
  if (!open) return null
  return <Drawer containerRef={containerRef} embedded={embedded} />
}

function Drawer({ containerRef, embedded }: { containerRef: React.RefObject<HTMLElement | null>; embedded: boolean }) {
  const tabId = useEditorStore(s => s.activeTabId) ?? ''
  const doc = useEditorStore(s => s.doc)
  const selection = useEditorStore(s => s.selection)
  const searches = useEditorStore(s => s.tabs.find(t => t.id === s.activeTabId)?.blastSearches ?? EMPTY)

  const run = useBlastStore(s => s.run)
  const failure = useBlastStore(s => s.failure)
  const shownRid = useBlastStore(s => s.shown[tabId])
  // Embedded, the panel does the collapsing (it closes) and the sizing.
  const collapsed = useBlastStore(s => s.collapsed) && !embedded
  const maximized = useBlastStore(s => s.maximized)
  const height = useBlastStore(s => s.height)

  // The search on show: the one picked, the newest when none was, none
  // while a new one is being set up (null).
  const search = shownRid === null ? null : searches.find(s => s.rid === shownRid) ?? searches[0] ?? null

  // --- Resizing: drag the top edge, or the arrow keys on it ---
  const dragStart = useRef<{ y: number; h: number } | null>(null)
  const maxHeight = () => Math.max(DRAWER_MIN_HEIGHT, (containerRef.current?.clientHeight ?? 800) - 96)
  const onResizeDown = (e: React.PointerEvent) => {
    if (collapsed || maximized) return
    e.preventDefault()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    dragStart.current = { y: e.clientY, h: height }
  }
  const onResizeMove = (e: React.PointerEvent) => {
    if (!dragStart.current) return
    setDrawerHeight(Math.min(maxHeight(), dragStart.current.h + dragStart.current.y - e.clientY))
  }
  const onResizeUp = () => { dragStart.current = null }
  const onResizeKey = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 64 : 16
    if (e.key === 'ArrowUp') { e.preventDefault(); setDrawerHeight(Math.min(maxHeight(), height + step)) }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setDrawerHeight(height - step) }
  }

  const style = collapsed || maximized || embedded ? undefined : { height: Math.min(height, maxHeight()) }

  return (
    <section
      className={`bd${collapsed ? ' bd-collapsed' : ''}${maximized && !embedded ? ' bd-maximized' : ''}${embedded ? ' bd-embedded' : ''}`}
      style={style}
      aria-label="BLAST"
    >
      {!collapsed && !maximized && !embedded && (
        <div
          className="bd-resize"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize the BLAST drawer"
          aria-valuemin={DRAWER_MIN_HEIGHT}
          aria-valuenow={height}
          tabIndex={0}
          onPointerDown={onResizeDown}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeUp}
          onPointerCancel={onResizeUp}
          onKeyDown={onResizeKey}
        />
      )}
      <SearchHeader tabId={tabId} searches={searches} search={search} embedded={embedded} />
      <RunStrip tabId={tabId} />
      {failure && failure.tabId === tabId && !run && (
        <div className="bd-failure" role="alert">
          <span>{failure.message}</span>
          {failure.url && (
            <a href={failure.url} target="_blank" rel="noopener noreferrer" className="bd-link">Open the job at EMBL-EBI ↗</a>
          )}
          <button className="bd-icon-btn" onClick={clearFailure} aria-label="Dismiss"><X size={13} /></button>
        </div>
      )}
      {!collapsed && (
        <div className="bd-body">
          {search
            ? <Results key={search.rid} tabId={tabId} search={search} />
            : run?.tabId === tabId
              ? <SkeletonRows label="Searching" count={6} />
              : <Intro tabId={tabId} hasSearches={searches.length > 0} protein={doc.sequence.alphabet === 'protein'} selectionLength={selectionSegments(selection, doc.sequence.topology, doc.sequence.length).reduce((n, [s, e]) => n + e - s, 0)} />}
        </div>
      )}
    </section>
  )
}

const EMPTY: BlastSearch[] = []

// --- Header: the search form and the drawer's own controls ---

function SearchHeader({ tabId, searches, search, embedded }: { tabId: string; searches: BlastSearch[]; search: BlastSearch | null; embedded: boolean }) {
  const doc = useEditorStore(s => s.doc)
  const selection = useEditorStore(s => s.selection)
  const querySource = useBlastStore(s => s.querySource)
  const translation = useBlastStore(s => s.translation)
  const draft = useBlastStore(s => s.draft)
  const run = useBlastStore(s => s.run)
  const collapsed = useBlastStore(s => s.collapsed)
  const maximized = useBlastStore(s => s.maximized)
  const focusRequest = useBlastStore(s => s.focusRequest)

  const seqLen = doc.sequence.length
  const topology = doc.sequence.topology
  const selSegments = useMemo(() => selectionSegments(selection, topology, seqLen), [selection, topology, seqLen])
  const selLength = selSegments.reduce((n, [s, e]) => n + e - s, 0)

  // The source in force: a selection option with nothing selected falls
  // back to the whole sequence, and the switch says so.
  const source = querySource === 'translation' && translation ? 'translation'
    : querySource === 'selection' && selLength > 0 ? 'selection' : 'whole'

  // A protein document or a translation sends residues: blastp or tblastn.
  // A program or database that does not fit gives way to the default of the
  // right kind, so a saved choice never sends a search the service refuses.
  const proteinQuery = source === 'translation' || doc.sequence.alphabet === 'protein'
  const unit = proteinQuery ? 'aa' : 'bp'
  const program: BlastProgram = PROTEIN_QUERY_PROGRAMS.includes(draft.program) === proteinQuery
    ? draft.program
    : proteinQuery ? 'blastp' : 'megablast'
  const databases = databasesFor(program)
  const database = databases.some(d => d.id === draft.database) ? draft.database : databases[0].id
  const groups = [...new Set(databases.map(d => d.group))]

  const queryLen = source === 'translation' ? translation!.protein.length : source === 'selection' ? selLength : seqLen
  const tooShort = queryLen < 10
  const busy = !!run
  const runningHere = run?.tabId === tabId

  const searchBtn = useRef<HTMLButtonElement>(null)
  useEffect(() => { if (focusRequest) searchBtn.current?.focus() }, [focusRequest])

  const [optionsOpen, setOptionsOpen] = useState(false)
  const optionsBtn = useRef<HTMLButtonElement>(null)
  const [recentAt, setRecentAt] = useState<{ x: number; y: number } | null>(null)

  /** The search as set up: what to send, where it came from, with which settings. */
  const request = useCallback((): BlastRequest => {
    let query: BlastQuery
    let sequence: string
    if (source === 'translation' && translation) {
      query = translation.query
      sequence = translation.protein
    } else {
      const segments: [number, number][] = source === 'selection' ? selSegments.map(([s, e]) => [s, e]) : [[0, seqLen]]
      sequence = queryBases(doc.sequence, segments)
      const disp = (n: number) => n.toLocaleString('en-US')
      const label = source === 'selection'
        ? `Selection ${disp(segments[0][0] + 1)}..${disp(segments[segments.length - 1][1])}`
        : 'Whole sequence'
      query = { label, segments, seqLength: seqLen, fingerprint: fingerprint(sequence) }
    }
    return {
      tabId,
      queryName: doc.name,
      sequence,
      query,
      settings: {
        ...draft,
        program,
        database,
        organism: draft.organism.trim(),
        matrix: usesMatrix(program) ? draft.matrix : '',
      },
    }
  }, [source, translation, selSegments, seqLen, doc, tabId, program, database, draft])

  const submit = () => {
    if (busy || tooShort) return
    void startBlast(request())
  }

  const optionCount = changedOptions(draft)

  return (
    <header className="bd-head">
      {/* Embedded, the panel's tab already says BLAST. */}
      {!embedded && (
        <div className="bd-brand">
          <Globe size={14} aria-hidden="true" />
          <span>BLAST</span>
        </div>
      )}

      <div className="bd-form" role="group" aria-label="Search settings">
        <div className="seg seg-sm bd-seg" role="radiogroup" aria-label="Query">
          <button role="radio" aria-checked={source === 'whole'} onClick={() => setQuerySource('whole')}>
            Whole sequence <span className="bd-seg-count">{seqLen.toLocaleString('en-US')} {doc.sequence.alphabet === 'protein' ? 'aa' : 'bp'}</span>
          </button>
          <button
            role="radio"
            aria-checked={source === 'selection'}
            disabled={selLength === 0}
            title={selLength === 0 ? 'Select a range in the sequence to search it' : undefined}
            onClick={() => setQuerySource('selection')}
          >
            Selection <span className="bd-seg-count">{selLength > 0 ? `${selLength.toLocaleString('en-US')} ${doc.sequence.alphabet === 'protein' ? 'aa' : 'bp'}` : 'none'}</span>
          </button>
          {translation && (
            <span className="bd-seg-translation" role="radio" aria-checked={source === 'translation'}>
              <button className="bd-seg-inner" onClick={() => setQuerySource('translation')}>
                {translation.label} <span className="bd-seg-count">{translation.protein.length.toLocaleString('en-US')} aa</span>
              </button>
              <button className="bd-seg-x" aria-label="Stop searching the translation" onClick={() => setQuerySource('whole')}><X size={11} /></button>
            </span>
          )}
        </div>

        <label className="bd-sr-only" htmlFor="bd-program">Program</label>
        <select id="bd-program" className="select bd-select" value={program} onChange={e => updateDraft({ program: e.target.value as BlastProgram })}>
          {PROGRAMS.filter(p => p.protein === proteinQuery).map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>

        <label className="bd-sr-only" htmlFor="bd-database">Database</label>
        <select id="bd-database" className="select bd-select bd-select-db" value={database} onChange={e => updateDraft({ database: e.target.value })}>
          {groups.map(g => (
            <optgroup key={g} label={g}>
              {databases.filter(d => d.group === g).map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
            </optgroup>
          ))}
        </select>

        <button
          ref={optionsBtn}
          className="btn bd-options-btn"
          aria-haspopup="dialog"
          aria-expanded={optionsOpen}
          onClick={() => setOptionsOpen(v => !v)}
        >
          <SlidersHorizontal size={13} aria-hidden="true" />
          Options
          {optionCount > 0 && <span className="bd-badge" aria-label={`${optionCount} changed`}>{optionCount}</span>}
        </button>
        <OptionsPopover open={optionsOpen} onClose={() => setOptionsOpen(false)} triggerRef={optionsBtn} draft={draft} program={program} />

        {runningHere ? (
          <button className="btn" onClick={cancelBlast}>Cancel search</button>
        ) : (
          <button
            ref={searchBtn}
            className="btn btn-primary bd-search-btn"
            onClick={submit}
            disabled={busy || tooShort}
            title={busy ? `A search for ${run!.queryName} is running` : tooShort ? `The query needs at least 10 ${unit}` : `Search ${databaseLabel(database)} at EMBL-EBI`}
          >
            <Search size={13} aria-hidden="true" /> Search
          </button>
        )}
        <button
          className="btn bd-ncbi-btn"
          onClick={() => { if (!tooShort) searchAtNcbi(request()) }}
          disabled={tooShort}
          title={`Run this search on NCBI's site, against ${ncbiDatabaseFor(program)}, in a new tab. To see the hits here too, choose Download All, then Single-file JSON there, and import the file under Recent.`}
        >
          Search at NCBI <ExternalLink size={12} aria-hidden="true" />
        </button>
      </div>

      <div className="bd-tools">
        <button
          className="btn bd-recent-btn"
          aria-haspopup="menu"
          aria-expanded={!!recentAt}
          onClick={e => {
            const r = e.currentTarget.getBoundingClientRect()
            setRecentAt(recentAt ? null : { x: r.left, y: r.bottom + 4 })
          }}
        >
          <History size={13} aria-hidden="true" /> Recent
        </button>
        {recentAt && <RecentMenu at={recentAt} tabId={tabId} current={search} searches={searches} onClose={() => setRecentAt(null)} />}
        {!embedded && (
          <button
            className="bd-icon-btn"
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? 'Expand the BLAST drawer' : 'Collapse the BLAST drawer'}
            title={collapsed ? 'Expand' : 'Collapse'}
          >{collapsed ? <ChevronUp size={15} /> : <ChevronDown size={15} />}</button>
        )}
        <button
          className="bd-icon-btn"
          onClick={() => setMaximized(!maximized)}
          aria-label={embedded
            ? (maximized ? 'Restore the panel' : 'Maximize the panel')
            : (maximized ? 'Restore the BLAST drawer' : 'Maximize the BLAST drawer')}
          title={maximized ? 'Restore' : 'Maximize'}
        >{maximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button>
        {!embedded && (
          <button className="bd-icon-btn" onClick={closeDrawer} aria-label="Close the BLAST drawer" title="Close (a running search continues)">
            <X size={15} />
          </button>
        )}
      </div>
    </header>
  )
}

// --- Options ---

function OptionsPopover({ open, onClose, triggerRef, draft, program }: {
  open: boolean
  onClose: () => void
  triggerRef: React.RefObject<HTMLButtonElement | null>
  draft: SettingsDraft
  program: BlastProgram
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const rect = open ? triggerRef.current?.getBoundingClientRect() : undefined
  // The drawer sits at the bottom of the window: the popover opens above the
  // button, and the clamp keeps it on screen.
  const { ref: clampRef, pos } = useClampedPosition(rect?.left ?? 0, rect ? rect.top - 8 : 0, { flip: false })
  const setNode = useCallback((node: HTMLDivElement | null) => { ref.current = node; clampRef(node) }, [clampRef])
  usePopoverDismiss(open, onClose, ref, triggerRef)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); triggerRef.current?.focus() } }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open, onClose, triggerRef])
  if (!open) return null

  return (
    <div
      ref={setNode}
      className="bd-popover"
      role="dialog"
      aria-label="Search options"
      style={{ left: pos.left, top: pos.top, transform: 'translateY(-100%)' }}
    >
      <div className="bd-pop-section">
        <div className="bd-pop-title">Limit the search</div>
        <label className="bd-check">
          <input type="checkbox" checked={draft.excludeSynthetic} onChange={e => updateDraft({ excludeSynthetic: e.target.checked })} />
          <span>
            Exclude synthetic constructs
            <span className="bd-hint">Vectors and synthetic genes, which crowd the top of a search with a plasmid part</span>
          </span>
        </label>
        <label className="bd-field">
          <span className="bd-field-label">Organism</span>
          <input
            className="input bd-input"
            value={draft.organism}
            placeholder="Any; a name or a taxid, such as Escherichia coli or 562"
            onChange={e => updateDraft({ organism: e.target.value })}
          />
        </label>
      </div>

      <div className="bd-pop-section">
        <div className="bd-pop-title">Scoring and reporting</div>
        <div className="bd-field-row">
          <label className="bd-field">
            <span className="bd-field-label">E-value threshold</span>
            <select className="select bd-input" value={evalueParam(draft.evalue)} onChange={e => updateDraft({ evalue: Number(e.target.value) })}>
              {EVALUES.map(v => <option key={v} value={v}>{v}{Number(v) === DEFAULT_SETTINGS.evalue ? ' (default)' : ''}</option>)}
            </select>
          </label>
          <label className="bd-field">
            <span className="bd-field-label">Max hits</span>
            <select className="select bd-input" value={maxHitsParam(draft.maxHits)} onChange={e => updateDraft({ maxHits: Number(e.target.value) })}>
              {MAX_HITS.map(n => <option key={n} value={n}>{n}{n === DEFAULT_SETTINGS.maxHits ? ' (default)' : ''}</option>)}
            </select>
          </label>
        </div>
        <div className="bd-field-row">
          <label className="bd-field">
            <span className="bd-field-label">Low-complexity filter</span>
            <select className="select bd-input" value={draft.lowComplexity} onChange={e => updateDraft({ lowComplexity: e.target.value as SettingsDraft['lowComplexity'] })}>
              <option value="default">Default</option>
              <option value="on">On</option>
              <option value="off">Off</option>
            </select>
          </label>
          {usesMatrix(program) && (
            <label className="bd-field">
              <span className="bd-field-label">Matrix</span>
              <select className="select bd-input" value={draft.matrix || 'BLOSUM62'} onChange={e => updateDraft({ matrix: e.target.value === 'BLOSUM62' ? '' : e.target.value })}>
                {MATRICES.map(m => <option key={m} value={m}>{m}{m === 'BLOSUM62' ? ' (default)' : ''}</option>)}
              </select>
            </label>
          )}
        </div>
      </div>

      <div className="bd-pop-foot">
        <button className="btn" onClick={resetOptions} disabled={changedOptions(draft) === 0}>Reset to defaults</button>
        <button className="btn btn-primary" onClick={() => { onClose(); triggerRef.current?.focus() }}>Done</button>
      </div>
    </div>
  )
}

// --- Recent searches, across every document ---

function RecentMenu({ at, tabId, current, searches, onClose }: {
  at: { x: number; y: number }
  tabId: string
  current: BlastSearch | null
  searches: BlastSearch[]
  onClose: () => void
}) {
  const tabs = useEditorStore(s => s.tabs)
  const others = useMemo(
    () => tabs
      .filter(t => t.id !== tabId)
      .flatMap(t => t.blastSearches.map(s => ({ tabId: t.id, name: t.doc.name, search: s })))
      .sort((a, b) => b.search.createdAt - a.search.createdAt)
      .slice(0, 8),
    [tabs, tabId],
  )
  const describe = (s: BlastSearch) =>
    `${programOf(s)} · ${s.query.label} · ${s.result.hits.length} ${s.result.hits.length === 1 ? 'hit' : 'hits'}${s.service === 'ncbi' ? ' · NCBI' : ''}`
  const pick = (t: string, rid: string) => {
    onClose()
    const editor = useEditorStore.getState()
    if (editor.activeTabId !== t) editor.setActiveTab(t)
    showSearch(t, rid)
    openDrawer()
  }
  return (
    <ContextMenuPopup x={at.x} y={at.y} onClose={onClose} label="Recent BLAST searches">
      <MenuItem icon={<Plus size={13} />} onSelect={() => { onClose(); showSearch(tabId, null) }}>New search</MenuItem>
      <MenuItem
        icon={<Upload size={13} />}
        onSelect={() => { onClose(); importNcbiResultFile(tabId) }}
        title="A result downloaded from NCBI's site: Download All, then Single-file JSON"
      >Import an NCBI result file…</MenuItem>
      {searches.length > 0 && <MenuSeparator />}
      {searches.slice(0, 10).map(s => (
        <MenuItem key={s.rid} onSelect={() => pick(tabId, s.rid)} shortcut={timeAgo(s.createdAt)}>
          <span className={current?.rid === s.rid ? 'bd-menu-current' : undefined}>{describe(s)}</span>
        </MenuItem>
      ))}
      {others.length > 0 && <MenuSeparator />}
      {others.map(o => (
        <MenuItem key={o.search.rid} onSelect={() => pick(o.tabId, o.search.rid)} shortcut={timeAgo(o.search.createdAt)} title={`Open ${o.name} and show this search`}>
          <strong>{o.name}</strong> · {describe(o.search)}
        </MenuItem>
      ))}
    </ContextMenuPopup>
  )
}

// --- A search running ---

function RunStrip({ tabId }: { tabId: string }) {
  const run = useBlastStore(s => s.run)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!run) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [run])
  if (!run) return null

  if (run.tabId !== tabId) {
    return (
      <div className="bd-run bd-run-elsewhere">
        <Loader2 size={13} className="spinner" aria-hidden="true" />
        <span>Searching <strong>{run.queryName}</strong> with {run.program}</span>
        <button className="bd-link-btn" onClick={() => useEditorStore.getState().setActiveTab(run.tabId)}>Show</button>
      </div>
    )
  }
  const elapsed = Math.max(0, Math.floor((now - run.startedAt) / 1000))
  const next = run.nextCheckAt ? Math.max(0, Math.ceil((run.nextCheckAt - now) / 1000)) : null
  return (
    <div className="bd-run">
      <Loader2 size={13} className="spinner" aria-hidden="true" />
      <span className="bd-run-status" aria-live="polite">{run.status}</span>
      <span className="bd-run-meta">{run.queryLabel} · {run.program}</span>
      <span className="bd-run-meta">{clock(elapsed)}{next !== null && ` · next check in ${next} s`}</span>
      {run.rid && (
        <span className="bd-run-rid">
          Job <code>{run.rid}</code>
          <button className="bd-icon-btn" onClick={() => copyText(run.rid!, 'Copied job ID')} aria-label="Copy the job ID" title="Copy the job ID">
            <Copy size={12} />
          </button>
          <a className="bd-link" href={ebiJobUrl(run.rid)} target="_blank" rel="noopener noreferrer">View at EMBL-EBI ↗</a>
        </span>
      )}
    </div>
  )
}

// --- Nothing on show ---

function Intro({ tabId, hasSearches, protein, selectionLength }: { tabId: string; hasSearches: boolean; protein: boolean; selectionLength: number }) {
  const translation = useBlastStore(s => (s.querySource === 'translation' ? s.translation : null))
  return (
    <div className="bd-intro">
      <p className="bd-intro-title">
        {translation
          ? `Find proteins like ${translation.label}`
          : protein ? 'Find proteins and coding sequences like this one' : 'Find sequences like this one'}
      </p>
      <p>
        Choose what to send above{selectionLength > 0 ? ' (the selection is ready)' : ''}, then Search.
        {hasSearches ? ' Earlier searches of this sequence are under Recent.' : ''}
      </p>
      <p className="bd-intro-note">
        Search runs at EMBL-EBI, against ENA (the same shared records as GenBank) or UniProt; the query is sent there and nothing else leaves this browser.
        For NCBI's own collections (core_nt, RefSeq, nr), use Search at NCBI: the search opens on NCBI's site, and its result file can be{' '}
        <button className="bd-link-btn" onClick={() => importNcbiResultFile(tabId)}>imported here</button>.
      </p>
    </div>
  )
}

// --- One search's results ---

function Results({ tabId, search }: { tabId: string; search: BlastSearch }) {
  const sequence = useEditorStore(s => s.doc.sequence)
  const addAnnotations = useEditorStore(s => s.addAnnotations)
  const removeBlastSearch = useEditorStore(s => s.removeBlastSearch)
  const [filter, setFilter] = useState('')
  const [checked, setChecked] = useState<ReadonlySet<number>>(new Set())
  const [confirmDelete, setConfirmDelete] = useState(false)
  const placement = useMemo(() => placementOf(search.query, sequence), [search.query, sequence])
  const { result, settings } = search
  const hits = result.hits.length

  // Pointing at a hit, in the plot or the table, draws its HSPs over the
  // sequence and the map; clicking selects its best one. Only while the
  // query still lines up with the sequence: otherwise they would point at
  // the wrong bases.
  const [hovered, setHovered] = useState<number | null>(null)
  const setHighlightRanges = useEditorStore(s => s.setHighlightRanges)
  const hover = useCallback((idx: number | null) => {
    setHovered(idx)
    const hit = idx === null ? null : search.result.hits[idx]
    setHighlightRanges(hit && placement.ok ? hit.hsps.map(h => hitRangeOnDoc(search.query, h.queryFrom, h.queryTo)) : [])
  }, [search, placement.ok, setHighlightRanges])
  useEffect(() => () => setHighlightRanges([]), [setHighlightRanges])

  const pick = useCallback((idx: number) => {
    const hsp = search.result.hits[idx]?.hsps[0]
    if (!hsp || !placement.ok) return
    const { start, end } = hitRangeOnDoc(search.query, hsp.queryFrom, hsp.queryTo)
    const editor = useEditorStore.getState()
    editor.smoothScrollRequested = true
    editor.setSelection({ anchor: start, caret: end })
    centerSequenceViewOn(start, end)
    document.getElementById(`bd-row-${search.rid}-${idx}`)?.scrollIntoView({ block: 'nearest' })
  }, [search, placement.ok])

  const mapOrder = useMemo(
    () => result.hits.map((h, i) => (hitMatches(h, filter) ? i : -1)).filter(i => i >= 0),
    [result.hits, filter],
  )

  const [actionsFor, setActionsFor] = useState<{ idx: number; x: number; y: number } | null>(null)
  const [exportAt, setExportAt] = useState<{ x: number; y: number } | null>(null)
  const checkedHits = [...checked].sort((a, b) => a - b).map(i => result.hits[i]).filter(Boolean)

  const limits = [
    settings.organism && `${settings.organism} only`,
    settings.excludeSynthetic && 'no synthetic constructs',
  ].filter(Boolean).join(', ')

  const toggle = (idx: number) => setChecked(prev => {
    const next = new Set(prev)
    if (next.has(idx)) next.delete(idx)
    else next.add(idx)
    return next
  })
  const setMany = (idxs: number[], on: boolean) => setChecked(prev => {
    const next = new Set(prev)
    for (const i of idxs) {
      if (on) next.add(i)
      else next.delete(i)
    }
    return next
  })

  // Each hit's best HSP, mapped back onto the bases the query came from,
  // as one undo step.
  const addFeatures = (idxs: number[]) => {
    if (!placement.ok) return
    const stamp = Date.now()
    const data: AnnotationData[] = []
    for (const idx of idxs) {
      const hit = result.hits[idx]
      const hsp = hit?.hsps[0]
      if (!hsp) continue
      const { start, end } = hitRangeOnDoc(search.query, hsp.queryFrom, hsp.queryTo)
      data.push({
        id: `blast_${stamp}_${idx}`,
        name: hit.sciName ? `${hit.accession} ${hit.sciName}` : `${hit.accession} ${hit.description.slice(0, 40)}`,
        type: 'misc_feature',
        start,
        end,
        strand: hitStrandOnDoc(search.query, result.program, hsp),
        color: BLAST_COLORS[idx % BLAST_COLORS.length],
        qualifiers: {
          note: [`BLAST ${programOf(search)} hit against ${result.database || settings.database} (${search.service === 'ncbi' ? 'NCBI' : 'EMBL-EBI'}), E=${formatEvalue(hsp.evalue)}, ${(hsp.identity * 100).toFixed(1)}% identity, ${hit.description}`],
          db_xref: [dbXref(hit.accession, result.database || settings.database, result.program, search.service)],
        },
      })
    }
    addAnnotations(data)
  }

  return (
    <div className="bd-results">
      <div className="bd-summary">
        <div className="bd-summary-main">
          <span className="bd-summary-count">{hits.toLocaleString('en-US')} {hits === 1 ? 'hit' : 'hits'}</span>
          <span>{search.service === 'ncbi' ? 'NCBI' : 'EMBL-EBI'} · {programOf(search)} · {databaseLabel(result.database || settings.database)}</span>
          <span>{search.query.label} · {result.queryLen.toLocaleString('en-US')} {search.query.translation || PROTEIN_QUERY_PROGRAMS.includes(programOf(search)) ? 'aa' : 'bp'}</span>
          {limits && <span>{limits}</span>}
          <span title={new Date(search.createdAt).toLocaleString()}>{timeAgo(search.createdAt)}</span>
          {result.message && <span className="bd-muted">{result.message}</span>}
        </div>
        <div className="bd-summary-tools">
          {hits > 0 && (
            <div className="bd-filter">
              <Search size={12} className="bd-filter-icon" aria-hidden="true" />
              <input
                className="input bd-filter-input"
                aria-label="Filter hits"
                placeholder="Filter hits"
                value={filter}
                onChange={e => setFilter(e.target.value)}
              />
            </div>
          )}
          {hits > 0 && (
            <button
              className="btn bd-small-btn"
              aria-haspopup="menu"
              aria-expanded={!!exportAt}
              onClick={e => {
                const r = e.currentTarget.getBoundingClientRect()
                setExportAt(exportAt ? null : { x: r.left, y: r.bottom + 4 })
              }}
            >
              <Download size={12} aria-hidden="true" /> Export
            </button>
          )}
          {search.service === 'ebi' && (
            <a className="bd-link" href={ebiJobUrl(search.rid)} target="_blank" rel="noopener noreferrer" title="While EMBL-EBI keeps the job; the hits here stay">
              View at EMBL-EBI ↗
            </a>
          )}
          <button
            className={`bd-icon-btn${confirmDelete ? ' bd-danger' : ''}`}
            onClick={() => {
              if (!confirmDelete) { setConfirmDelete(true); return }
              removeBlastSearch(tabId, search.rid)
              showSearch(tabId, null)
            }}
            onBlur={() => setConfirmDelete(false)}
            aria-label={confirmDelete ? 'Confirm: delete this search' : 'Delete this search'}
            title={confirmDelete ? 'Click again to delete' : 'Delete this search'}
          >
            {confirmDelete ? <span className="bd-confirm">Delete?</span> : <Trash2 size={13} />}
          </button>
        </div>
      </div>

      {hits === 0 ? (
        <div className="bd-empty">No significant similarity found{limits ? ` (${limits})` : ''}.</div>
      ) : (
        <div className="bd-table-wrap">
          <HitMap search={search} order={mapOrder} hoveredIdx={hovered} onHover={hover} onPick={pick} canPick={placement.ok} />
          <HitTable
            search={search}
            filter={filter}
            checked={checked}
            onToggleCheck={toggle}
            onSetChecked={setMany}
            hoveredIdx={hovered}
            onHover={hover}
            onSelectRange={placement.ok ? pick : undefined}
            onActions={(idx, at) => setActionsFor({ idx, ...at })}
          />
        </div>
      )}

      {exportAt && (
        <ContextMenuPopup x={exportAt.x} y={exportAt.y} onClose={() => setExportAt(null)} label="Export the hits">
          <MenuItem icon={<FileSpreadsheet size={13} />} onSelect={() => { setExportAt(null); downloadHitsCsv(search) }}>
            Hit table (CSV)
          </MenuItem>
          <MenuItem icon={<FileText size={13} />} onSelect={() => { setExportAt(null); downloadHitsFasta(search, result.hits) }}>
            Aligned stretch of every hit (FASTA)
          </MenuItem>
          {checkedHits.length > 0 && (
            <MenuItem icon={<FileText size={13} />} onSelect={() => { setExportAt(null); downloadHitsFasta(search, checkedHits) }}>
              Aligned stretch of the {checkedHits.length} checked (FASTA)
            </MenuItem>
          )}
        </ContextMenuPopup>
      )}

      {actionsFor && result.hits[actionsFor.idx] && (() => {
        const hit = result.hits[actionsFor.idx]
        const idx = actionsFor.idx
        const close = () => setActionsFor(null)
        const alignable = canAlignWithQuery(search)
        return (
          <ContextMenuPopup x={actionsFor.x} y={actionsFor.y} onClose={close} label={`Hit ${hit.accession}`}>
            <MenuItem icon={<FilePlus size={13} />} disabled={!canOpenRecord(search)} onSelect={() => { close(); void openHitRecord(hit, search) }} title={canOpenRecord(search) ? 'Fetch the whole record and open it as a new document' : 'Structure entries are opened from the Structure view, not as sequences'}>
              Open the record
            </MenuItem>
            <MenuItem
              icon={<AlignLeft size={13} />}
              disabled={!alignable}
              title={alignable ? 'Align the query and the aligned stretch of this hit in the alignment workbench' : 'Only a search whose query and hits are the same kind of sequence can be aligned here'}
              onSelect={() => {
                close()
                const entries = alignmentEntries(search, hit)
                if (entries) requestAlignment(entries)
              }}
            >
              Align with the query
            </MenuItem>
            <MenuSeparator />
            <MenuItem icon={<MousePointer2 size={13} />} disabled={!placement.ok} onSelect={() => { close(); pick(idx) }}>
              Select in the sequence
            </MenuItem>
            <MenuItem icon={<Tag size={13} />} disabled={!placement.ok} onSelect={() => { close(); addFeatures([idx]) }}>
              Add as a feature
            </MenuItem>
            <MenuSeparator />
            <MenuItem icon={<Copy size={13} />} onSelect={() => { close(); copyHitFasta(hit) }}>
              Copy the aligned stretch as FASTA
            </MenuItem>
            <MenuItem icon={<Copy size={13} />} onSelect={() => { close(); copyText(hit.accession, `Copied ${hit.accession}`) }}>
              Copy the accession
            </MenuItem>
            <MenuItem icon={<ExternalLink size={13} />} onSelect={() => { close(); window.open(recordUrl(hit.accession, result.database || settings.database, result.program, search.service), '_blank', 'noopener,noreferrer') }}>
              Open the record online
            </MenuItem>
          </ContextMenuPopup>
        )
      })()}

      {checked.size > 0 && (
        <div className="bd-selbar" role="region" aria-label="Checked hits">
          <span className="bd-selbar-count">{checked.size} checked</span>
          {!placement.ok && <span className="bd-muted">{placement.reason}</span>}
          <span className="bd-spacer" />
          <button className="btn" onClick={() => setChecked(new Set())}>Clear</button>
          <button className="btn btn-primary" onClick={() => { addFeatures([...checked].sort((a, b) => a - b)); setChecked(new Set()) }} disabled={!placement.ok}>
            Add {checked.size === 1 ? 'as a feature' : `${checked.size} as features`}
          </button>
        </div>
      )}
    </div>
  )
}

// Feature colours for hits turned into annotations. They are stored in the
// document with the feature, as every feature colour is (user data, not
// theme), so they stay literal.
const BLAST_COLORS = [
  '#4dabf7', '#ff6b6b', '#51cf66', '#ffd43b', '#cc5de8',
  '#20c997', '#ff922b', '#748ffc', '#f06595', '#66d9e8',
]
