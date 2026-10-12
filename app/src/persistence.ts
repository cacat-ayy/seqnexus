/**
 * Hybrid persistence: localStorage for metadata, IndexedDB for sequence data.
 *
 * Base strings, chromatogram traces, and alignment results are stored in
 * IndexedDB. Everything else (tab layout, annotations, folders, theme,
 * search parameters) is stored in localStorage.
 */

import { useEditorStore, type ExplorerFolder, type ViewMode, type BaseEdit, type SavedAlignment, type Assembly, type Contig, type GelDoc, type CloneDoc } from './store'
import { sanitizeWorkspace, type GelWorkspaceState } from './gel/workspace'
import { sanitizeDesign, type CloningDesign } from './cloning/design'
import type { Ab1Data } from './io/ab1'
import type { AlignmentResult } from './alignment/types'
import type { BlastSearch } from './blast/types'
import type { ContigDoc } from './assembly/types'
import { sanitizeContigView } from './assembly/view'
import { linkAssemblies, sanitizeAssembly, type AssemblyRecord } from './assembly/container'
import { sanitizeDoc, type AlnDoc } from './msa/model'
import { sanitizeView } from './msa/view'
import { toUid, parseUid, tabUid, type ItemMeta } from './explorer/types'
import type { LibraryOligo } from './primers/oligo'
import type { GuideRecord } from './crispr/types'
import { sanitizeEnzymeSets, type EnzymeSet } from './enzymes/sets'
import { type DocumentSnapshot, type DocumentState, type UndoSnapshot, snapshot, restore } from './models/Document'
import { PieceTable, type PieceTableSnapshot } from './models/PieceTable'
import { Sequence } from './models/Sequence'
import { Annotation } from './models/Annotation'
import type { AnnotationData } from './models/Annotation'
import {
  isAvailable as idbAvailable,
  saveSequences,
  loadSequences,
  deleteSequences,
  getAllStoredIds,
  saveTraces,
  loadTraces,
  deleteTraces,
  getAllStoredTraceIds,
  saveAlignments,
  loadAlignments,
  deleteAlignments,
  getAllStoredAlignmentIds,
  saveUndoHistory,
  loadUndoHistory,
  deleteUndoHistory,
  getAllStoredUndoIds,
  saveBlastSearches,
  loadBlastSearches,
  deleteBlastSearches,
  getAllStoredBlastIds,
  getStoredReadSetIds,
  deleteReadChunks,
} from './storage/idb'
import { sanitizeReadSet } from './ngs/record'
import { mappingStorageList } from './ngs/builder'
import { qcStorageId } from './ngs/qcreport/storage'
import type { ReadSetRecord } from './ngs/types'
import { notify } from './toast'
import { STORAGE_KEYS } from './storage/keys'

const STORAGE_KEY = STORAGE_KEYS.session
/** Where an unreadable session payload is parked so autosave cannot clobber it. */
const CORRUPT_KEY = STORAGE_KEYS.sessionCorrupt
const SAVE_DEBOUNCE_MS = 1000

// ---- Undo history serialization ----

/** Serializable undo history for a single tab, stored in IndexedDB. */
interface SerializedUndoHistory {
  /** The PieceTable's immutable original buffer. */
  original: string
  /** The PieceTable's append-only add buffer. */
  add: string
  /** Current PieceTable tree snapshot (to reconstruct the document without materializing bases). */
  currentTree: PieceTableSnapshot
  /** Undo stack snapshots. */
  undoStack: UndoSnapshot[]
  /** Redo stack snapshots. */
  redoStack: UndoSnapshot[]
}

// ---- Serializable session shapes ----

interface SerializedTabV2 {
  id: string
  doc: Omit<DocumentSnapshot, 'bases'>
  createdAt?: number
  modifiedAt?: number
  viewMode: ViewMode
  zoomLevel: number
  hiddenAnnotationIds?: string[]
  showOrfs?: boolean
  showEnzymes?: boolean
  showAutoAnnotations?: boolean
  readOnly?: boolean
}

/** Sequencing read metadata (trace data stored in IndexedDB). */
interface SerializedSeqRead {
  id: string
  name: string
  createdAt?: number
  trimStart: number
  trimEnd: number
  edits: BaseEdit[]
  reversed?: boolean
}

/** Alignment metadata (result data stored in IndexedDB). */
interface SerializedAlignment {
  id: string
  name: string
  createdAt: number
  modifiedAt?: number
  view?: unknown
  /** Written before the alignment rebuild, which kept only a zoom level. */
  zoomLevel?: number
  /** Written before the alignment rebuild, when IndexedDB held engine results. */
  seqType?: 'dna' | 'protein'
  algorithm?: string
}

/**
 * An alignment from its metadata and stored data: a document, or (saved
 * before the rebuild) an engine result, which sanitizeDoc converts.
 */
/** Storage ids of a saved assembly's NGS samples, in either saved shape (samples, or one 'ngs' before samples). */
function storedSampleIds(a: unknown): string[] {
  if (!a || typeof a !== 'object') return []
  const x = a as { samples?: unknown; ngs?: unknown }
  const list = Array.isArray(x.samples) ? x.samples : x.ngs ? [x.ngs] : []
  return list.flatMap(m => (m && typeof m === 'object' && typeof (m as { storageId?: unknown }).storageId === 'string' ? [(m as { storageId: string }).storageId] : []))
}

function restoreAlignment(sa: SerializedAlignment, raw: unknown): SavedAlignment | null {
  const doc = sanitizeDoc(raw, { seqType: sa.seqType, at: sa.createdAt })
  if (!doc) {
    loadWarnings.push(`The alignment "${sa.name}" could not be read and was skipped`)
    return null
  }
  return {
    id: sa.id,
    name: sa.name,
    doc,
    createdAt: sa.createdAt,
    modifiedAt: sa.modifiedAt ?? sa.createdAt,
    view: sanitizeView(sa.view, sa.zoomLevel),
    undoStack: [],
    redoStack: [],
  }
}

/**
 * Contig metadata; the contig document is stored in IndexedDB beside the
 * alignments. Contigs written before the assembly rebuild referenced read
 * alignments instead (`readAlignmentIds`); those are not restored.
 */
interface SerializedContig {
  id: string
  name: string
  createdAt: number
  modifiedAt?: number
  view?: unknown
  /** The assembly that lists it. Absent in sessions from before assemblies. */
  assemblyId?: string
  /** Written before the assembly rebuild. */
  readAlignmentIds?: string[]
}

/** A gel is plain data; its undo history is not kept. */
interface SerializedGel {
  id: string
  name: string
  createdAt: number
  modifiedAt: number
  state: GelWorkspaceState
}

function serializeGels(gels: GelDoc[]): SerializedGel[] | undefined {
  if (gels.length === 0) return undefined
  return gels.map(g => ({ id: g.id, name: g.name, createdAt: g.createdAt, modifiedAt: g.modifiedAt, state: g.state }))
}

/** A cloning design is plain data; its undo history is not kept. */
interface SerializedClone {
  id: string
  name: string
  createdAt: number
  modifiedAt: number
  design: CloningDesign
}

function serializeClones(clones: CloneDoc[]): SerializedClone[] | undefined {
  if (clones.length === 0) return undefined
  return clones.map(c => ({
    id: c.id, name: c.name, createdAt: c.createdAt, modifiedAt: c.modifiedAt, design: c.design,
  }))
}

/** Stored designs, repaired; ones too damaged to read are dropped with a warning. */
function deserializeClones(raw: SerializedClone[] | undefined): CloneDoc[] {
  const out: CloneDoc[] = []
  for (const c of raw ?? []) {
    const design = c && typeof c.id === 'string' ? sanitizeDesign(c.design) : null
    if (!design) {
      loadWarnings.push('A saved cloning design could not be read and was skipped')
      continue
    }
    out.push({
      id: c.id,
      name: typeof c.name === 'string' && c.name ? c.name : 'Cloning',
      createdAt: typeof c.createdAt === 'number' ? c.createdAt : 0,
      modifiedAt: typeof c.modifiedAt === 'number' ? c.modifiedAt : 0,
      design,
      undoStack: [],
      redoStack: [],
    })
  }
  return out
}

/** Stored gels, repaired; ones too damaged to read are dropped with a warning. */
function deserializeGels(raw: SerializedGel[] | undefined): GelDoc[] {
  const out: GelDoc[] = []
  for (const g of raw ?? []) {
    const state = g && typeof g.id === 'string' ? sanitizeWorkspace(g.state) : null
    if (!state) {
      loadWarnings.push('A saved gel could not be read and was skipped')
      continue
    }
    out.push({
      id: g.id,
      name: typeof g.name === 'string' && g.name ? g.name : 'Gel',
      createdAt: typeof g.createdAt === 'number' ? g.createdAt : 0,
      modifiedAt: typeof g.modifiedAt === 'number' ? g.modifiedAt : 0,
      state,
      undoStack: [],
      redoStack: [],
    })
  }
  return out
}

