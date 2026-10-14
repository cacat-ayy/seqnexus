import './finder.css'
/**
 * The Motifs tab: the panel's finder slot on a protein, the ORFs tab's twin.
 *
 * The library's patterns, the membrane spans of the hydropathy rule and the
 * Chou-Fasman structure, in one table with a category filter above it. The
 * scan is the app's (useMotifScan) and follows the residues; this tab only
 * reads and filters what it found. Clicking a row selects the hit; the box
 * at the start of a row, or Ctrl-click, picks it for Add.
 */

import { useCallback, useMemo, useState } from 'react'
import { Copy, Plus } from 'lucide-react'
import { useEditorStore } from '../../store'
import { displayPosition } from '../../models/Document'
import { MOTIF_CATEGORIES, motifDefinition, type MotifHit } from '../../protein/motifs'
import { TM_MOTIF_ID } from '../../hooks/useMotifScan'
import { TM_WINDOW, TM_THRESHOLD } from '../../protein/scales'
import { motifKey, convertibleMotifs, isMotifAnnotated } from '../../utils/motif-features'
import { selectFeature } from '../features/feature-actions'
import { copyText } from '../../utils/clipboard'
import ConfirmDialog from '../ConfirmDialog'

/** Rows drawn at once. */
const ROW_CAP = 500
/** Past this many, adding every hit asks first. */
const CONFIRM_ADD_ALL = 50
/** What a hit the document already has as a feature says, on its row and in the count. */
const ADDED_TITLE = 'Already a feature: Add leaves it out'

type SortKey = 'position' | 'motif'
interface Sort { key: SortKey; desc: boolean }

const COMPARE: Record<SortKey, (a: MotifHit, b: MotifHit) => number> = {
  position: (a, b) => a.start - b.start || a.end - b.end,
  motif: (a, b) => a.name.localeCompare(b.name) || a.start - b.start,
}

const n = (x: number) => x.toLocaleString('en-US')

/** What a hit's motif is: its pattern and source, or the rule that predicted it. */
function motifAbout(hit: MotifHit): { pattern?: string; description: string; source?: string } {
  const def = motifDefinition(hit.motifId)
  if (def) return { pattern: def.pattern, description: def.description, source: def.source }
  if (hit.motifId === TM_MOTIF_ID) {
    return { description: `Mean Kyte-Doolittle hydropathy over a ${TM_WINDOW}-residue window above ${TM_THRESHOLD}: a likely membrane span.` }
  }
  return { description: 'Chou and Fasman (1978): nucleated where the propensities cluster, extended while they hold. A rough guide to secondary structure, not a prediction to rely on.' }
}

