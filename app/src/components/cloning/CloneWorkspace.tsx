/**
 * A cloning design as a workspace in the centre panel.
 *
 * Left: the parts and the method. Middle: the design drawn. Right: what the
 * reaction gives. Nothing is behind a Simulate button — the design is re-run
 * on every change, so the product and the reason there isn't one are always
 * in front of you.
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
  partFromDoc,
  sequenceHash,
  type CloningDesign,
  type CloningMethodId,
  type DesignPart,
} from '../../cloning/design'
import { productDocument, productKey, runDesign, selectedProduct } from '../../cloning/run'
import { binsFromDesign, type BulkRow, type DesignBin } from '../../cloning/bulk'
import AssemblyDiagram from './AssemblyDiagram'
import LibraryPanel from './LibraryPanel'
import OligosPanel from './OligosPanel'
import JunctionInspector from './JunctionInspector'
import PartsPanel from './PartsPanel'
import ProductsPanel from './ProductsPanel'

interface Props {
  clone: CloneDoc
  onClose: () => void
}

const METHODS: CloningMethodId[] = ['restriction', 'golden-gate', 'homology', 'gateway', 'topo']

/** The enzymes offered for a plain digest: the ones people cut with. */
const COMMON_ENZYMES = [
  ...new Set([
    ...(ENZYME_GROUPS['Common (6-cutters)'] ?? []),
    ...(ENZYME_GROUPS['Rare (8-cutters)'] ?? []),
  ]),
].sort()

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
  const chosenKey = chosen ? productKey(chosen) : null

  const patch = useCallback(
    (changes: Partial<CloningDesign>, coalesceKey?: string) => {
      updateClone(clone.id, d => ({ ...d, ...changes }), coalesceKey)
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
      updateClone(clone.id, d => ({
        ...d,
        parts: [...d.parts, partFromDoc(doc, { sourceId: tab.id, ...(region ? { region } : {}) })],
      }))
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
    const folderId = store.createFolder(`${clone.name} — ${folderName}`)
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
    const enzymes = design.method === 'golden-gate' ? [design.typeIIS] : design.enzymes
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

  const toggleEnzyme = useCallback(
    (name: string) => {
      updateClone(clone.id, d => ({
        ...d,
        enzymes: d.enzymes.includes(name) ? d.enzymes.filter(e => e !== name) : [...d.enzymes, name],
      }))
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
            <div className="cw-methods">
              {METHODS.map(method => (
                <button
                  key={method}
                  className={`cw-method ${design.method === method ? 'active' : ''}`}
                  onClick={() => patch({ method })}
                  title={METHOD_BLURB[method]}
                >
                  {METHOD_LABEL[method]}
                </button>
              ))}
            </div>
            <p className="cw-blurb">{METHOD_BLURB[design.method]}</p>

            {design.method === 'restriction' && (
              <div className="cw-options">
                <div className="cw-enzymes">
                  {COMMON_ENZYMES.map(name => (
                    <button
                      key={name}
                      className={`cw-enzyme ${design.enzymes.includes(name) ? 'on' : ''}`}
                      onClick={() => toggleEnzyme(name)}
                    >
                      {name}
                    </button>
                  ))}
                </div>
                <label className="cw-part-check">
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
            <AssemblyDiagram
              design={design}
              product={chosen}
              hovered={hovered}
              onHover={setHovered}
              onPick={id => setHovered(id)}
            />
          )}
        </div>

        {mode === 'one' && (
          <div className="cw-right">
            <h3 className="cw-section-title">Products</h3>
            <ProductsPanel
              products={result.products}
              selectedKey={chosenKey}
              problems={result.problems}
              warnings={result.warnings}
              {...(result.fidelity ? { fidelity: result.fidelity } : {})}
              onSelect={key => patch({ selected: key })}
              onOpen={product => {
                openDocumentState(productDocument(design, product))
                notify.success(`${product.name} opened as a sequence`)
              }}
            />
          </div>
        )}
      </div>
    </div>
  )
}