interface SerializedSessionV2 {
  version: 2
  tabs: SerializedTabV2[]
  activeTabId: string | null
  folders: ExplorerFolder[]
  /** Favourites and notes, keyed by explorer uid. Optional: sessions written
   *  before per-item metadata existed simply have none. */
  itemMeta?: Record<string, ItemMeta>
  /** Tag name to colour. Optional for the same reason as itemMeta. */
  tagColors?: Record<string, string>
  theme: string
  sequencingReads?: SerializedSeqRead[]
  activeSequencingReadIds?: string[]
  alignments?: SerializedAlignment[]
  /** Written before the assembly rebuild; read only to report it. */
  readAlignments?: { id: string }[]
  contigs?: SerializedContig[]
  /** Assemblies, each listing its contigs. Absent before assemblies: each contig is then wrapped in one. */
  assemblies?: AssemblyRecord[]
  activeAssemblyId?: string | null
  /**
   * NGS read sets: their descriptions. The reads are in IndexedDB, and stay
   * out of session files (which hold the reads of nothing this large).
   */
  readSets?: ReadSetRecord[]
  activeReadSetId?: string | null
  /** The primer library. Plain data; optional so older sessions still load. */
  oligos?: LibraryOligo[]
  /** The guide library. Plain data; optional so older sessions still load. */
  guides?: GuideRecord[]
  /** Saved enzyme sets. Plain data; optional so older sessions still load. */
  enzymeSets?: EnzymeSet[]
  /** Virtual gels. Optional so older sessions still load. */
  gels?: SerializedGel[]
  /** Cloning designs. Optional so older sessions still load. */
  clones?: SerializedClone[]
  activeGelId?: string | null
  activeCloneId?: string | null
  activeAlignmentId?: string | null
  activeContigId?: string | null
  // ORF/enzyme panel params (re-run searches on restore)
  orfParams?: { minCodons: number; startCodons: string[]; allowInterior: boolean }
  enzymeParams?: { subset: string; searchQuery: string; filterByCount: boolean; minCuts: number; maxCuts: number }
}

// ---- Save ----

let _idbOk: boolean | null = null

async function checkIdb(): Promise<boolean> {
  if (_idbOk === null) _idbOk = await idbAvailable()
  return _idbOk
}

/** A folder as written before folders could hold anything but sequences. */
interface LegacyFolder {
  id: string
  name: string
  tabIds?: string[]
  itemUids?: string[]
  parentId?: string | null
  color?: string
  collapsed?: boolean
}

/**
 * Read folders in either shape.
 *
 * Sessions written before folders became kind-agnostic hold `tabIds`, a list
 * of bare tab ids. Those become sequence uids on the way in. Only the new
 * shape is ever written back, so this runs once per stored session.
 */
export function migrateFolders(folders: unknown): ExplorerFolder[] {
  if (!Array.isArray(folders)) return []
  return (folders as LegacyFolder[])
    .filter(f => f && typeof f.id === 'string')
    .map(f => ({
      id: f.id,
      name: typeof f.name === 'string' ? f.name : 'Folder',
      itemUids: Array.isArray(f.itemUids)
        ? f.itemUids.filter((u): u is string => typeof u === 'string')
        : (f.tabIds ?? []).filter(id => typeof id === 'string').map(id => toUid('sequence', id)),
      parentId: typeof f.parentId === 'string' ? f.parentId : null,
      color: typeof f.color === 'string' ? f.color : undefined,
      collapsed: f.collapsed === true,
    }))
}

/**
 * Item metadata for items that still exist.
 *
 * Deleting a starred item leaves its entry behind, because the delete buffer
 * may still put it back. Filtering at save time rather than at delete time
 * keeps undo intact without letting the map grow across a long session.
 */
function liveItemMeta(state: ReturnType<typeof useEditorStore.getState>): Record<string, ItemMeta> | undefined {
  const live = new Set<string>([
    ...state.tabs.map(tabUid),
    ...state.sequencingReads.map(r => toUid('read', r.id)),
    ...state.alignments.map(a => toUid('alignment', a.id)),
    ...state.contigs.map(c => toUid('contig', c.id)),
    ...state.assemblies.map(a => toUid('assembly', a.id)),
    ...state.readSets.map(r => toUid('readset', r.id)),
    ...state.oligos.map(o => toUid('oligo', o.id)),
    ...state.gels.map(g => toUid('gel', g.id)),
    ...state.clones.map(c => toUid('clone', c.id)),
  ])
  const out: Record<string, ItemMeta> = {}
  let any = false
  for (const [uid, meta] of Object.entries(state.itemMeta)) {
    if (!live.has(uid)) continue
    out[uid] = meta
    any = true
  }
  return any ? out : undefined
}

/** Build the session data from the current store state. */
function buildSessionData(theme: string): {
  meta: SerializedSessionV2
  sequences: { tabId: string; bases: string }[]
  traces: { readId: string; data: Ab1Data }[]
  alignmentData: { alignId: string; data: AlnDoc | AlignmentResult | ContigDoc }[]
  undoEntries: { tabId: string; data: SerializedUndoHistory }[]
  blastData: { tabId: string; data: BlastSearch[] }[]
} {
  const state = useEditorStore.getState()
  const sequences: { tabId: string; bases: string }[] = []
  const undoEntries: { tabId: string; data: SerializedUndoHistory }[] = []
  const v2Tabs: SerializedTabV2[] = []

  for (const tab of state.tabs) {
    const snap = snapshot(tab.doc)
    sequences.push({ tabId: tab.id, bases: snap.bases })

    // Save undo history if there are any undo/redo entries
    if (tab.undoStack.length > 0 || tab.redoStack.length > 0) {
      const pt = tab.doc.sequence.pieceTable
      undoEntries.push({
        tabId: tab.id,
        data: {
          original: pt.originalBuffer,
          add: pt.addBuffer,
          currentTree: pt.snapshot(),
          undoStack: tab.undoStack,
          redoStack: tab.redoStack,
        },
      })
    }

    const { bases, ...docWithoutBases } = snap
    v2Tabs.push({
      id: tab.id, doc: docWithoutBases, viewMode: tab.viewMode, zoomLevel: tab.zoomLevel,
      createdAt: tab.createdAt || undefined,
      modifiedAt: tab.modifiedAt || undefined,
      hiddenAnnotationIds: tab.hiddenAnnotationIds.length > 0 ? tab.hiddenAnnotationIds : undefined,
      showOrfs: tab.showOrfs || undefined,
      showEnzymes: tab.showEnzymes || undefined,
      showAutoAnnotations: tab.showAutoAnnotations || undefined,
      readOnly: tab.readOnly || undefined,
    })
  }

  // Sequencing reads: metadata in localStorage, trace data in IndexedDB
  const seqReads: SerializedSeqRead[] = state.sequencingReads.map(r => ({
    id: r.id,
    name: r.data.name,
    createdAt: r.createdAt || undefined,
    trimStart: r.trimStart,
    trimEnd: r.trimEnd,
    edits: r.edits,
    ...(r.reversed ? { reversed: true } : {}),
  }))
  const traces = state.sequencingReads.map(r => ({ readId: r.id, data: r.data }))

  // Alignments: metadata in localStorage, result data in IndexedDB
  const serializedAlignments: SerializedAlignment[] = state.alignments.map(a => ({
    id: a.id,
    name: a.name,
    createdAt: a.createdAt,
    modifiedAt: a.modifiedAt,
    view: a.view,
  }))
  const alignmentData = state.alignments.map(a => ({ alignId: a.id, data: a.doc }))

  // Contigs: metadata in localStorage, the document in IndexedDB (shared store with alignments)
  const serializedContigs: SerializedContig[] = state.contigs.map(c => ({
    id: c.id,
    name: c.name,
    createdAt: c.createdAt,
    modifiedAt: c.modifiedAt,
    view: c.view,
    assemblyId: c.assemblyId,
  }))
  const contigData = state.contigs.map(c => ({ alignId: c.id, data: c.doc }))

  return {
    meta: {
      version: 2,
      tabs: v2Tabs,
      activeTabId: state.activeTabId,
      folders: state.folders,
      itemMeta: liveItemMeta(state),
      tagColors: Object.keys(state.tagColors).length > 0 ? state.tagColors : undefined,
      theme,
      sequencingReads: seqReads,
      activeSequencingReadIds: state.activeSequencingReadIds,
      activeAlignmentId: state.activeAlignmentId,
      activeContigId: state.activeContigId,
      activeAssemblyId: state.activeAssemblyId,
      alignments: serializedAlignments,
      contigs: serializedContigs.length > 0 ? serializedContigs : undefined,
      assemblies: state.assemblies.length > 0 ? state.assemblies : undefined,
      readSets: state.readSets.length > 0 ? state.readSets : undefined,
      activeReadSetId: state.activeReadSetId,
      oligos: state.oligos.length > 0 ? state.oligos : undefined,
      guides: state.guideLibrary.length > 0 ? state.guideLibrary : undefined,
      enzymeSets: state.enzymeSets.length > 0 ? state.enzymeSets : undefined,
      gels: serializeGels(state.gels),
      clones: serializeClones(state.clones),
      activeGelId: state.activeGelId,
      activeCloneId: state.activeCloneId,
      orfParams: {
        minCodons: state.orfMinCodons,
        startCodons: state.orfStartCodons,
        allowInterior: state.orfAllowInterior,
      },
      enzymeParams: {
        subset: state.enzymeSubset,
        searchQuery: state.enzymeSearchQuery,
        filterByCount: state.enzymeFilterByCount,
        minCuts: state.enzymeMinCuts,
        maxCuts: state.enzymeMaxCuts,
      },
    },
    sequences,
    traces,
    alignmentData: [...alignmentData, ...contigData],
    undoEntries,
    // BLAST searches: in IndexedDB beside the bases, one list per tab, only
    // for tabs that have any. They can be large (every alignment is kept).
    blastData: state.tabs.filter(t => t.blastSearches.length > 0).map(t => ({ tabId: t.id, data: t.blastSearches })),
  }
}

