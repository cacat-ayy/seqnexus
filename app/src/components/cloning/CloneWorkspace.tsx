/**
 * A cloning design as a workspace in the centre panel.
 *
 * Left: the method and the parts. Middle: a map per part and one for the
 * product, as tabs (see ./MapStage). Nothing is behind a Simulate button: the
 * design is re-run on every change, so the product and the reason there is
 * not one are always in front of you.
 *
 * The design lives in the store as an explorer item. Every change goes
 * through `updateClone`, which keeps its undo history, so Ctrl+Z and Ctrl+Y
 * work here the way they do in the sequence editor.
 */

import './CloneWorkspace.css'
import { useCallback, useMemo, useState } from 'react'
import { Combine, FilePlus2, Plus, X } from 'lucide-react'
import { useEditorStore, type CloneDoc } from '../../store'
import { toUid } from '../../explorer/types'
import { digestWorkspace } from '../../gel/workspace'
import { notify } from '../../toast'
import { ENZYME_GROUPS } from '../../enzymes/db'
import { KIT_LIST } from '../../cloning/kits'
import {
  METHOD_BLURB,
  METHOD_LABEL,
  needsOligos,
  partBases,
  partEnzymes,
  partFromDoc,
  partTopology,
  sequenceHash,
  vectorsFirst,
  type CloningDesign,
  type CloningMethodId,
  type DesignPart,
} from '../../cloning/design'
import { productDocument, runDesign, selectedProduct } from '../../cloning/run'
import { findFixes, type DesignFix } from '../../cloning/outcome'
import { binsFromDesign, type BulkRow, type DesignBin } from '../../cloning/bulk'
import EnzymeField, { type CutTarget } from '../EnzymeField'
import { partColor } from './colors'
import LibraryPanel from './LibraryPanel'
import OligosPanel from './OligosPanel'
import JunctionInspector from './JunctionInspector'
import PartsPanel from './PartsPanel'
import MapStage from './MapStage'

interface Props {
  clone: CloneDoc
  onClose: () => void
}

const METHODS: CloningMethodId[] = ['restriction', 'golden-gate', 'homology', 'gateway', 'topo']

const TYPE_IIS_ENZYMES = [...(ENZYME_GROUPS['Golden Gate (Type IIS)'] ?? [])].sort()

