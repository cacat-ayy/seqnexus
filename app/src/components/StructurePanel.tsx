import './StructurePanel.css'
/**
 * The 3D structure of the open protein, beside its sequence.
 *
 * The coordinates come from the cache or the network (structure/sources),
 * the chain is aligned to the protein (structure/align), and the viewer is
 * 3Dmol.js, loaded on first use. The two views are linked through the
 * store: residues selected in the sequence are drawn as sticks in the
 * accent colour, a feature hovered in the sequence lights up its residues,
 * and a residue clicked in 3D is selected in the sequence. Hovering a
 * residue in 3D names it, with its position in the protein and, for an
 * AlphaFold model, its confidence.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RotateCcw, Image as ImageIcon, Replace, Trash2, ExternalLink, X } from 'lucide-react'
import { useEditorStore } from '../store'
import { parseStructure } from '../structure/parse'
import { mapToChain, identity } from '../structure/align'
import { chainColors, spectrumColor, PLDDT_BANDS, type StructureColorMode } from '../structure/color'
import { loadStructureText, StructureFileMissing, RCSB_ENTRY_PAGE, ALPHAFOLD_ENTRY_PAGE } from '../structure/sources'
import { load3Dmol, type Viewer3D, type ThreeDmol, type AtomSpec } from '../structure/load3dmol'
import type { ParsedStructure } from '../structure/model'
import { buildResiduePalette } from '../utils/residue-colors'
import { displayPosition } from '../models/Document'
import { downloadBlob } from '../utils/download'
import { notify } from '../toast'
import StructurePicker from './StructurePicker'
import { useExitAnimation } from '../hooks/useExitAnimation'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { useBackdropDismiss } from '../hooks/useBackdropDismiss'
import { notifyFigureSaved } from '../utils/cite-notice'
import { pngWithCredit } from '../utils/file-credit'

type DrawStyle = 'cartoon' | 'sticks' | 'surface'

interface Loaded {
  key: string
  text: string
  parsed: ParsedStructure
}

interface HoverInfo {
  chain: string
  resn: string
  resi: number
  b?: number
  proteinPos: number | null
}

/** Theme colours for the viewer, read from the tokens (WebGL cannot use var()). */
function themeColors(el: HTMLElement | null) {
  const cs = el ? getComputedStyle(el) : null
  // Fallbacks for tests and unmounted renders, as readSequenceColors has.
  const v = (name: string, fallback: string) => cs?.getPropertyValue(name).trim() || fallback
  return { bg: v('--canvas-bg', '#ffffff'), neutral: v('--canvas-complement', '#9ca3af'), accent: v('--accent', '#6366f1') }
}

