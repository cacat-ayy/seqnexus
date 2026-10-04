/**
 * Several reads at once, in one of two views.
 *
 * Traces: the reads stacked one under another, calls over chromatogram,
 * sharing a ruler and a scroll, so a plate can be read across. Table: one
 * row per read with its QC figures and quality along its length, sortable:
 * which reads worked, which need a look, which failed. Either way a read
 * opens on its own from here (double-click a trace, click a table row).
 */

import '../alignment/AlignmentWorkspace.css'
import './ReadWorkspace.css'
import './ReadQcSummary.css'
import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  ChevronsUpDown, ClipboardCopy, Download, ExternalLink, Layers, Minus, Plus, Repeat, Rows3, Scissors, X,
} from 'lucide-react'
import { useEditorStore, type SequencingRead } from '../../store'
import { readQc, VERDICT_LABEL, type QcVerdict } from '../../sanger/qc'
import { editedRead, toFasta, toFastq } from '../../sanger/edits'
import { buildTraceModel, type TraceModel } from '../../sanger/model'
import {
  DEFAULT_TRACE_VIEW, getTraceView, HEIGHT_MAX, HEIGHT_MIN, STACK_HEIGHT_MAX, STACK_HEIGHT_MIN,
  subscribeTraceView, updateTraceView, ZOOM_WIDTHS, type TraceView,
} from '../../sanger/view'
import { copyText } from '../../utils/clipboard'
import { downloadText } from '../../utils/download'
import { QualitySparkline } from '../explorer/ExplorerPreview'
import { createSignal, useSignal, type Signal } from '../alignment/signal'
import ContextMenuPopup, { MenuItem, MenuSeparator } from '../ContextMenuPopup'
import TrimCallDialog from './TrimCallDialog'
import AssembleDialog from '../contig/AssembleDialog'
import ReadStackCanvas, { type ReadStackHandle, type StackHover } from './ReadStackCanvas'
import { stackLayout } from './stack'
import HoverReadout from './TraceReadout'
import { toUid } from '../../explorer/types'

interface Props {
  readIds: string[]
  onClose: () => void
  onExportPrompt?: (defaultName: string, onConfirm: (name: string) => void) => void
}

type SortKey = 'name' | 'verdict' | 'well' | 'length' | 'kept' | 'score' | 'crl' | 'qv20' | 'mixed' | 'edits'

const nf = new Intl.NumberFormat()
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
const VERDICT_ORDER: Record<QcVerdict, number> = { fail: 0, check: 1, good: 2 }

interface Row {
  read: SequencingRead
  name: string
  verdict: QcVerdict
  issues: string[]
  well: string
  length: number
  kept: number
  score: number | null
  crl: number | null
  qv20: number | null
  mixed: number
  edits: number
}

/** A read's model, rebuilt only when the read itself changes. */
const modelCache = new WeakMap<SequencingRead, TraceModel>()
function modelOf(read: SequencingRead): TraceModel {
  let m = modelCache.get(read)
  if (!m) {
    m = buildTraceModel(read.data, read.edits, read.trimStart, read.trimEnd, !!read.reversed)
    modelCache.set(read, m)
  }
  return m
}