/**
 * A tab's stored BLAST searches, as read back: the ones with what the drawer
 * needs (a request id, settings, a query and a result), anything else left out.
 */
function blastSearchList(raw: unknown): BlastSearch[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const ok = raw.filter((b: Partial<BlastSearch> | null) =>
    !!b && typeof b.rid === 'string' && !!b.settings && Array.isArray(b.query?.segments) && Array.isArray(b.result?.hits))
  return ok.length > 0 ? ok : undefined
}

// ---- Data the store doesn't hold but storage must keep ----

/**
 * Saved items the last load failed to read because storage threw (not
 * because their data was missing). They never reach the store, so without
 * this the next autosave would write an index without them and delete their
 * data as orphans, turning a passing read error into permanent loss. Instead
 * every save carries their index entries forward and leaves their data
 * alone, and the next load tries them again.
 */
interface Unrestored {
  tabs: SerializedTabV2[]
  reads: SerializedSeqRead[]
  alignments: SerializedAlignment[]
  contigs: SerializedContig[]
  /** The assemblies of unrestored contigs, so the contigs find them again. */
  assemblies: AssemblyRecord[]
}
const noneUnrestored = (): Unrestored => ({ tabs: [], reads: [], alignments: [], contigs: [], assemblies: [] })
let unrestored = noneUnrestored()

/**
 * Set when this page's load could not read the saved session at all. Its data
 * is still in IndexedDB, and nothing in memory says which records are its, so
 * no cleanup may run until the page is reloaded.
 */
let cleanupBlocked = false

/** Append the unrestored items to the index about to be written. */
function carryUnrestored(meta: SerializedSessionV2): void {
  const keep = <T extends { id: string }>(live: T[] | undefined, kept: T[]): T[] => {
    const ids = new Set((live ?? []).map(x => x.id))
    return [...(live ?? []), ...kept.filter(x => !ids.has(x.id))]
  }
  meta.tabs = keep(meta.tabs, unrestored.tabs)
  meta.sequencingReads = keep(meta.sequencingReads, unrestored.reads)
  meta.alignments = keep(meta.alignments, unrestored.alignments)
  if (unrestored.contigs.length > 0) meta.contigs = keep(meta.contigs, unrestored.contigs)
  if (unrestored.assemblies.length > 0) meta.assemblies = keep(meta.assemblies, unrestored.assemblies)
}

/**
 * IDs whose stored data orphan cleanup must leave alone even though the index
 * being written doesn't list them, or null when cleanup must not run at all.
 *
 * Covers the unrestored items, and every item of a parked unreadable session
 * (preserveCorruptSession): that copy is only recoverable while the data it
 * points at still exists.
 */
function cleanupKeeps(): Set<string> | null {
  if (cleanupBlocked) return null
  const ids = new Set<string>()
  const { tabs, reads, alignments, contigs } = unrestored
  for (const x of [...tabs, ...reads, ...alignments, ...contigs]) ids.add(x.id)
  let parked: string | null
  try {
    parked = localStorage.getItem(CORRUPT_KEY)
  } catch {
    return null
  }
  if (!parked) return ids
  try {
    const data = JSON.parse((JSON.parse(parked) as { raw: string }).raw) as Partial<SerializedSessionV2>
    const lists: unknown[] = [data.tabs, data.sequencingReads, data.alignments, data.contigs, data.readSets]
    for (const list of lists) {
      if (!Array.isArray(list)) continue
      for (const x of list) {
        if (x && typeof (x as { id?: unknown }).id === 'string') ids.add((x as { id: string }).id)
      }
    }
    return ids
  } catch {
    // Can't tell which records the parked copy needs, so keep them all.
    return null
  }
}

/** Callback invoked after each successful save so the UI can refresh the storage indicator. */
let _onSaveComplete: (() => void) | null = null
export function onSaveComplete(cb: (() => void) | null): void {
  _onSaveComplete = cb
}

// ---- What the last save wrote ----

type EditorState = ReturnType<typeof useEditorStore.getState>

interface WrittenTab {
  /** Bases are unchanged while both the Sequence and its PieceTable version are. */
  seq: Sequence
  version: number
  undo: unknown
  redo: unknown
  hasHistory: boolean
}

/** References to what storage holds, from the last successful save (or the load). */
interface Written {
  tabs: Map<string, WrittenTab>
  traces: Map<string, unknown>
  alignments: Map<string, unknown>
  /** Each tab's list of BLAST searches, for tabs that have any. */
  blast: Map<string, unknown>
}

const emptyWritten = (): Written => ({ tabs: new Map(), traces: new Map(), alignments: new Map(), blast: new Map() })
let written = emptyWritten()
let lastSaveFailed = false

function writtenFrom(state: EditorState): Written {
  const w = emptyWritten()
  for (const t of state.tabs) {
    w.tabs.set(t.id, {
      seq: t.doc.sequence,
      version: t.doc.sequence.pieceTable.version,
      undo: t.undoStack,
      redo: t.redoStack,
      hasHistory: t.undoStack.length > 0 || t.redoStack.length > 0,
    })
    if (t.blastSearches.length > 0) w.blast.set(t.id, t.blastSearches)
  }
  for (const r of state.sequencingReads) w.traces.set(r.id, r.data)
  for (const a of state.alignments) w.alignments.set(a.id, a.doc)
  for (const c of state.contigs) w.alignments.set(c.id, c.doc)
  return w
}

function sameSequence(a: WrittenTab | undefined, b: WrittenTab | undefined): boolean {
  return !!a && !!b && a.seq === b.seq && a.version === b.version
}

/**
 * Record the store as it is now as already in storage. Called right after a
 * session is restored: what was just read need not be written straight back
 * (a plate of chromatograms would otherwise be rewritten on every visit).
 */
export function markSessionSaved(): void {
  written = writtenFrom(useEditorStore.getState())
}

/**
 * Whether anything that saveSession writes differs between two store states.
 * The store changes on every caret move, hover and selection; only changes
 * to saved data should schedule an autosave.
 */
export function savedStateChanged(state: EditorState, prev: EditorState): boolean {
  if (state.tabs !== prev.tabs) {
    if (state.tabs.length !== prev.tabs.length) return true
    for (let i = 0; i < state.tabs.length; i++) {
      const a = state.tabs[i]
      const b = prev.tabs[i]
      if (a === b) continue
      if (
        a.id !== b.id || a.doc !== b.doc || a.undoStack !== b.undoStack || a.redoStack !== b.redoStack ||
        a.viewMode !== b.viewMode || a.zoomLevel !== b.zoomLevel || a.hiddenAnnotationIds !== b.hiddenAnnotationIds ||
        a.showOrfs !== b.showOrfs || a.showEnzymes !== b.showEnzymes || a.showAutoAnnotations !== b.showAutoAnnotations ||
        a.readOnly !== b.readOnly || a.createdAt !== b.createdAt || a.modifiedAt !== b.modifiedAt ||
        a.blastSearches !== b.blastSearches
      ) return true
    }
  }
  const keys: (keyof EditorState)[] = [
    'activeTabId', 'folders', 'itemMeta', 'tagColors', 'sequencingReads', 'activeSequencingReadIds',
    'alignments', 'contigs', 'oligos', 'guideLibrary', 'enzymeSets', 'gels', 'activeGelId', 'activeAlignmentId', 'activeContigId',
    'clones', 'activeCloneId', 'assemblies', 'activeAssemblyId', 'readSets', 'activeReadSetId',
    'orfMinCodons', 'orfStartCodons', 'orfAllowInterior',
    'enzymeSubset', 'enzymeSearchQuery', 'enzymeFilterByCount', 'enzymeMinCuts', 'enzymeMaxCuts',
  ]
  return keys.some(k => state[k] !== prev[k])
}

