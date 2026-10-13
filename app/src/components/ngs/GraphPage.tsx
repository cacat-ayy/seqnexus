/**
 * The Graph page of a de novo assembly: its assembly graph drawn the way
 * Bandage draws it (ngs/denovo/layout.ts), each segment a stroke as long as
 * its sequence, joined where the graph joins it, coloured by coverage
 * against the assembly's usual coverage. It shows why contigs end where they
 * do: a repeat is a short piece several contigs lead into and out of, often
 * at twice the coverage or more; a circle is a replicon resolved whole; a
 * dead end is where coverage ran out or a linear molecule ends.
 *
 * Drag to move, wheel to zoom, click a segment for its details, its
 * neighbours and its sequence. Export GFA for Bandage or other tools.
 */

import './GraphPage.css'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Copy, Download, FilePlus2, Maximize2, Rows3 } from 'lucide-react'
import { useEditorStore, type Assembly } from '../../store'
import { notify } from '../../toast'
import { getReadChunk } from '../../storage/idb'
import { mappingStorageIds } from '../../ngs/builder'
import { components, decodeGraph, toGfa, type StoredGraph } from '../../ngs/denovo/graph'
import { layoutGraph } from '../../ngs/denovo/layout'
import { formatBp } from '../../utils/format'
import { saveText } from '../../utils/download'

const nf = new Intl.NumberFormat('en-US')

/** Graphs with more segments than this are not drawn (Bandage handles them better); GFA export still works. */
const MAX_DRAWN = 4000

type ColourMode = 'coverage' | 'contigs'

/** Catmull-Rom through the points as cubic Bezier curves; closed for a circle. */
function smoothPath(p: Float64Array, closed: boolean): string {
  const n = p.length / 2
  if (n < 2) return ''
  const pt = (i: number) => {
    const k = closed ? ((i % n) + n) % n : Math.max(0, Math.min(n - 1, i))
    return [p[2 * k], p[2 * k + 1]]
  }
  let d = `M${p[0].toFixed(3)},${p[1].toFixed(3)}`
  const last = closed ? n : n - 1
  for (let i = 0; i < last; i++) {
    const [x0, y0] = pt(i - 1)
    const [x1, y1] = pt(i)
    const [x2, y2] = pt(i + 1)
    const [x3, y3] = pt(i + 2)
    d += ` C${(x1 + (x2 - x0) / 6).toFixed(3)},${(y1 + (y2 - y0) / 6).toFixed(3)} ${(x2 - (x3 - x1) / 6).toFixed(3)},${(y2 - (y3 - y1) / 6).toFixed(3)} ${x2.toFixed(3)},${y2.toFixed(3)}`
  }
  return closed ? `${d} Z` : d
}

/** The coverage most of the assembly has: the length-weighted median over the segments. */
function usualCoverage(g: StoredGraph): number {
  const s = [...g.segments].sort((a, b) => a.coverage - b.coverage)
  const half = s.reduce((n, x) => n + x.length, 0) / 2
  let acc = 0
  for (const x of s) { acc += x.length; if (acc >= half) return x.coverage || 1 }
  return 1
}

/** A colour for a coverage ratio, mixed from the theme: warning (low) to accent (usual) to success (3x and more). */
function coverageColour(r: number): string {
  if (r < 1) {
    const p = Math.round(Math.max(0, Math.min(1, (r - 0.25) / 0.75)) * 100)
    return `color-mix(in srgb, var(--accent) ${p}%, var(--warning))`
  }
  const q = Math.round(Math.max(0, Math.min(1, (r - 1) / 2)) * 100)
  return `color-mix(in srgb, var(--success) ${q}%, var(--accent))`
}

interface View { scale: number; tx: number; ty: number }