export default function ReadSetView({ readIds, onClose, onExportPrompt }: Props) {
  const reads = useEditorStore(s => s.sequencingReads)
  const view = useSyncExternalStore(subscribeTraceView, getTraceView, getTraceView)
  const onView = useCallback((patch: Partial<TraceView>) => updateTraceView(patch), [])
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'name', dir: 1 })
  const [trimOpen, setTrimOpen] = useState(false)
  const [assembleOpen, setAssembleOpen] = useState(false)

  // In the order they were picked in the explorer.
  const picked = useMemo(() => {
    const byId = new Map(reads.map(r => [r.id, r]))
    return readIds.map(id => byId.get(id)).filter((r): r is SequencingRead => !!r)
  }, [reads, readIds])

  const rows = useMemo((): Row[] => picked.map(read => {
    const qc = readQc(read.data)
    const noQ = !!read.data.metadata.qualityMissing
    return {
      read,
      name: read.data.name,
      verdict: qc.verdict,
      issues: qc.issues,
      well: read.data.metadata.well ?? '',
      length: read.data.bases.length,
      kept: Math.max(0, read.trimEnd - read.trimStart),
      score: qc.traceScore,
      crl: noQ ? null : qc.crl.length,
      qv20: noQ ? null : qc.qv20,
      mixed: qc.mixedPeaks,
      edits: read.edits.length,
    }
  }), [picked])

  const sorted = useMemo(() => {
    const k = sort.key
    const val = (r: Row): number | string => {
      switch (k) {
        case 'name': return r.name
        case 'well': return wellKey(r.well)
        case 'verdict': return VERDICT_ORDER[r.verdict]
        default: return r[k] ?? -1
      }
    }
    return [...rows].sort((a, b) => {
      const x = val(a)
      const y = val(b)
      const c = typeof x === 'string' && typeof y === 'string' ? collator.compare(x, y) : (x as number) - (y as number)
      return c * sort.dir
    })
  }, [rows, sort])

  const counts = { good: 0, check: 0, fail: 0 }
  for (const r of rows) counts[r.verdict]++

  const header = (key: SortKey, label: string, num = false, title?: string) => (
    <th
      className={num ? 'num' : undefined}
      aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
      onClick={() => setSort(s => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: num || key === 'verdict' ? -1 : 1 }))}
      title={title}
    >
      {label}
    </th>
  )

  // Exports follow what is on screen: the table's sort, or the stack's order.
  const shownRows = view.readSet === 'table' ? sorted : rows
  const all = (fmt: 'fasta' | 'fastq') => shownRows.map(r => {
    const e = editedRead(r.read.data, r.read.edits, r.read.trimStart, r.read.trimEnd, { reversed: !!r.read.reversed })
    const name = r.name.replace(/\s+/g, '_')
    return fmt === 'fastq' ? toFastq(name, e) : toFasta(name, e.bases)
  }).join('')

  const save = (fmt: 'fasta' | 'fastq') => {
    const text = all(fmt)
    const def = `reads.${fmt}`
    const run = (name: string) => downloadText(text, name)
    if (onExportPrompt) onExportPrompt(def, run)
    else run(def)
  }

  return (
    <div className="aw rs">
      <div className="aw-header">
        <Layers size={14} className="aw-header-icon" />
        <span className="aw-title-static">{rows.length} reads</span>
        <span className="aw-muted">
          {counts.good} good{counts.check ? ` · ${counts.check} to check` : ''}{counts.fail ? ` · ${counts.fail} failed` : ''}
        </span>
        <span className="aw-spacer" />
        <button className="aw-btn" onClick={() => setTrimOpen(true)} title="Trim and call mixed bases on every read here, with a preview first">
          <Scissors size={13} /> Trim &amp; call…
        </button>
        <button className="aw-btn" onClick={() => setAssembleOpen(true)} title="Map the reads to a reference, or assemble them de novo">
          <Layers size={13} /> Assemble…
        </button>
        <button className="aw-btn" onClick={() => copyText(all('fasta'), `Copied ${rows.length} reads as FASTA`)} title="The trimmed, edited reads, as shown (reverse complemented where set)">
          <ClipboardCopy size={13} /> Copy FASTA
        </button>
        <button className="aw-btn" onClick={() => save('fasta')}><Download size={13} /> FASTA</button>
        <button className="aw-btn" onClick={() => save('fastq')}><Download size={13} /> FASTQ</button>
        <button className="aw-icon-btn" onClick={onClose} title="Close" aria-label="Close"><X size={15} /></button>
      </div>
      {trimOpen && <TrimCallDialog readIds={readIds} onClose={() => setTrimOpen(false)} />}
      {assembleOpen && <AssembleDialog readIds={readIds} onClose={() => setAssembleOpen(false)} />}

      {view.readSet === 'traces' ? (
        <TraceStack rows={rows} readIds={readIds} view={view} onView={onView} />
      ) : (
        <>
          <div className="aw-toolbar">
            <ViewSwitch value={view.readSet} onChange={v => onView({ readSet: v })} />
          </div>
          <div className="rs-scroll">
            <table className="rs-table">
              <thead>
                <tr>
                  {header('verdict', 'QC')}
                  {header('name', 'Read')}
                  {header('well', 'Well')}
                  <th title="Quality along the read; the trimmed ends are shaded">Quality</th>
                  {header('length', 'Length', true)}
                  {header('kept', 'Kept', true, 'Bases left after trimming')}
                  {header('score', 'Trace score', true, 'Mean quality after quality trimming')}
                  {header('crl', 'CRL', true, 'Contiguous read length: longest stretch where every 20-base window averages Q20 or better')}
                  {header('qv20', 'QV20+', true, 'Bases called at Q20 or better')}
                  {header('mixed', 'Second peaks', true, 'Calls in the high-quality stretch whose second peak reaches a third of the called one')}
                  {header('edits', 'Edits', true)}
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map(r => (
                  <tr key={r.read.id} onClick={() => openAlone(r.read.id)} title={`Open ${r.name}`}>
                    <td><span className={`read-qc-verdict ${r.verdict}`}>{VERDICT_LABEL[r.verdict]}</span></td>
                    <td className="rs-name">{r.name}</td>
                    <td>{r.well}</td>
                    <td><span className="rs-spark"><QualitySparkline data={r.read.data} trimStart={r.read.trimStart} trimEnd={r.read.trimEnd} /></span></td>
                    <td className="num">{nf.format(r.length)}</td>
                    <td className="num">{nf.format(r.kept)}</td>
                    <td className="num">{r.score === null ? '–' : Math.round(r.score)}</td>
                    <td className="num">{r.crl === null ? '–' : nf.format(r.crl)}</td>
                    <td className="num">{r.qv20 === null ? '–' : nf.format(r.qv20)}</td>
                    <td className="num">{nf.format(r.mixed)}</td>
                    <td className="num">{r.edits ? nf.format(r.edits) : ''}</td>
                    <td className="rs-issues" title={r.issues.join('\n')}>{r.issues[0] ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

function ViewSwitch({ value, onChange }: { value: TraceView['readSet']; onChange: (v: TraceView['readSet']) => void }) {
  const opts = [
    { value: 'traces', label: 'Traces', title: 'The reads stacked, calls over chromatogram' },
    { value: 'table', label: 'QC table', title: 'One row per read with its quality figures, sortable' },
  ] as const
  return (
    <div className="aw-seg" role="radiogroup" aria-label="Show the reads as">
      {opts.map(o => (
        <button key={o.value} role="radio" aria-checked={value === o.value} className={value === o.value ? 'active' : ''} title={o.title} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Stacked traces
// ---------------------------------------------------------------------------

const sameHover = (a: StackHover | null, b: StackHover | null) => a === b || (!!a && !!b && a.row === b.row && a.d === b.d)

function TraceStack({ rows, readIds, view, onView }: {
  rows: readonly Row[]
  readIds: string[]
  view: TraceView
  onView: (patch: Partial<TraceView>) => void
}) {
  const canvasRef = useRef<ReadStackHandle>(null)
  const models = useMemo(() => rows.map(r => modelOf(r.read)), [rows])
  const gutter = useMemo(() => rows.map(r => ({
    name: r.name,
    detail: [`${nf.format(r.kept)} of ${nf.format(r.length)} bp kept`, r.well && `well ${r.well}`].filter(Boolean).join(' · '),
    reversed: !!r.read.reversed,
    verdict: r.verdict,
  })), [rows])
  const layout = useMemo(() => stackLayout(models, view.stackAlign, view.stackHeight), [models, view.stackAlign, view.stackHeight])
  const hover = useMemo(() => createSignal<StackHover | null>(null, sameHover), [])
  const [selected, setSelected] = useState<number | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; row: number } | null>(null)
  const sel = selected !== null && selected < rows.length ? selected : null

  const zoomRef = useRef(view.zoom)
  zoomRef.current = view.zoom
  const heightRef = useRef(view.height)
  heightRef.current = view.height
  const zoomTo = (z: number) => onView({ zoom: Math.max(0, Math.min(ZOOM_WIDTHS.length - 1, z)) })
  const onZoom = useCallback((step: number) => onView({ zoom: Math.max(0, Math.min(ZOOM_WIDTHS.length - 1, zoomRef.current + step)) }), [onView])
  const onHeight = useCallback((step: number) => {
    const h = Math.max(HEIGHT_MIN, Math.min(HEIGHT_MAX, heightRef.current * (step > 0 ? 1.15 : 1 / 1.15)))
    onView({ height: Math.round(h * 100) / 100 })
  }, [onView])

  const open = (row: number) => {
    const r = rows[row]
    if (r) openAlone(r.read.id)
  }

  return (
    <>
      <div className="aw-toolbar">
        <ViewSwitch value={view.readSet} onChange={v => onView({ readSet: v })} />
        <span className="aw-tool-sep" />
        <span className="aw-tool-label">Line up at</span>
        <select
          className="select aw-select"
          value={view.stackAlign}
          aria-label="Line up the reads at"
          title="Reads are not aligned here, only lined up; assemble them to align"
          onChange={e => onView({ stackAlign: e.target.value === 'trim' ? 'trim' : 'start' })}
        >
          <option value="start">Base 1</option>
          <option value="trim">Start of the kept part</option>
        </select>
        <span className="aw-tool-sep" />
        <button className={`aw-tool-btn ${view.quality ? 'active' : ''}`} aria-pressed={view.quality} onClick={() => onView({ quality: !view.quality })} title="Show quality as boxes behind the trace">
          Quality
        </button>
        <button className={`aw-tool-btn ${view.mixed ? 'active' : ''}`} aria-pressed={view.mixed} onClick={() => onView({ mixed: !view.mixed })} title={`Mark calls with a second peak of at least ${Math.round(view.mixedRatio * 100)}%`}>
          Second peaks
        </button>
        <button className={`aw-tool-btn ${view.normalize ? 'active' : ''}`} aria-pressed={view.normalize} onClick={() => onView({ normalize: !view.normalize })} title="Scale peaks to their local height, so the weak end of a read is as readable as the start">
          Even heights
        </button>
        <span className="aw-spacer" />
        <Rows3 size={13} className="tw-tool-icon" aria-hidden />
        <input
          type="range"
          className="aw-zoom tw-height"
          min={STACK_HEIGHT_MIN}
          max={STACK_HEIGHT_MAX}
          step={4}
          value={view.stackHeight}
          aria-label="Row height"
          title="Row height"
          onChange={e => onView({ stackHeight: Number(e.target.value) })}
          onDoubleClick={() => onView({ stackHeight: DEFAULT_TRACE_VIEW.stackHeight })}
        />
        <ChevronsUpDown size={13} className="tw-tool-icon" aria-hidden />
        <input
          type="range"
          className="aw-zoom tw-height"
          min={Math.log(HEIGHT_MIN)}
          max={Math.log(HEIGHT_MAX)}
          step={0.01}
          value={Math.log(view.height)}
          aria-label="Peak height"
          title="Peak height (Alt+wheel)"
          onChange={e => onView({ height: Math.round(Math.exp(Number(e.target.value)) * 100) / 100 })}
          onDoubleClick={() => onView({ height: DEFAULT_TRACE_VIEW.height })}
        />
        <span className="aw-tool-sep" />
        <button className="aw-tool-icon" onClick={() => zoomTo(view.zoom - 1)} disabled={view.zoom <= 0} title="Zoom out (Ctrl+wheel)" aria-label="Zoom out"><Minus size={14} /></button>
        <input type="range" className="aw-zoom" min={0} max={ZOOM_WIDTHS.length - 1} value={view.zoom} aria-label="Zoom" onChange={e => zoomTo(Number(e.target.value))} />
        <button className="aw-tool-icon" onClick={() => zoomTo(view.zoom + 1)} disabled={view.zoom >= ZOOM_WIDTHS.length - 1} title="Zoom in (Ctrl+wheel)" aria-label="Zoom in"><Plus size={14} /></button>
      </div>
      <div className="aw-main">
        <ReadStackCanvas
          ref={canvasRef}
          models={models}
          rows={gutter}
          layout={layout}
          view={view}
          selected={sel}
          hover={hover}
          onSelect={setSelected}
          onOpen={open}
          onContextMenu={setMenu}
          onZoom={onZoom}
          onHeight={onHeight}
        />
        <StackStatus rows={rows} models={models} hover={hover} />
      </div>

      {menu && rows[menu.row] && (() => {
        const r = rows[menu.row]
        const reversed = !!r.read.reversed
        return (
          <ContextMenuPopup x={menu.x} y={menu.y} onClose={() => setMenu(null)} label="Read actions">
            <div onClick={() => setMenu(null)}>
              <div className="ctx-menu-header">{r.name}</div>
              <MenuItem icon={<ExternalLink size={13} />} onSelect={() => open(menu.row)} shortcut="Enter">Open on its own</MenuItem>
              <MenuItem icon={<Repeat size={13} />} onSelect={() => useEditorStore.getState().setSequencingReversed(r.read.id, !reversed)}>
                {reversed ? 'Show as read' : 'Show reverse complement'}
              </MenuItem>
              <MenuSeparator />
              <MenuItem icon={<X size={13} />} onSelect={() => removeFromView(readIds, r.read.id)}>
                Remove from this view
              </MenuItem>
            </div>
          </ContextMenuPopup>
        )
      })()}
    </>
  )
}

function StackStatus({ rows, models, hover }: { rows: readonly Row[]; models: readonly TraceModel[]; hover: Signal<StackHover | null> }) {
  const h = useSignal(hover)
  const r = h ? rows[h.row] : undefined
  const m = h ? models[h.row] : undefined
  return (
    <div className="aw-status">
      <div className="aw-status-readout">
        {r && m ? (
          <>
            <span><b>{r.name}</b></span>
            {h!.d !== null && h!.d < m.n
              ? <HoverReadout m={m} d={h!.d} />
              : <span className="aw-muted">{nf.format(r.kept)} of {nf.format(r.length)} bases kept · {VERDICT_LABEL[r.verdict]}</span>}
          </>
        ) : (
          <span className="aw-muted">Double-click a read to open it · ↑↓ move between reads · Ctrl+wheel zoom · Alt+wheel peak height · Shift+wheel scrolls through the reads</span>
        )}
      </div>
    </div>
  )
}

/**
 * Open one read on its own. The reads were picked together in the explorer;
 * once only one is shown, that pick no longer describes what is open.
 */
function openAlone(id: string) {
  const s = useEditorStore.getState()
  s.setExplorerSelectedIds(new Set())
  s.setActiveSequencingRead(id)
}

/** Take a read out of the stack, and out of the explorer's pick with it. */
function removeFromView(readIds: readonly string[], id: string) {
  const rest = readIds.filter(r => r !== id)
  if (rest.length <= 1) return openAlone(rest[0] ?? id)
  const s = useEditorStore.getState()
  s.setExplorerSelectedIds(prev => {
    const next = new Set(prev)
    next.delete(toUid('read', id))
    return next
  })
  s.setActiveSequencingReads(rest)
}

/** Wells sort by row then column: A1, A2 … A12, B1. */
function wellKey(well: string): string {
  const m = /^([A-Pa-p])0*(\d{1,2})$/.exec(well.trim())
  return m ? `${m[1].toUpperCase()}${m[2].padStart(2, '0')}` : `~${well}`
}