/**
 * True while work may not be in storage yet: a save is waiting or running,
 * or the last one failed (including storage being unavailable).
 */
export function hasUnsavedChanges(): boolean {
  return _timer !== null || saving !== null || lastSaveFailed
}

/** Save now instead of after the debounce, if a save is waiting. For page hide/close. */
export function flushSave(theme: string): void {
  if (_timer === null) return
  clearTimeout(_timer)
  _timer = null
  void saveSession(theme)
}

/** The save currently writing, if any. */
let saving: Promise<void> | null = null
/** One more save requested while `saving` runs; carries the latest theme. */
let queued: { theme: string; done: Promise<void> } | null = null

/**
 * Save session. Async - writes bases/traces/alignments to IndexedDB, metadata to localStorage.
 *
 * Saves run one at a time. Each is several IndexedDB steps followed by orphan
 * cleanup and the index write, so two interleaved saves could have the older
 * one's cleanup delete what the newer one just wrote, or the older index
 * point at deleted data. A save requested while one runs waits for it, and
 * however many arrive meanwhile, exactly one more runs, on the state as it is
 * then.
 */
export function saveSession(theme: string): Promise<void> {
  if (!saving) {
    saving = writeSession(theme).finally(() => { saving = null })
    return saving
  }
  if (queued) {
    queued.theme = theme
    return queued.done
  }
  const next = () => {
    const t = queued!.theme
    queued = null
    return saveSession(t)
  }
  queued = { theme, done: saving.then(next, next) }
  return queued.done
}

async function writeSession(theme: string): Promise<void> {
  const { meta, sequences, traces, alignmentData, undoEntries, blastData } = buildSessionData(theme)
  // Same tick as buildSessionData, so it describes exactly what is written.
  const next = writtenFrom(useEditorStore.getState())
  carryUnrestored(meta)

  try {
    if (!(await checkIdb())) {
      lastSaveFailed = true
      notify.error('Your work is not being saved in this browser', {
        detail: 'Storage is blocked or unavailable here (some private windows do this). Use File → Export session to keep a copy.',
        key: 'session-save',
      })
      return
    }
    {
      // Write only what changed since the last save: a caret move or one
      // typed base must not rewrite every genome, trace and alignment.
      const prev = written
      const dirtySequences = sequences.filter(s => !sameSequence(prev.tabs.get(s.tabId), next.tabs.get(s.tabId)))
      if (dirtySequences.length > 0) await saveSequences(dirtySequences)

      const dirtyTraces = traces.filter(t => prev.traces.get(t.readId) !== t.data)
      if (dirtyTraces.length > 0) await saveTraces(dirtyTraces)

      const dirtyAlignments = alignmentData.filter(a => prev.alignments.get(a.alignId) !== a.data)
      if (dirtyAlignments.length > 0) await saveAlignments(dirtyAlignments)

      const dirtyUndo = undoEntries.filter(u => {
        const was = prev.tabs.get(u.tabId)
        const now = next.tabs.get(u.tabId)
        return !sameSequence(was, now) || was?.undo !== now?.undo || was?.redo !== now?.redo
      })
      if (dirtyUndo.length > 0) await saveUndoHistory(dirtyUndo)

      // A tab whose history is gone must lose its stored history too: on
      // reload a stored history wins over the stored bases, and would bring
      // back an older document.
      const historyGone = [...next.tabs].filter(([id, t]) => !t.hasHistory && prev.tabs.get(id)?.hasHistory !== false).map(([id]) => id)
      if (historyGone.length > 0) await deleteUndoHistory(historyGone)

      const dirtyBlast = blastData.filter(b => prev.blast.get(b.tabId) !== b.data)
      if (dirtyBlast.length > 0) await saveBlastSearches(dirtyBlast)
      // A tab whose last search was deleted keeps none in storage either.
      const blastGone = [...prev.blast.keys()].filter(id => next.tabs.has(id) && !next.blast.has(id))
      if (blastGone.length > 0) await deleteBlastSearches(blastGone)

      const keeps = cleanupKeeps()
      if (keeps) {
        // Clean up orphaned IndexedDB entries (sequences)
        const currentIds = new Set([...meta.tabs.map(t => t.id), ...keeps])
        const storedIds = await getAllStoredIds()
        const orphans = storedIds.filter(id => !currentIds.has(id))
        if (orphans.length > 0) await deleteSequences(orphans)

        // Clean up orphaned IndexedDB entries (traces)
        const currentReadIds = new Set([...(meta.sequencingReads ?? []).map(r => r.id), ...keeps])
        const storedTraceIds = await getAllStoredTraceIds()
        const traceOrphans = storedTraceIds.filter(id => !currentReadIds.has(id))
        if (traceOrphans.length > 0) await deleteTraces(traceOrphans)

        // Clean up orphaned IndexedDB entries (alignments)
        const currentAlignIds = new Set([
          ...(meta.alignments ?? []).map(a => a.id),
          ...(meta.contigs ?? []).map(c => c.id),
          ...keeps,
        ])
        const storedAlignIds = await getAllStoredAlignmentIds()
        const alignOrphans = storedAlignIds.filter(id => !currentAlignIds.has(id))
        if (alignOrphans.length > 0) await deleteAlignments(alignOrphans)

        // Clean up orphaned IndexedDB entries (undo history)
        const storedUndoIds = await getAllStoredUndoIds()
        const undoOrphans = storedUndoIds.filter(id => !currentIds.has(id))
        if (undoOrphans.length > 0) await deleteUndoHistory(undoOrphans)

        // Clean up orphaned IndexedDB entries (BLAST searches of closed tabs)
        const storedBlastIds = await getAllStoredBlastIds()
        const blastOrphans = storedBlastIds.filter(id => !currentIds.has(id))
        if (blastOrphans.length > 0) await deleteBlastSearches(blastOrphans)
      }

      // Write metadata (without bases/traces/alignment results) to localStorage
      localStorage.setItem(STORAGE_KEY, JSON.stringify(meta))
    }
    // Only now: if any step failed, the next save must write it all again.
    written = next
    lastSaveFailed = false
    _onSaveComplete?.()
  } catch (err) {
    lastSaveFailed = true
    const quota = err instanceof DOMException && err.name === 'QuotaExceededError'
    // Keyed: autosave retries on a timer, and a browser that is out of room
    // will fail every time. One standing notice, not one per attempt.
    notify.error(quota ? 'Storage quota exceeded' : 'Session save failed', {
      detail: 'Export your work to avoid losing it.',
      key: 'session-save',
    })
  }
}

// ---- Load ----

export interface RestoredSeqRead {
  id: string
  data: Ab1Data
  createdAt?: number
  trimStart: number
  trimEnd: number
  edits: BaseEdit[]
  reversed?: boolean
}

export interface RestoredSession {
  tabs: { id: string; doc: DocumentState; createdAt?: number; modifiedAt?: number; viewMode: ViewMode; zoomLevel: number; hiddenAnnotationIds?: string[]; showOrfs?: boolean; showEnzymes?: boolean; showAutoAnnotations?: boolean; readOnly?: boolean; undoStack?: UndoSnapshot[]; redoStack?: UndoSnapshot[]; blastSearches?: BlastSearch[] }[]
  activeTabId: string | null
  folders: ExplorerFolder[]
  /** Favourites and notes, keyed by explorer uid. */
  itemMeta: Record<string, ItemMeta>
  tagColors: Record<string, string>
  theme: string
  sequencingReads: RestoredSeqRead[]
  activeSequencingReadIds: string[]
  alignments: SavedAlignment[]
  contigs: Contig[]
  assemblies: Assembly[]
  activeAssemblyId?: string | null
  /** Always empty from a session file: read sets stay in the browser. */
  readSets: ReadSetRecord[]
  activeReadSetId?: string | null
  oligos: LibraryOligo[]
  /** Optional so a session written before guides existed still restores. */
  guides?: GuideRecord[]
  enzymeSets?: EnzymeSet[]
  gels: GelDoc[]
  clones: CloneDoc[]
  activeGelId?: string | null
  activeCloneId?: string | null
  activeAlignmentId?: string | null
  activeContigId?: string | null
  orfParams?: { minCodons: number; startCodons: string[]; allowInterior: boolean }
  enzymeParams?: { subset: string; searchQuery: string; filterByCount: boolean; minCuts: number; maxCuts: number }
  /** Session import only: what the file named but did not contain. */
  warnings?: string[]
}

/** "2 sequencing reads could not be restored (data missing): a, b" */
function missingWarning(noun: string, names: string[], where: string): string {
  const plural = names.length === 1 ? noun : `${noun}s`
  return `${names.length} ${plural} could not be restored (${where}): ${names.join(', ')}`
}

/**
 * Warnings collected during the most recent loadSession() call.
 *
 * Restore degrades gracefully in several places (missing bases, unreadable
 * traces, corrupt metadata). Each of those silently drops user data, so the
 * reasons are recorded here for the UI to surface rather than swallowed.
 */
