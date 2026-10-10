/**
 * Reads mapped to a reference, as a browsable view: coverage, the
 * reference's bases and the reads themselves, from a whole genome down to
 * single bases (see mappingPaint.ts for what each zoom shows).
 *
 * The view reads the stored mapping a stretch at a time (ngs/view.ts): the
 * pages around what is on screen are loaded when the reads can be drawn,
 * laid out in rows, downsampled where reads pile up, and counted into a
 * pileup for the coverage track. Zoomed out further it shows the stored
 * coverage summaries alone.
 *
 * The side panel holds the display settings, the colour legend, the
 * fragment lengths of the pairs (drag across them to show only pairs of
 * those lengths) and the selected read with its mate.
 *
 * Variants (ngs/calls.ts) are found once, in the background, and kept with
 * the mapping; they show as a track under the coverage and in a table
 * docked under the reads, the two linked (VariantTable.tsx).
 */

import './MappingViewer.css'
import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  ArrowDownUp, ChevronDown, ClipboardCopy, Crosshair, Diff, Image as ImageIcon, Scissors, Maximize2, Minus, PanelRightClose, PanelRightOpen, Plus, Search, X,
} from 'lucide-react'
import { useEditorStore } from '../../store'
import { notify } from '../../toast'
import { downloadText } from '../../utils/download'
import { startCallVariants } from '../../workers/readset'
import { siteVariants, technologyOfPreset, variantPresetOf, type SiteCall } from '../../ngs/calls'
import { mappedFeatures, variantAnnotations } from '../../assembly/features'
import {
  VARIANT_PRESETS, variantFilters, variantKey, variantsCsv, type Variant, type VariantPreset, type VariantSettings,
} from '../../assembly/variants'
import { writeVcf } from '../../assembly/vcf'
import VariantTable, { VariantCard, type CallState } from './VariantTable'
import ConsensusDialog from './ConsensusDialog'
import MappingFigureDialog from './MappingFigureDialog'
import JunctionTable from './JunctionTable'
import { takeReveal } from './reveal'
import { startFindJunctions } from '../../workers/readset'
import { junctionAnnotations, type Junction } from '../../ngs/junctions'
import type { AnnotationData } from '../../models/Annotation'
import { createSignal, useSignal, type Signal } from '../alignment/signal'
import { withAlpha } from '../sanger/paint'
import ContextMenuPopup, { MenuItem, MenuSeparator } from '../ContextMenuPopup'
import HoverCard from '../HoverCard'
import Minimap from '../minimap/Minimap'
import { createViewportSource } from '../minimap/viewport'
import { markerTrack } from '../minimap/tracks/markers'
import type { MinimapTrack } from '../minimap/types'
import { copyText } from '../../utils/clipboard'
import { getReadChunk } from '../../storage/idb'
import type { NgsMapping } from '../../assembly/container'
import { sequenceOf, type CoverageLevel } from '../../ngs/alignments'
import type { PileupSite } from '../../ngs/pileup'
import {
  baseAt, DEFAULT_DOWNSAMPLE, editDistance, expectedInsert, fragmentLength, layoutReads, MappingSource, MAX_ROWS,
  pairClass, queryLength, READ_LOAD_LIMIT, READ_SPAN_LIMIT, readDiff, SORT_LABEL, sortRows, windowPileup,
  type PairClass, type ReadLayout, type SortBy, type ViewRead, type WindowPileup,
} from '../../ngs/view'
import { HistogramChart } from './charts'
import MappingCanvas, { type MapHover, type MappingCanvasHandle } from './MappingCanvas'
import {
  ALLELE_FRACTION, clampScale, depthOver, layFeatures, LETTER_PX, mapGeometry, MAX_PX_PER_BASE, MAPQ_LABEL, PAIR_LABEL, readColors,
  type BaseMode, type ColorBy, type MapqClass, type CompareTo, type MapOptions, type MapPaintInput, type MapScale, type RowMode,
} from './mappingPaint'
import { readAlnTheme, useThemeVersion } from '../alignment/theme'
import { drawCaption } from '../minimap/theme'
import { reverseComplement } from '../../models/complement'

const nf = new Intl.NumberFormat()

interface Display {
  colorBy: ColorBy
  rowMode: RowMode
  softClips: boolean
  strands: boolean
  downsample: boolean
  minMapq: number
  lowOn: boolean
  lowCoverage: number
  bases: BaseMode
  compareTo: CompareTo
  baseQuality: boolean
  consensus: boolean
  features: boolean
}

/** Where each mapping was left, for coming back to it in this session. */
const memory = new Map<string, {
  ref: number
  scale: MapScale
  display: Display
  panel: boolean
  variants: { open: boolean; settings: VariantSettings; preset: VariantPreset | 'custom' }
}>()

interface RefData {
  ref: number
  bases: string
  coverage: Uint32Array | null
  levels: CoverageLevel[]
  sites: PileupSite[]
}

interface Loaded {
  ref: number
  from: number
  to: number
  reads: ViewRead[]
  pileup: WindowPileup
  /** Bases kept between reads in a row, from the zoom when loaded. */
  gap: number
}

type ReadState = 'zoom' | 'loading' | 'reads' | 'many' | 'error'

/** Keys a read can be found again by after a reload. */
interface ReadKey { name: string; flag: number; start: number }
const keyOf = (r: ViewRead): ReadKey => ({ name: r.a.name, flag: r.a.flag, start: r.a.start })

/** Per-base coverage is loaded for references up to this long (four bytes a base). */
const COVERAGE_LIMIT = 50_000_000

interface Props {
  ngs: NgsMapping
  /** The assembly holding the mapping, to come back to after annotating the reference. */
  assemblyId: string
  /** Its name, for exported files and consensus sequences. */
  name: string
  refIndex: number
  onRefIndex: (i: number) => void
}

