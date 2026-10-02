/**
 * The read's side panel.
 *
 * "Read" is the read as a whole: its QC, how it is trimmed, how many calls
 * were changed, and the run details from the file. "Selection" is the
 * selected stretch (or the base at the caret): its quality, composition,
 * translation and what can be done with it.
 */

import { memo, useDeferredValue, useMemo } from 'react'
import { ClipboardCopy, Eraser, FileOutput, Repeat, RotateCcw, Scissors, SlidersHorizontal, Undo2, Wand2 } from 'lucide-react'
import type { TraceMetadata } from '../../io/trace'
import { KIND_DELETE, KIND_INSERT } from '../../sanger/layout'
import type { TraceModel } from '../../sanger/model'
import type { TraceView } from '../../sanger/view'
import { translate } from '../../utils/codon'
import ReadQcSummary from './ReadQcSummary'
import type { TraceSelection } from './TraceCanvas'

export interface ReadActions {
  copy: () => void
  copyReverseComplement: () => void
  extract: () => void
  trimToSelection: () => void
  autoTrim: () => void
  clearTrim: () => void
  revertSelection: () => void
  revertAll: () => void
  /** Open the trim and mixed-base dialog. */
  openTrim: () => void
  clearMixed: () => void
}

interface Props {
  model: TraceModel
  view: TraceView
  selection: TraceSelection | null
  caret: number | null
  tab: 'read' | 'selection'
  onTab: (t: 'read' | 'selection') => void
  actions: ReadActions
}

const nf = new Intl.NumberFormat()

function ReadInspector({ model, view, selection, caret, tab, onTab, actions }: Props) {
  return (
    <aside className="aw-inspector" aria-label="Read inspector">
      <div className="aw-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'read'} className={`aw-tab ${tab === 'read' ? 'active' : ''}`} onClick={() => onTab('read')}>
          Read
        </button>
        <button role="tab" aria-selected={tab === 'selection'} className={`aw-tab ${tab === 'selection' ? 'active' : ''}`} onClick={() => onTab('selection')}>
          Selection
        </button>
      </div>
      <div className="aw-inspector-body">
        {tab === 'read'
          ? <ReadPanel model={model} actions={actions} />
          : <SelectionPanel model={model} view={view} selection={selection} caret={caret} actions={actions} />}
      </div>
    </aside>
  )
}

export default memo(ReadInspector)

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

function ReadPanel({ model: m, actions }: { model: TraceModel; actions: ReadActions }) {
  let mixedCalls = 0
  for (let d = 0; d < m.n; d++) if (m.auto[d]) mixedCalls++
  const [t0, t1] = m.trim
  let kept = 0
  for (let d = t0; d < t1; d++) if (m.kind[d] !== KIND_DELETE) kept++
  const total = m.data.bases.length
  const edited = m.layout.edited
  const originalDiffers = m.data.originalCalls ? countDiffs(m.data.originalCalls.bases, m.data.bases) : 0

  return (
    <div className="aw-panel">
      <ReadQcSummary data={m.data} />

      <div className="aw-section-label">Trim</div>
      <p className="tw-note">
        {t1 > t0
          ? <>Keeping <b>{nf.format(kept)}</b> of {nf.format(total)} bases ({nf.format(t0 + 1)}–{nf.format(t1)}).</>
          : <>Everything is trimmed away.</>}
        {' '}Drag the handles in the ruler to change it.
      </p>
      <div className="aw-actions">
        <button className="aw-action" onClick={actions.autoTrim} disabled={!!m.data.metadata.qualityMissing} title={m.data.metadata.qualityMissing ? 'This file has no quality values to trim by' : 'Keep the best stretch at Q20 or better'}>
          <Wand2 size={13} /> Trim by quality
        </button>
        <button className="aw-action" onClick={actions.clearTrim} disabled={t0 === 0 && t1 === m.n}><RotateCcw size={13} /> Keep the whole read</button>
        <button className="aw-action" onClick={actions.openTrim}><SlidersHorizontal size={13} /> Trim by error rate, primers or vector…</button>
      </div>

      <div className="aw-section-label">Edits</div>
      <p className="tw-note">
        {edited === 0 ? 'The calls are as the instrument made them.' : `${nf.format(edited)} ${edited === 1 ? 'base is' : 'bases are'} edited. The trace and the original calls are kept, so any edit can be taken back.`}
      </p>
      {mixedCalls > 0 && (
        <p className="tw-note">{nf.format(mixedCalls)} of them {mixedCalls === 1 ? 'is a mixed-base call' : 'are mixed-base calls'} made from second peaks (shown in amber).</p>
      )}
      <div className="aw-actions">
        <button className="aw-action" onClick={actions.openTrim}><Wand2 size={13} /> Call mixed bases…</button>
        {mixedCalls > 0 && <button className="aw-action" onClick={actions.clearMixed}><Eraser size={13} /> Clear mixed-base calls</button>}
        {edited > 0 && <button className="aw-action danger" onClick={actions.revertAll}><Undo2 size={13} /> Revert all edits</button>}
      </div>
      {originalDiffers > 0 && (
        <p className="tw-note">
          The file also holds the base caller&apos;s first calls, which differ at {nf.format(originalDiffers)} {originalDiffers === 1 ? 'base' : 'bases'}: it was edited before it was exported.
        </p>
      )}

      <RunDetails meta={m.data.metadata} />
    </div>
  )
}