let loadWarnings: string[] = []

/** Read and clear the warnings recorded by the last loadSession(). */
export function consumeLoadWarnings(): string[] {
  const w = loadWarnings
  loadWarnings = []
  return w
}

/**
 * Stash an unreadable session payload so it is not overwritten by the next
 * autosave. Without this, a single corrupt write is unrecoverable: the app
 * starts empty and saves over the only copy seconds later.
 */
function preserveCorruptSession(raw: string): void {
  try {
    localStorage.setItem(CORRUPT_KEY, JSON.stringify({ savedAt: Date.now(), raw }))
  } catch {
    // Quota exhausted, or the payload is too large to duplicate. Nothing more
    // we can do; the warning below still tells the user what happened.
  }
}

/** Load session. Async - reads metadata from localStorage, bases from IndexedDB. */
export async function loadSession(): Promise<RestoredSession | null> {
  loadWarnings = []
  unrestored = noneUnrestored()
  cleanupBlocked = false
  let raw: string | null = null
  try {
    raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const data: SerializedSessionV2 = JSON.parse(raw)
    if (!data || data.version !== 2 || !Array.isArray(data.tabs)) {
      cleanupBlocked = true
      preserveCorruptSession(raw)
      loadWarnings.push(
        'Your saved session could not be read (unrecognised format). A copy has been kept: export it from Storage if you need to recover it.',
      )
      return null
    }

    return await loadV2(data)
  } catch (err) {
    // Whatever loadV2 got through, none of it reaches the store.
    unrestored = noneUnrestored()
    cleanupBlocked = true
    if (raw) preserveCorruptSession(raw)
    loadWarnings.push(
      `Your saved session could not be restored: ${err instanceof Error ? err.message : String(err)}. A copy of the saved data has been kept.`,
    )
    return null
  }
}

/** Load a v2 session: fetch bases from IndexedDB, reassemble snapshots. */
async function loadV2(data: SerializedSessionV2): Promise<RestoredSession | null> {
  const tabIds = data.tabs.map(t => t.id)
  let basesMap = new Map<string, string>()
  let undoMap = new Map<string, unknown>()
  let basesError: string | null = null

  try {
    basesMap = await loadSequences(tabIds)
  } catch (err) {
    // IndexedDB read failed. The data may well still be there, so the tabs
    // are kept for the next load rather than dropped (see `unrestored`).
    basesError = err instanceof Error ? err.message : String(err)
  }

  try {
    undoMap = await loadUndoHistory(tabIds)
  } catch {
    // Undo history load failed - tabs will start with empty undo stacks.
    // Not surfaced: no user data is lost, only the ability to undo past edits.
  }

  let blastMap = new Map<string, unknown>()
  try {
    blastMap = await loadBlastSearches(tabIds)
  } catch {
    // The searches stay in storage (a save only rewrites a tab's list when
    // it changes), so a failed read loses nothing; they show next time.
  }

  const tabs: RestoredSession['tabs'] = []
  const droppedTabs: string[] = []
  for (const st of data.tabs) {
    const bases = basesMap.get(st.id)
    if (bases === undefined) {
      if (basesError !== null) {
        unrestored.tabs.push(st)
        continue
      }
      // bases lost - skip this tab, but remember it so the user is told which
      droppedTabs.push(st.doc?.name ?? st.id)
      continue
    }

    const undoData = undoMap.get(st.id) as SerializedUndoHistory | undefined
    let doc: DocumentState
    let undoStack: UndoSnapshot[] | undefined
    let redoStack: UndoSnapshot[] | undefined

    // Stored history is only trusted when it reproduces the stored bases: one
    // left behind by an older save would otherwise bring back an old document.
    const historyMatches = (h: SerializedUndoHistory) => {
      try {
        const pt = PieceTable.fromBuffers(h.original, h.add, h.currentTree)
        return pt.length === bases.length && pt.toString() === bases
      } catch {
        return false
      }
    }
    if (undoData && undoData.original !== undefined && undoData.currentTree && historyMatches(undoData)) {
      // Reconstruct PieceTable from saved buffers so undo snapshots remain valid
      try {
        const pt = PieceTable.fromBuffers(undoData.original, undoData.add, undoData.currentTree)
        const seq = Sequence.fromPieceTable(pt, st.doc.topology, st.doc.alphabet ?? 'dna')
        doc = {
          name: st.doc.name,
          description: st.doc.description,
          sequence: seq,
          annotations: (st.doc.annotations ?? []).map((d: AnnotationData) => new Annotation(d)),
          ...(st.doc.primers?.length ? { primers: st.doc.primers } : {}),
          metadata: st.doc.metadata,
        }
        undoStack = undoData.undoStack ?? []
        redoStack = undoData.redoStack ?? []
      } catch {
        // Undo reconstruction failed - fall back to plain restore
        const fullSnap: DocumentSnapshot = { ...st.doc, bases }
        doc = restore(fullSnap)
      }
    } else {
      const fullSnap: DocumentSnapshot = { ...st.doc, bases }
      doc = restore(fullSnap)
    }

    tabs.push({
      id: st.id,
      doc,
      createdAt: st.createdAt,
      modifiedAt: st.modifiedAt,
      viewMode: st.viewMode,
      zoomLevel: st.zoomLevel,
      hiddenAnnotationIds: st.hiddenAnnotationIds,
      showOrfs: st.showOrfs,
      showEnzymes: st.showEnzymes,
      showAutoAnnotations: st.showAutoAnnotations,
      readOnly: st.readOnly,
      undoStack,
      redoStack,
      blastSearches: blastSearchList(blastMap.get(st.id)),
    })
  }

  if (droppedTabs.length > 0) {
    loadWarnings.push(
      `${droppedTabs.length} saved ${droppedTabs.length === 1 ? 'sequence' : 'sequences'} could not be restored (data missing from storage): ${droppedTabs.join(', ')}`,
    )
  }
  if (unrestored.tabs.length > 0) {
    const n = unrestored.tabs.length
    loadWarnings.push(
      `${n} saved ${n === 1 ? 'sequence' : 'sequences'} could not be read from storage (${basesError}): ${unrestored.tabs.map(t => t.doc?.name ?? t.id).join(', ')}. ${n === 1 ? 'It has' : 'They have'} been kept and will be tried again when SeqNexus is next opened.`,
    )
  }

  // Restore sequencing reads from IndexedDB traces
  const seqReads: RestoredSeqRead[] = []
  const serializedReads = data.sequencingReads ?? []
  const lostReads: string[] = []
  if (serializedReads.length > 0) {
    try {
      const readIds = serializedReads.map(r => r.id)
      const tracesMap = await loadTraces(readIds)
      for (const sr of serializedReads) {
        const traceData = tracesMap.get(sr.id) as Ab1Data | undefined
        if (!traceData) {
          lostReads.push(sr.name)
          continue
        }
        seqReads.push({
          id: sr.id,
          data: { ...traceData, name: sr.name },
          createdAt: sr.createdAt,
          trimStart: sr.trimStart,
          trimEnd: sr.trimEnd,
          edits: sr.edits ?? [],
          reversed: sr.reversed,
        })
      }
    } catch (err) {
      // Trace load failed. Keep the reads for the next load (see `unrestored`).
      seqReads.length = 0
      unrestored.reads = serializedReads
      const n = serializedReads.length
      loadWarnings.push(
        `${n} sequencing ${n === 1 ? 'read' : 'reads'} could not be read from storage (${err instanceof Error ? err.message : String(err)}). ${n === 1 ? 'It has' : 'They have'} been kept and will be tried again when SeqNexus is next opened.`,
      )
    }
  }

  // Restore alignments from IndexedDB
  const alignments: SavedAlignment[] = []
  const serializedAligns = data.alignments ?? []
  const lostAlignments: string[] = []
  if (serializedAligns.length > 0) {
    try {
      const alignIds = serializedAligns.map(a => a.id)
      const alignMap = await loadAlignments(alignIds)
      for (const sa of serializedAligns) {
        const raw = alignMap.get(sa.id)
        if (!raw) {
          lostAlignments.push(sa.name)
          continue
        }
        const aln = restoreAlignment(sa, raw)
        if (aln) alignments.push(aln)
      }
    } catch (err) {
      // Alignment load failed. Keep them for the next load (see `unrestored`).
      alignments.length = 0
      unrestored.alignments = serializedAligns
      const n = serializedAligns.length
      loadWarnings.push(
        `${n} ${n === 1 ? 'alignment' : 'alignments'} could not be read from storage (${err instanceof Error ? err.message : String(err)}). ${n === 1 ? 'It has' : 'They have'} been kept and will be tried again when SeqNexus is next opened.`,
      )
    }
  }

  if (lostReads.length > 0) loadWarnings.push(missingWarning('sequencing read', lostReads, 'data missing from storage'))
  if (lostAlignments.length > 0) loadWarnings.push(missingWarning('alignment', lostAlignments, 'data missing from storage'))

  // Restore contigs from IndexedDB. Contigs from before the assembly rebuild
  // (built from read alignments) cannot be shown any more and are dropped.
  const contigs: Contig[] = []
  const savedContigs = (data.contigs ?? []).filter(c => !c.readAlignmentIds)
  if (savedContigs.length > 0) {
    try {
      const map = await loadAlignments(savedContigs.map(c => c.id))
      for (const sc of savedContigs) {
        const c = restoreContig(sc, map.get(sc.id))
        if (c) contigs.push(c)
      }
    } catch {
      // Keep them for the next load (see `unrestored`), with their assemblies.
      contigs.length = 0
      unrestored.contigs = savedContigs
      unrestored.assemblies = (data.assemblies ?? []).map(sanitizeAssembly).filter((a): a is AssemblyRecord => a !== null)
      const n = savedContigs.length
      loadWarnings.push(`${n} ${n === 1 ? 'contig' : 'contigs'} could not be read from storage. ${n === 1 ? 'It has' : 'They have'} been kept and will be tried again when SeqNexus is next opened.`)
    }
  }
  const legacy = (data.readAlignments?.length ?? 0) + (data.contigs ?? []).filter(c => c.readAlignmentIds).length
  if (legacy > 0) {
    loadWarnings.push(`${legacy} read ${legacy === 1 ? 'alignment or contig' : 'alignments and contigs'} from before the assembly rebuild could not be kept. Assemble the reads again to get them back.`)
  }

  // Clean up orphaned IndexedDB entries
  try {
    const keeps = cleanupKeeps()
    if (keeps) {
      const currentIds = new Set([...tabIds, ...keeps])
      const storedIds = await getAllStoredIds()
      const orphans = storedIds.filter(id => !currentIds.has(id))
      if (orphans.length > 0) await deleteSequences(orphans)
    }
  } catch {
    // best-effort cleanup
  }

  // Read sets: descriptions from the index; their reads stay in IndexedDB.
  // Reads of no listed read set (deleted ones past undo, cancelled imports)
  // are removed here, and only here: at save time, an import in progress or
  // a read set in the Recently deleted buffer would look the same.
  const readSets = (data.readSets ?? []).map(sanitizeReadSet).filter((r): r is ReadSetRecord => r !== null)
  try {
    const keeps = cleanupKeeps()
    if (keeps) {
      // NGS mappings store their alignments and coverage beside the reads.
      const mappings = (data.assemblies ?? []).flatMap(a => storedSampleIds(a).flatMap(id => mappingStorageList(id)))
      // A read set's quality report is stored under its own id (qcreport/storage.ts).
      const listed = new Set([...readSets.flatMap(r => [r.id, qcStorageId(r.id)]), ...mappings, ...keeps])
      const stray = (await getStoredReadSetIds()).filter(id => !listed.has(id))
      if (stray.length > 0) await deleteReadChunks(stray)
    }
  } catch {
    // best-effort cleanup
  }

  const linked = linkStoredAssemblies(data.assemblies, contigs, migrateFolders(data.folders), data.itemMeta ?? {})
  return {
    readSets,
    activeReadSetId: data.activeReadSetId ?? null,
    tabs,
    activeTabId: data.activeTabId,
    folders: linked.folders,
    itemMeta: linked.itemMeta,
    tagColors: data.tagColors ?? {},
    theme: data.theme ?? 'light',
    sequencingReads: seqReads,
    activeSequencingReadIds: data.activeSequencingReadIds ?? [],
    alignments,
    contigs: linked.contigs,
    assemblies: linked.assemblies,
    activeAssemblyId: data.activeAssemblyId ?? null,
    oligos: data.oligos ?? [],
    guides: data.guides ?? [],
    enzymeSets: sanitizeEnzymeSets(data.enzymeSets),
    gels: deserializeGels(data.gels),
    clones: deserializeClones(data.clones),
    activeGelId: data.activeGelId ?? null,
    activeCloneId: data.activeCloneId ?? null,
    activeAlignmentId: data.activeAlignmentId ?? null,
    activeContigId: data.activeContigId ?? null,
    orfParams: data.orfParams,
    enzymeParams: data.enzymeParams,
  }
}