export default function MappingViewer({ ngs, assemblyId, name, refIndex, onRefIndex }: Props) {
  const report = ngs.report
  const refs = report.references
  const ref = Math.min(refIndex, refs.length - 1)
  const R = refs[ref]
  const paired = report.properlyPaired !== null
  const saved = memory.get(ngs.storageId)
  const [display, setDisplay] = useState<Display>(() => ({
    colorBy: paired ? 'pair' : 'strand', rowMode: 'expanded', softClips: false, strands: false,
    downsample: true, minMapq: 0, lowOn: false, lowCoverage: 10,
    bases: 'disagree', compareTo: 'reference', baseQuality: false, consensus: true, features: true,
    ...saved?.display,
  }))
  const [panel, setPanel] = useState(saved?.panel ?? true)
  const technology = technologyOfPreset(report.preset)
  const [vstate, setVstate] = useState(() => saved?.variants ?? {
    open: false, settings: VARIANT_PRESETS[variantPresetOf(technology)], preset: variantPresetOf(technology) as VariantPreset | 'custom',
  })
  const source = useMemo(() => new MappingSource({ get: getReadChunk }, ngs.storageId, refs), [ngs.storageId]) // eslint-disable-line react-hooks/exhaustive-deps
  // Opened from the samples page at a position: there, close enough to read the bases.
  const [reveal] = useState(() => takeReveal(ngs.storageId))
  const scale = useMemo(() => createSignal<MapScale>(reveal
    ? { start: reveal.pos - 60, bpPerPx: 0.12 }
    : saved && saved.ref === ref ? saved.scale : { start: 0, bpPerPx: Infinity }), []) // eslint-disable-line react-hooks/exhaustive-deps
  const hover = useMemo(() => createSignal<MapHover | null>(null, (a, b) => a?.read === b?.read && Math.floor(a?.pos ?? -1) === Math.floor(b?.pos ?? -1) && a?.clientX === b?.clientX && a?.clientY === b?.clientY), [])
  const viewport = useMemo(() => createViewportSource(), [])
  // The view spans (nearly) the whole reference: the overview would only repeat its coverage.
  const [whole, setWhole] = useState(false)
  const canvasRef = useRef<MappingCanvasHandle>(null)
  const [plotW, setPlotW] = useState(0)

  // ---- The reference's data ----
  const [refData, setRefData] = useState<RefData | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    setRefData(null)
    setError(null)
    Promise.all([
      source.reference(ref),
      R.length <= COVERAGE_LIMIT ? source.coverage(ref) : Promise.resolve(null),
      source.summaries(ref),
      source.sites(ref),
    ]).then(([bases, coverage, levels, sites]) => {
      if (alive) setRefData({ ref, bases, coverage, levels, sites })
    }).catch(err => { if (alive) setError(err instanceof Error ? err.message : String(err)) })
    return () => { alive = false }
  }, [source, ref, R.length])

  // ---- Reads over the view ----
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [readState, setReadState] = useState<ReadState>('zoom')
  const loadedRef = useRef(loaded)
  loadedRef.current = loaded
  const token = useRef(0)
  const timer = useRef(0)
  useEffect(() => {
    if (!refData || plotW <= 0) return
    const check = () => {
      const s = scale.get()
      const v0 = Math.max(0, s.start)
      const v1 = Math.min(R.length, s.start + plotW * s.bpPerPx)
      viewport.set({ start: v0, end: v1 })
      setWhole(v1 - v0 >= R.length * 0.9)
      const span = v1 - v0
      window.clearTimeout(timer.current)
      if (span > READ_SPAN_LIMIT) { token.current++; setReadState('zoom'); return }
      const cur = loadedRef.current
      if (cur && cur.ref === ref && cur.from <= v0 && cur.to >= v1) { setReadState('reads'); return }
      setReadState(st => (st === 'reads' && cur?.ref === ref ? 'reads' : 'loading'))
      timer.current = window.setTimeout(async () => {
        const t = ++token.current
        try {
          let w0 = Math.max(0, Math.floor(v0 - span))
          let w1 = Math.min(R.length, Math.ceil(v1 + span))
          if (await source.countIn(ref, w0, w1) > READ_LOAD_LIMIT) {
            w0 = Math.floor(v0)
            w1 = Math.ceil(v1)
            if (await source.countIn(ref, w0, w1) > READ_LOAD_LIMIT) { if (t === token.current) setReadState('many'); return }
          }
          const reads = await source.load(ref, w0, w1)
          if (t !== token.current) return
          const pileup = windowPileup(reads, { bases: refData.bases, circular: R.circular }, w0, w1)
          setLoaded({ ref, from: w0, to: w1, reads, pileup, gap: Math.max(2, Math.ceil(3 * scale.get().bpPerPx)) })
          setReadState('reads')
        } catch (err) {
          if (t === token.current) { setReadState('error'); setError(err instanceof Error ? err.message : String(err)) }
        }
      }, cur ? 120 : 0)
    }
    check()
    const off = scale.subscribe(check)
    return () => { off(); window.clearTimeout(timer.current) }
  }, [refData, plotW, scale, source, ref, R.length, R.circular, viewport])

  // Remember where the view was.
  useEffect(() => {
    const save = () => memory.set(ngs.storageId, { ref, scale: scale.get(), display, panel, variants: vstate })
    save()
    return scale.subscribe(save)
  }, [ngs.storageId, ref, scale, display, panel, vstate])

  // ---- Variants ----
  const [call, setCall] = useState<CallState>({ kind: 'none' })
  const [calls, setCalls] = useState<{ ref: number; list: SiteCall[] } | null>(null)
  const [callsVersion, setCallsVersion] = useState(0)
  useEffect(() => {
    let alive = true
    source.calls(ref).then(list => {
      if (!alive) return
      if (list) { setCalls({ ref, list }); setCall({ kind: 'ready' }) } else { setCalls(null); setCall(c => (c.kind === 'running' ? c : { kind: 'none' })) }
    }).catch(err => { if (alive) setCall({ kind: 'error', message: err instanceof Error ? err.message : String(err) }) })
    return () => { alive = false }
  }, [source, ref, callsVersion])
  const runCalls = useCallback(() => {
    setCall({ kind: 'running', progress: 0 })
    const h = startCallVariants({ type: 'call-variants', storageId: ngs.storageId, references: refs.map(r => ({ name: r.name, length: r.length, circular: r.circular })) },
      (d, t) => setCall({ kind: 'running', progress: t ? d / t : 0 }))
    h.promise.then(() => { source.forgetCalls(); setCallsVersion(v => v + 1) })
      .catch(err => setCall({ kind: 'error', message: err instanceof Error ? err.message : String(err) }))
  }, [ngs.storageId, refs, source])
  // The reference's features, when its sequence is open and still the length mapped to.
  const tabs = useEditorStore(st => st.tabs)
  const refTabOf = useCallback((i: number) => {
    const t = refs[i].tabId ? tabs.find(x => x.id === refs[i].tabId) : undefined
    return t && t.doc.sequence.length === refs[i].length ? t : undefined
  }, [tabs, refs])
  const refTab = refTabOf(ref)
  // With the sequence closed, the copy of its features the mapping kept.
  const features = useMemo(() => mappedFeatures(refs[ref], refTab ? [refTab] : []), [refs, ref, refTab])
  const variants = useMemo(() => (calls && calls.ref === ref && refData?.ref === ref ? siteVariants(calls.list, refData.bases, features, technology, refs[ref].circular) : []),
    [calls, ref, refData, features, technology, refs])
  const passing = useMemo(() => variants.filter(v => variantFilters(v, vstate.settings).length === 0).sort((a, b) => a.c0 - b.c0), [variants, vstate.settings])
  const [selVariant, setSelVariant] = useState<string | null>(null)
  const [consensusOpen, setConsensusOpen] = useState(false)
  const [figure, setFigure] = useState<{ view: [number, number] } | null>(null)

  // ---- Junctions ----
  const [juncOpen, setJuncOpen] = useState(false)
  const [junc, setJunc] = useState<{ ref: number; list: Junction[] } | null>(null)
  const [juncState, setJuncState] = useState<CallState>({ kind: 'none' })
  const [juncVersion, setJuncVersion] = useState(0)
  const [selJunction, setSelJunction] = useState<number | null>(null)
  useEffect(() => {
    if (!juncOpen) return
    let alive = true
    source.junctions(ref).then(list => {
      if (!alive) return
      if (list) { setJunc({ ref, list }); setJuncState({ kind: 'ready' }) } else setJuncState(st => (st.kind === 'running' ? st : { kind: 'none' }))
    }).catch(err => { if (alive) setJuncState({ kind: 'error', message: err instanceof Error ? err.message : String(err) }) })
    return () => { alive = false }
  }, [juncOpen, source, ref, juncVersion])
  const findJunctionsNow = useCallback(() => {
    setJuncState({ kind: 'running', progress: 0 })
    startFindJunctions({ type: 'find-junctions', storageId: ngs.storageId, references: refs.map(r => ({ name: r.name, length: r.length, circular: r.circular })) },
      (d, t) => setJuncState({ kind: 'running', progress: t ? d / t : 0 }))
      .promise.then(() => setJuncVersion(v => v + 1))
      .catch(err => setJuncState({ kind: 'error', message: err instanceof Error ? err.message : String(err) }))
  }, [ngs.storageId, refs])


  // ---- Layout ----
  const [sort, setSort] = useState<{ pos: number; by: SortBy } | null>(null)
  const layout = useMemo((): ReadLayout | null => {
    if (!loaded || loaded.ref !== ref) return null
    return layoutReads(loaded.reads, {
      softClips: display.softClips,
      downsample: display.downsample ? DEFAULT_DOWNSAMPLE : null,
      minMapq: display.minMapq,
      gap: loaded.gap,
      maxRows: MAX_ROWS,
    })
  }, [loaded, ref, display.softClips, display.downsample, display.minMapq])
  // A sort holds while its position is in the loaded stretch; moving far enough away to load another one ends it.
  useEffect(() => {
    if (sort && loaded && (loaded.ref !== ref || sort.pos < loaded.from || sort.pos >= loaded.to)) setSort(null)
  }, [loaded, sort, ref])
  const sorted = useMemo(() => {
    if (!layout) return null
    if (sort && refData && loaded && sort.pos >= loaded.from && sort.pos < loaded.to) {
      return sortRows(layout, sort.pos, sort.by, { bases: refData.bases, circular: R.circular }, ref)
    }
    layout.rows.forEach((row, i) => { for (const r of row) r.row = i })
    return layout
  }, [layout, sort, refData, loaded, R.circular, ref])
  const shownLayout = readState === 'reads' || readState === 'loading' ? sorted : null

  // ---- Selection ----
  const [selKey, setSelKey] = useState<ReadKey | null>(null)
  const selected = useMemo(() => {
    if (!selKey || !loaded) return null
    let best: ViewRead | null = null
    for (const r of loaded.reads) {
      if (r.a.name !== selKey.name || r.a.flag !== selKey.flag || r.a.start !== selKey.start) continue
      // Of the two copies of a read across the origin, the one on screen.
      if (!best || (best.row < 0 && r.row >= 0)) best = r
    }
    return best
  }, [selKey, loaded, sorted]) // eslint-disable-line react-hooks/exhaustive-deps
  const partners = useMemo(() => (selected && loaded
    ? loaded.reads.filter(r => r.a !== selected.a && r.a.name === selected.a.name && r.row >= 0)
    : []), [selected, loaded, sorted]) // eslint-disable-line react-hooks/exhaustive-deps
  const pendingMate = useRef<{ name: string; second: boolean } | null>(null)
  useEffect(() => {
    const want = pendingMate.current
    if (!want || !loaded) return
    const mate = loaded.reads.find(r => r.a.name === want.name && !(r.a.flag & 0x800) && ((r.a.flag & 0x80) !== 0) === want.second)
    if (mate) {
      pendingMate.current = null
      setSelKey(keyOf(mate))
    }
  }, [loaded])
  useEffect(() => { if (selected && selected.row >= 0) canvasRef.current?.revealRow(selected.row) }, [selected])

  // ---- Paint input ----
  const expected = useMemo(() => expectedInsert(report.insertSizes), [report.insertSizes])
  const [brush, setBrush] = useState<[number, number] | null>(null)
  const opts: MapOptions = useMemo(() => ({
    colorBy: display.colorBy, softClips: display.softClips, strands: display.strands,
    lowCoverage: display.lowOn ? display.lowCoverage : 0, brush, expected,
    bases: display.bases, compareTo: display.compareTo, baseQuality: display.baseQuality,
  }), [display, brush, expected])
  // Only whether bases are drawn as letters changes the layout; the rest of the scale is read by the canvas.
  const letters = useSyncExternalStore(scale.subscribe, () => 1 / scale.get().bpPerPx >= LETTER_PX)
  const showVariants = call.kind === 'ready'
  const showConsensus = display.consensus && loaded !== null
  const laidFeatures = useMemo(() => (display.features ? layFeatures(features, R.length) : { laid: [], lanes: 0 }),
    [display.features, features, R.length])
  const geo = useMemo(() => mapGeometry(display.rowMode, letters ? LETTER_PX : 1, showVariants, showConsensus, laidFeatures.lanes),
    [display.rowMode, letters, showVariants, showConsensus, laidFeatures.lanes])
  const input: MapPaintInput = useMemo(() => ({
    geo, refIndex: ref, refName: R.name, length: R.length, circular: R.circular,
    bases: refData?.ref === ref ? refData.bases : null,
    coverage: refData?.ref === ref ? refData.coverage : null,
    levels: refData?.ref === ref ? refData.levels : null,
    sites: refData?.ref === ref ? refData.sites : null,
    pileup: loaded?.ref === ref && shownLayout ? loaded.pileup : null,
    layout: shownLayout,
    opts,
    variants: showVariants ? passing : null,
    selectedVariant: selVariant,
    features: laidFeatures.laid,
  }), [geo, ref, R, refData, loaded, shownLayout, opts, showVariants, passing, selVariant, laidFeatures])

  // ---- Navigation ----
  const changeRef = useCallback((i: number, center?: number) => {
    if (i === ref) { if (center !== undefined) canvasRef.current?.centerOn(center); return }
    const L = refs[i].length
    const span = Math.min(L, plotW * Math.max(1 / MAX_PX_PER_BASE, Math.min(scale.get().bpPerPx, L / Math.max(1, plotW))))
    const start = center !== undefined ? center - span / 2 : 0
    scale.set(clampScale({ start, bpPerPx: center !== undefined ? scale.get().bpPerPx : Infinity }, L, plotW))
    setLoaded(null)
    setSort(null)
    onRefIndex(i)
  }, [ref, refs, plotW, scale, onRefIndex])

  const goToMate = useCallback((r: ViewRead) => {
    const a = r.a
    if (!(a.flag & 0x1) || a.flag & 0x8 || a.mateRef < 0 || a.matePos < 0) return
    const second = !(a.flag & 0x80)
    const here = a.mateRef === ref ? loadedRef.current?.reads.find(x => x.a.name === a.name && !(x.a.flag & 0x800) && ((x.a.flag & 0x80) !== 0) === second) : undefined
    if (here) {
      setSelKey(keyOf(here))
      canvasRef.current?.centerOn((here.start + here.end) / 2)
      return
    }
    pendingMate.current = { name: a.name, second }
    changeRef(a.mateRef, a.matePos + 75)
  }, [changeRef, ref])

  const [menu, setMenu] = useState<{ x: number; y: number; pos: number; read: ViewRead | null } | null>(null)
  const sortAt = (pos: number, by: SortBy) => setSort({ pos, by })
  const centre = () => {
    const s = scale.get()
    return Math.floor(s.start + (plotW * s.bpPerPx) / 2)
  }
  const [sortMenu, setSortMenu] = useState(false)
  const sortMenuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!sortMenu) return
    const close = (e: MouseEvent) => { if (!sortMenuRef.current?.contains(e.target as Node)) setSortMenu(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [sortMenu])

  const refBases = refData?.ref === ref ? { bases: refData.bases, circular: R.circular } : null
  const copyRead = (r: ViewRead, fastq: boolean) => {
    if (!refBases) return
    const a = r.a
    const sam = sequenceOf(refBases, a)
    if (sam === '*') { copyText(`>${a.name}\n`, 'Copied the read name; its bases were not stored'); return }
    const rev = (a.flag & 0x10) !== 0
    const seq = rev ? reverseComplement(sam) : sam
    const qual = rev ? [...a.qual].reverse().join('') : a.qual
    copyText(fastq && qual ? `@${a.name}\n${seq}\n+\n${qual}\n` : `>${a.name}\n${seq}\n`, fastq ? 'Copied the read as FASTQ' : 'Copied the read as FASTA')
  }

  // ---- Variant actions ----
  const gotoVariant = useCallback((v: Variant) => {
    setSelVariant(variantKey(v))
    const mid = (v.c0 + v.c1) / 2
    const s = scale.get()
    const span = plotW * s.bpPerPx
    // Close enough to see the bases, unless already closer.
    if (span > 120) canvasRef.current?.goTo(mid - 60, mid + 60)
    else canvasRef.current?.centerOn(mid)
  }, [scale, plotW])
  // Only which variant is pointed at, so pointer moves elsewhere do not re-render the view.
  const litVariant = useSyncExternalStore(hover.subscribe, () => { const v = hover.get()?.variant; return v ? variantKey(v) : null })

  /** Add features to the reference: to its open sequence, or to a copy opened from the mapping's. */
  const addToReference = (notes: AnnotationData[], what: string) => {
    if (!notes.length || !refData) return
    const store = useEditorStore.getState()
    if (refTab) {
      if (refTab.readOnly) { notify.info(`${refTab.doc.name} is read-only; unlock it to annotate`); return }
      store.setActiveTab(refTab.id)
      store.addAnnotations(notes)
    } else {
      store.openDocument(R.name, refData.bases, R.circular ? 'circular' : 'linear', `Reference of ${name}, with its ${what}`)
      useEditorStore.getState().addAnnotations(notes)
    }
    const tabId = useEditorStore.getState().activeTabId
    useEditorStore.getState().setActiveAssembly(assemblyId)
    notify.success(`Added ${notes.length} ${what} to ${refTab?.doc.name ?? R.name} as features`,
      { action: { label: 'Show', onClick: () => { if (tabId) useEditorStore.getState().setActiveTab(tabId) } } })
  }
  const annotate = (list: Variant[]) => addToReference(variantAnnotations(list, R.length), list.length === 1 ? 'variant' : 'variants')

  const fileStem = name.replace(/[\\/:*?"<>|\s]+/g, '_')
  const exportVariants = async (format: 'vcf' | 'vcf-all' | 'csv') => {
    try {
      if (format === 'csv') {
        downloadText(variantsCsv(passing), `${fileStem}_${R.name.replace(/\s+/g, '_')}_variants.csv`, 'text/csv')
        return
      }
      const all = format === 'vcf-all'
      const references = await Promise.all(refs.map(async (r, i) => {
        const [bases, list] = await Promise.all([source.reference(i), source.calls(i)])
        const vs = list ? siteVariants(list, bases, mappedFeatures(r, tabs), technology, r.circular) : []
        return {
          name: r.name, bases,
          variants: vs.map(v => ({ v, filters: variantFilters(v, vstate.settings) })).filter(x => all || x.filters.length === 0),
        }
      }))
      downloadText(writeVcf({ references, source: ngs.readSetName, referenceName: refs.map(r => r.name).join(', ') }),
        `${fileStem}${all ? '_candidates' : ''}.vcf`, 'text/plain')
      const n = references.reduce((k, r) => k + r.variants.length, 0)
      notify.success(`Exported ${n} ${n === 1 ? 'variant' : 'variants'} as VCF`)
    } catch (err) {
      notify.error('Export failed', { detail: err instanceof Error ? err.message : String(err) })
    }
  }

  const marks = useMemo(() => ({ selected, partners, sortPos: sort && shownLayout ? sort.pos : null }), [selected, partners, sort, shownLayout])
  const fileReady = !error && refData?.ref === ref

  // ---- Minimap ----
  const tracks = useMemo((): MinimapTrack[] => {
    if (!refData || refData.ref !== ref) return []
    const sites = refData.sites.filter(s => {
      const rb = 'ACGT'.indexOf(refData.bases[s.pos])
      const refN = rb >= 0 ? s.counts[rb * 2] + s.counts[rb * 2 + 1] : 0
      return s.depth > 0 && (s.depth - refN) / s.depth >= ALLELE_FRACTION
    }).map(s => s.pos)
    return [coverageTrack(refData), markerTrack('mapping-sites', [{ label: 'Site where 20% of reads or more differ', positions: sites, color: t => t.warning }])]
  }, [refData, ref])

  const counts = useMemo(() => {
    if (!loaded || display.colorBy !== 'pair') return null
    const out: Partial<Record<PairClass, number>> = {}
    for (const r of loaded.reads) {
      if (r.shift !== 0 || r.a.mapq < display.minMapq) continue
      const c = pairClass(r.a, ref, R.length, R.circular, expected)
      out[c] = (out[c] ?? 0) + 1
    }
    return out
  }, [loaded, display.colorBy, display.minMapq, ref, R, expected])

  const brushed = useMemo(() => {
    if (!brush || !loaded) return null
    let n = 0
    for (const r of loaded.reads) {
      if (r.shift !== 0 || !(r.a.flag & 0x40)) continue
      const t = fragmentLength(r.a, ref, R.length, R.circular)
      if (t !== null && t >= brush[0] && t <= brush[1]) n++
    }
    return n
  }, [brush, loaded, ref, R])

  return (
    <div className="mv">
      <div className="aw-toolbar mv-toolbar">
        {refs.length > 1 && (
          <select className="select aw-select" value={ref} aria-label="Reference" onChange={e => changeRef(Number(e.target.value))}>
            {refs.map((x, i) => <option key={i} value={i}>{x.name}</option>)}
          </select>
        )}
        <LocusBox scale={scale} plotW={plotW} length={R.length} onGo={(a, b) => canvasRef.current?.goTo(a, b)} />
        <span className="aw-tool-sep" />
        <label className="aw-tool-label" htmlFor={`mv-color-${ngs.storageId}`}>Colour</label>
        <select id={`mv-color-${ngs.storageId}`} className="select aw-select" value={display.colorBy}
          onChange={e => setDisplay(d => ({ ...d, colorBy: e.target.value as ColorBy }))}>
          <option value="none">One colour</option>
          <option value="strand">By strand</option>
          {paired && <option value="pair">By pair (distance and orientation)</option>}
          <option value="mapq">By mapping quality</option>
        </select>
        <div className="aw-export" ref={sortMenuRef}>
          <button className={`aw-tool-btn ${sort ? 'active' : ''}`} onClick={() => setSortMenu(o => !o)} aria-expanded={sortMenu}
            disabled={!shownLayout} title="Sort the rows by their reads at the centre of the view">
            <ArrowDownUp size={13} /> {sort ? `Sorted by ${SORT_LABEL[sort.by].toLowerCase()}` : 'Sort'} <ChevronDown size={12} />
          </button>
          {sortMenu && (
            <div className="aw-menu" role="menu">
              {(Object.keys(SORT_LABEL) as SortBy[]).filter(b => b !== 'insert' || paired).map(b => (
                <button key={b} role="menuitem" className="aw-menu-item" onClick={() => { sortAt(centre(), b); setSortMenu(false) }}>
                  <span className="aw-menu-label">{SORT_LABEL[b]} at the centre</span>
                </button>
              ))}
              {sort && (
                <>
                  <div className="aw-menu-sep" />
                  <button role="menuitem" className="aw-menu-item" onClick={() => { setSort(null); setSortMenu(false) }}>
                    <span className="aw-menu-label">Unsorted</span>
                  </button>
                </>
              )}
            </div>
          )}
        </div>
        <span className="aw-tool-sep" />
        <button className={`aw-tool-btn ${vstate.open ? 'active' : ''}`} aria-pressed={vstate.open}
          onClick={() => setVstate(v => ({ ...v, open: !v.open }))} title="The variants: a table under the reads, linked to them">
          <Diff size={13} /> Variants{showVariants ? ` (${nf.format(passing.length)})` : ''}
        </button>
        <button className={`aw-tool-btn ${juncOpen ? 'active' : ''}`} aria-pressed={juncOpen}
          onClick={() => setJuncOpen(o => !o)} title="Positions where many reads stop aligning together: long deletions, inversions, inserted DNA">
          <Scissors size={13} /> Junctions{junc && junc.ref === ref ? ` (${nf.format(junc.list.length)})` : ''}
        </button>
        <span className="aw-spacer" />
        <button className="aw-tool-btn" onClick={() => {
          const s0 = scale.get()
          setFigure({ view: [Math.max(0, s0.start), Math.min(R.length, s0.start + plotW * s0.bpPerPx)] })
        }} disabled={!refData} title="Export this stretch as a figure: SVG, PNG or PDF">
          <ImageIcon size={13} /> Figure
        </button>
        <ZoomControls scale={scale} plotW={plotW} length={R.length} canvas={canvasRef} />
        <button className="aw-icon-btn" onClick={() => setPanel(o => !o)} title={panel ? 'Hide the side panel' : 'Show the side panel'} aria-label={panel ? 'Hide the side panel' : 'Show the side panel'}>
          {panel ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
        </button>
      </div>

      <div className="aw-body-row">
        <div className="aw-main">
          {fileReady && (
            <div className="aw-minimap">
              <Minimap kind="mapping" length={R.length} tracks={tracks} viewport={viewport} folded={whole}
                onNavigate={start => {
                  const s = scale.get()
                  scale.set(clampScale({ start, bpPerPx: s.bpPerPx }, R.length, plotW))
                }}
                positionLabel="Position" ariaLabel={`Coverage along ${R.name}`} />
            </div>
          )}
          <ViewNote state={readState} layout={shownLayout} error={error} onShowAll={() => setDisplay(d => ({ ...d, downsample: false }))}
            onZoomIn={() => {
              const s = scale.get()
              const c = s.start + (plotW * s.bpPerPx) / 2
              canvasRef.current?.goTo(c - READ_SPAN_LIMIT / 4, c + READ_SPAN_LIMIT / 4)
            }} />
          {error && !refData ? (
            <div className="mv-empty">
              <p className="aw-note">{error}. Run the mapping again to store it in full.</p>
            </div>
          ) : (
            <MappingCanvas
              ref={canvasRef}
              input={input}
              scale={scale}
              hover={hover}
              marks={marks}
              onPlotWidth={setPlotW}
              onSelectRead={r => setSelKey(r ? keyOf(r) : null)}
              onSelectVariant={v => gotoVariant(v)}
              onContextMenu={setMenu}
            />
          )}
          {vstate.open && (
            <VariantTable
              variants={variants}
              settings={vstate.settings}
              preset={vstate.preset}
              onSettings={(settings, preset) => setVstate(v => ({ ...v, settings, preset }))}
              selected={selVariant}
              lit={litVariant}
              onSelect={gotoVariant}
              call={call}
              onCall={runCalls}
              canAnnotate={fileReady}
              annotateTitle={refTab
                ? `Add a "variation" feature for each variant listed to ${refTab.doc.name}`
                : `${R.name} is not open: opens it from the copy kept with the mapping, with a feature for each variant listed`}
              onAnnotate={annotate}
              onExport={exportVariants}
              onConsensus={() => setConsensusOpen(true)}
              onClose={() => setVstate(v => ({ ...v, open: false }))}
              refName={R.name}
            />
          )}
          {juncOpen && (
            <JunctionTable
              junctions={junc && junc.ref === ref ? junc.list : null}
              state={juncState}
              onFind={findJunctionsNow}
              selected={selJunction}
              onSelect={j => {
                setSelJunction(junc?.list.indexOf(j) ?? null)
                // The clipped bases are what a junction is about.
                setDisplay(d => (d.softClips ? d : { ...d, softClips: true }))
                canvasRef.current?.goTo(j.pos - 60, j.pos + 60)
              }}
              refIndex={ref}
              refNames={refs.map(r => r.name)}
              canAnnotate={fileReady}
              annotateTitle={refTab
                ? `Add a "variation" feature for each junction to ${refTab.doc.name}`
                : `${R.name} is not open: opens it from the copy kept with the mapping, with a feature for each junction`}
              onAnnotate={js => addToReference(junctionAnnotations(js, ref, refs.map(r => r.name), R.length), js.length === 1 ? 'junction' : 'junctions')}
              onClose={() => setJuncOpen(false)}
            />
          )}
          <StatusBar hover={hover} input={input} refName={R.name} />
          <TrackVariantHover hover={hover} settings={vstate.settings} />
          <ReadHover hover={hover} refBases={refBases} refIndex={ref} refs={refs} expected={expected} selected={selected} />
        </div>
        {panel && (
          <aside className="aw-inspector mv-side" aria-label="Mapping view settings">
            <div className="aw-inspector-body">
              <div className="aw-panel">
                {selected && (
                  <ReadPanel read={selected} refBases={refBases} refIndex={ref} refs={refs} expected={expected}
                    onMate={() => goToMate(selected)} onCopy={fq => copyRead(selected, fq)} onClose={() => setSelKey(null)}
                    onZoom={() => canvasRef.current?.goTo(selected.x0 - 20, selected.x1 + 20)} />
                )}
                <InView layout={shownLayout} loaded={loaded} state={readState} />
                <div className="aw-section-label">Display</div>
                <div className="aw-seg" role="radiogroup" aria-label="Rows">
                  {(['expanded', 'squished'] as const).map(m => (
                    <button key={m} role="radio" aria-checked={display.rowMode === m} className={display.rowMode === m ? 'active' : ''}
                      onClick={() => setDisplay(d => ({ ...d, rowMode: m }))}
                      title={m === 'expanded' ? 'Rows tall enough for bases' : 'Thin rows, to see more reads at once'}>
                      {m === 'expanded' ? 'Expanded' : 'Squished'}
                    </button>
                  ))}
                </div>
                <div className="mv-inline">
                  <span className="mv-inline-label" title="How the reads' bases are drawn once you zoom in far enough for letters">Bases</span>
                  <select className="select aw-select" value={display.bases} aria-label="How bases are drawn"
                    onChange={e => setDisplay(d => ({ ...d, bases: e.target.value as BaseMode }))}>
                    <option value="disagree">Highlight disagreements</option>
                    <option value="dots">Dots where they agree</option>
                    <option value="all">All in base colours</option>
                    <option value="off">Only differences</option>
                  </select>
                </div>
                {display.bases !== 'off' && (
                  <div className="aw-seg" role="radiogroup" aria-label="Disagreements with">
                    {(['reference', 'consensus'] as const).map(m => (
                      <button key={m} role="radio" aria-checked={display.compareTo === m} className={display.compareTo === m ? 'active' : ''}
                        onClick={() => setDisplay(d => ({ ...d, compareTo: m }))}
                        title={m === 'reference' ? 'Highlight bases that differ from the reference'
                          : 'Highlight bases that differ from the majority of the reads: a variant every read carries fades, minority reads stand out'}>
                        {m === 'reference' ? 'Against reference' : 'Against consensus'}
                      </button>
                    ))}
                  </div>
                )}
                <label className="aw-check small" title="Fade every base by its quality, not only the ones that differ (faint at Q5 and below, full from Q20)">
                  <input type="checkbox" checked={display.baseQuality} onChange={e => setDisplay(d => ({ ...d, baseQuality: e.target.checked }))} />
                  Shade bases by quality
                </label>
                <label className="aw-check small" title="A row under the reference with the majority base of the loaded reads, tinted where it differs from the reference">
                  <input type="checkbox" checked={display.consensus} onChange={e => setDisplay(d => ({ ...d, consensus: e.target.checked }))} />
                  Consensus row
                </label>
                <label className="aw-check small" title={features.length ? 'The reference\'s features above it; coding features show their translation when you zoom in'
                  : 'The reference has no features'}>
                  <input type="checkbox" checked={display.features} disabled={features.length === 0} onChange={e => setDisplay(d => ({ ...d, features: e.target.checked }))} />
                  Features and translation
                </label>
                <label className="aw-check small" title="Draw the bases the aligner left unaligned at a read's ends, faintly">
                  <input type="checkbox" checked={display.softClips} onChange={e => setDisplay(d => ({ ...d, softClips: e.target.checked }))} />
                  Soft-clipped bases
                </label>
                <label className="aw-check small" title={`Draw at most ${DEFAULT_DOWNSAMPLE.max} reads starting in any ${DEFAULT_DOWNSAMPLE.window} bases. Coverage always counts every read.`}>
                  <input type="checkbox" checked={display.downsample} onChange={e => setDisplay(d => ({ ...d, downsample: e.target.checked }))} />
                  Downsample deep stretches
                </label>
                <label className="aw-check small" title="Split each coverage bar into the forward (lower) and reverse (upper) strand">
                  <input type="checkbox" checked={display.strands} onChange={e => setDisplay(d => ({ ...d, strands: e.target.checked }))} />
                  Coverage by strand
                </label>
                <div className="mv-inline">
                  <label className="aw-check small" title="Shade every stretch where fewer reads than this cover the reference">
                    <input type="checkbox" checked={display.lowOn} onChange={e => setDisplay(d => ({ ...d, lowOn: e.target.checked }))} />
                    Shade coverage below
                  </label>
                  <input className="mv-num" type="number" min={1} max={100000} value={display.lowCoverage} aria-label="Lowest coverage"
                    onChange={e => { const v = Math.max(1, Math.round(Number(e.target.value) || 1)); setDisplay(d => ({ ...d, lowCoverage: v, lowOn: true })) }} />
                  <span className="aw-muted">×</span>
                </div>
                <div className="mv-inline">
                  <span className="mv-inline-label" title="Leave out reads placed with less confidence than this (MAPQ 0: the read fits equally well elsewhere)">Mapping quality at least</span>
                  <input className="mv-num" type="number" min={0} max={60} value={display.minMapq} aria-label="Lowest mapping quality"
                    onChange={e => { const v = Math.max(0, Math.min(60, Math.round(Number(e.target.value) || 0))); setDisplay(d => ({ ...d, minMapq: v })) }} />
                </div>
                <Legend colorBy={display.colorBy} counts={counts} />
                {report.insertSizes && report.insertSizes.counts.length > 0 && (
                  <>
                    <div className="aw-section-label">Fragment length</div>
                    <p className="aw-note">
                      {expected ? <>Expected {nf.format(expected[0])} to {nf.format(expected[1])} bp (middle 99% of proper pairs). </> : null}
                      Drag across the bars to show only the pairs of those lengths.
                    </p>
                    <HistogramChart title="Proper pairs" hist={report.insertSizes}
                      binLabel={(lo, hi) => `${nf.format(lo)} to ${nf.format(hi - 1)} bp`} unit="pairs"
                      brush={brush} onBrush={setBrush} />
                    {brush && (
                      <div className="mv-brush">
                        <span>
                          Pairs of {nf.format(brush[0])} {brush[1] === Infinity ? 'bp or longer' : `to ${nf.format(brush[1])} bp`}
                          {brushed !== null && <span className="aw-muted"> · {nf.format(brushed)} loaded here</span>}
                        </span>
                        <button className="aw-icon-btn" onClick={() => setBrush(null)} title="Show every read" aria-label="Clear the fragment length range"><X size={13} /></button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </aside>
        )}
      </div>

      {figure && (
        <MappingFigureDialog
          input={{ ...input, layout: shownLayout, variants: showVariants ? passing : null }}
          view={figure.view}
          loaded={loaded && loaded.ref === ref && shownLayout ? [loaded.from, loaded.to] : null}
          colorBy={display.colorBy}
          strands={display.strands}
          name={`${name}_${R.name}`}
          onClose={() => setFigure(null)}
        />
      )}
      {consensusOpen && (
        <ConsensusDialog source={source} refIndex={ref} name={name} assemblyId={assemblyId} onClose={() => setConsensusOpen(false)} />
      )}
      {menu && (
        <ContextMenuPopup x={menu.x} y={menu.y} onClose={() => setMenu(null)} label="Mapping actions">
          <div onClick={() => setMenu(null)}>
            {menu.read && (
              <>
                <div className="ctx-menu-header">{menu.read.a.name}</div>
                {(menu.read.a.flag & 0x1) !== 0 && (menu.read.a.flag & 0x8) === 0 && (
                  <MenuItem icon={<Crosshair size={13} />} onSelect={() => goToMate(menu.read!)}>Go to the mate</MenuItem>
                )}
                <MenuItem icon={<Search size={13} />} onSelect={() => { setSelKey(keyOf(menu.read!)); canvasRef.current?.goTo(menu.read!.x0 - 20, menu.read!.x1 + 20) }}>Zoom to the read</MenuItem>
                <MenuItem icon={<ClipboardCopy size={13} />} onSelect={() => copyRead(menu.read!, false)}>Copy the read as FASTA</MenuItem>
                <MenuItem icon={<ClipboardCopy size={13} />} onSelect={() => copyRead(menu.read!, true)}>Copy the read as FASTQ</MenuItem>
                <MenuItem icon={<ClipboardCopy size={13} />} onSelect={() => copyText(menu.read!.a.name, 'Copied the read name')}>Copy the name</MenuItem>
                <MenuSeparator />
              </>
            )}
            <div className="ctx-menu-header">Sort the rows at {nf.format(menu.pos + 1)} by</div>
            {(Object.keys(SORT_LABEL) as SortBy[]).filter(b => b !== 'insert' || paired).map(b => (
              <MenuItem key={b} icon={<ArrowDownUp size={13} />} onSelect={() => sortAt(menu.pos, b)} disabled={!shownLayout}>{SORT_LABEL[b]}</MenuItem>
            ))}
            {sort && <MenuItem onSelect={() => setSort(null)}>Unsorted</MenuItem>}
          </div>
        </ContextMenuPopup>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

/** Coverage along the whole reference for the minimap, from the summaries (or per base on a short one). */
function coverageTrack(d: RefData): MinimapTrack {
  const L = d.bases.length
  const at = (b0: number, b1: number) => depthOver({ coverage: d.coverage, levels: d.levels, pileup: null }, b0, b1, Math.max(1, b1 - b0))
  let peak = 1
  for (const l of d.levels) for (let k = 0; k < l.mean.length; k++) if (l.mean[k] > peak) peak = l.mean[k]
  if (d.coverage && L <= 100_000) for (let k = 0; k < L; k++) if (d.coverage[k] > peak) peak = d.coverage[k]
  return {
    id: 'mapping-coverage',
    height: 22,
    draw(ctx, a, theme) {
      const w = Math.max(1, Math.round(a.w))
      ctx.fillStyle = theme.good
      for (let x = 0; x < w; x++) {
        const b0 = (x / w) * L
        const v = at(b0, b0 + L / w).mean
        const h = Math.min(1, v / peak) * a.h
        ctx.fillStyle = v === 0 ? theme.bad : theme.good
        ctx.fillRect(a.x + (x / w) * a.w, a.y + a.h - Math.max(v === 0 ? 2 : 0, h), Math.max(1, a.w / w + 0.25), Math.max(v === 0 ? 2 : 0, h))
      }
      drawCaption(ctx, theme, 'Coverage', a.x + 2, a.y + 1)
    },
    hit(pos, _y, unitsPerPx) {
      const d0 = at(Math.max(0, pos - unitsPerPx / 2), Math.min(L, pos + unitsPerPx / 2 + 1))
      return { label: `${d0.mean.toFixed(1)}× mean depth`, detail: unitsPerPx > 1.5 ? `around position ${nf.format(Math.round(pos) + 1)}` : `position ${nf.format(Math.round(pos) + 1)}` }
    },
  }
}

/** The visible range as text, and a box to type a position or range into. */
function LocusBox({ scale, plotW, length, onGo }: { scale: Signal<MapScale>; plotW: number; length: number; onGo: (start: number, end: number) => void }) {
  const s = useSignal(scale)
  const [draft, setDraft] = useState<string | null>(null)
  const a = Math.max(0, Math.floor(s.start))
  const b = Number.isFinite(s.bpPerPx) && plotW > 1 ? Math.min(length, Math.ceil(s.start + plotW * s.bpPerPx)) : length
  const text = `${nf.format(a + 1)} to ${nf.format(b)}`
  const go = () => {
    const t = (draft ?? '').replace(/[,\s]/g, '').toLowerCase()
    setDraft(null)
    const num = (x: string) => {
      const m = /^(\d+(?:\.\d+)?)(k|m)?$/.exec(x)
      return m ? Number(m[1]) * (m[2] === 'k' ? 1000 : m[2] === 'm' ? 1e6 : 1) : NaN
    }
    const parts = t.split(/-|\.\.|to/).filter(Boolean)
    if (parts.length === 1) {
      const p = num(parts[0])
      if (Number.isFinite(p)) { const span = Math.min(length, Math.max(60, b - a)); onGo(p - 1 - span / 2, p - 1 + span / 2) }
    } else if (parts.length === 2) {
      const p = num(parts[0])
      const q = num(parts[1])
      if (Number.isFinite(p) && Number.isFinite(q)) onGo(Math.min(p, q) - 1, Math.max(p, q))
    }
  }
  return (
    <input className="mv-locus" value={draft ?? text} aria-label="Position or range to show"
      title="Type a position (12000) or a range (12,000 to 13,500, or 12k-13.5k) and press Enter"
      onFocus={e => { setDraft(text); requestAnimationFrame(() => e.target.select()) }}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => setDraft(null)}
      onKeyDown={e => {
        if (e.key === 'Enter') { go(); (e.target as HTMLInputElement).blur() } else if (e.key === 'Escape') { setDraft(null); (e.target as HTMLInputElement).blur() }
      }} />
  )
}

function ZoomControls({ scale, plotW, length, canvas }: { scale: Signal<MapScale>; plotW: number; length: number; canvas: React.RefObject<MappingCanvasHandle> }) {
  const s = useSignal(scale)
  const min = Math.log2(1 / MAX_PX_PER_BASE)
  const max = Math.max(min, Math.log2(length / Math.max(1, plotW)))
  const v = Math.log2(s.bpPerPx)
  return (
    <>
      <button className="aw-tool-icon" onClick={() => canvas.current?.zoomBy(0.5)} disabled={v >= max - 1e-6} title="Zoom out (minus, or Ctrl+wheel)" aria-label="Zoom out"><Minus size={14} /></button>
      <input type="range" className="aw-zoom" min={-max} max={-min} step={0.05} value={-v} aria-label="Zoom"
        onChange={e => {
          const bpp = 2 ** -Number(e.target.value)
          const c = s.start + (plotW * s.bpPerPx) / 2
          scale.set(clampScale({ start: c - (plotW * bpp) / 2, bpPerPx: bpp }, length, plotW))
        }} />
      <button className="aw-tool-icon" onClick={() => canvas.current?.zoomBy(2)} disabled={v <= min + 1e-6} title="Zoom in (plus, Ctrl+wheel, or double-click)" aria-label="Zoom in"><Plus size={14} /></button>
      <button className="aw-tool-icon" onClick={() => canvas.current?.goTo(0, length)} title="Show the whole reference" aria-label="Show the whole reference"><Maximize2 size={13} /></button>
    </>
  )
}

function ViewNote({ state, layout, error, onShowAll, onZoomIn }: {
  state: ReadState
  layout: ReadLayout | null
  error: string | null
  onShowAll: () => void
  onZoomIn: () => void
}) {
  if (state === 'error') return <div className="mv-note danger">The reads could not be read: {error}</div>
  if (state === 'zoom') {
    return (
      <div className="mv-note">
        Coverage only at this zoom: reads are drawn over {nf.format(READ_SPAN_LIMIT / 1000)} kb or less.
        <button className="ngs-link" onClick={onZoomIn}>Zoom in</button>
      </div>
    )
  }
  if (state === 'loading' && !layout) return <div className="mv-note">Loading the reads…</div>
  if (state === 'many') return <div className="mv-note">Too many reads here to draw ({nf.format(READ_LOAD_LIMIT)} at most at once). Zoom in to see them.</div>
  if (!layout) return null
  const notes: string[] = []
  if (layout.sampledOut > 0) notes.push(`Downsampled: ${nf.format(layout.sampledOut)} of ${nf.format(layout.total)} reads here are not drawn, at most ${DEFAULT_DOWNSAMPLE.max} starting in any ${DEFAULT_DOWNSAMPLE.window} bases (marked under the reference). Coverage counts every read.`)
  if (layout.overflow > 0) notes.push(`${nf.format(layout.overflow)} reads did not fit in ${nf.format(MAX_ROWS)} rows.`)
  if (!notes.length) return null
  return (
    <div className="mv-note">
      {notes.join(' ')}
      {layout.sampledOut > 0 && <button className="ngs-link" onClick={onShowAll}>Draw every read</button>}
    </div>
  )
}

function InView({ layout, loaded, state }: { layout: ReadLayout | null; loaded: Loaded | null; state: ReadState }) {
  if (state !== 'reads' || !layout || !loaded) return null
  const drawn = layout.total - layout.sampledOut - layout.overflow
  return (
    <>
      <div className="aw-section-label">Loaded around the view</div>
      <dl className="aw-stats">
        <div className="aw-stat" title={`Positions ${nf.format(loaded.from + 1)} to ${nf.format(loaded.to)}`}><dt>Reads</dt><dd>{nf.format(layout.total)}</dd></div>
        <div className="aw-stat"><dt>Drawn</dt><dd>{nf.format(drawn)}</dd></div>
        {layout.filtered > 0 && <div className="aw-stat" title="Below the lowest mapping quality"><dt>Left out</dt><dd>{nf.format(layout.filtered)}</dd></div>}
        <div className="aw-stat"><dt>Rows</dt><dd>{nf.format(layout.rows.length)}</dd></div>
      </dl>
    </>
  )
}

const Legend = memo(function Legend({ colorBy, counts }: { colorBy: ColorBy; counts: Partial<Record<PairClass, number>> | null }) {
  const [theme, setTheme] = useState<ReturnType<typeof readAlnTheme> | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const themeVersion = useThemeVersion(ref)
  useEffect(() => { if (ref.current) setTheme(readAlnTheme(ref.current)) }, [themeVersion])
  const c = theme ? readColors(theme) : null
  const items: { label: string; color: string; count?: number; title?: string }[] = []
  if (c && colorBy === 'strand') items.push({ label: 'Forward strand', color: c.forward }, { label: 'Reverse strand', color: c.reverse })
  if (c && colorBy === 'mapq') {
    for (const k of ['high', 'low', 'zero', 'none'] as MapqClass[]) items.push({ label: MAPQ_LABEL[k], color: c.mapq[k] })
  }
  if (c && colorBy === 'pair') {
    for (const k of ['proper', 'larger', 'smaller', 'orientation', 'otherRef', 'mateUnmapped', 'single'] as PairClass[]) {
      if (k !== 'proper' && !counts?.[k]) continue
      items.push({ label: PAIR_LABEL[k], color: c.pair[k], count: counts?.[k] })
    }
  }
  return (
    <div ref={ref} className="mv-legend">
      <div className="aw-section-label">Key</div>
      {items.map(it => (
        <div key={it.label} className="mv-key">
          <i style={{ background: it.color }} />
          <span>{it.label}</span>
          {it.count !== undefined && <span className="aw-muted mv-key-n">{nf.format(it.count)}</span>}
        </div>
      ))}
      {theme && (
        <>
          <div className="mv-key"><i className="mv-key-ins" style={{ background: theme.accent }} /><span>Inserted bases (number when zoomed in)</span></div>
          <div className="mv-key"><i className="mv-key-del" /><span>Deleted bases</span></div>
          <div className="mv-key"><i style={{ background: withAlpha(theme.muted, 0.2) }} /><span>{colorBy === 'mapq' ? 'Faint: outside the fragment lengths picked' : 'Faint: mapping quality 0, or outside the fragment lengths picked'}</span></div>
        </>
      )}
      <p className="aw-note">Bases that differ from the reference are drawn in their base&apos;s colour, fainter the lower their quality.</p>
    </div>
  )
})

// ---------------------------------------------------------------------------
// A read's details
// ---------------------------------------------------------------------------

interface ReadInfoProps {
  read: ViewRead
  refBases: { bases: string; circular: boolean } | null
  refIndex: number
  refs: readonly { name: string; length: number; circular: boolean }[]
  expected: readonly [number, number] | null
  pos?: number
}

function readFacts({ read, refBases, refIndex, refs, expected, pos }: ReadInfoProps): [string, React.ReactNode][] {
  const a = read.a
  const R = refs[refIndex]
  const L = R.length
  const d = read.diff ?? (read.diff = readDiff(a))
  const rows: [string, React.ReactNode][] = []
  const end = a.end > L ? `${nf.format(a.end - L)} (across the origin)` : nf.format(a.end)
  rows.push(['Position', `${nf.format(a.start + 1)} to ${end}`])
  rows.push(['Strand', a.flag & 0x10 ? 'Reverse' : 'Forward'])
  rows.push(['Length', `${nf.format(queryLength(a))} bases, ${nf.format(a.end - a.start)} on the reference`])
  rows.push(['Mapping quality', a.mapq === 255 ? 'Not given' : `${a.mapq}${a.mapq === 0 ? ' (fits as well elsewhere)' : ''}`])
  if (a.diff !== '*') {
    const ins = d.insertions.reduce((n, x) => n + x.bases.length, 0)
    const del = d.deletions.reduce((n, x) => n + x.len, 0)
    rows.push(['Differences', `${nf.format(editDistance(d))}: ${nf.format(d.mismatches.length)} mismatched, ${nf.format(ins)} inserted, ${nf.format(del)} deleted`])
  }
  if (a.clipL || a.clipR) rows.push(['Soft clipped', `${nf.format(a.clipL.length)} at the start, ${nf.format(a.clipR.length)} at the end`])
  if (a.flag & 0x800) rows.push(['Split read', 'Supplementary: another part of this read maps elsewhere'])
  if (a.flag & 0x1) {
    const which = a.flag & 0x40 ? 'First of the pair' : a.flag & 0x80 ? 'Second of the pair' : 'Paired'
    let mate: string
    if (a.flag & 0x8) mate = 'not mapped'
    else {
      const mref = refs[a.mateRef]?.name ?? `reference ${a.mateRef + 1}`
      mate = `${a.mateRef === refIndex ? '' : `on ${mref} `}at ${nf.format(a.matePos + 1)}, ${a.flag & 0x20 ? 'reverse' : 'forward'}`
    }
    rows.push([which, `Mate ${mate}`])
    const t = fragmentLength(a, refIndex, L, R.circular)
    if (t !== null) rows.push(['Fragment', `${nf.format(t)} bp`])
    const cls = pairClass(a, refIndex, L, R.circular, expected)
    if (cls !== 'proper' && cls !== 'single') rows.push(['Pair', PAIR_LABEL[cls]])
  }
  if (pos !== undefined && refBases) {
    const b = baseAt(a, refBases, pos - read.shift)
    if (b) {
      const refB = refBases.bases[((pos % L) + L) % L]
      const what = b.kind === 'deletion' ? 'deleted' : b.kind === 'skip' ? 'skipped'
        : `${b.base}${b.kind === 'mismatch' ? ` (reference ${refB})` : ''}${b.qual >= 0 ? `, Q${b.qual}` : ''}, base ${nf.format(b.readPos)} of the read`
      rows.push([`At ${nf.format((((pos % L) + L) % L) + 1)}`, what])
    }
  }
  return rows
}

function ReadHover({ hover, selected, ...rest }: Omit<ReadInfoProps, 'read' | 'pos'> & { hover: Signal<MapHover | null>; selected: ViewRead | null }) {
  const h = useSignal(hover)
  const [shown, setShown] = useState<MapHover | null>(null)
  useEffect(() => {
    if (!h?.read) { setShown(null); return }
    if (shown?.read === h.read) { setShown(h); return }
    setShown(null)
    const t = window.setTimeout(() => setShown(h), 350)
    return () => window.clearTimeout(t)
  }, [h]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!shown?.read) return null
  const r = shown.read
  return (
    <HoverCard x={shown.clientX + 14} y={shown.clientY + 14} pinKey={`read:${r.a.name}:${r.a.flag}:${r.a.start}`}>
      <div className="ft-tooltip-name">
        <span className="hc-name">{r.a.name}</span>
        {r === selected && <span className="hc-chip">selected</span>}
      </div>
      <table className="ft-tooltip-table">
        <tbody>
          {readFacts({ read: r, pos: Math.floor(shown.pos), ...rest }).map(([k, v]) => <tr key={k}><td>{k}</td><td>{v}</td></tr>)}
        </tbody>
      </table>
    </HoverCard>
  )
}

function ReadPanel({ read, onMate, onCopy, onClose, onZoom, ...rest }: Omit<ReadInfoProps, 'pos'> & {
  onMate: () => void
  onCopy: (fastq: boolean) => void
  onClose: () => void
  onZoom: () => void
}) {
  const a = read.a
  const mate = (a.flag & 0x1) !== 0 && (a.flag & 0x8) === 0
  return (
    <div className="aw-subpanel mv-read">
      <div className="mv-read-head">
        <span className="aw-subpanel-title mv-read-name" title={a.name}>{a.name}</span>
        <button className="aw-icon-btn" onClick={onClose} title="Clear the selection (Esc)" aria-label="Clear the selection"><X size={13} /></button>
      </div>
      <dl className="mv-facts">
        {readFacts({ read, ...rest }).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
      </dl>
      <div className="aw-actions">
        {mate && <button className="aw-action" onClick={onMate}><Crosshair size={13} /> Go to the mate</button>}
        <button className="aw-action" onClick={onZoom}><Search size={13} /> Zoom to the read</button>
        <button className="aw-action" onClick={() => onCopy(false)}><ClipboardCopy size={13} /> Copy as FASTA</button>
        <button className="aw-action" onClick={() => onCopy(true)} disabled={!a.qual}><ClipboardCopy size={13} /> Copy as FASTQ</button>
      </div>
    </div>
  )
}

function StatusBar({ hover, input, refName }: { hover: Signal<MapHover | null>; input: MapPaintInput; refName: string }) {
  const h = useSignal(hover)
  let readout: React.ReactNode = (
    <span className="aw-muted">Drag to move · Ctrl+wheel or double-click to zoom · click a read to select it · right-click to sort or copy</span>
  )
  if (h && h.pos >= 0 && h.pos < input.length) {
    const p = Math.floor(h.pos)
    const parts: React.ReactNode[] = [<span key="p">{refName} <b>{nf.format(p + 1)}</b>{input.bases && <> <b>{input.bases[p]}</b></>}</span>]
    const pu = input.pileup
    if (pu && p >= pu.from && p < pu.to) {
      const k = p - pu.from
      const dpt = pu.depth[k]
      parts.push(<span key="d">{nf.format(dpt)}× ({nf.format(pu.forward[k])} forward, {nf.format(dpt - pu.forward[k])} reverse)</span>)
      const al = ['A', 'C', 'G', 'T', 'deleted', 'inserted after'].map((n, i) => [n, pu.counts[k * 6 + i]] as const).filter(([, n]) => n > 0)
      if (al.length) parts.push(<span key="a">{al.map(([n, c]) => `${n} ${nf.format(c)}`).join(' · ')}</span>)
    } else {
      const d = depthOver(input, p, p + 1, 1)
      parts.push(<span key="d">{d.mean.toFixed(d.mean % 1 ? 1 : 0)}×</span>)
    }
    readout = <>{parts}</>
  }
  return (
    <div className="aw-status">
      <div className="aw-status-readout">{readout}</div>
    </div>
  )
}

/** The evidence card for a variant pointed at in the view's variant track. */
function TrackVariantHover({ hover, settings }: { hover: Signal<MapHover | null>; settings: VariantSettings }) {
  const h = useSignal(hover)
  if (!h?.variant) return null
  return <VariantCard v={h.variant} x={h.clientX} y={h.clientY} failed={variantFilters(h.variant, settings)} />
}