export default function MotifTab() {
  const doc = useEditorStore(s => s.doc)
  const hits = useEditorStore(s => s.motifResults)
  const categoriesOff = useEditorStore(s => s.motifCategoriesOff)
  const setCategoriesOff = useEditorStore(s => s.setMotifCategoriesOff)
  const picks = useEditorStore(s => s.motifPicks)
  const togglePick = useEditorStore(s => s.toggleMotifPick)
  const applyMotifs = useEditorStore(s => s.applyMotifs)
  const showMotifs = useEditorStore(s => s.showMotifs)
  const toggleMotifs = useEditorStore(s => s.toggleMotifs)
  const readOnly = useEditorStore(s => s.readOnly)

  const seqLen = doc.sequence.length
  const origin = doc.metadata?.displayOrigin ?? 0
  const at = useCallback((i: number) => n(displayPosition(i, origin, seqLen)), [origin, seqLen])

  const off = useMemo(() => new Set(categoriesOff), [categoriesOff])
  const shownHits = useMemo(() => hits.filter(h => !off.has(h.category)), [hits, off])
  const countIn = (category: string) => hits.reduce((c, h) => c + (h.category === category ? 1 : 0), 0)
  const toggleCategory = (category: string, on: boolean) =>
    setCategoriesOff(on ? categoriesOff.filter(c => c !== category) : [...categoriesOff, category])

  const [sort, setSort] = useState<Sort>({ key: 'position', desc: false })
  const sorted = useMemo(() => {
    const cmp = COMPARE[sort.key]
    return [...shownHits].sort((a, b) => (sort.desc ? -1 : 1) * cmp(a, b))
  }, [shownHits, sort])
  const rows = sorted.length > ROW_CAP ? sorted.slice(0, ROW_CAP) : sorted
  const sortBy = (key: SortKey) => setSort(s => s.key === key ? { key, desc: !s.desc } : { key, desc: false })

  const convertible = useMemo(() => convertibleMotifs(shownHits, doc.annotations), [shownHits, doc.annotations])
  const convertibleKeys = useMemo(() => new Set(convertible.map(motifKey)), [convertible])
  const addedCount = shownHits.length - convertible.length
  const pickedCount = useMemo(
    () => convertible.reduce((c, h) => c + (picks.has(motifKey(h)) ? 1 : 0), 0),
    [convertible, picks],
  )
  const [confirmAddAll, setConfirmAddAll] = useState(false)

  const [activeKey, setActiveKey] = useState<string | null>(null)
  const active = useMemo(() => shownHits.find(h => motifKey(h) === activeKey) ?? null, [shownHits, activeKey])

  const focusHit = useCallback((hit: MotifHit) => {
    setActiveKey(motifKey(hit))
    selectFeature({ start: hit.start, end: hit.end })
  }, [])
  const handleRow = (hit: MotifHit, e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey) { togglePick(motifKey(hit)); return }
    focusHit(hit)
  }
  const handleListKey = (e: React.KeyboardEvent) => {
    if (rows.length === 0) return
    const i = rows.findIndex(h => motifKey(h) === activeKey)
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const next = e.key === 'ArrowDown' ? Math.min(rows.length - 1, i + 1) : Math.max(0, i < 0 ? 0 : i - 1)
      focusHit(rows[next])
      document.getElementById(rowId(motifKey(rows[next])))?.scrollIntoView?.({ block: 'nearest' })
    } else if (e.key === ' ' && i >= 0) {
      e.preventDefault()
      togglePick(motifKey(rows[i]))
    }
  }

  if (!doc.sequence.isProtein) {
    return <div className="fd-empty">Motifs are found in a protein. Its ORFs tab finds the reading frames in DNA.</div>
  }

  return (
    <div className="fd">
      <div className="fd-setup">
        <div className="fd-settings">
          <div className="fd-field">
            <span className="fd-field-label">Categories</span>
            <div className="fd-checks">
              {MOTIF_CATEGORIES.map(category => (
                <label key={category} className="fd-check">
                  <input
                    type="checkbox"
                    checked={!off.has(category)}
                    onChange={e => toggleCategory(category, e.target.checked)}
                  />
                  {category}
                  <span className="fd-check-count">{countIn(category)}</span>
                </label>
              ))}
            </div>
          </div>
          <p className="fd-hint">
            PROSITE patterns for the sites a construct is checked for, the sequence liabilities a developability
            review flags, and membrane spans by the Kyte-Doolittle rule. Every occurrence is shown; a pattern this
            short also matches by chance, so a hit is a place to look, not a finding.
          </p>
          <div className="fd-checks">
            <label className="fd-check">
              <input type="checkbox" checked={showMotifs} onChange={() => toggleMotifs()} />
              Show on the sequence
            </label>
          </div>
        </div>
      </div>

      <div className="fd-main">
        <div className="fd-status">
          <span className="fd-status-count" aria-live="polite">
            <span>{n(shownHits.length)} hit{shownHits.length === 1 ? '' : 's'}</span>
            {addedCount > 0 && <span className="fd-added" title={ADDED_TITLE}>{n(addedCount)} already features</span>}
            {pickedCount > 0 && <span className="fd-picked">{pickedCount} picked</span>}
          </span>
          {convertible.length > 0 && !readOnly && (
            <button
              className={`btn btn-sm ${pickedCount > 0 ? 'btn-primary' : ''}`}
              onClick={() => {
                if (pickedCount > 0) applyMotifs(picks)
                else if (convertible.length > CONFIRM_ADD_ALL) setConfirmAddAll(true)
                else applyMotifs()
              }}
              title={addedCount > 0
                ? `Add the hits that are not features yet (${n(addedCount)} already are)`
                : 'Add these hits to the document as features'}
            >
              {pickedCount > 0 ? `Add picked (${pickedCount})` : `Add all (${n(convertible.length)})`}
            </button>
          )}
        </div>

        <div className="fd-table fd-motifs">
          {rows.length > 0 && (
            <div className="fd-head">
              <span />
              <SortHeader label="Motif" id="motif" sort={sort} onSort={sortBy} />
              <SortHeader label="Location" id="position" sort={sort} onSort={sortBy} />
              <span className="fd-th fd-col-wide">Residues</span>
            </div>
          )}
          <ul
            className="fd-list"
            role="listbox"
            aria-label="Motif hits"
            tabIndex={rows.length > 0 ? 0 : -1}
            aria-activedescendant={active ? rowId(motifKey(active)) : undefined}
            onKeyDown={handleListKey}
          >
            {rows.map(hit => {
              const key = motifKey(hit)
              const added = !convertibleKeys.has(key)
              const picked = !added && picks.has(key)
              return (
                <li
                  key={key}
                  id={rowId(key)}
                  role="option"
                  aria-selected={key === activeKey}
                  className={`fd-row ${key === activeKey ? 'active' : ''} ${picked ? 'picked' : ''} ${added ? 'is-added' : ''}`}
                  title={added ? ADDED_TITLE : undefined}
                  onClick={e => handleRow(hit, e)}
                >
                  <input
                    type="checkbox"
                    className="fd-pick"
                    tabIndex={-1}
                    aria-label={added ? `${hit.name} at ${at(hit.start)} is already a feature` : `Pick ${hit.name} at ${at(hit.start)} for Add`}
                    checked={picked}
                    disabled={added}
                    onClick={e => e.stopPropagation()}
                    onChange={() => togglePick(key)}
                  />
                  <span className="fd-name" title={hit.name}>
                    <span className="fd-swatch" style={{ backgroundColor: hit.color }} />
                    <span>{hit.name}</span>
                  </span>
                  <span className="fd-cell tabular" title={`${at(hit.start)}..${at(hit.end - 1)}`}>{at(hit.start)}..{at(hit.end - 1)}</span>
                  <span className="fd-cell mono fd-col-wide" title={hit.sequence}>{hit.sequence}</span>
                </li>
              )
            })}
            {sorted.length > rows.length && (
              <li className="fd-more">Showing the first {n(rows.length)} of {n(sorted.length)}. Switch categories off to see fewer.</li>
            )}
            {shownHits.length === 0 && (
              <li className="fd-empty">
                {seqLen === 0 ? 'Open a protein to find motifs in it.' : 'No motifs found in the categories shown.'}
              </li>
            )}
          </ul>
        </div>
      </div>

      <div className="fd-side">
        {active && (
          <MotifInspector
            key={motifKey(active)}
            hit={active}
            at={at}
            readOnly={readOnly}
            onAdd={() => applyMotifs([motifKey(active)])}
          />
        )}
      </div>

      <ConfirmAddAll
        open={confirmAddAll}
        count={convertible.length}
        onResult={add => {
          if (add) applyMotifs()
          setConfirmAddAll(false)
        }}
      />
    </div>
  )
}