/**
 * Pair the stored assemblies with the contigs that loaded. A contig saved
 * before assemblies existed gets an assembly of its own, and its folder,
 * star and note move from the contig to that assembly.
 */
function linkStoredAssemblies(
  raw: unknown,
  contigs: Contig[],
  folders: ExplorerFolder[],
  itemMeta: Record<string, ItemMeta>,
): { assemblies: Assembly[]; contigs: Contig[]; folders: ExplorerFolder[]; itemMeta: Record<string, ItemMeta> } {
  const stored = Array.isArray(raw) ? raw.map(sanitizeAssembly).filter((a): a is AssemblyRecord => a !== null) : []
  const linked = linkAssemblies(stored, contigs, newId)
  if (linked.wrapped.size === 0) return { assemblies: linked.assemblies, contigs: linked.contigs, folders, itemMeta }
  const move = (uid: string) => linked.wrapped.get(uid) ?? uid
  const meta: Record<string, ItemMeta> = {}
  for (const [uid, m] of Object.entries(itemMeta)) meta[move(uid)] = m
  return {
    assemblies: linked.assemblies,
    contigs: linked.contigs,
    folders: folders.map(f => ({ ...f, itemUids: f.itemUids.map(move) })),
    itemMeta: meta,
  }
}

/** A saved contig, or null when its document is missing or from before the assembly rebuild. */
function restoreContig(sc: SerializedContig, raw: unknown): Contig | null {
  const doc = raw as ContigDoc | undefined
  if (!doc || typeof doc !== 'object' || typeof doc.width !== 'number' || !Array.isArray(doc.rows) || !('method' in doc)) return null
  return {
    id: sc.id,
    // Checked against the assemblies by linkStoredAssemblies.
    assemblyId: sc.assemblyId ?? '',
    name: sc.name,
    doc,
    createdAt: sc.createdAt,
    modifiedAt: sc.modifiedAt ?? sc.createdAt,
    view: sanitizeContigView(sc.view),
    undoStack: [],
    redoStack: [],
  }
}

// ---- Debounced auto-save ----

let _timer: ReturnType<typeof setTimeout> | null = null

export function scheduleSave(theme: string): void {
  if (_timer) clearTimeout(_timer)
  _timer = setTimeout(() => {
    saveSession(theme)
    _timer = null
  }, SAVE_DEBOUNCE_MS)
}

// ---- Session export / import ----

export interface SessionExportOptions {
  includeReads: boolean
  includeAlignments: boolean
  includeContigs: boolean
}

interface SessionExportEnvelope {
  format: 'seqnexus-session'
  version: 1
  exportedAt: string
  include: {
    sequences: true
    reads: boolean
    alignments: boolean
    contigs: boolean
  }
  session: SerializedSessionV2
  sequences: { tabId: string; bases: string }[]
  traces?: { readId: string; data: Ab1Data }[]
  alignmentData?: { alignId: string; data: AlnDoc | AlignmentResult | ContigDoc }[]
  /** Each sequence's BLAST searches, by tab id. Always included: they belong to their sequence. */
  blastData?: { tabId: string; data: BlastSearch[] }[]
}

/**
 * Estimate the JSON size of a session export (in bytes) for the given options.
 * Uses a rough heuristic - actual size may differ by ~10%.
 */
export function estimateExportSize(opts: SessionExportOptions): number {
  const state = useEditorStore.getState()
  let size = 0
  // Sequences: bases + annotation metadata
  for (const tab of state.tabs) {
    size += tab.doc.sequence.length * 1.1 // bases + JSON overhead
    size += JSON.stringify(tab.doc.annotations.map(a => a.toData())).length
  }
  size += 2000 // metadata overhead (folders, theme, params)
  if (opts.includeReads) {
    for (const r of state.sequencingReads) {
      // Trace data: 4 channels of int arrays + peak locations + quality
      const d = r.data
      size += (d.traces.A.length + d.traces.C.length + d.traces.G.length + d.traces.T.length) * 4
      size += d.peakLocations.length * 4
      size += d.qualityScores.length * 2
      size += d.bases.length
    }
  }
  if (opts.includeAlignments) {
    for (const a of state.alignments) {
      size += JSON.stringify(a.doc).length
    }
  }
  if (opts.includeContigs) {
    for (const c of state.contigs) size += JSON.stringify(c.doc).length
  }
  for (const tab of state.tabs) {
    if (tab.blastSearches.length > 0) size += JSON.stringify(tab.blastSearches).length
  }
  // Gels are small and always included
  size += JSON.stringify(serializeGels(state.gels) ?? []).length
  size += JSON.stringify(serializeClones(state.clones) ?? []).length
  return size
}