export default function StructurePanel({ onExportPrompt }: {
  onExportPrompt?: (defaultName: string, onConfirm: (name: string) => void) => void
}) {
  const doc = useEditorStore(s => s.doc)
  const selection = useEditorStore(s => s.selection)
  const hoveredAnnotationId = useEditorStore(s => s.hoveredAnnotationId)
  const hiddenAnnotationIds = useEditorStore(s => s.hiddenAnnotationIds)
  const proteinColorScheme = useEditorStore(s => s.proteinColorScheme)
  const ref = doc.metadata?.structure ?? null

  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [missingFile, setMissingFile] = useState<string | null>(null)
  const [drawStyle, setDrawStyle] = useState<DrawStyle>('cartoon')
  const [colorMode, setColorMode] = useState<StructureColorMode>(ref?.source === 'alphafold' ? 'confidence' : 'features')
  const [hover, setHover] = useState<HoverInfo | null>(null)
  const [changeOpen, setChangeOpen] = useState(false)

  const hostRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<Viewer3D | null>(null)
  const libRef = useRef<ThreeDmol | null>(null)
  const [viewerKey, setViewerKey] = useState<string | null>(null)

  // A new structure picks the colouring that suits it.
  useEffect(() => { setColorMode(ref?.source === 'alphafold' ? 'confidence' : 'features') }, [ref?.key, ref?.source])

  // Coordinates: cache or network, then parse.
  useEffect(() => {
    if (!ref) { setLoaded(null); setStatus('idle'); return }
    if (loaded?.key === ref.key) return
    let cancelled = false
    setStatus('loading')
    setError(null)
    setMissingFile(null)
    loadStructureText(ref).then(text => {
      if (cancelled) return
      setLoaded({ key: ref.key, text, parsed: parseStructure(text, ref.format) })
      setStatus('ready')
    }).catch(err => {
      if (cancelled) return
      if (err instanceof StructureFileMissing) setMissingFile(err.fileName)
      setError(err instanceof Error ? err.message : String(err))
      setStatus('error')
    })
    return () => { cancelled = true }
  // loaded is read only to skip a reload of the same structure.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref?.key])

  const chain = useMemo(() => {
    if (!loaded || !ref) return null
    return loaded.parsed.chains.find(c => c.id === ref.chain) ?? loaded.parsed.chains[0] ?? null
  }, [loaded, ref])
  const residues = doc.sequence.bases
  // Realigned on every edit: a mutation or a deletion moves the map.
  const mapping = useMemo(() => (chain ? mapToChain(residues, chain) : null), [chain, residues])
  /** Chain residue index by author number, for 3Dmol's atoms. */
  const indexByResi = useMemo(() => new Map(chain?.residues.map((r, i) => [r.num, i]) ?? []), [chain])

  // The viewer: created once per structure, after the library loads.
  useEffect(() => {
    if (status !== 'ready' || !loaded || !hostRef.current) return
    let cancelled = false
    load3Dmol().then(lib => {
      if (cancelled || !hostRef.current) return
      libRef.current = lib
      hostRef.current.innerHTML = ''
      const colors = themeColors(hostRef.current)
      const viewer = lib.createViewer(hostRef.current, { backgroundColor: colors.bg, antialias: true })
      viewer.addModel(loaded.text, loaded.parsed.format === 'mmcif' ? 'cif' : 'pdb')
      viewer.zoomTo()
      viewerRef.current = viewer
      setViewerKey(loaded.key)
    }).catch(err => {
      if (cancelled) return
      setError(err instanceof Error ? err.message : String(err))
      setStatus('error')
    })
    return () => {
      cancelled = true
      viewerRef.current = null
      setViewerKey(null)
    }
  }, [status, loaded])

  // Hover and click, wired once per viewer; they read the latest map through refs.
  const mappingRef = useRef(mapping)
  mappingRef.current = mapping
  const indexRef = useRef(indexByResi)
  indexRef.current = indexByResi
  const chainIdRef = useRef(ref?.chain)
  chainIdRef.current = ref?.chain
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || !viewerKey) return
    const proteinPos = (atom: AtomSpec): number | null => {
      if (atom.chain !== chainIdRef.current || atom.resi === undefined) return null
      const j = indexRef.current.get(atom.resi)
      const i = j === undefined ? -1 : mappingRef.current?.toProtein[j] ?? -1
      return i >= 0 ? i : null
    }
    viewer.setHoverDuration(60)
    viewer.setHoverable({}, true, atom => {
      if (atom.resi === undefined) return
      setHover({ chain: atom.chain ?? '', resn: atom.resn ?? '', resi: atom.resi, b: atom.b, proteinPos: proteinPos(atom) })
    }, () => setHover(null))
    viewer.setClickable({}, true, atom => {
      const i = proteinPos(atom)
      if (i === null) return
      const s = useEditorStore.getState()
      s.smoothScrollRequested = true
      s.setSelection({ anchor: i, caret: i + 1 })
    })
  }, [viewerKey])

  // Colours, style and highlights: restyled on any change, surfaces only when they must be.
  const features = useMemo(() => {
    const hidden = new Set(hiddenAnnotationIds)
    return doc.annotations.filter(a => !hidden.has(a.id))
  }, [doc.annotations, hiddenAnnotationIds])
  const surfaceKey = useRef('')
  useEffect(() => {
    const viewer = viewerRef.current
    const lib = libRef.current
    if (!viewer || !lib || !chain || !viewerKey) return
    const theme = themeColors(hostRef.current)
    const palette = proteinColorScheme === 'none' ? {} : buildResiduePalette(proteinColorScheme, theme.neutral)
    const colors = colorMode === 'chain' ? [] : chainColors({
      mode: colorMode, chain, mapping, features, palette, protein: residues, neutral: theme.neutral,
    })
    const colorByResi = new Map(chain.residues.map((r, i) => [r.num, colors[i]]))
    const own = { chain: chain.id }
    const colorfunc = (atom: AtomSpec) => colorByResi.get(atom.resi ?? -1) ?? theme.neutral

    // Everything else in the entry: other chains faint, ligands as sticks, no water.
    viewer.setStyle({}, colorMode === 'chain'
      ? { cartoon: { colorscheme: 'chain' } }
      : { cartoon: { color: theme.neutral, opacity: 0.45 } })
    viewer.setStyle({ hetflag: true }, { stick: { radius: 0.18, colorscheme: 'greenCarbon' } })
    viewer.setStyle({ resn: ['HOH', 'WAT', 'DOD'] }, {})

    const shape = colorMode === 'chain' ? { colorscheme: 'chain' } : { colorfunc }
    if (drawStyle === 'sticks') viewer.setStyle(own, { stick: { radius: 0.2, ...shape } })
    else viewer.setStyle(own, { cartoon: { ...shape, thickness: 0.4 } })

    // A feature hovered in the sequence: its residues in the accent colour.
    const hovered = hoveredAnnotationId ? doc.annotations.find(a => a.id === hoveredAnnotationId) : null
    const resisOf = (start: number, end: number) => {
      const out: number[] = []
      for (let i = Math.max(0, start); i < Math.min(end, residues.length); i++) {
        const j = mapping?.toChain[i] ?? -1
        if (j >= 0) out.push(chain.residues[j].num)
      }
      return out
    }
    if (hovered) {
      const resi = (hovered.segments ?? [[hovered.start, hovered.end]]).flatMap(([s, e]) => resisOf(s, e))
      if (resi.length > 0) {
        if (drawStyle === 'sticks') viewer.setStyle({ ...own, resi }, { stick: { radius: 0.3, color: theme.accent } })
        else viewer.setStyle({ ...own, resi }, { cartoon: { color: theme.accent, thickness: 0.6 } })
      }
    }
    // The selection: sticks in the accent colour over whatever is drawn.
    const [s0, s1] = [Math.min(selection.anchor, selection.caret), Math.max(selection.anchor, selection.caret)]
    const selResi = s1 > s0 ? resisOf(s0, s1) : []
    if (selResi.length > 0 && selResi.length <= 400) {
      viewer.addStyle({ ...own, resi: selResi }, { stick: { radius: 0.22, color: theme.accent } })
    }

    const sk = drawStyle === 'surface' ? `${colorMode}|${proteinColorScheme}|${residues.length}|${features.length}|${viewerKey}` : ''
    if (sk !== surfaceKey.current) {
      viewer.removeAllSurfaces()
      if (drawStyle === 'surface') {
        if (colorMode === 'chain') {
          viewer.addSurface(lib.SurfaceType.VDW, { opacity: 0.85, colorscheme: 'chain' }, own)
        } else {
          // One patch per colour, each shaped by the whole chain: the
          // surface colour callback is not applied to every vertex, so
          // colours are given per patch instead. The spectrum is cut to 20
          // steps here so a long chain does not make hundreds of patches.
          const n = chain.residues.length
          const patchColors = colorMode === 'spectrum'
            ? chain.residues.map((_, i) => spectrumColor(Math.round((n > 1 ? i / (n - 1) : 0) * 20) / 20))
            : colors
          const groups = new Map<string, number[]>()
          chain.residues.forEach((r, i) => {
            const c = patchColors[i] ?? theme.neutral
            groups.set(c, [...(groups.get(c) ?? []), r.num])
          })
          for (const [color, resi] of groups) {
            viewer.addSurface(lib.SurfaceType.VDW, { opacity: 0.85, color }, { ...own, resi }, own)
          }
        }
      }
      surfaceKey.current = sk
    }
    viewer.render()
  }, [viewerKey, chain, mapping, colorMode, drawStyle, features, proteinColorScheme, hoveredAnnotationId, selection, residues, doc.annotations])

  // Fit the canvas to its pane, and follow the theme's background.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const ro = new ResizeObserver(() => { viewerRef.current?.resize(); viewerRef.current?.render() })
    ro.observe(host)
    const root = host.closest('.app-root')
    const mo = new MutationObserver(() => {
      viewerRef.current?.setBackgroundColor(themeColors(host).bg)
      viewerRef.current?.render()
      surfaceKey.current = ''
    })
    if (root) mo.observe(root, { attributes: true, attributeFilter: ['data-theme'] })
    return () => { ro.disconnect(); mo.disconnect() }
  }, [status])

  const resetView = useCallback(() => { viewerRef.current?.zoomTo({}, 300); viewerRef.current?.render() }, [])

  const exportPng = useCallback(() => {
    const viewer = viewerRef.current
    if (!viewer || !ref) return
    const base = `${doc.name || 'protein'}-${ref.id}`.replace(/[^\w.-]+/g, '_')
    const write = async (name: string) => {
      try {
        // The view as drawn on screen: its resolution is the screen's, so none is written.
        const blob = await pngWithCredit(await (await fetch(viewer.pngURI())).blob())
        downloadBlob(blob, name)
        notifyFigureSaved(name)
      } catch (err) {
        notify.error('Could not export the structure', { detail: err instanceof Error ? err.message : undefined })
      }
    }
    if (onExportPrompt) onExportPrompt(`${base}-3d.png`, n => { void write(n) })
    else void write(`${base}-3d.png`)
  }, [doc.name, ref, onExportPrompt])

  const setChain = useCallback((id: string) => {
    if (ref && id !== ref.chain) useEditorStore.getState().setStructure({ ...ref, chain: id })
  }, [ref])

  if (!ref) {
    return (
      <div className="sp-panel sp-empty">
        <div className="sp-empty-inner">
          <div className="sp-empty-title">No structure yet</div>
          <p className="sp-empty-hint">Show an experimental structure or an AlphaFold model beside the sequence. It is lined up with this protein by alignment, so tags and missing loops are fine.</p>
          <StructurePicker />
        </div>
      </div>
    )
  }

  const hasPlddt = ref.source === 'alphafold'
  const chainsWithProtein = loaded?.parsed.chains ?? []
  const pct = mapping ? Math.round(identity(mapping) * 100) : 0
  const origin = doc.metadata?.displayOrigin ?? 0
  const entryUrl = ref.source === 'pdb' ? RCSB_ENTRY_PAGE(ref.id) : ref.source === 'alphafold' ? ALPHAFOLD_ENTRY_PAGE(ref.id) : null

  return (
    <div className="sp-panel">
      <div className="sp-toolbar">
        <span className="sp-source" title={ref.title}>
          <span className="sp-source-kind">{ref.source === 'pdb' ? 'PDB' : ref.source === 'alphafold' ? 'AlphaFold' : 'File'}</span>
          <span className="sp-source-id">{ref.id}</span>
          {entryUrl && (
            <a className="sp-icon-link" href={entryUrl} target="_blank" rel="noreferrer" title="Open the entry's page">
              <ExternalLink size={12} />
            </a>
          )}
        </span>
        {chainsWithProtein.length > 1 && (
          <select className="select sp-select" value={ref.chain} onChange={e => setChain(e.target.value)} title="The chain the protein is matched to">
            {chainsWithProtein.map(c => <option key={c.id} value={c.id}>Chain {c.id} ({c.residues.length} aa)</option>)}
          </select>
        )}
        <div className="seg seg-sm sp-toggle" role="radiogroup" aria-label="Drawing style">
          {(['cartoon', 'sticks', 'surface'] as DrawStyle[]).map(s => (
            <button key={s} role="radio" aria-checked={drawStyle === s}
              className={drawStyle === s ? 'active' : ''} onClick={() => setDrawStyle(s)}>
              {s[0].toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
        <select className="select sp-select" value={colorMode} onChange={e => setColorMode(e.target.value as StructureColorMode)} title="Colour by">
          <option value="features">Colour: features</option>
          <option value="residues">Colour: residue scheme</option>
          <option value="spectrum">Colour: N to C</option>
          <option value="chain">Colour: chain</option>
          {hasPlddt && <option value="confidence">Colour: confidence (pLDDT)</option>}
        </select>
        <span className="sp-spacer" />
        <button className="sp-tool" onClick={resetView} title="Reset the view" aria-label="Reset the view"><RotateCcw size={13} /></button>
        <button className="sp-tool" onClick={exportPng} title="Export the view as PNG" aria-label="Export the view as PNG" disabled={status !== 'ready'}><ImageIcon size={13} /></button>
        <button className="sp-tool" onClick={() => setChangeOpen(true)} title="Show another structure" aria-label="Show another structure"><Replace size={13} /></button>
        <button className="sp-tool" onClick={() => useEditorStore.getState().setStructure(null)} title="Remove the structure (undo brings it back)" aria-label="Remove the structure"><Trash2 size={13} /></button>
      </div>

      <div className="sp-stage">
        {/* 3Dmol owns this element's children; React never renders into it. */}
        <div ref={hostRef} className="sp-host" />
        {status === 'loading' && <div className="sp-overlay">Loading {ref.id}…</div>}
        {status === 'error' && (
          <div className="sp-overlay sp-overlay-error">
            {missingFile ? <StructurePicker missingFile={missingFile} /> : <span>{error}</span>}
          </div>
        )}
      </div>

      <div className="sp-footer">
        <span className="sp-match" title={ref.title}>
          {mapping && chain
            ? `Chain ${chain.id}: ${mapping.aligned} of ${residues.length} residues aligned, ${pct}% identical`
            : ref.title ?? ''}
        </span>
        {colorMode === 'confidence' && (
          <span className="sp-legend">
            {PLDDT_BANDS.map(b => (
              <span key={b.label} className="sp-legend-item" title={b.label}>
                {/* The band colour is data (AlphaFold DB's palette), set inline. */}
                <span className="sp-swatch" style={{ backgroundColor: b.color }} />
                {b.label.split(' (')[0]}
              </span>
            ))}
          </span>
        )}
        <span className="sp-hover">
          {hover && (
            <>
              {hover.resn ? hover.resn[0] + hover.resn.slice(1).toLowerCase() : ''}{hover.resi}
              {hover.chain && ` · chain ${hover.chain}`}
              {hover.proteinPos !== null ? ` · residue ${displayPosition(hover.proteinPos, origin, residues.length)} of the protein` : ' · not in the protein'}
              {hasPlddt && hover.b !== undefined && ` · pLDDT ${hover.b.toFixed(0)}`}
            </>
          )}
        </span>
      </div>

      <ChangeDialog open={changeOpen} onClose={() => setChangeOpen(false)} />
    </div>
  )
}

function ChangeDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { visible, closing, onAnimationEnd } = useExitAnimation(open)
  const close = onClose
  const backdropRef = useRef<HTMLDivElement>(null)
  useFocusTrap(backdropRef, open)
  const backdrop = useBackdropDismiss(close)
  if (!visible) return null
  return (
    <div ref={backdropRef} className={closing ? 'modal-backdrop closing' : 'modal-backdrop'} onAnimationEnd={onAnimationEnd}
      {...backdrop} onKeyDown={e => { if (e.key === 'Escape') close() }} tabIndex={-1}>
      <div className="modal-dialog sp-dialog" role="dialog" aria-modal="true" aria-labelledby="sp-change-title">
        <div className="modal-header">
          <h3 className="modal-title" id="sp-change-title">Show Another Structure</h3>
          <button className="modal-close" onClick={close} aria-label="Close"><X size={16} /></button>
        </div>
        <div className="modal-body">
          <StructurePicker onDone={close} />
        </div>
      </div>
    </div>
  )
}
