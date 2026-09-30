/**
 * A virtual gel as a workspace in the centre panel.
 *
 * The gel fills the left, drawn tall like a real one; the right panel edits
 * the selected lane or the gel's running and imaging conditions. The gel is
 * worked directly: click a lane to select it, drag wells to reorder, click the
 * empty well to add a lane, hover a band to see what is in it.
 *
 * The gel lives in the store as an explorer item. Every change goes through
 * `updateGel`, which keeps its undo history: Ctrl+Z / Ctrl+Y work here the way
 * they do in the sequence editor.
 */

import './GelWorkspace.css'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { X, Download, ChevronDown, FilePlus2, GalleryVertical, Wand2 } from 'lucide-react'
import { useEditorStore, type GelDoc } from '../../store'
import { notify } from '../../toast'
import { isWidgetKeyTarget } from '../../utils/key-target'
import { layoutGel, DEFAULT_BAND_OPTIONS, type GelBand, type PlacedSpecies } from '../../gel/bands'
import { DEFAULT_SAMPLE_NG, type GelConditions, type GelLane } from '../../gel/model'
import type { GelResolver, SequenceSource } from '../../gel/simulate'
import { GEL_FORMATS } from '../../gel/migration'
import { buildScene, type GelScene } from '../../gel/render/scene'
import { GEL_LOOKS, GEL_LOOK_ORDER, getLook, type GelLookId } from '../../gel/render/looks'
import { rasterCanvas, renderGelCanvas } from '../../gel/render/paint'
import { sceneToSvg } from '../../gel/render/svg'
import { MAX_LANES, autoLaneLabel, newLaneId, type GelDisplay, type GelWorkspaceState, type NameLookup } from '../../gel/workspace'
import { describeBand, describeSpecies, fragmentEnds, fragmentPosition, laneCsv, laneReport } from '../../gel/report'
import { extractFragment, pcrTemplate, selectInSequence } from '../../gel/actions'
import { exportGelPdf } from '../../gel/exportPdf'
import { downloadBlob, downloadText } from '../../utils/download'
import { openPcrProduct } from '../primers/workbench/openProduct'
import GelCanvas, { type BandRef } from './GelCanvas'
import LaneInspector, { type OligoOption, type SourceOption } from './LaneInspector'
import GelSettings from './GelSettings'
import DigestDesigner from './DigestDesigner'
import type { DigestDesign } from '../../gel/designer'
import { DEFAULT_LADDER_ID } from '../../gel/ladders'

interface Props {
  gel: GelDoc
  onClose: () => void
  /** Ask for a filename before writing an export. */
  onExportPrompt?: (defaultName: string, onConfirm: (name: string) => void) => void
}

type Panel = 'lane' | 'gel' | 'design'

const EXPORT_HEIGHT = 520
const EXPORT_LANE_PITCH = 54