function countDiffs(a: string, b: string): number {
  let k = Math.abs(a.length - b.length)
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) k++
  return k
}

const RUN_FIELDS: [keyof TraceMetadata, string][] = [
  ['sampleName', 'Sample'],
  ['well', 'Well'],
  ['lane', 'Capillary'],
  ['plateName', 'Plate'],
  ['instrument', 'Instrument'],
  ['machineName', 'Machine'],
  ['runName', 'Run'],
  ['runModule', 'Run module'],
  ['dyeSet', 'Dye set'],
  ['polymer', 'Polymer'],
  ['mobilityFile', 'Mobility file'],
  ['basecaller', 'Base caller'],
  ['dataCollection', 'Collection software'],
  ['averageSpacing', 'Peak spacing'],
  ['owner', 'Owner'],
  ['comment', 'Comment'],
]

function RunDetails({ meta }: { meta: TraceMetadata }) {
  const rows: [string, string][] = []
  for (const [k, label] of RUN_FIELDS) {
    const v = meta[k]
    if (v === undefined || v === '' || typeof v === 'object') continue
    rows.push([label, typeof v === 'number' ? String(v) : v as string])
  }
  if (meta.runStartDate) rows.push(['Run started', `${meta.runStartDate}${meta.runStartTime ? ` ${meta.runStartTime}` : ''}`])
  if (meta.runEndDate) rows.push(['Run ended', `${meta.runEndDate}${meta.runEndTime ? ` ${meta.runEndTime}` : ''}`])
  const sig = meta.signal
  const noise = meta.noise
  if (rows.length === 0 && !sig) return null
  return (
    <>
      <div className="aw-section-label">Run</div>
      <dl className="aw-stats tw-run">
        {rows.map(([label, value]) => (
          <div key={label} className="aw-stat" title={value}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
        {sig && (
          <div className="aw-stat" title="Average signal intensity per dye, as reported by the instrument">
            <dt>Signal</dt>
            <dd className="tw-signal">
              {(['A', 'C', 'G', 'T'] as const).map(b => <span key={b} className={`tw-ch-${b}`}>{b} {Math.round(sig[b])}</span>)}
            </dd>
          </div>
        )}
        {noise && (
          <div className="aw-stat" title="Baseline noise per dye">
            <dt>Noise</dt>
            <dd className="tw-signal">
              {(['A', 'C', 'G', 'T'] as const).map(b => <span key={b} className={`tw-ch-${b}`}>{b} {noise[b].toFixed(1)}</span>)}
            </dd>
          </div>
        )}
      </dl>
    </>
  )
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

function SelectionPanel({ model: m, view, selection: liveSel, caret, actions }: {
  model: TraceModel
  view: TraceView
  selection: TraceSelection | null
  caret: number | null
  actions: ReadActions
}) {
  const selection = useDeferredValue(liveSel)
  const range = selection ?? (caret !== null && caret < m.n ? { d0: caret, d1: caret + 1 } : null)
  const stats = useMemo(() => (range ? rangeStats(m, range.d0, range.d1, view) : null), [m, range?.d0, range?.d1, view]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!range || !stats) {
    return (
      <div className="aw-panel">
        <p className="tw-note">Click a base, or drag across the trace, to see the stretch&apos;s quality and translation here.</p>
      </div>
    )
  }
  const one = range.d1 - range.d0 === 1
  return (
    <div className="aw-panel">
      <div className="aw-sel-head">
        <div className="aw-sel-title">{one ? `Base ${nf.format(range.d0 + 1)}` : `Bases ${nf.format(range.d0 + 1)}–${nf.format(range.d1)}`}</div>
        <div className="aw-sel-sub">{nf.format(stats.length)} {stats.length === 1 ? 'base' : 'bases'}{stats.deleted ? ` · ${stats.deleted} deleted` : ''}</div>
      </div>
      <dl className="aw-stats">
        {stats.meanQ !== null && <Stat label="Mean quality" value={`Q${stats.meanQ.toFixed(1)}`} strong />}
        {stats.minQ !== null && <Stat label="Lowest quality" value={`Q${stats.minQ}`} />}
        {stats.meanQ !== null && <Stat label={`Below Q${view.qualityCutoff}`} value={nf.format(stats.low)} />}
        <Stat label="GC content" value={stats.length ? `${((stats.gc / stats.length) * 100).toFixed(1)}%` : '—'} />
        <Stat label="Ambiguous calls" value={nf.format(stats.ambiguous)} />
        <Stat label="Second peaks" value={nf.format(stats.mixed)} hint={`Calls whose second-tallest peak reaches ${Math.round(view.mixedRatio * 100)}% of the called one`} />
        <Stat label="Edited" value={nf.format(stats.edited)} />
      </dl>
      {stats.bases && (
        <>
          <div className="aw-section-label">Sequence</div>
          <div className="tw-seq">{stats.bases.length > 240 ? `${stats.bases.slice(0, 240)}…` : stats.bases}</div>
        </>
      )}
      {stats.bases.length >= 3 && (
        <>
          <div className="aw-section-label">Translation (frame 1 of the selection)</div>
          <div className="tw-seq">{stats.protein.length > 80 ? `${stats.protein.slice(0, 80)}…` : stats.protein}</div>
        </>
      )}
      <div className="aw-section-label">Actions</div>
      <div className="aw-actions">
        <button className="aw-action" onClick={actions.copy}><ClipboardCopy size={13} /> Copy</button>
        <button className="aw-action" onClick={actions.copyReverseComplement}><Repeat size={13} /> Copy reverse complement</button>
        <button className="aw-action" onClick={actions.extract}><FileOutput size={13} /> Extract as sequence</button>
        {!one && <button className="aw-action" onClick={actions.trimToSelection}><Scissors size={13} /> Trim to selection</button>}
        {stats.edited > 0 && <button className="aw-action" onClick={actions.revertSelection}><Undo2 size={13} /> Revert edits here</button>}
      </div>
    </div>
  )
}

function rangeStats(m: TraceModel, d0: number, d1: number, view: TraceView) {
  let bases = ''
  let qSum = 0
  let qN = 0
  let minQ = Infinity
  let low = 0
  let gc = 0
  let ambiguous = 0
  let mixed = 0
  let edited = 0
  let deleted = 0
  for (let d = d0; d < d1; d++) {
    const k = m.kind[d]
    if (k !== 0) edited++
    if (k === KIND_DELETE) { deleted++; continue }
    const b = m.shown[d]
    bases += b
    if (b === 'G' || b === 'C' || b === 'S') gc++
    if (b !== 'A' && b !== 'C' && b !== 'G' && b !== 'T') ambiguous++
    if (k !== KIND_INSERT && m.secondRatio[d] >= view.mixedRatio) mixed++
    const q = m.quality[d]
    if (q >= 0 && !m.data.metadata.qualityMissing) {
      qSum += q
      qN++
      if (q < minQ) minQ = q
      if (q < view.qualityCutoff) low++
    }
  }
  return {
    bases,
    length: bases.length,
    meanQ: qN ? qSum / qN : null,
    minQ: qN ? minQ : null,
    low, gc, ambiguous, mixed, edited, deleted,
    protein: translate(bases.slice(0, bases.length - (bases.length % 3))),
  }
}

function Stat({ label, value, hint, strong }: { label: string; value: string; hint?: string; strong?: boolean }) {
  return (
    <div className={`aw-stat${strong ? ' strong' : ''}`} title={hint}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}