/** Export the current session as a JSON Blob. */
export function exportSessionToJson(theme: string, opts: SessionExportOptions): Blob {
  const { meta, sequences, traces, alignmentData, blastData } = buildSessionData(theme)

  // Strip undo history from the serialized session (not included in export)
  // buildSessionData already produces undoEntries separately, we just don't include them

  // Filter out categories the user didn't select
  if (!opts.includeReads) {
    meta.sequencingReads = []
    meta.activeSequencingReadIds = []
  }
  if (!opts.includeAlignments) {
    meta.alignments = []
    meta.activeAlignmentId = null
  }
  if (!opts.includeContigs) {
    meta.contigs = undefined
    meta.activeContigId = null
    meta.assemblies = undefined
    meta.activeAssemblyId = null
  }
  // Read sets never go in a session file: their reads would make it huge.
  // They stay in this browser and are exported as FASTQ instead.
  meta.readSets = undefined
  meta.activeReadSetId = null

  const alignIds = new Set((meta.alignments ?? []).map(a => a.id))
  const contigIds = new Set((meta.contigs ?? []).map(c => c.id))

  // Drop metadata for whatever the user left out, so an export without reads
  // does not carry favourites for reads it does not contain.
  if (meta.itemMeta) {
    const kept = new Set<string>([
      ...meta.tabs.map(t => toUid(t.doc.alphabet === 'protein' ? 'protein' : 'sequence', t.id)),
      ...(meta.sequencingReads ?? []).map(r => toUid('read', r.id)),
      ...[...alignIds].map(id => toUid('alignment', id)),
      ...(meta.contigs ?? []).map(c => toUid('contig', c.id)),
      ...(meta.assemblies ?? []).map(a => toUid('assembly', a.id)),
      ...(meta.oligos ?? []).map(o => toUid('oligo', o.id)),
      ...(meta.gels ?? []).map(g => toUid('gel', g.id)),
      ...(meta.clones ?? []).map(c => toUid('clone', c.id)),
    ])
    const filtered = Object.fromEntries(
      Object.entries(meta.itemMeta).filter(([uid]) => kept.has(uid)),
    )
    meta.itemMeta = Object.keys(filtered).length > 0 ? filtered : undefined

    // Carry only the colours of tags that survived the filtering, so an
    // export without reads does not ship a palette of read-only tags.
    const liveTags = new Set(Object.values(filtered).flatMap(m => m.tags ?? []))
    const colors = Object.fromEntries(
      Object.entries(meta.tagColors ?? {}).filter(([tag]) => liveTags.has(tag)),
    )
    meta.tagColors = Object.keys(colors).length > 0 ? colors : undefined
  }

  const envelope: SessionExportEnvelope = {
    format: 'seqnexus-session',
    version: 1,
    exportedAt: new Date().toISOString(),
    include: {
      sequences: true,
      reads: opts.includeReads,
      alignments: opts.includeAlignments,
      contigs: opts.includeContigs,
    },
    session: meta,
    sequences,
    traces: opts.includeReads ? traces : undefined,
    alignmentData: alignmentData.filter(ad => alignIds.has(ad.alignId) || contigIds.has(ad.alignId)),
    blastData,
  }

  // Remove empty optional fields to reduce size
  if (!envelope.traces?.length) delete envelope.traces
  if (!envelope.alignmentData?.length) delete envelope.alignmentData
  if (!envelope.blastData?.length) delete envelope.blastData

  const json = JSON.stringify(envelope)
  return new Blob([json], { type: 'application/json' })
}

/** Validate and parse a session export file. Returns the envelope or throws. */
function parseSessionEnvelope(json: string): SessionExportEnvelope {
  const data = JSON.parse(json)
  if (!data || data.format !== 'seqnexus-session' || data.version !== 1) {
    throw new Error('Not a valid SeqNexus session file')
  }
  if (!data.session || !Array.isArray(data.sequences)) {
    throw new Error('Malformed session file: missing session data or sequences')
  }
  return data as SessionExportEnvelope
}

/**
 * Import a session from a JSON string.
 * Returns a RestoredSession ready to be applied to the store.
 */
export function importSessionFromJson(json: string): RestoredSession {
  // restoreAlignment and deserializeGels report into loadWarnings.
  loadWarnings = []
  const lost = { sequences: [] as string[], reads: [] as string[], alignments: [] as string[] }
  const envelope = parseSessionEnvelope(json)
  const data = envelope.session

  // Build bases map from the inline sequences array
  const basesMap = new Map<string, string>()
  for (const s of envelope.sequences) {
    basesMap.set(s.tabId, s.bases)
  }

  // Build traces map
  const tracesMap = new Map<string, Ab1Data>()
  if (envelope.traces) {
    for (const t of envelope.traces) {
      tracesMap.set(t.readId, t.data)
    }
  }

  // Build alignment data map
  const alignMap = new Map<string, unknown>()
  if (envelope.alignmentData) {
    for (const ad of envelope.alignmentData) {
      alignMap.set(ad.alignId, ad.data)
    }
  }

  const blastMap = new Map<string, unknown>((envelope.blastData ?? []).map(b => [b.tabId, b.data]))

  // Reconstruct tabs
  const tabs: RestoredSession['tabs'] = []
  for (const st of data.tabs) {
    const bases = basesMap.get(st.id)
    if (bases === undefined) {
      lost.sequences.push(st.doc?.name ?? st.id)
      continue
    }
    const fullSnap: DocumentSnapshot = { ...st.doc, bases }
    const doc = restore(fullSnap)
    tabs.push({
      id: st.id, doc, createdAt: st.createdAt, modifiedAt: st.modifiedAt,
      viewMode: st.viewMode, zoomLevel: st.zoomLevel,
      hiddenAnnotationIds: st.hiddenAnnotationIds,
      showOrfs: st.showOrfs, showEnzymes: st.showEnzymes,
      showAutoAnnotations: st.showAutoAnnotations,
      readOnly: st.readOnly,
      blastSearches: blastSearchList(blastMap.get(st.id)),
    })
  }

  // Reconstruct sequencing reads
  const seqReads: RestoredSeqRead[] = []
  for (const sr of data.sequencingReads ?? []) {
    const traceData = tracesMap.get(sr.id)
    if (!traceData) {
      lost.reads.push(sr.name)
      continue
    }
    seqReads.push({
      id: sr.id,
      data: { ...traceData, name: sr.name },
      createdAt: sr.createdAt,
      trimStart: sr.trimStart, trimEnd: sr.trimEnd,
      edits: sr.edits ?? [],
      reversed: sr.reversed,
    })
  }

  // Reconstruct alignments
  const alignments: SavedAlignment[] = []
  for (const sa of data.alignments ?? []) {
    const raw = alignMap.get(sa.id)
    if (!raw) {
      lost.alignments.push(sa.name)
      continue
    }
    const aln = restoreAlignment(sa, raw)
    if (aln) alignments.push(aln)
  }

  // Reconstruct contigs (ones from before the assembly rebuild are dropped)
  const contigs: Contig[] = []
  for (const sc of data.contigs ?? []) {
    if (sc.readAlignmentIds) continue
    const c = restoreContig(sc, alignMap.get(sc.id))
    if (c) contigs.push(c)
  }
  const linked = linkStoredAssemblies(data.assemblies, contigs, migrateFolders(data.folders), data.itemMeta ?? {})

  return {
    readSets: [],
    tabs,
    activeTabId: data.activeTabId,
    folders: linked.folders,
    itemMeta: linked.itemMeta,
    tagColors: data.tagColors ?? {},
    theme: data.theme ?? 'light',
    sequencingReads: seqReads,
    activeSequencingReadIds: data.activeSequencingReadIds ?? [],
    alignments,
    contigs: linked.contigs,
    assemblies: linked.assemblies,
    activeAssemblyId: data.activeAssemblyId ?? null,
    oligos: data.oligos ?? [],
    guides: data.guides ?? [],
    enzymeSets: sanitizeEnzymeSets(data.enzymeSets),
    gels: deserializeGels(data.gels),
    clones: deserializeClones(data.clones),
    activeGelId: data.activeGelId ?? null,
    activeCloneId: data.activeCloneId ?? null,
    activeAlignmentId: data.activeAlignmentId ?? null,
    activeContigId: data.activeContigId ?? null,
    orfParams: data.orfParams,
    enzymeParams: data.enzymeParams,
    warnings: [
      ...(lost.sequences.length > 0 ? [missingWarning('sequence', lost.sequences, 'not in the file')] : []),
      ...(lost.reads.length > 0 ? [missingWarning('sequencing read', lost.reads, 'not in the file')] : []),
      ...(lost.alignments.length > 0 ? [missingWarning('alignment', lost.alignments, 'not in the file')] : []),
      ...consumeLoadWarnings(),
    ],
  }
}

/** Generate a new unique ID (same format as tab IDs). */
function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