const rowId = (key: string) => `fd-motif-${key.replace(/[^a-zA-Z0-9-]/g, '_')}`

function SortHeader({ label, id, sort, onSort }: {
  label: string; id: SortKey; sort: Sort; onSort: (key: SortKey) => void
}) {
  const on = sort.key === id
  return (
    <button
      type="button"
      className={`fd-th ${on ? 'on' : ''}`}
      onClick={() => onSort(id)}
      aria-label={`Sort by ${label.toLowerCase()}${on ? (sort.desc ? ', descending' : ', ascending') : ''}`}
    >
      {label}
      {on && <span className="fd-th-dir" aria-hidden>{sort.desc ? '↓' : '↑'}</span>}
    </button>
  )
}

function ConfirmAddAll({ open, count, onResult }: { open: boolean; count: number; onResult: (add: boolean) => void }) {
  return (
    <ConfirmDialog
      open={open}
      title="Add every hit"
      message={`Add ${n(count)} motif hits to the document as features? This can be undone.`}
      buttons={[
        { label: 'Cancel', value: 'cancel' },
        { label: `Add ${n(count)}`, value: 'add', variant: 'primary' },
      ]}
      onResult={value => onResult(value === 'add')}
    />
  )
}

/** The hit in focus: what its motif is, where it is, and Add. */
function MotifInspector({ hit, at, readOnly, onAdd }: {
  hit: MotifHit; at: (i: number) => string; readOnly: boolean; onAdd: () => void
}) {
  const annotations = useEditorStore(s => s.doc.annotations)
  const about = motifAbout(hit)
  const annotated = isMotifAnnotated(hit, annotations)
  return (
    <div className="fdi">
      <div className="fdi-head">
        <span className="fd-swatch" style={{ backgroundColor: hit.color }} />
        <span className="fdi-title">{hit.name}</span>
      </div>
      <dl className="fdi-grid">
        <dt>Category</dt>
        <dd>{hit.category}</dd>
        <dt>Location</dt>
        <dd>{at(hit.start)}..{at(hit.end - 1)}, {n(hit.end - hit.start)} residue{hit.end - hit.start === 1 ? '' : 's'}</dd>
        {about.pattern && <><dt>Pattern</dt><dd className="fd-codon">{about.pattern}</dd></>}
        {about.source && <><dt>Source</dt><dd>{about.source}</dd></>}
        <dt>Becomes</dt>
        <dd>a {hit.type} feature</dd>
      </dl>
      <p className="fdi-note">{about.description}</p>
      <div className="fdi-label">Residues</div>
      <div className="fdi-seq">{hit.sequence}</div>
      {annotated && <p className="fdi-note">The document already has this feature.</p>}
      <div className="fdi-actions">
        {!annotated && !readOnly && (
          <button className="btn btn-sm btn-primary" onClick={onAdd} title="Add this hit to the document as a feature">
            <Plus size={12} /> Add as feature
          </button>
        )}
        <button className="btn btn-sm" onClick={() => void copyText(hit.sequence, 'Residues copied')} title="Copy the residues matched">
          <Copy size={12} /> Copy residues
        </button>
      </div>
    </div>
  )
}
