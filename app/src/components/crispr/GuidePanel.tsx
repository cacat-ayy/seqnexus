import './crispr.css'
/**
 * The Guides tab: find the sites, see which are worth using, keep the ones
 * you want.
 *
 * The settings are the whole scan: which nuclease, which spacer length, and
 * whether to look at the selection only. Everything below them follows from
 * that, so there is no Run button to forget to press.
 *
 * The three score columns stay separate. A model number, the share of
 * predicted deletions that shift the frame, and the flags are different kinds
 * of claim, and blending them into one figure of merit would hide which one
 * a guide fails on. Sorting picks one of them at a time instead.
 *
 * Clicking a row selects the protospacer in the sequence; Ctrl-click picks it
 * for conversion into a feature, the way ORF and motif picks work.
 */

import { useMemo, useState } from 'react'
import { useEditorStore } from '../../store'
import { NUCLEASES, resolveNuclease, defaultSpacerLength } from '../../crispr/nucleases'
import { guideKey, convertibleGuides } from '../../utils/guide-features'
import { displayPosition } from '../../models/Document'
import { REPAIR_CAP } from '../../crispr/score/guide'
import GuideLandscape from './GuideLandscape'
import GuideInspector from './GuideInspector'
import NucleaseDialog from './NucleaseDialog'
import OffTargetSection from './OffTargetSection'
import GuideRow from './GuideRow'
import KnockoutTask from './tasks/KnockoutTask'
import DeletionTask from './tasks/DeletionTask'
import KnockinTask from './tasks/KnockinTask'
import BaseEditTask from './tasks/BaseEditTask'
import TileTask from './tasks/TileTask'
import PrimeEditTask from './tasks/PrimeEditTask'
import OrderTask from './tasks/OrderTask'
import GuideLibrary from './GuideLibrary'
import type { CrisprTask, GuideCandidate, GuideDrawScope } from '../../crispr/types'

const TASKS: { id: CrisprTask; label: string; hint: string }[] = [
  { id: 'find', label: 'Find', hint: 'Every site, scored' },
  { id: 'knockout', label: 'Knock out', hint: 'Guides ranked by where they cut in a gene' },
  { id: 'deletion', label: 'Delete', hint: 'Pairs that take a region out' },
  { id: 'knockin', label: 'Knock in', hint: 'A donor for the selected guide' },
  { id: 'baseedit', label: 'Base edit', hint: 'Guides whose editing window reaches a base' },
  { id: 'primeedit', label: 'Prime edit', hint: 'A pegRNA that writes an edit in' },
  { id: 'tile', label: 'Tile', hint: 'A spaced set across a region' },
  { id: 'order', label: 'Order', hint: 'The oligos to buy, and how to screen afterwards' },
]

type Sort = 'position' | 'score' | 'frame' | 'gc'

const SORTS: { id: Sort; label: string }[] = [
  { id: 'position', label: 'Position' },
  { id: 'score', label: 'Score' },
  { id: 'frame', label: 'Out of frame' },
  { id: 'gc', label: 'GC' },
]

/** Rows rendered at once. The landscape covers the rest of the sequence. */
const ROW_LIMIT = 300