export default function CloneWorkspace({ clone, onClose }: Props) {
  const tabs = useEditorStore(s => s.tabs)
  const activeTabId = useEditorStore(s => s.activeTabId)
  const liveDoc = useEditorStore(s => s.doc)
  const selection = useEditorStore(s => s.selection)
  const updateClone = useEditorStore(s => s.updateClone)
  const renameClone = useEditorStore(s => s.renameClone)
  const openDocumentState = useEditorStore(s => s.openDocumentState)
  const setActiveTab = useEditorStore(s => s.setActiveTab)
  const setSelection = useEditorStore(s => s.setSelection)

  const { design } = clone
  const [hovered, setHovered] = useState<string | null>(null)
  // Which map is in front: a part's id, or the product. A restriction design
  // opens on the first part still waiting for its sites, since choosing them
  // is the next thing to do; anything else opens on what it makes.
  const [tab, setTab] = useState<string>(() => {
    const d = clone.design
    const waiting = d.method === 'restriction' ? vectorsFirst(d.parts).find(p => partEnzymes(p, d).length === 0) : undefined
    return waiting?.id ?? 'product'
  })
  const shownTab = tab === 'product' || design.parts.some(p => p.id === tab) ? tab : 'product'
  const [addOpen, setAddOpen] = useState(false)
  const [mode, setMode] = useState<'one' | 'library'>('one')
  const [aside, setAside] = useState<'none' | 'oligos' | 'junctions'>('none')
  const [bins, setBins] = useState<DesignBin[]>([])

  // A library starts from the design in front of you: one position per part,
  // each with that part as its only choice, ready for alternatives.
  const openLibrary = useCallback(() => {
    setMode('library')
    setBins(current => (current.length > 0 ? current : binsFromDesign(design)))
  }, [design])

  // Every open sequence, for adding parts and for spotting a part whose
  // source has moved on since it was taken.
  const sources = useMemo(() => {
    const map = new Map<string, { name: string; hash: string }>()
    for (const tab of tabs) {
      const doc = tab.id === activeTabId ? liveDoc : tab.doc
      map.set(tab.id, {
        name: doc.name,
        hash: sequenceHash(doc.sequence.bases, doc.sequence.topology),
      })
    }
    return map
  }, [tabs, activeTabId, liveDoc])

  // The design is cheap to run and always re-run, so a saved design shows
  // what the engines say now rather than what they said when it was saved.
  const result = useMemo(() => runDesign(design), [design])
  const chosen = selectedProduct(design, result.products)
  // What to try when the construct does not form; each is re-run first, so
  // this only costs anything while the design is broken.
  const fixes = useMemo(() => findFixes(design, 3, result), [design, result])

  // The parts as the enzyme field counts cuts on them, vector first so its
  // suggestions are the enzymes that open the vector once. Each keeps the
  // colour it has in the parts list.
  const cutTargets = useMemo((): CutTarget[] => {
    const colorOf = new Map(design.parts.map((p, i) => [p.id, partColor(i)]))
    return vectorsFirst(design.parts).map(part => ({
      source: {
        name: part.name,
        bases: partBases(part),
        topology: partTopology(part),
        ...(part.damMethylated ? { damMethylated: true } : {}),
        ...(part.dcmMethylated ? { dcmMethylated: true } : {}),
      },
      color: colorOf.get(part.id)!,
    }))
  }, [design.parts])

  const patch = useCallback(
    (changes: Partial<CloningDesign>, coalesceKey?: string) => {
      updateClone(clone.id, d => ({ ...d, ...changes }), coalesceKey)
    },
    [clone.id, updateClone],
  )

  const applyFix = useCallback(
    (fix: DesignFix) => {
      if (fix.apply === 'oligos') {
        setAside('oligos')
        return
      }
      // The construct is what the fix was chosen for, so it is what to show.
      const apply = fix.apply
      updateClone(clone.id, d => ({ ...apply(d), selected: undefined }))
      notify.success(fix.label)
    },
    [clone.id, updateClone],
  )

  const patchPart = useCallback(
    (id: string, changes: Partial<DesignPart>, coalesceKey?: string) => {
      updateClone(
        clone.id,
        d => ({ ...d, parts: d.parts.map(p => (p.id === id ? { ...p, ...changes } : p)) }),
        coalesceKey,
      )
    },
    [clone.id, updateClone],
  )

  const addPart = useCallback(
    (tabId: string, useSelection: boolean) => {
      const tab = tabs.find(t => t.id === tabId)
      if (!tab) return
      const doc = tab.id === activeTabId ? liveDoc : tab.doc
      const from = Math.min(selection.anchor, selection.caret)
      const to = Math.max(selection.anchor, selection.caret)
      const region = useSelection && to > from ? { start: from, end: to } : undefined
      const added = partFromDoc(doc, { sourceId: tab.id, ...(region ? { region } : {}) })
      updateClone(clone.id, d => ({ ...d, parts: [...d.parts, added] }))
      // Its map comes to the front: deciding where it is cut is the next step.
      setTab(added.id)
      setAddOpen(false)
    },
    [tabs, activeTabId, liveDoc, selection, clone.id, updateClone],
  )

  const refreshPart = useCallback(
    (id: string) => {
      const part = design.parts.find(p => p.id === id)
      if (!part?.source) return
      const tab = tabs.find(t => t.id === part.source!.id)
      if (!tab) return
      const doc = tab.id === activeTabId ? liveDoc : tab.doc
      const fresh = partFromDoc(doc, { sourceId: tab.id, role: part.role })
      patchPart(id, {
        bases: fresh.bases,
        topology: fresh.topology,
        annotations: fresh.annotations,
        source: fresh.source,
        // A region taken from the old sequence may no longer mean anything.
        region: undefined,
      })
      notify.success(`${doc.name} refreshed in this design`)
    },
    [design.parts, tabs, activeTabId, liveDoc, patchPart],
  )

  const revealPart = useCallback(
    (part: DesignPart) => {
      if (!part.source) return
      setActiveTab(part.source.id)
      if (part.region) setSelection({ anchor: part.region.start, caret: part.region.end })
    },
    [setActiveTab, setSelection],
  )

  const openProduct = useCallback(() => {
    if (!chosen) return
    openDocumentState(productDocument(design, chosen))
    notify.success(`${chosen.name} opened as a sequence`)
  }, [chosen, design, openDocumentState])

  const openRow = useCallback((row: BulkRow) => {
    if (!row.product) return
    openDocumentState(productDocument(design, row.product, row.name))
    notify.success(`${row.name} opened as a sequence`)
  }, [design, openDocumentState])

  /**
   * Keep a whole library. The constructs go into a folder of their own, so a
   * run of fifty does not land loose among the sequences already open.
   */
  const saveRows = useCallback((rows: BulkRow[], folderName: string) => {
    const store = useEditorStore.getState()
    const folderId = store.createFolder(`${clone.name}: ${folderName}`)
    for (const row of rows) {
      if (!row.product) continue
      const id = store.openDocumentState(productDocument(design, row.product, row.name))
      if (folderId) store.moveItemToFolder(toUid('sequence', id), folderId)
    }
    notify.success(`Kept ${rows.length} construct${rows.length === 1 ? '' : 's'}`)
  }, [clone.name, design])

  /**
   * Open the construct and run a diagnostic digest on it: the gel shows it
   * uncut beside itself cut, which is how a clone is checked before it is
   * sequenced. The enzymes are the ones the design already names.
   */
  const checkOnGel = useCallback(() => {
    if (!chosen) return
    const store = useEditorStore.getState()
    const id = store.openDocumentState(productDocument(design, chosen))
    const enzymes = design.method === 'golden-gate'
      ? [design.typeIIS]
      : [...new Set(design.parts.flatMap(p => partEnzymes(p, design)))]
    store.createGel({
      name: `${chosen.name} check`,
      state: digestWorkspace(id, enzymes.length > 0 ? enzymes : []),
    })
  }, [chosen, design])

  const removePart = useCallback(
    (id: string) => {
      updateClone(clone.id, d => ({ ...d, parts: d.parts.filter(p => p.id !== id) }))
    },
    [clone.id, updateClone],
  )

  return (
    <div className="cw">
      <div className="cw-header">
        <Combine size={14} className="cw-header-icon" />
        <input
          className="cw-name"
          value={clone.name}
          aria-label="Design name"
          onChange={e => renameClone(clone.id, e.target.value)}
        />
        <div className="cw-modes" role="tablist" aria-label="What to build">
          <button
            className={`cw-mode ${mode === 'one' ? 'active' : ''}`}
            role="tab"
            aria-selected={mode === 'one'}
            onClick={() => setMode('one')}
          >
            One construct
          </button>
          <button
            className={`cw-mode ${mode === 'library' ? 'active' : ''}`}
            role="tab"
            aria-selected={mode === 'library'}
            onClick={openLibrary}
            title="Build every combination of the parts at each position"
          >
            Library
          </button>
        </div>
        <span className="cw-spacer" />
        <button
          className="cw-btn"
          onClick={() => useEditorStore.getState().createClone()}
          title="Start another design from the sequence you were viewing"
        >
          <FilePlus2 size={13} /> New
        </button>
        <button
          className={`cw-btn ${aside === 'junctions' ? 'active' : ''}`}
          onClick={() => setAside(a => (a === 'junctions' ? 'none' : 'junctions'))}
          disabled={!chosen || chosen.junctions.length === 0}
          title={chosen ? 'Look at each junction base by base' : 'Nothing to look at yet'}
        >
          Junctions
        </button>
        <button
          className={`cw-btn ${aside === 'oligos' ? 'active' : ''}`}
          onClick={() => setAside(a => (a === 'oligos' ? 'none' : 'oligos'))}
          disabled={!needsOligos(design)}
          title="Primers to order for this design"
        >
          Oligos
        </button>
        <button
          className="cw-btn"
          onClick={checkOnGel}
          disabled={!chosen}
          title="Open the construct and run a diagnostic digest on a gel"
        >
          Check on a gel
        </button>
        <button
          className="cw-btn primary"
          onClick={openProduct}
          disabled={!chosen}
          title={chosen ? 'Open the selected product as a sequence' : 'Nothing to open yet'}
        >
          Open product
        </button>
        <button className="cw-close" onClick={onClose} aria-label="Close">
          <X size={16} />
        </button>
      </div>

      <div className="cw-body">
        <div className="cw-left">
          <div className="cw-section">
            <h3 className="cw-section-title">Method</h3>
            <select
              className="select cw-method-select"
              value={design.method}
              aria-label="Method"
              onChange={e => patch({ method: e.target.value as CloningMethodId })}
            >
              {METHODS.map(method => (
                <option key={method} value={method}>{METHOD_LABEL[method]}</option>
              ))}
            </select>
            <p className="cw-blurb">{METHOD_BLURB[design.method]}</p>

            {design.method === 'restriction' && (
              <div className="cw-options">
                <div className="cw-field">
                  Enzymes
                  <EnzymeField
                    value={design.enzymes}
                    onChange={enzymes => patch({ enzymes })}
                    targets={cutTargets}
                    placeholder="Type e.g. EcoRI+PstI"
                    suggestTitle={design.parts.length > 1 ? 'Recent, then vector once + inserts' : 'Recent and single cutters'}
                  />
                  <span className="cw-field-note">
                    Shown on every map, and they cut any part you have not clicked sites on.
                  </span>
                </div>
                <label className="cw-check">
                  <input
                    type="checkbox"
                    checked={design.purify}
                    onChange={e => patch({ purify: e.target.checked })}
                  />
                  Gel-purify the fragments
                </label>
              </div>
            )}

            {design.method === 'golden-gate' && (
              <label className="cw-field">
                Enzyme
                <select
                  className="select"
                  value={design.typeIIS}
                  onChange={e => patch({ typeIIS: e.target.value })}
                >
                  {TYPE_IIS_ENZYMES.map(name => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </label>
            )}

            {design.method === 'homology' && (
              <div className="cw-options">
                <label className="cw-field">
                  Kit
                  <select
                    className="select"
                    value={design.kit}
                    onChange={e => patch({ kit: e.target.value as CloningDesign['kit'] })}
                  >
                    {KIT_LIST.map(kit => (
                      <option key={kit.id} value={kit.id}>{kit.name}</option>
                    ))}
                  </select>
                </label>
                <p className="cw-blurb">{KIT_LIST.find(k => k.id === design.kit)?.note}</p>
              </div>
            )}

            {design.method === 'gateway' && (
              <label className="cw-field">
                Reaction
                <select
                  className="select"
                  value={design.gateway}
                  onChange={e => patch({ gateway: e.target.value as CloningDesign['gateway'] })}
                >
                  <option value="LR">LR: entry clone into a destination vector</option>
                  <option value="BP">BP: attB product into a donor vector</option>
                  <option value="MultiSite">MultiSite: several entry clones at once</option>
                </select>
              </label>
            )}

            {design.method === 'topo' && (
              <label className="cw-field">
                Variant
                <select
                  className="select"
                  value={design.topo}
                  onChange={e => patch({ topo: e.target.value as CloningDesign['topo'] })}
                >
                  <option value="TA">TA: Taq product with A overhangs</option>
                  <option value="Blunt">Blunt: proofreading polymerase product</option>
                  <option value="Directional">Directional: CACC on the forward primer</option>
                </select>
              </label>
            )}
          </div>

          <div className="cw-section cw-section-grow">
            <h3 className="cw-section-title">
              Parts
              <span className="cw-add" >
                <button className="cw-btn" onClick={() => setAddOpen(o => !o)} aria-expanded={addOpen}>
                  <Plus size={13} /> Add
                </button>
                {addOpen && (
                  <div className="cw-menu" role="menu">
                    {tabs.length === 0 && <span className="cw-menu-empty">No sequences are open</span>}
                    {tabs.map(tab => {
                      const name = sources.get(tab.id)?.name ?? tab.doc.name
                      const hasSelection =
                        tab.id === activeTabId && Math.abs(selection.caret - selection.anchor) > 0
                      return (
                        <div key={tab.id} className="cw-menu-row">
                          <button role="menuitem" onClick={() => addPart(tab.id, false)}>{name}</button>
                          {hasSelection && (
                            <button
                              role="menuitem"
                              className="cw-menu-sub"
                              onClick={() => addPart(tab.id, true)}
                              title="Use only the selected stretch"
                            >
                              selection
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </span>
            </h3>
            <PartsPanel
              design={design}
              fragments={result.fragments}
              sources={sources}
              hovered={hovered}
              onHover={setHovered}
              selected={shownTab}
              onSelect={setTab}
              onChange={patchPart}
              onRemove={removePart}
              onRefresh={refreshPart}
              onReveal={revealPart}
            />
          </div>
        </div>

        <div className="cw-middle">
          {aside === 'oligos' ? (
            <OligosPanel design={design} product={chosen} onClose={() => setAside('none')} />
          ) : aside === 'junctions' && chosen ? (
            <div className="cw-aside">
              <div className="cw-library-bar">
                <strong className="cw-oligo-title">Junctions in {chosen.name}</strong>
                <span className="cw-spacer" />
                <button className="cw-btn" onClick={() => setAside('none')}>Done</button>
              </div>
              <JunctionInspector product={chosen} />
            </div>
          ) : mode === 'library' ? (
            <LibraryPanel
              design={design}
              bins={bins}
              onBinsChange={setBins}
              onOpenRow={openRow}
              onSaveRows={saveRows}
            />
          ) : (
            <MapStage
              design={design}
              result={result}
              chosen={chosen}
              fixes={fixes}
              tab={shownTab}
              onTab={setTab}
              onPart={patchPart}
              onSelectProduct={key => patch({ selected: key })}
              onOpenProduct={product => {
                openDocumentState(productDocument(design, product))
                notify.success(`${product.name} opened as a sequence`)
              }}
              onFix={applyFix}
            />
          )}
        </div>
      </div>
    </div>
  )
}