export default function GelWorkspace({ gel, onClose, onExportPrompt }: Props) {
  const tabs = useEditorStore(s => s.tabs)
  const oligos = useEditorStore(s => s.oligos)
  const updateGel = useEditorStore(s => s.updateGel)
  const { lanes, conditions, display } = gel.state
  const [selected, setSelected] = useState<number | null>(() => (gel.state.lanes.length > 1 ? 1 : 0))
  const [selectedBand, setSelectedBand] = useState<BandRef | null>(null)
  const [hoverRow, setHoverRow] = useState<number | null>(null)
  const [panel, setPanel] = useState<Panel>('lane')
  const [exportOpen, setExportOpen] = useState(false)
  const exportRef = useRef<HTMLDivElement>(null)

  // Undo can take lanes away from under the selection.
  const selectedLane = selected === null ? null : lanes.length === 0 ? null : Math.min(selected, lanes.length - 1)

  const edit = useCallback((fn: (s: GelWorkspaceState) => GelWorkspaceState, coalesceKey?: string) =>
    updateGel(gel.id, fn, coalesceKey), [updateGel, gel.id])

  // Ctrl+Z / Ctrl+Y (and Ctrl+Shift+Z) undo and redo gel edits. Text fields
  // keep their own undo while they have focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || isWidgetKeyTarget(e.target)) return
      const k = e.key.toLowerCase()
      const s = useEditorStore.getState()
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); s.undoGel(gel.id) }
      else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); s.redoGel(gel.id) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [gel.id])

  useEffect(() => {
    if (!exportOpen) return
    const close = (e: MouseEvent) => { if (!exportRef.current?.contains(e.target as Node)) setExportOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [exportOpen])

  // ---- Sources ----
  const sources = useMemo((): SourceOption[] => tabs.map(t => ({
    id: t.id, name: t.doc.name, length: t.doc.sequence.length, topology: t.doc.sequence.topology,
  })), [tabs])

  const oligoOptions = useMemo((): OligoOption[] => oligos.map(o => ({ id: o.id, name: o.name, length: o.sequence.length })), [oligos])

  const resolver = useMemo((): GelResolver => ({
    sequence: (id: string): SequenceSource | null => {
      const tab = tabs.find(t => t.id === id)
      if (!tab) return null
      return {
        name: tab.doc.name,
        bases: tab.doc.sequence.bases,
        topology: tab.doc.sequence.topology,
        damMethylated: tab.doc.metadata?.damMethylated,
        dcmMethylated: tab.doc.metadata?.dcmMethylated,
      }
    },
    oligo: id => oligos.find(o => o.id === id) ?? null,
  }), [tabs, oligos])

  const names = useMemo((): NameLookup => ({
    sequence: id => tabs.find(t => t.id === id)?.doc.name ?? null,
    oligo: id => oligos.find(o => o.id === id)?.name ?? null,
  }), [tabs, oligos])

  const sourceLength = useCallback((id: string) => tabs.find(t => t.id === id)?.doc.sequence.length ?? 0, [tabs])

  // ---- Simulation ----
  const layout = useMemo(
    () => layoutGel({ conditions, lanes }, resolver, { ...DEFAULT_BAND_OPTIONS, massThickness: display.massThickness }),
    [conditions, lanes, resolver, display.massThickness],
  )

  const laneInputs = useMemo(() => lanes.map((l, i) => ({
    label: display.labelMode === 'names' ? (l.label || autoLaneLabel(l.sample, names)) : String(i + 1),
    isLadder: l.sample.kind === 'ladder',
  })), [lanes, display.labelMode, names])

  // ---- Edits ----
  const setLanes = useCallback((fn: (lanes: GelLane[]) => GelLane[], coalesceKey?: string) =>
    edit(s => ({ ...s, lanes: fn(s.lanes) }), coalesceKey), [edit])

  const patchConditions = useCallback((patch: Partial<GelConditions>) =>
    edit(s => ({ ...s, conditions: { ...s.conditions, ...patch } }), `conditions:${Object.keys(patch).join(',')}`), [edit])

  const patchDisplay = useCallback((patch: Partial<GelDisplay>) =>
    edit(s => ({ ...s, display: { ...s.display, ...patch } }), `display:${Object.keys(patch).join(',')}`), [edit])

  const selectLane = useCallback((idx: number) => {
    setSelected(idx)
    setSelectedBand(null)
    setPanel('lane')
  }, [])

  const addLane = useCallback(() => {
    if (lanes.length >= MAX_LANES) return
    // A new lane starts as the last sample run uncut: the next thing to try
    // is usually another digest of the same sequence.
    const lastSeq = [...lanes].reverse().find(l => l.sample.kind === 'sequence')?.sample
    const sourceId = lastSeq?.kind === 'sequence' ? lastSeq.sourceId : sources[0]?.id
    const lane: GelLane = {
      id: newLaneId(),
      sample: sourceId ? { kind: 'sequence', sourceId, enzymes: [], ng: DEFAULT_SAMPLE_NG } : { kind: 'empty' },
    }
    setLanes(ls => [...ls, lane])
    selectLane(lanes.length)
  }, [lanes, sources, setLanes, selectLane])

  const removeLane = useCallback((idx: number) => {
    if (!lanes[idx]) return
    setLanes(ls => ls.filter((_, i) => i !== idx))
    setSelectedBand(null)
    setSelected(lanes.length <= 1 ? null : Math.min(idx, lanes.length - 2))
    notify.success(`Removed lane ${idx + 1}`, {
      action: { label: 'Undo', onClick: () => useEditorStore.getState().undoGel(gel.id) },
    })
  }, [lanes, setLanes, gel.id])

  const duplicateLane = useCallback((idx: number) => {
    if (lanes.length >= MAX_LANES) return
    setLanes(ls => [...ls.slice(0, idx + 1), { ...ls[idx], id: newLaneId() }, ...ls.slice(idx + 1)])
    selectLane(idx + 1)
  }, [lanes.length, setLanes, selectLane])

  const moveLane = useCallback((from: number, to: number) => {
    setLanes(ls => {
      const next = [...ls]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
    setSelected(to)
    setSelectedBand(null)
  }, [setLanes])

  // ---- Name ----
  const [nameDraft, setNameDraft] = useState<string | null>(null)
  const commitName = () => {
    const next = nameDraft?.trim()
    if (next && next !== gel.name) useEditorStore.getState().renameGel(gel.id, next)
    setNameDraft(null)
  }

  // ---- Band details ----
  const describe = useCallback((laneIdx: number, band: GelBand): string[] => {
    const lane = lanes[laneIdx]
    const lines = [describeBand(band)]
    const len = lane?.sample.kind === 'sequence' ? sourceLength(lane.sample.sourceId) : 0
    for (const m of band.members) {
      if (m.fragment) lines.push(`${fragmentPosition(m.fragment, len)} · ${fragmentEnds(m.fragment)}`)
      if (m.pcr === 'side') lines.push(`${m.bp} bp side product`)
    }
    if (lane) lines.push(`Lane ${laneIdx + 1}: ${lane.label || autoLaneLabel(lane.sample, names)}`)
    return lines
  }, [lanes, sourceLength, names])

  const onSelectBand = useCallback((ref: BandRef) => {
    setSelected(ref.laneIdx)
    setSelectedBand(ref)
    setPanel('lane')
  }, [])

  const highlight: BandRef | null = hoverRow !== null && selectedLane !== null
    ? { laneIdx: selectedLane, bandIdx: hoverRow }
    : selectedBand

  // ---- Fragment actions ----
  const lane = selectedLane !== null ? lanes[selectedLane] : undefined

  const onSelectFragment = useCallback((s: PlacedSpecies) => {
    if (lane?.sample.kind !== 'sequence' || !s.fragment) return
    selectInSequence(lane.sample.sourceId, s.fragment)
  }, [lane])

  const onExtractFragment = useCallback((s: PlacedSpecies) => {
    if (lane?.sample.kind !== 'sequence' || !s.fragment) return
    extractFragment(lane.sample.sourceId, lane.sample.enzymes, s.fragment)
  }, [lane])

  const onOpenPcrProduct = useCallback(() => {
    if (lane?.sample.kind !== 'pcr') return
    const fwd = oligos.find(o => o.id === (lane.sample.kind === 'pcr' ? lane.sample.forwardId : ''))
    const rev = oligos.find(o => o.id === (lane.sample.kind === 'pcr' ? lane.sample.reverseId : ''))
    const template = pcrTemplate(lane.sample.templateId)
    if (fwd && rev && template) openPcrProduct(fwd, rev, template)
  }, [lane, oligos])

  // ---- Digest designer ----
  // Start from the sequences already on the gel, else the one being viewed.
  const { designIds, designPriority } = useMemo(() => {
    const onGel = [...new Set(lanes.flatMap(l => (l.sample.kind === 'sequence' ? [l.sample.sourceId] : l.sample.kind === 'pcr' ? [l.sample.templateId] : [])))]
    const back = useEditorStore.getState().gelReturnTabId
    return {
      designIds: onGel.length > 0 ? onGel : back ? [back] : [],
      designPriority: [...new Set([...onGel, ...(back ? [back] : [])])],
    }
  }, [lanes])

  const applyDesign = useCallback((design: DigestDesign, ids: string[]) => {
    // A ladder that brackets the bands: a 100 bp ladder when everything is small.
    const all = design.patterns.flatMap(p => p.fragments)
    const ladderId = Math.max(...all) <= 1500 ? '100bp' : Math.min(...all) < 400 ? '1kb-plus' : DEFAULT_LADDER_ID
    edit(s => ({
      ...s,
      lanes: [
        { id: newLaneId(), sample: { kind: 'ladder', ladderId } },
        ...ids.map((sourceId): GelLane => ({
          id: newLaneId(),
          label: names.sequence(sourceId) ?? undefined,
          sample: { kind: 'sequence', sourceId, enzymes: design.enzymes, ng: DEFAULT_SAMPLE_NG },
        })),
      ],
    }))
    setSelected(1)
    setSelectedBand(null)
    notify.success(`Laid out ${design.enzymes.join(' + ')} for ${ids.length} sequence${ids.length > 1 ? 's' : ''}`, {
      action: { label: 'Undo', onClick: () => useEditorStore.getState().undoGel(gel.id) },
    })
  }, [edit, names, gel.id])

  // ---- Export ----
  const look = getLook(display.look)

  /**
   * The gel as a figure: sized for its lanes, not for the window, and cropped
   * to the photo so there is no empty margin around it.
   */
  const exportScene = useCallback((): GelScene => {
    const build = (width: number) => buildScene({
      width, height: EXPORT_HEIGHT, layout, lanes: laneInputs,
      exposure: display.exposure, labelMode: display.labelMode,
    })
    const first = build(Math.max(320, 90 + lanes.length * EXPORT_LANE_PITCH))
    return build(first.figure.w)
  }, [lanes.length, layout, laneInputs, display.exposure, display.labelMode])

  const paintOpts = useCallback((scale: number) => ({
    scale, exposure: display.exposure, effects: display.effects, showDyeFronts: display.showDyeFronts,
  }), [display])

  const withName = useCallback((defaultName: string, run: (name: string) => void) => {
    if (onExportPrompt) onExportPrompt(defaultName, run)
    else run(defaultName)
  }, [onExportPrompt])

  const baseName = gel.name.replace(/[\\/:*?"<>|]+/g, '_')

  const exportPng = (scale: number) => withName(`${baseName}${scale >= 4 ? '-print' : ''}.png`, name => {
    renderGelCanvas(exportScene(), look, paintOpts(scale))?.toBlob(b => { if (b) downloadBlob(b, name) }, 'image/png')
  })

  const exportSvg = () => withName(`${baseName}.svg`, name => {
    const scene = exportScene()
    const slabPng = look.vector ? null : rasterCanvas(scene, look, paintOpts(3))?.toDataURL('image/png') ?? null
    downloadText(sceneToSvg(scene, look, { showDyeFronts: display.showDyeFronts, slabPng }), name, 'image/svg+xml')
  })

  const exportCsv = () => withName(`${baseName}-lanes.csv`, name => {
    downloadText(laneCsv(lanes, layout, names.sequence), name, 'text/csv')
  })

  const exportPdf = () => {
    const canvas = renderGelCanvas(exportScene(), look, paintOpts(3))
    if (!canvas) return
    const rows = laneReport(lanes, layout, names.sequence, { enzymeSep: ' + ', sizeSep: ', ', format: describeSpecies })
    exportGelPdf(canvas, rows, conditions.agarosePct)
  }

  return (
    <div className="gw">
      <div className="gw-header">
        <GalleryVertical size={14} className="gw-header-icon" />
        <input
          className="gw-name"
          value={nameDraft ?? gel.name}
          aria-label="Gel name"
          title="Rename the gel"
          onChange={e => setNameDraft(e.target.value)}
          onBlur={commitName}
          onKeyDown={e => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            else if (e.key === 'Escape') { setNameDraft(null); (e.target as HTMLInputElement).blur() }
          }}
          size={Math.max(6, (nameDraft ?? gel.name).length)}
        />
        <button className="gw-chip" onClick={() => setPanel('gel')} title="Gel settings">
          {conditions.agarosePct.toFixed(1)}% · {conditions.buffer} · {GEL_FORMATS[conditions.format].label} · run {Math.round(conditions.dyeFront * 100)}%
        </button>
        <span className="gw-muted">{lanes.length} / {MAX_LANES} lanes</span>
        <span className="gw-spacer" />
        <select
          className="select gw-select gw-look"
          value={display.look}
          aria-label="Look"
          title={look.description}
          onChange={e => patchDisplay({ look: e.target.value as GelLookId })}
        >
          {GEL_LOOK_ORDER.map(id => <option key={id} value={id}>{GEL_LOOKS[id].label}</option>)}
        </select>
        <button className={`gw-btn ${panel === 'design' ? 'active' : ''}`} onClick={() => setPanel('design')} title="Find enzymes that tell sequences apart">
          <Wand2 size={13} /> Design digest
        </button>
        <button className="gw-btn" onClick={() => useEditorStore.getState().createGel()} title="Start another gel from the sequence you were viewing">
          <FilePlus2 size={13} /> New gel
        </button>
        <div className="gw-export" ref={exportRef}>
          <button className="gw-btn" onClick={() => setExportOpen(o => !o)} aria-expanded={exportOpen}>
            <Download size={13} /> Export <ChevronDown size={12} />
          </button>
          {exportOpen && (
            <div className="gw-menu" role="menu">
              {([
                ['PNG', 'Image, 2× resolution', () => exportPng(2)],
                ['PNG', 'Print, 4× resolution', () => exportPng(4)],
                ['SVG', 'Vector labels, embedded gel image', exportSvg],
                ['CSV', 'Lane and fragment table', exportCsv],
                ['PDF', 'Gel and table, to print', exportPdf],
              ] as [string, string, () => void][]).map(([label, desc, run]) => (
                <button key={desc} role="menuitem" className="gw-menu-item" onClick={() => { run(); setExportOpen(false) }}>
                  <span className="gw-menu-label">{label}</span>
                  <span className="gw-menu-desc">{desc}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <button className="gw-icon-btn" onClick={onClose} title="Close the gel" aria-label="Close the gel">
          <X size={15} />
        </button>
      </div>

      <div className="gw-body">
        <GelCanvas
          layout={layout}
          lanes={laneInputs}
          display={display}
          canAddLane={lanes.length < MAX_LANES}
          selectedLane={selectedLane}
          highlight={highlight}
          describeBand={describe}
          onSelectLane={selectLane}
          onSelectBand={onSelectBand}
          onMoveLane={moveLane}
          onAddLane={addLane}
          onRemoveLane={removeLane}
        />
        <aside className="gw-inspector" aria-label="Gel inspector">
          <div className="gw-tabs" role="tablist">
            <button role="tab" aria-selected={panel === 'lane'} className={`gw-tab ${panel === 'lane' ? 'active' : ''}`} onClick={() => setPanel('lane')}>
              {lane ? `Lane ${selectedLane! + 1}` : 'Lane'}
            </button>
            <button role="tab" aria-selected={panel === 'gel'} className={`gw-tab ${panel === 'gel' ? 'active' : ''}`} onClick={() => setPanel('gel')}>
              Gel &amp; image
            </button>
            <button role="tab" aria-selected={panel === 'design'} className={`gw-tab ${panel === 'design' ? 'active' : ''}`} onClick={() => setPanel('design')}>
              Design
            </button>
          </div>
          {panel === 'gel' ? (
            <GelSettings conditions={conditions} onConditions={patchConditions} display={display} onDisplay={patchDisplay} />
          ) : panel === 'design' ? (
            <DigestDesigner
              sources={sources}
              resolveSource={resolver.sequence}
              conditions={conditions}
              initialIds={designIds}
              priorityIds={designPriority}
              onApply={applyDesign}
            />
          ) : lane ? (
            <LaneInspector
              key={lane.id}
              lane={lane}
              index={selectedLane!}
              layout={layout.lanes[selectedLane!]}
              sources={sources}
              oligos={oligoOptions}
              resolveSource={resolver.sequence}
              selectedBand={selectedBand?.laneIdx === selectedLane ? selectedBand.bandIdx : null}
              onHoverBand={setHoverRow}
              onSelectBand={bandIdx => setSelectedBand({ laneIdx: selectedLane!, bandIdx })}
              onChange={(next, coalesceKey) => setLanes(ls => ls.map((l, i) => (i === selectedLane ? next : l)), coalesceKey)}
              onRemove={() => removeLane(selectedLane!)}
              onDuplicate={lanes.length < MAX_LANES ? () => duplicateLane(selectedLane!) : null}
              onSelectInSequence={onSelectFragment}
              onExtract={onExtractFragment}
              onOpenPcrProduct={onOpenPcrProduct}
            />
          ) : (
            <div className="gw-empty">
              <p>Click a lane on the gel to edit it, or the empty well after the last lane to add one.</p>
              <button className="btn-add" onClick={addLane} disabled={lanes.length >= MAX_LANES}>Add lane</button>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