export default function GuidePanel() {
  const candidates = useEditorStore(s => s.guideResults)
  const info = useEditorStore(s => s.guideScanInfo)
  const nucleaseId = useEditorStore(s => s.crisprNucleaseId)
  const spacerLength = useEditorStore(s => s.crisprSpacerLength)
  const selectionOnly = useEditorStore(s => s.crisprSelectionOnly)
  const setParams = useEditorStore(s => s.setCrisprParams)
  const customNucleases = useEditorStore(s => s.customNucleases)
  const showGuides = useEditorStore(s => s.showGuides)
  const toggleGuides = useEditorStore(s => s.toggleGuides)
  const drawScope = useEditorStore(s => s.crisprDraw)
  const picks = useEditorStore(s => s.guidePicks)
  const togglePick = useEditorStore(s => s.toggleGuidePick)
  const selectedKey = useEditorStore(s => s.selectedGuideKey)
  const setSelectedKey = useEditorStore(s => s.setSelectedGuideKey)
  const applyGuides = useEditorStore(s => s.applyGuides)
  const setSelection = useEditorStore(s => s.setSelection)
  const annotations = useEditorStore(s => s.doc.annotations)
  const seqLen = useEditorStore(s => s.doc.sequence.length)
  const origin = useEditorStore(s => s.doc.metadata?.displayOrigin ?? 0)
  const isProtein = useEditorStore(s => s.doc.sequence.alphabet === 'protein')
  const readOnly = useEditorStore(s => s.readOnly)
  const offTargetReports = useEditorStore(s => s.offTargetReports)
  const task = useEditorStore(s => s.crisprTask)
  const setTask = useEditorStore(s => s.setCrisprTask)
  const view = useEditorStore(s => s.crisprView)
  const setView = useEditorStore(s => s.setCrisprView)

  const [sort, setSort] = useState<Sort>('position')
  const [dialogOpen, setDialogOpen] = useState(false)

  const nuclease = resolveNuclease(nucleaseId, customNucleases)
  const at = (i: number) => displayPosition(i, origin, seqLen)

  const sorted = useMemo(() => {
    const list = [...candidates]
    const by: Record<Sort, (a: GuideCandidate, b: GuideCandidate) => number> = {
      position: (a, b) => a.site.start - b.site.start,
      score: (a, b) => (b.scores.onTarget ?? -1) - (a.scores.onTarget ?? -1),
      frame: (a, b) => (b.scores.outOfFrame ?? -1) - (a.scores.outOfFrame ?? -1),
      gc: (a, b) => Math.abs(a.scores.gc - 0.55) - Math.abs(b.scores.gc - 0.55),
    }
    return list.sort(by[sort])
  }, [candidates, sort])

  const shown = sorted.slice(0, ROW_LIMIT)
  const selected = useMemo(
    () => (selectedKey ? candidates.find(c => guideKey(c.site) === selectedKey) ?? null : null),
    [candidates, selectedKey],
  )

  const convertible = useMemo(
    () => (nuclease ? convertibleGuides(candidates.map(c => c.site), nuclease, annotations) : []),
    [candidates, nuclease, annotations],
  )
  const pickedCount = useMemo(
    () => convertible.reduce((n, s) => n + (picks.has(guideKey(s)) ? 1 : 0), 0),
    [convertible, picks],
  )

  const handleRow = (candidate: GuideCandidate, e: React.MouseEvent) => {
    const key = guideKey(candidate.site)
    if (e.ctrlKey || e.metaKey) {
      togglePick(key)
      return
    }
    setSelectedKey(key)
    setSelection({ anchor: candidate.site.start, caret: candidate.site.end })
  }

  if (isProtein) {
    return <div className="gp-empty">A protein has no PAM to find. Open the DNA to design guides against it.</div>
  }

  if (view === 'library') {
    return (
      <div className="gp">
        <div className="fs-segmented" role="tablist" aria-label="Guides view">
          <button role="tab" aria-selected={false} onClick={() => setView('design')}>Design</button>
          <button role="tab" aria-selected className="active">Library</button>
        </div>
        <GuideLibrary />
      </div>
    )
  }

  return (
    <div className="gp">
      <div className="fs-segmented" role="tablist" aria-label="Guides view">
        <button role="tab" aria-selected className="active">Design</button>
        <button role="tab" aria-selected={false} onClick={() => setView('library')}>Library</button>
      </div>

      <div className="gp-tasks" role="tablist" aria-label="What to design">
        {TASKS.map(t => (
          <button
            key={t.id}
            role="tab"
            aria-selected={task === t.id}
            className={task === t.id ? 'active' : ''}
            onClick={() => setTask(t.id)}
            title={t.hint}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="gp-settings">
        <div className="gp-field gp-field-wide">
          <label htmlFor="gp-nuclease">Nuclease</label>
          <select
            id="gp-nuclease"
            value={nucleaseId}
            onChange={e => {
              if (e.target.value === '__custom__') setDialogOpen(true)
              else setParams({ crisprNucleaseId: e.target.value, crisprSpacerLength: 0 })
            }}
          >
            <optgroup label="Shipped">
              {NUCLEASES.map(n => (
                <option key={n.id} value={n.id}>
                  {n.name} ({n.pamSide === 'threePrime' ? `N-${n.pam}` : `${n.pam}-N`})
                </option>
              ))}
            </optgroup>
            {customNucleases.length > 0 && (
              <optgroup label="Yours">
                {customNucleases.map(n => (
                  <option key={n.id} value={n.id}>
                    {n.name} ({n.pamSide === 'threePrime' ? `N-${n.pam}` : `${n.pam}-N`})
                  </option>
                ))}
              </optgroup>
            )}
            <option value="__custom__">Describe a nuclease…</option>
          </select>
        </div>

        {nuclease && (
          <div className="gp-field">
            <label htmlFor="gp-spacer">Spacer</label>
            <select
              id="gp-spacer"
              value={spacerLength || defaultSpacerLength(nuclease)}
              onChange={e => setParams({ crisprSpacerLength: Number(e.target.value) })}
            >
              {nuclease.spacerLengths.map(l => (
                <option key={l} value={l}>{l} nt</option>
              ))}
            </select>
          </div>
        )}

        <div className="gp-checks">
          <label className="gp-check">
            <input type="checkbox" checked={selectionOnly} onChange={e => setParams({ crisprSelectionOnly: e.target.checked })} />
            Selection only
          </label>
          <label className="gp-check">
            <input type="checkbox" checked={showGuides} onChange={toggleGuides} />
            Show on the sequence
          </label>
          {showGuides && (
            <select
              value={drawScope}
              aria-label="Which guides to draw"
              onChange={e => setParams({ crisprDraw: e.target.value as GuideDrawScope })}
              title="A relaxed PAM finds a site every few bases, and all of them at once is a wall rather than a figure."
            >
              <option value="all">Draw all</option>
              <option value="picked">Draw picked</option>
              <option value="selected">Draw selected</option>
            </select>
          )}
        </div>

        {nuclease?.note && <p className="gp-note">{nuclease.note}</p>}
      </div>

      {candidates.length > 0 && (
        <OffTargetSection
          pickedKeys={[...picks]}
          hasSelection={selectedKey !== null}
        />
      )}

      {task === 'knockout' && <KnockoutTask candidates={candidates} nuclease={nuclease!} onSelect={handleRow} />}
      {task === 'deletion' && <DeletionTask candidates={candidates} nuclease={nuclease!} />}
      {task === 'knockin' && <KnockinTask candidates={candidates} nuclease={nuclease!} />}
      {task === 'baseedit' && <BaseEditTask candidates={candidates} nuclease={nuclease!} onSelect={handleRow} />}
      {task === 'primeedit' && <PrimeEditTask candidates={candidates} nuclease={nuclease!} />}
      {task === 'tile' && <TileTask candidates={candidates} nuclease={nuclease!} onSelect={handleRow} />}
      {task === 'order' && <OrderTask candidates={candidates} nuclease={nuclease!} />}

      {task === 'find' && (
        <>
      <div className="gp-status">
        <span className="gp-status-count">
          {info.running
            ? 'Scanning…'
            : `${candidates.length} site${candidates.length === 1 ? '' : 's'}`}
          {pickedCount > 0 && <span className="gp-picked">{pickedCount} picked</span>}
        </span>
        {convertible.length > 0 && !readOnly && (
          <button
            className="btn btn-primary btn-sm"
            onClick={() => applyGuides(pickedCount > 0 ? picks : undefined)}
            title="Add these guides to the document as features"
          >
            {pickedCount > 0 ? `Add picked (${pickedCount})` : `Add all (${convertible.length})`}
          </button>
        )}
      </div>

      {(info.truncated || info.skippedAmbiguous > 0 || candidates.length > REPAIR_CAP) && (
        <p className="gp-note gp-warn gp-note-row">
          {info.truncated && 'The scan stopped at its site cap, so this is not every site. Narrow it to a selection. '}
          {info.skippedAmbiguous > 0 && `${info.skippedAmbiguous} site${info.skippedAmbiguous === 1 ? '' : 's'} passed over for an ambiguous base in the spacer. `}
          {candidates.length > REPAIR_CAP && 'Too many sites to predict repair for all of them; the selected one is predicted in full.'}
        </p>
      )}

      <GuideLandscape
        candidates={candidates}
        seqLen={seqLen}
        selectedKey={selectedKey}
        onPick={key => {
          const found = candidates.find(c => guideKey(c.site) === key)
          if (!found) return
          setSelectedKey(key)
          setSelection({ anchor: found.site.start, caret: found.site.end })
        }}
      />

      {candidates.length > 0 && (
        <div className="gp-toolbar">
          <label className="gp-check" htmlFor="gp-sort">Sort</label>
          <select id="gp-sort" value={sort} onChange={e => setSort(e.target.value as Sort)}>
            {SORTS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <span className="gp-spacer" />
        </div>
      )}

      <ul className="gp-list">
        {shown.map(candidate => {
          const key = guideKey(candidate.site)
          return (
            <GuideRow
              key={key}
              candidate={candidate}
              nuclease={nuclease!}
              at={at}
              selected={key === selectedKey}
              picked={picks.has(key)}
              specificity={offTargetReports[key]?.specificity}
              onClick={handleRow}
            />
          )
        })}
        {sorted.length > shown.length && (
          <li className="gp-more">
            Showing {shown.length} of {sorted.length}. Sort or narrow the scan to see the rest.
          </li>
        )}
        {candidates.length === 0 && !info.running && (
          <li className="gp-empty">
            {seqLen === 0
              ? 'Open a sequence to find guides in it.'
              : selectionOnly
                ? 'No site for this nuclease in the selection.'
                : 'No site for this nuclease in this sequence.'}
          </li>
        )}
      </ul>
        </>
      )}

      {/* The inspector belongs to whichever task picks one guide at a time. */}
      {selected && nuclease && task !== 'deletion' && task !== 'knockin' && task !== 'primeedit' && task !== 'order' && (
        <GuideInspector
          key={guideKey(selected.site)}
          candidate={selected}
          nuclease={nuclease}
        />
      )}

      <NucleaseDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSaved={id => setParams({ crisprNucleaseId: id, crisprSpacerLength: 0 })}
      />
    </div>
  )
}