export default function GraphPage({ assembly, onShowReads }: { assembly: Assembly; onShowReads: (refIndex: number) => void }) {
  const sample = assembly.samples?.[0]
  const [graph, setGraph] = useState<StoredGraph | 'missing' | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [hover, setHover] = useState<{ seg: number; x: number; y: number } | null>(null)
  const [mode, setMode] = useState<ColourMode>('coverage')
  const [view, setView] = useState<View | null>(null)
  const [size, setSize] = useState({ w: 800, h: 500 })
  const wrapRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number; view: View; moved: boolean; seg: number | null } | null>(null)

  useEffect(() => {
    let live = true
    if (!sample) { setGraph('missing'); return }
    getReadChunk(mappingStorageIds(sample.storageId).graph, 0)
      .then(data => { if (live) setGraph(data ? decodeGraph(data) : 'missing') })
      .catch(() => { if (live) setGraph('missing') })
    return () => { live = false }
  }, [sample])

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [graph])

  const g = graph && graph !== 'missing' ? graph : null
  const drawable = !!g && g.segments.length <= MAX_DRAWN
  const layout = useMemo(() => (g && drawable ? layoutGraph(g) : null), [g, drawable])
  const usual = useMemo(() => (g ? usualCoverage(g) : 1), [g])
  const paths = useMemo(() => (g && layout ? layout.points.map((p, i) => smoothPath(p, g.segments[i].circular)) : []), [g, layout])

  const fit = useMemo(() => {
    if (!layout) return { scale: 1, tx: 0, ty: 0 }
    const pad = 40
    const scale = Math.max(0.01, Math.min((size.w - 2 * pad) / layout.width, (size.h - 2 * pad) / layout.height, 60))
    return { scale, tx: (size.w - layout.width * scale) / 2, ty: (size.h - layout.height * scale) / 2 }
  }, [layout, size])
  const v = view ?? fit

  const stats = useMemo(() => {
    if (!g) return null
    let deadEnds = 0
    const out = g.segments.map(() => ({ plus: false, minus: false }))
    for (const [a, as, b, bs] of g.links) {
      if (as === '+') out[a].plus = true
      else out[a].minus = true
      if (bs === '+') out[b].minus = true
      else out[b].plus = true
    }
    g.segments.forEach((s, i) => {
      if (s.circular) return
      if (!out[i].plus) deadEnds++
      if (!out[i].minus) deadEnds++
    })
    return {
      contigs: new Set(g.segments.filter(s => s.contig !== null).map(s => s.contig)).size,
      contigSegments: g.segments.filter(s => s.contig !== null).length,
      pieces: g.segments.filter(s => s.contig === null).length,
      components: components(g).length,
      deadEnds,
    }
  }, [g])

  const neighbours = useMemo(() => {
    if (!g || selected === null) return []
    const set = new Set<number>()
    for (const [a, , b] of g.links) {
      if (a === selected && b !== selected) set.add(b)
      if (b === selected && a !== selected) set.add(a)
    }
    return [...set]
  }, [g, selected])

  if (graph === null) return <div className="gp-empty aw-note">Loading the graph…</div>
  if (!g) {
    return (
      <div className="gp-empty aw-note">
        No graph is stored for this assembly: it was made before assembly graphs were kept. Run it again to see its graph.
      </div>
    )
  }

  const colourOf = (i: number) => {
    const s = g.segments[i]
    if (mode === 'contigs') return s.contig !== null ? 'var(--accent)' : 'var(--text-soft)'
    return coverageColour(s.coverage / usual)
  }
  const seqName = (i: number) => g.segments[i].name
  const exportGfa = () => saveText(toGfa(g), `${assembly.name.replace(/[\\/:*?"<>|\s]+/g, '_')}.gfa`)
  const openSegment = (i: number) => {
    const s = g.segments[i]
    const title = `${assembly.name} ${s.name}`
    // Opened beside the assembly, which stays on screen, as a consensus is.
    const store = useEditorStore.getState()
    const id = store.openDocument(title, g.sequences[i], s.circular ? 'circular' : 'linear',
      `${s.name} of the assembly graph of ${assembly.name}`, 'consensus')
    store.setActiveAssembly(assembly.id)
    notify.success(`Opened ${title}`, { action: { label: 'Show', onClick: () => useEditorStore.getState().setActiveTab(id) } })
  }

  const onWheel = (e: React.WheelEvent) => {
    const rect = wrapRef.current!.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const f = Math.exp(-e.deltaY * 0.0015)
    const scale = Math.max(fit.scale * 0.2, Math.min(fit.scale * 80, v.scale * f))
    const k = scale / v.scale
    setView({ scale, tx: mx - (mx - v.tx) * k, ty: my - (my - v.ty) * k })
  }
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    // The segment pressed on, read now: once the pointer is captured, events come from the canvas.
    const hit = (e.target as Element).closest('[data-seg]')
    drag.current = { x: e.clientX, y: e.clientY, view: v, moved: false, seg: hit ? Number(hit.getAttribute('data-seg')) : null }
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (!d.moved && Math.hypot(dx, dy) < 3) return
    d.moved = true
    setHover(null)
    setView({ ...d.view, tx: d.view.tx + dx, ty: d.view.ty + dy })
  }
  const onPointerUp = () => {
    const d = drag.current
    drag.current = null
    // A click selects the segment under the pointer, or clears the selection.
    if (d && !d.moved) setSelected(d.seg)
  }

  const sel = selected !== null ? g.segments[selected] : null
  const near = new Set(neighbours)
  // Labels: contigs always, pieces once drawn long enough to hold one.
  const labels = layout ? g.segments.map((s, i) => {
    const p = layout.points[i]
    const mid = Math.floor(p.length / 4) * 2
    const longEnough = (p.length / 2) * v.scale > 70
    if (!(s.contig !== null || longEnough || i === selected)) return null
    return { i, x: p[mid] * v.scale + v.tx, y: p[mid + 1] * v.scale + v.ty }
  }).filter((x): x is { i: number; x: number; y: number } => !!x) : []

  return (
    <div className="gp">
      <div className="gp-main">
        <div className="gp-toolbar">
          <div className="seg seg-sm aw-seg" role="radiogroup" aria-label="Colour by">
            <button role="radio" aria-checked={mode === 'coverage'} className={mode === 'coverage' ? 'active' : ''} onClick={() => setMode('coverage')}
              title="Coverage against the assembly's usual coverage">Coverage</button>
            <button role="radio" aria-checked={mode === 'contigs'} className={mode === 'contigs' ? 'active' : ''} onClick={() => setMode('contigs')}
              title="Contigs, and the shorter pieces between them">Contigs</button>
          </div>
          {mode === 'coverage' ? (
            <div className="gp-legend" title={`Usual coverage: ${usual.toFixed(1)}${g.coverageUnit === 'k-mer' ? ' (k-mer)' : '×'}`}>
              <span>¼×</span><span className="gp-ramp" /><span>1×</span><span className="gp-ramp gp-ramp-high" /><span>3×+</span>
            </div>
          ) : (
            <div className="gp-legend"><span className="gp-swatch gp-swatch-contig" /> Contig <span className="gp-swatch gp-swatch-piece" /> {g.linkOverlaps ? 'Other unitig' : 'Piece'}</div>
          )}
          <span className="aw-spacer" />
          <button className="aw-btn" onClick={() => setView(null)} disabled={!drawable} title="Fit the whole graph"><Maximize2 size={13} /> Fit</button>
          <button className="aw-btn" onClick={exportGfa} title="GFA 1, for Bandage and other graph tools"><Download size={13} /> Export GFA</button>
        </div>
        <div className="gp-canvas" ref={wrapRef} onWheel={drawable ? onWheel : undefined}
          onPointerDown={drawable ? onPointerDown : undefined} onPointerMove={drawable ? onPointerMove : undefined} onPointerUp={drawable ? onPointerUp : undefined}>
          {!drawable ? (
            <p className="gp-empty aw-note">The graph has {nf.format(g.segments.length)} segments, too many to draw here. Export it as GFA and open it in Bandage.</p>
          ) : layout && (
            <svg width={size.w} height={size.h} className="gp-svg" role="img" aria-label="Assembly graph">
              <g transform={`translate(${v.tx},${v.ty}) scale(${v.scale})`}>
                {g.links.map(([a, as, b, bs], k) => {
                  if (a === b) return null
                  const pa = layout.points[a]
                  const pb = layout.points[b]
                  const ia = as === '+' ? pa.length - 2 : 0
                  const ib = bs === '+' ? 0 : pb.length - 2
                  const on = selected !== null && (a === selected || b === selected)
                  return <line key={k} x1={pa[ia]} y1={pa[ia + 1]} x2={pb[ib]} y2={pb[ib + 1]} className={on ? 'gp-link on' : 'gp-link'} vectorEffect="non-scaling-stroke" />
                })}
                {paths.map((d, i) => (
                  <path key={i} d={d} data-seg={i}
                    className={`gp-seg${i === selected ? ' sel' : ''}${selected !== null && i !== selected && !near.has(i) ? ' dim' : ''}`}
                    style={{ stroke: colourOf(i) }} vectorEffect="non-scaling-stroke"
                    onPointerEnter={e => { if (!drag.current) setHover({ seg: i, x: e.clientX, y: e.clientY }) }}
                    onPointerMove={e => { if (!drag.current) setHover({ seg: i, x: e.clientX, y: e.clientY }) }}
                    onPointerLeave={() => setHover(h => (h?.seg === i ? null : h))} />
                ))}
              </g>
              <g className="gp-labels">
                {labels.map(l => <text key={l.i} x={l.x + 8} y={l.y - 8}>{seqName(l.i)}</text>)}
              </g>
            </svg>
          )}
          {hover && drawable && (() => {
            const s = g.segments[hover.seg]
            const rect = wrapRef.current?.getBoundingClientRect()
            return (
              <div className="gp-hover" style={{ left: hover.x - (rect?.left ?? 0) + 14, top: hover.y - (rect?.top ?? 0) + 14 }}>
                <strong>{s.name}</strong> {formatBp(s.length)}{s.circular ? ', circular' : ''}
                <div className="aw-muted">{s.coverage.toFixed(1)}{g.coverageUnit === 'k-mer' ? ' k-mer coverage' : '× depth'}, {(s.coverage / usual).toFixed(2)}× the usual</div>
              </div>
            )
          })()}
        </div>
      </div>

      <aside className="gp-side">
        {sel && selected !== null ? (
          <>
            <div className="gp-side-title">{sel.name}</div>
            <dl className="ngs-facts">
              <dt>Length</dt><dd>{nf.format(sel.length)} bp</dd>
              <dt>Shape</dt><dd>{sel.circular ? 'Circular: its end leads back to its start' : 'Linear'}</dd>
              <dt>Coverage</dt>
              <dd>{sel.coverage.toFixed(1)}{g.coverageUnit === 'k-mer' ? ' (k-mer)' : '×'}, {(sel.coverage / usual).toFixed(2)}× the usual</dd>
              <dt>Joins</dt><dd>{neighbours.length === 0 ? (sel.circular ? 'none besides itself' : 'none: both ends are dead ends') : neighbours.length}</dd>
            </dl>
            {sel.contig === null && (
              <p className="aw-note">
                {g.linkOverlaps ? `A unitig too short, or with too few reads behind it, to be a contig.` : 'A piece shorter than the shortest contig.'} {neighbours.length >= 2 && sel.coverage / usual >= 1.6
                  ? 'Several segments lead into it and it has more coverage than the usual: most likely a repeat, present in more than one copy.'
                  : 'Pieces like this sit where contigs could not be joined on unambiguously.'}
              </p>
            )}
            {neighbours.length > 0 && (
              <div className="gp-neighbours">
                {neighbours.map(n => (
                  <button key={n} className="gp-chip" onClick={() => setSelected(n)}>
                    <span className="gp-chip-dot" style={{ background: colourOf(n) }} />{g.segments[n].name}
                  </button>
                ))}
              </div>
            )}
            <div className="gp-actions">
              {sel.contig !== null && (
                <button className="aw-btn" onClick={() => onShowReads(sel.contig!)}><Rows3 size={13} /> Show reads</button>
              )}
              <button className="aw-btn" onClick={() => openSegment(selected)}><FilePlus2 size={13} /> Open as sequence</button>
              <button className="aw-btn" onClick={() => { void navigator.clipboard?.writeText(g.sequences[selected]).then(() => notify.success(`Copied ${sel.name}`)) }}>
                <Copy size={13} /> Copy sequence
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="gp-side-title">Assembly graph</div>
            {stats && (
              <dl className="ngs-facts">
                <dt>Segments</dt><dd>{nf.format(g.segments.length)}: {stats.contigSegments !== stats.contigs ? `${nf.format(stats.contigSegments)} in ` : ''}{nf.format(stats.contigs)} {stats.contigs === 1 ? 'contig' : 'contigs'}, {nf.format(stats.pieces)} {g.linkOverlaps ? (stats.pieces === 1 ? 'other unitig' : 'other unitigs') : stats.pieces === 1 ? 'piece' : 'pieces'}</dd>
                <dt>Joins</dt><dd>{nf.format(g.links.length)}{g.overlap ? `, each overlapping by ${g.overlap} bases (k - 1)` : g.linkOverlaps?.length ? ', where reads overlap from one into the next' : ''}</dd>
                <dt>Components</dt><dd>{nf.format(stats.components)}</dd>
                <dt>Dead ends</dt><dd>{nf.format(stats.deadEnds)}</dd>
              </dl>
            )}
            <p className="aw-note">Click a segment for its details and sequence. Drag to move, wheel to zoom.</p>
            <ul className="gp-help">
              <li><strong>A circle</strong> is a replicon assembled whole: a plasmid, or a small chromosome.</li>
              <li><strong>A short piece several segments lead into</strong>, at twice the usual coverage or more, is a repeat; the contigs end at it because the reads cannot say which way through it goes.</li>
              <li><strong>A dead end</strong> is where coverage ran out, or a linear molecule (an amplicon) ends.</li>
              <li><strong>Twice the coverage on a whole circle</strong> is a plasmid at more copies per cell.</li>
            </ul>
            {assembly.denovo?.polished && <p className="aw-note">This is the graph from before the contigs were polished outside SeqNexus.</p>}
          </>
        )}
      </aside>
    </div>
  )
}