/** "a", "a and b", "a, b and c". */
const listed = (parts: string[]) => parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
const count = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`

/**
 * What a session holds, in words: "3 sequences, 2 chromatograms and 1 gel".
 * Every kind is counted, so a session of gels alone does not read as empty.
 * Empty string when it holds nothing.
 */
export function describeSession(s: RestoredSession): string {
  const proteins = s.tabs.filter(t => t.doc.sequence.alphabet === 'protein').length
  const parts: [number, string, string][] = [
    [s.tabs.length - proteins, 'sequence', 'sequences'],
    [proteins, 'protein', 'proteins'],
    [s.sequencingReads.length, 'chromatogram', 'chromatograms'],
    [s.alignments.length, 'alignment', 'alignments'],
    [s.assemblies.length, 'assembly', 'assemblies'],
    // Contigs filed under an assembly are counted with it.
    [s.contigs.filter(c => !s.assemblies.some(a => a.id === c.assemblyId)).length, 'contig', 'contigs'],
    [s.gels.length, 'gel', 'gels'],
    [s.clones.length, 'cloning design', 'cloning designs'],
    [s.oligos.length, 'oligo', 'oligos'],
    [s.guides?.length ?? 0, 'guide', 'guides'],
    [s.enzymeSets?.length ?? 0, 'enzyme set', 'enzyme sets'],
  ]
  return listed(parts.filter(([n]) => n > 0).map(([n, one, many]) => count(n, one, many)))
}

/**
 * Remap all IDs in a RestoredSession to avoid collisions during merge.
 * Returns a new session with fresh IDs and updated cross-references.
 */
export function remapSessionIds(session: RestoredSession): RestoredSession {
  const tabIdMap = new Map<string, string>()
  const readIdMap = new Map<string, string>()
  const alignIdMap = new Map<string, string>()
  const contigIdMap = new Map<string, string>()
  const folderIdMap = new Map<string, string>()

  // Generate new IDs
  for (const tab of session.tabs) {
    tabIdMap.set(tab.id, newId())
  }
  for (const r of session.sequencingReads) {
    readIdMap.set(r.id, newId())
  }
  for (const a of session.alignments) {
    alignIdMap.set(a.id, newId())
  }
  const oligoIdMap = new Map<string, string>()
  for (const o of session.oligos) oligoIdMap.set(o.id, newId())
  for (const c of session.contigs) {
    contigIdMap.set(c.id, newId())
  }
  const assemblyIdMap = new Map<string, string>()
  for (const a of session.assemblies) assemblyIdMap.set(a.id, newId())
  const gelIdMap = new Map<string, string>()
  for (const g of session.gels) gelIdMap.set(g.id, newId())
  const cloneIdMap = new Map<string, string>()
  for (const c of session.clones) cloneIdMap.set(c.id, newId())
  for (const f of session.folders) {
    folderIdMap.set(f.id, newId())
  }

  // Metadata is keyed by `${kind}:${id}`, so it has to follow its item
  // through the remap. Without this, imported favourites would reattach to
  // whichever existing items happened to hold the old ids.
  const idMapFor = {
    'sequence': tabIdMap,
    'protein': tabIdMap,
    'read': readIdMap,
    'alignment': alignIdMap,
    'contig': contigIdMap,
    'assembly': assemblyIdMap,
    // Read sets are never in a session file, so there is nothing to map.
    'readset': new Map<string, string>(),
    'gel': gelIdMap,
    'clone': cloneIdMap,
    'oligo': oligoIdMap,
  }

  /** A gel lane's references follow the sequences and primers they name. */
  const remapSample = (s: GelWorkspaceState['lanes'][number]['sample']): typeof s => {
    switch (s.kind) {
      case 'sequence': return { ...s, sourceId: tabIdMap.get(s.sourceId) ?? s.sourceId }
      case 'pcr': return {
        ...s,
        templateId: tabIdMap.get(s.templateId) ?? s.templateId,
        forwardId: oligoIdMap.get(s.forwardId) ?? s.forwardId,
        reverseId: oligoIdMap.get(s.reverseId) ?? s.reverseId,
      }
      default: return s
    }
  }
  /** Rewrite one uid through its kind's map, or null if its item is not here. */
  const remapUid = (uid: string): string | null => {
    const parsed = parseUid(uid)
    if (!parsed) return null
    const mapped = idMapFor[parsed.kind].get(parsed.id)
    return mapped ? toUid(parsed.kind, mapped) : null
  }

  const itemMeta: Record<string, ItemMeta> = {}
  for (const [uid, meta] of Object.entries(session.itemMeta ?? {})) {
    const next = remapUid(uid)
    if (next) itemMeta[next] = meta
  }

  return {
    tabs: session.tabs.map(t => ({
      ...t,
      id: tabIdMap.get(t.id) || t.id,
    })),
    activeTabId: session.activeTabId ? (tabIdMap.get(session.activeTabId) ?? session.activeTabId) : null,
    folders: session.folders.map(f => ({
      ...f,
      id: folderIdMap.get(f.id) || f.id,
      parentId: f.parentId ? (folderIdMap.get(f.parentId) ?? null) : null,
      itemUids: f.itemUids.map(remapUid).filter((u): u is string => u !== null),
    })),
    itemMeta,
    // Tag names are not ids, so only the item side of a tag needs remapping.
    tagColors: session.tagColors ?? {},
    theme: session.theme,
    sequencingReads: session.sequencingReads.map(r => ({
      ...r,
      id: readIdMap.get(r.id) || r.id,
    })),
    activeSequencingReadIds: session.activeSequencingReadIds.map(id => readIdMap.get(id) || id),
    alignments: session.alignments.map(a => ({
      ...a,
      id: alignIdMap.get(a.id) || a.id,
    })),
    oligos: session.oligos.map(o => ({ ...o, id: oligoIdMap.get(o.id) || o.id })),
    assemblies: session.assemblies.map(a => ({
      ...a,
      id: assemblyIdMap.get(a.id) || a.id,
      contigIds: a.contigIds.map(id => contigIdMap.get(id) || id),
      inputs: {
        readIds: a.inputs.readIds.flatMap(id => (readIdMap.has(id) ? [readIdMap.get(id)!] : [])),
        reference: a.inputs.reference
          ? { ...a.inputs.reference, tabId: a.inputs.reference.tabId ? (tabIdMap.get(a.inputs.reference.tabId) ?? null) : null }
          : null,
      },
      unplaced: a.unplaced.map(u => ({ ...u, readId: u.readId ? (readIdMap.get(u.readId) ?? null) : null })),
    })),
    activeAssemblyId: session.activeAssemblyId ? (assemblyIdMap.get(session.activeAssemblyId) ?? null) : null,
    readSets: [],
    contigs: session.contigs.map(c => ({
      ...c,
      id: contigIdMap.get(c.id) || c.id,
      assemblyId: assemblyIdMap.get(c.assemblyId) || c.assemblyId,
      doc: {
        ...c.doc,
        reference: c.doc.reference ? { ...c.doc.reference, tabId: c.doc.reference.tabId ? (tabIdMap.get(c.doc.reference.tabId) ?? null) : null } : null,
        rows: c.doc.rows.map(r => ({ ...r, readId: r.readId ? (readIdMap.get(r.readId) ?? null) : null })),
      },
    })),
    gels: session.gels.map(g => ({
      ...g,
      id: gelIdMap.get(g.id) || g.id,
      state: { ...g.state, lanes: g.state.lanes.map(l => ({ ...l, sample: remapSample(l.sample) })) },
    })),
    activeGelId: session.activeGelId ? (gelIdMap.get(session.activeGelId) ?? null) : null,
    clones: session.clones.map(c => ({
      ...c,
      id: cloneIdMap.get(c.id) || c.id,
      // A part's own copy of its sequence travels with it; only the pointer
      // back to the sequence it came from has to follow the remap.
      design: {
        ...c.design,
        parts: c.design.parts.map(part => (part.source
          ? { ...part, source: { ...part.source, id: tabIdMap.get(part.source.id) ?? part.source.id } }
          : part)),
      },
    })),
    activeCloneId: session.activeCloneId ? (cloneIdMap.get(session.activeCloneId) ?? null) : null,
    activeAlignmentId: session.activeAlignmentId ? (alignIdMap.get(session.activeAlignmentId) ?? session.activeAlignmentId) : null,
    activeContigId: session.activeContigId ? (contigIdMap.get(session.activeContigId) ?? session.activeContigId) : null,
    orfParams: session.orfParams,
    enzymeParams: session.enzymeParams,
    // Left out before, so a merge brought in neither the guide library nor
    // the saved enzyme sets. Enzyme sets have no ids to remap; a guide's
    // provenance follows the sequence it was designed on.
    enzymeSets: session.enzymeSets,
    guides: session.guides?.map(g => (g.origin?.documentId
      ? { ...g, origin: { ...g.origin, documentId: tabIdMap.get(g.origin.documentId) ?? g.origin.documentId } }
      : g)),
  }
}
