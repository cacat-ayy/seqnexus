import { create } from 'zustand'
import { Sequence } from './models/Sequence'
import type { AnnotationData } from './models/Annotation'
import {
  DocumentState,
  snapshot,
  restore,
  addAnnotation,
  removeAnnotation,
  removeAnnotations,
  updateAnnotation,
  updateAnnotations,
  type UndoSnapshot,
  type Strandedness,
  type DocumentOrigin,
  undoSnapshot,
  restoreUndo,
  insertBasesInPlace,
  deleteBasesInPlace,
  replaceBasesInPlace,
  substituteBasesInPlace,
  assertSubstitutions,
  rotateOrigin as rotateOriginDoc,
} from './models/Document'
import { reverseComplement } from './models/complement'
import type { ColorSchemeId, ColorTarget } from './utils/base-colors'
import { loadDisplaySettings, saveDisplaySettings, type DisplaySettings } from './utils/display-settings'
import type { PlasmidStyleId } from './plasmid/styles'
import type { Ab1Data } from './io/ab1'
import type { CutSite } from './enzymes/finder'
import type { ORFResult } from './workers/orf-finder'
import type { PrimerPair } from './primers/finder'
import type { AlignmentResult } from './alignment/types'
import { toUid, parseUid, type ItemMeta } from './explorer/types'
import { PRESET_COLORS } from './utils/annotation-constants'
import type { AnnotationMatch } from './workers/annotate-list'
import { matchToAnnotationData } from './workers/annotate-list'
import { matchKey, proposalsFrom } from './utils/auto-annotations'
import { orfKey, convertibleOrfs, orfToAnnotationData } from './utils/orf-features'
import {
  builtinSource, toStoredSource, BUILTIN_SOURCE_ID, type FeatureSource, type StoredFeatureSource,
} from './features/feature-sources'
import type { CommonFeature } from './features/common-features'
import {
  saveFeatureSource, loadFeatureSources as idbLoadFeatureSources,
  deleteFeatureSource as idbDeleteFeatureSource,
  saveUsageTable, loadUsageTables as idbLoadUsageTables,
  deleteUsageTable as idbDeleteUsageTable,
} from './storage/idb'
import { DEFAULT_CODON_SETTINGS, type CodonSettings } from './codon/settings'
import type {
  AminoAcidStyleId, TranslationFrameId,
} from './codon/translation-display'
import type { CodonUsageTable } from './codon/usage-tables'

const MAX_UNDO = 100

export interface Selection {
  anchor: number
  caret: number
}

export function selectionRange(sel: Selection): [number, number] | null {
  if (sel.anchor === sel.caret) return null
  return [Math.min(sel.anchor, sel.caret), Math.max(sel.anchor, sel.caret)]
}

/**
 * Check if a selection spans the origin on a circular sequence.
 * This is encoded as anchor > caret (the selection wraps around position 0).
 */
export function isOriginSpanningSelection(sel: Selection, topology: string): boolean {
  return topology === 'circular' && sel.anchor > sel.caret && sel.anchor !== sel.caret
}

/**
 * Get the selected base ranges, handling origin-spanning on circular sequences.
 * Returns one or two [start, end) ranges. For origin-spanning selections,
 * returns [[anchor, seqLen), [0, caret)].
 */
export function selectionSegments(
  sel: Selection,
  topology: string,
  seqLen: number,
): [number, number][] {
  if (sel.anchor === sel.caret) return []
  if (isOriginSpanningSelection(sel, topology)) {
    // Wraps around origin: [anchor..seqLen) + [0..caret)
    const segs: [number, number][] = []
    if (sel.anchor < seqLen) segs.push([sel.anchor, seqLen])
    if (sel.caret > 0) segs.push([0, sel.caret])
    return segs
  }
  return [[Math.min(sel.anchor, sel.caret), Math.max(sel.anchor, sel.caret)]]
}

/**
 * Total number of selected bases, handling origin-spanning.
 */
export function selectionLength(sel: Selection, topology: string, seqLen: number): number {
  const segs = selectionSegments(sel, topology, seqLen)
  return segs.reduce((sum, [s, e]) => sum + (e - s), 0)
}

export type SearchMode = 'nucleotide' | 'protein'

export interface SearchOptions {
  isRegex: boolean
  mode: SearchMode
  revComplement: boolean  // also find reverse complement matches
  ambiguity: boolean      // interpret IUPAC ambiguity codes in query
}

export const defaultSearchOptions: SearchOptions = {
  isRegex: false,
  mode: 'nucleotide',
  revComplement: true,
  ambiguity: true,
}

export interface SearchState {
  query: string
  options: SearchOptions
  matches: [number, number][]
  currentMatch: number
}

export type ViewMode = 'linear' | 'circular' | 'split'

/** Per-document state including undo stacks and selection. */
export interface DocumentTab {
  id: string
  doc: DocumentState
  /** When it entered the session. The other four kinds already had this. */
  createdAt: number
  /** Stamped wherever an undo entry is created, which is every edit. */
  modifiedAt: number
  selection: Selection
  search: SearchState
  undoStack: UndoSnapshot[]
  redoStack: UndoSnapshot[]
  viewMode: ViewMode
  zoomLevel: number  // 0-20, controls bases per row (0=most zoomed out, 20=most zoomed in)
  readOnly: boolean
  hiddenAnnotationIds: string[]
  showOrfs: boolean
  showEnzymes: boolean
  showPrimers: boolean
  showAutoAnnotations: boolean
  // Cached analysis results (preserved across tab switches)
  orfResults: ORFResult[]
  enzymeCutSites: CutSite[]
  enzymeNames: string[]
  primerResults: PrimerPair[]
  selectedPrimerIndices: Set<number>
  autoAnnotations: AnnotationMatch[]
}

export interface ExplorerFolder {
  id: string
  name: string
  /**
   * Explorer uids (`${kind}:${id}`), not tab ids.
   *
   * Folders used to hold sequences only, which made type the structure of the
   * tree rather than a property of an item, and left reads, alignments and
   * contigs with nowhere to be filed. An item has at most one folder: multi
   * membership is what tags are for.
   */
  itemUids: string[]
  /** Parent folder, for nesting. Null at the top level. */
  parentId: string | null
  /** Optional accent on the folder header. */
  color?: string
  collapsed: boolean
}

/** A closed sequence, kept just long enough to undo the close. */
export interface ClosedTab {
  tab: DocumentTab
  /** Where it sat in `tabs`, so reopening does not send it to the end. */
  index: number
  /** The folder it belonged to, or null if it sat at the top level. */
  folderId: string | null
}

/**
 * Anything the explorer has deleted, kept just long enough to take it back.
 *
 * Sequences had this buffer from the start; the other four kinds only had a
 * confirmation dialog, which is backwards, since a read alignment or a contig
 * costs far more to recreate than a sequence does to reopen. One buffer across
 * all kinds lets every delete act immediately and offer an Undo instead.
 */
export type DeletedItem =
  | ({ kind: 'sequence' } & ClosedTab)
  | { kind: 'read'; index: number; folderId: string | null; read: SequencingRead; wasActive: boolean }
  | { kind: 'alignment'; index: number; folderId: string | null; alignment: SavedAlignment }
  /** Removing a read alignment also rewrites the contigs holding it, so the
   *  whole contig list is snapshotted rather than reconstructed. */
  | { kind: 'read-alignment'; index: number; folderId: string | null; readAlignment: ReadAlignment; contigs: Contig[] }
  | { kind: 'contig'; index: number; folderId: string | null; contig: Contig }

/** How many deletes can be taken back. Small on purpose: this is an undo
    buffer, and every entry pins a full sequence or trace in memory. */
export const MAX_RECENTLY_CLOSED = 5

export type BaseEdit =
  | { type: 'substitute'; pos: number; original: string; base: string }
  | { type: 'insert'; pos: number; offset: number; base: string }
  | { type: 'delete'; pos: number; original: string }

interface SeqUndoSnapshot {
  edits: BaseEdit[]
  trimStart: number
  trimEnd: number
}

export interface SequencingRead {
  id: string
  data: Ab1Data
  /** When it was imported. Absent in sessions written before the field. */
  createdAt: number
  trimStart: number
  trimEnd: number
  edits: BaseEdit[]
  undoStack: SeqUndoSnapshot[]
  redoStack: SeqUndoSnapshot[]
}

/**
 * Apply edits to the original base string and return the edited sequence
 * plus a per-character edit-type map for rendering.
 */
export function applyEdits(
  originalBases: string,
  edits: BaseEdit[],
): { bases: string; editMap: Array<'original' | 'substitute' | 'insert' | 'delete'> } {
  if (edits.length === 0) {
    return {
      bases: originalBases,
      editMap: Array(originalBases.length).fill('original'),
    }
  }

  const bases: string[] = []
  const editMap: Array<'original' | 'substitute' | 'insert' | 'delete'> = []

  // Index edits by original position for fast lookup
  const editsByPos = new Map<number, BaseEdit[]>()
  for (const e of edits) {
    const arr = editsByPos.get(e.pos) || []
    arr.push(e)
    editsByPos.set(e.pos, arr)
  }

  for (let i = 0; i < originalBases.length; i++) {
    const posEdits = editsByPos.get(i)
    if (!posEdits) {
      bases.push(originalBases[i])
      editMap.push('original')
      continue
    }

    // Process inserts before this position, sorted by offset
    const inserts = posEdits.filter((e): e is BaseEdit & { type: 'insert' } => e.type === 'insert').sort((a, b) => a.offset - b.offset)
    for (const e of inserts) {
      bases.push(e.base)
      editMap.push('insert')
    }

    // Check for delete or substitute at this position
    const del = posEdits.find(e => e.type === 'delete')
    const sub = posEdits.find(e => e.type === 'substitute')
    if (del) {
      // deleted - skip this base but mark it
      bases.push(originalBases[i])
      editMap.push('delete')
    } else if (sub) {
      bases.push(sub.base)
      editMap.push('substitute')
    } else {
      bases.push(originalBases[i])
      editMap.push('original')
    }
  }

  // Handle inserts past the end
  const endEdits = editsByPos.get(originalBases.length)
  if (endEdits) {
    const endInserts = endEdits.filter((e): e is BaseEdit & { type: 'insert' } => e.type === 'insert').sort((a, b) => a.offset - b.offset)
    for (const e of endInserts) {
      bases.push(e.base)
      editMap.push('insert')
    }
  }

  return { bases: bases.join(''), editMap }
}

/** Auto-incrementing ID generator. Supports syncing to a restored max value. */
function makeIdGenerator(prefix: string) {
  let counter = 0
  return {
    next(): string { return `${prefix}_${++counter}` },
    /** Ensure counter is at least `n` (used when restoring persisted sessions). */
    syncTo(n: number) { counter = Math.max(counter, n) },
  }
}

const featureSourceIds = makeIdGenerator('fsrc')
const usageTableIds = makeIdGenerator('usage')
const tabIds = makeIdGenerator('tab')
const seqReadIds = makeIdGenerator('seqread')
const folderIds = makeIdGenerator('folder')
const alignIds = makeIdGenerator('align')
const readAlignIds = makeIdGenerator('readalign')
const contigIds = makeIdGenerator('contig')

const nextTabId = () => tabIds.next()
const nextSeqReadId = () => seqReadIds.next()
const nextFolderId = () => folderIds.next()
const nextFeatureSourceId = () => featureSourceIds.next()
const nextUsageTableId = () => usageTableIds.next()
const nextAlignId = () => alignIds.next()
const nextReadAlignId = () => readAlignIds.next()
const nextContigId = () => contigIds.next()

/**
 * A folder and every folder beneath it, including itself.
 *
 * Guarded against a cycle in `parentId`, which nothing in the UI can create
 * but a hand-edited or partially-written session could.
 */
export function folderSubtree(folders: ExplorerFolder[], rootId: string): Set<string> {
  const childrenOf = new Map<string, string[]>()
  for (const f of folders) {
    if (f.parentId) (childrenOf.get(f.parentId) ?? childrenOf.set(f.parentId, []).get(f.parentId)!).push(f.id)
  }
  const out = new Set<string>()
  const stack = [rootId]
  while (stack.length > 0) {
    const id = stack.pop()!
    if (out.has(id)) continue
    out.add(id)
    for (const child of childrenOf.get(id) ?? []) stack.push(child)
  }
  return out
}

/**
 * Pick a colour for a new tag: the first preset not already in use, so tags
 * created one after another stay distinguishable. Falls back to walking the
 * palette once every colour is taken.
 */
function nextTagColor(used: Record<string, string>): string {
  const taken = new Set(Object.values(used))
  return PRESET_COLORS.find(c => !taken.has(c))
    ?? PRESET_COLORS[Object.keys(used).length % PRESET_COLORS.length]
}

/** Which folder an item is filed in, if any. */
function folderOf(folders: ExplorerFolder[], uid: string): string | null {
  return folders.find(f => f.itemUids.includes(uid))?.id ?? null
}

/** Drop an item from whatever folder holds it. */
function withoutItem(folders: ExplorerFolder[], uid: string): ExplorerFolder[] {
  if (!folders.some(f => f.itemUids.includes(uid))) return folders
  return folders.map(f => (
    f.itemUids.includes(uid) ? { ...f, itemUids: f.itemUids.filter(u => u !== uid) } : f
  ))
}

/** Put an item back in the folder it was deleted from, if that still exists. */
function withItem(folders: ExplorerFolder[], uid: string, folderId: string | null): ExplorerFolder[] {
  if (!folderId) return folders
  return folders.map(f => (
    f.id === folderId && !f.itemUids.includes(uid) ? { ...f, itemUids: [...f.itemUids, uid] } : f
  ))
}

/** Append to the delete buffer, dropping the oldest entry past the cap. */
function pushDeleted(buffer: DeletedItem[], entry: DeletedItem): DeletedItem[] {
  return [...buffer.slice(-(MAX_RECENTLY_CLOSED - 1)), entry]
}

/** Put an item back at the index it was removed from, clamped to the end. */
function insertAt<T>(list: T[], index: number, item: T): T[] {
  const next = list.slice()
  next.splice(Math.min(Math.max(index, 0), next.length), 0, item)
  return next
}

/**
 * Write one item's metadata back, dropping the entry entirely when every
 * field has been cleared. Keeps `{}` and `{ starred: false }` out of the map,
 * which matters because the map is persisted and remapped on session import.
 */
function pruneEmptyMeta(
  map: Record<string, ItemMeta>,
  uid: string,
  meta: ItemMeta,
): Record<string, ItemMeta> {
  const next = { ...map }
  if (Object.values(meta).every(v => v === undefined)) delete next[uid]
  else next[uid] = meta
  return next
}

export interface ReadAlignment {
  id: string
  name: string
  readId: string                // SequencingRead.id
  tabId: string                 // DocumentTab.id
  result: AlignmentResult
  createdAt: number
  zoomLevel: number
  showChromatogram: boolean
  resolvedCols: number[]        // alignment columns that have been resolved
}

export interface Contig {
  id: string
  name: string
  tabId: string                 // reference DocumentTab.id
  readAlignmentIds: string[]    // ordered list of ReadAlignment.id
  createdAt: number
  zoomLevel: number
  expandedReadId: string | null // which read's chromatogram is expanded inline
}

export interface SavedAlignment {
  id: string
  name: string
  result: AlignmentResult
  seqType: 'dna' | 'protein'
  algorithm: 'nw' | 'sw' | 'msa' | 'mafft'
  createdAt: number
  zoomLevel: number
}

interface EditorStore {
  // Multi-document state
  tabs: DocumentTab[]
  activeTabId: string | null

  // Computed convenience - returns the active tab's doc/selection/search
  doc: DocumentState
  selection: Selection
  search: SearchState
  viewMode: ViewMode
  zoomLevel: number
  readOnly: boolean

  // Explorer selection (shared so toolbar can read it)
  explorerSelectedIds: Set<string>
  setExplorerSelectedIds: (ids: Set<string> | ((prev: Set<string>) => Set<string>)) => void

  /**
   * Per-item user metadata, keyed by explorer uid (`${kind}:${id}`).
   *
   * Kept in one map rather than as fields on the five item types: it is user
   * annotation rather than item state, it has to span kinds for favourites to
   * work at all, and a single map is one thing to persist and one thing to
   * remap on session import.
   */
  itemMeta: Record<string, ItemMeta>
  toggleItemStar: (uid: string) => void
  setItemNote: (uid: string, note: string | null) => void
  /** Drop metadata for items that no longer exist. */
  pruneItemMeta: () => void

  /**
   * Tag name to colour.
   *
   * Separate from `itemMeta` because a colour belongs to the tag, not to
   * each item wearing it: recolouring "failed QC" has to change every row at
   * once, and storing the colour per item would make that a rewrite.
   */
  tagColors: Record<string, string>
  addTag: (uid: string, tag: string) => void
  removeTag: (uid: string, tag: string) => void
  /** Rewrites the tag on every item that carries it. */
  renameTag: (from: string, to: string) => void
  /** Removes the tag everywhere and forgets its colour. */
  deleteTag: (tag: string) => void
  setTagColor: (tag: string, color: string) => void

  // Explorer folders
  folders: ExplorerFolder[]
  createFolder: (name: string, parentId?: string | null) => string
  renameFolder: (id: string, name: string) => void
  deleteFolder: (id: string) => void
  toggleFolder: (id: string) => void
  /** File an item of any kind, or pass null to move it back to the top level. */
  moveItemToFolder: (uid: string, folderId: string | null) => void
  /** Sequence-only shorthand over `moveItemToFolder`, for the import paths. */
  moveTabToFolder: (tabId: string, folderId: string | null) => void
  /** Re-parent a folder. Ignored when it would make a cycle. */
  setFolderParent: (id: string, parentId: string | null) => void
  setFolderColor: (id: string, color: string | null) => void

  // Annotation visibility (per-tab)
  hiddenAnnotationIds: string[]
  toggleAnnotationVisibility: (id: string) => void
  setTypeVisibility: (type: string, visible: boolean) => void
  /** Show or hide an arbitrary set of annotations in one update. */
  setAnnotationsVisibility: (ids: Iterable<string>, hidden: boolean) => void
  setAllAnnotationsVisible: () => void

  // --- Global display preferences ---
  // Unlike showOrfs/showEnzymes/showPrimers, which are per tab, these are
  // user preferences: they apply to every document and persist across
  // sessions in their own localStorage key.
  colorScheme: ColorSchemeId
  setColorScheme: (id: ColorSchemeId) => void
  colorTarget: ColorTarget
  setColorTarget: (t: ColorTarget) => void
  showComplement: boolean
  toggleComplement: () => void
  showAnnotationTracks: boolean
  toggleAnnotationTracks: () => void
  plasmidStyle: PlasmidStyleId
  setPlasmidStyle: (id: PlasmidStyleId) => void
  showGcRing: boolean
  toggleGcRing: () => void
  showPlasmidLegend: boolean
  togglePlasmidLegend: () => void
  /** Amino acids under the sequence, and how they are drawn. */
  showTranslation: boolean
  toggleTranslation: () => void
  translationFrame: TranslationFrameId
  setTranslationFrame: (id: TranslationFrameId) => void
  translationCodeId: number
  setTranslationCode: (id: number) => void
  aminoAcidStyle: AminoAcidStyleId
  setAminoAcidStyle: (id: AminoAcidStyleId) => void
  threeLetterAminoAcids: boolean
  toggleThreeLetterAminoAcids: () => void

  // Hover state (cross-view, not per-tab)
  hoveredAnnotationId: string | null
  setHoveredAnnotation: (id: string | null) => void

  // Edit annotation: when set, opens the Features panel and expands this annotation
  editAnnotationId: string | null
  setEditAnnotation: (id: string | null) => void
  requestAddAnnotation: boolean
  setRequestAddAnnotation: (v: boolean) => void
  smoothScrollRequested: boolean

  // Enzyme digest state (cross-view)
  enzymeCutSites: CutSite[]
  enzymeNames: string[]  // currently selected enzyme names
  setEnzymeCutSites: (sites: CutSite[]) => void
  setEnzymeNames: (names: string[]) => void
  clearEnzymes: () => void
  // Enzyme panel params (persisted)
  enzymeSubset: string
  enzymeSearchQuery: string
  enzymeFilterByCount: boolean
  enzymeMinCuts: number
  enzymeMaxCuts: number
  setEnzymeParams: (params: Partial<{ enzymeSubset: string; enzymeSearchQuery: string; enzymeFilterByCount: boolean; enzymeMinCuts: number; enzymeMaxCuts: number }>) => void

  // ORF display state (cross-view)
  orfResults: ORFResult[]
  setOrfResults: (orfs: ORFResult[]) => void
  clearOrfs: () => void
  /** ORF keys picked for conversion into features. Transient, not per tab. */
  orfPicks: Set<string>
  toggleOrfPick: (key: string) => void
  clearOrfPicks: () => void
  /**
   * Turn the picked ORFs (or all of them) into CDS features.
   * One undo entry, and the overlay switches off — they are features now.
   */
  applyOrfs: (keys?: Iterable<string>) => number
  // ORF panel params (persisted)
  orfMinCodons: number
  orfStartCodons: string[]
  orfAllowInterior: boolean
  setOrfParams: (params: Partial<{ orfMinCodons: number; orfStartCodons: string[]; orfAllowInterior: boolean }>) => void

  // Primer display state (cross-view)
  primerResults: PrimerPair[]
  selectedPrimerIndices: Set<number>
  setPrimerResults: (pairs: PrimerPair[]) => void
  toggleSelectedPrimer: (idx: number) => void
  clearPrimers: () => void

  // --- Auto-annotation (cross-view) ---
  // Proposals, not features: they are drawn on the sequence and only enter the
  // document when the user converts them.
  autoAnnotations: AnnotationMatch[]
  setAutoAnnotations: (matches: AnnotationMatch[]) => void
  clearAutoAnnotations: () => void
  /** Match keys the user has picked for conversion. Transient, not per tab. */
  autoAnnotationPicks: Set<string>
  toggleAutoAnnotationPick: (key: string) => void
  setAutoAnnotationPicks: (keys: Iterable<string>) => void
  clearAutoAnnotationPicks: () => void
  /**
   * Turn the picked proposals (or all of them) into real features.
   * One undo entry, and the overlay switches off — they are features now.
   */
  applyAutoAnnotations: (keys?: Iterable<string>) => number
  autoAnnotateScanning: boolean
  setAutoAnnotateScanning: (v: boolean) => void
  // Auto-annotate params (user preferences, like the ORF ones)
  autoAnnotateMinSimilarity: number
  autoAnnotateOverlapThreshold: number
  setAutoAnnotateParams: (params: Partial<{ autoAnnotateMinSimilarity: number; autoAnnotateOverlapThreshold: number }>) => void

  // --- Codon optimization ---
  /**
   * Settings for the optimizer, kept here rather than in the modal so a run
   * can be refined after closing it, like the ORF and enzyme parameters.
   */
  codonSettings: CodonSettings
  setCodonSettings: (patch: Partial<CodonSettings>) => void
  /** Usage tables the user imported. The built-ins live in code. */
  customUsageTables: CodonUsageTable[]
  loadCustomUsageTables: () => Promise<void>
  addCustomUsageTable: (table: CodonUsageTable) => string
  removeCustomUsageTable: (id: string) => void
  /**
   * Rewrite bases without moving anything: one undo entry, annotations
   * untouched. Returns false when the document is read-only.
   */
  substituteBases: (edits: readonly { start: number; end: number; bases: string }[]) => boolean

  // --- Feature source databases (auto-annotation references) ---
  featureSources: FeatureSource[]
  /** Read imported databases back from IndexedDB. Safe to call repeatedly. */
  loadFeatureSources: () => Promise<void>
  addFeatureSource: (name: string, features: CommonFeature[]) => string
  removeFeatureSource: (id: string) => void
  toggleFeatureSource: (id: string) => void
  renameFeatureSource: (id: string, name: string) => void

  // Visibility toggles for overlay layers
  showOrfs: boolean
  showEnzymes: boolean
  showPrimers: boolean
  showAutoAnnotations: boolean
  toggleOrfs: () => void
  toggleEnzymes: () => void
  togglePrimers: () => void
  toggleAutoAnnotations: () => void

  // Tab management
  openDocument: (name: string, bases: string, topology?: 'linear' | 'circular', description?: string, origin?: DocumentOrigin) => string
  openDocumentState: (state: DocumentState) => string
  closeTab: (tabId: string) => void
  /**
   * The last few deleted items of any kind, newest last, so a delete can be
   * taken back.
   *
   * Deliberately in-memory only and excluded from the session snapshot:
   * this is an undo buffer for the current sitting, not a recycle bin, and
   * persisting it would keep the bases of deleted sequences on disk after the
   * user asked for them to go.
   */
  recentlyDeleted: DeletedItem[]
  /** Restore the most recently deleted item, at its original position. */
  undoDelete: () => void
  /** Older name for `undoDelete`, kept for callers that only close tabs. */
  reopenClosedTab: () => void
  setActiveTab: (tabId: string) => void
  renameTab: (tabId: string, name: string) => void
  duplicateTab: (tabId: string) => void
  setViewMode: (mode: ViewMode) => void
  setZoom: (level: number) => void
  toggleReadOnly: () => void
  /** Incremented when an edit is blocked by read-only mode. UI watches this to flash the lock icon. */
  readOnlyBlockCount: number
  notifyReadOnlyBlock: () => void

  // Folder management (extended)
  deleteFolderWithContents: (folderId: string) => void

  // Document properties
  updateDocumentProperties: (props: {
    name?: string
    description?: string
    topology?: 'linear' | 'circular'
    strandedness?: Strandedness
    damMethylated?: boolean
    dcmMethylated?: boolean
    ecoKIMethylated?: boolean
    displayOrigin?: number
  }) => void

  // Custom origin (circular only)
  setDisplayOrigin: (pos: number) => void
  rotateOrigin: (newOrigin: number) => void

  // Edit actions (operate on active tab)
  insert: (pos: number, fragment: string) => void
  delete: (start: number, end: number) => void
  /** Delete two ranges in one undo snapshot (for origin-spanning selections on circular sequences).
   *  Optionally insert text at position 0 after both deletes. */
  deleteTwo: (start1: number, end1: number, start2: number, end2: number, insertAtZero?: string) => void
  replace: (start: number, end: number, fragment: string) => void
  addAnnotation: (data: AnnotationData) => void
  addAnnotations: (data: AnnotationData[]) => void
  removeAnnotation: (id: string) => void
  /** Delete many annotations as a single undoable action. */
  removeAnnotations: (ids: Iterable<string>) => void
  updateAnnotation: (id: string, patch: Partial<Omit<AnnotationData, 'id'>>) => void
  /**
   * Patch many annotations as a single undoable action.
   *
   * Pass a `coalesceKey` for continuous interactions — a colour picker drag
   * fires on every frame, and without a key each frame would push its own
   * full-document undo snapshot. Mint a fresh key per interaction so separate
   * drags stay separately undoable.
   */
  updateAnnotations: (
    ids: Iterable<string>,
    patch: Partial<Omit<AnnotationData, 'id'>>,
    opts?: { coalesceKey?: string },
  ) => void
  setSelection: (sel: Selection) => void
  setCaret: (pos: number) => void
  undo: () => void
  redo: () => void
  canUndo: () => boolean
  canRedo: () => boolean

  /** Set after a successful undo/redo to drive UI feedback. Cleared by consumer. */
  lastUndoRedoAction: 'undo' | 'redo' | null
  clearUndoRedoAction: () => void
  setSearch: (query: string, options: SearchOptions) => void
  nextMatch: () => void
  prevMatch: () => void
  clearSearch: () => void
  replaceCurrentMatch: (replacement: string) => void
  replaceAllMatches: (replacement: string) => void

  // Session restore (bulk-load tabs + folders + sequencing reads + alignments from persistence)
  restoreSession: (
    tabs: { id: string; doc: DocumentState; createdAt?: number; modifiedAt?: number; viewMode: ViewMode; zoomLevel: number; hiddenAnnotationIds?: string[]; showOrfs?: boolean; showEnzymes?: boolean; showPrimers?: boolean; showAutoAnnotations?: boolean; readOnly?: boolean; undoStack?: UndoSnapshot[]; redoStack?: UndoSnapshot[] }[],
    activeTabId: string | null,
    folders: ExplorerFolder[],
    seqReads?: { id: string; data: Ab1Data; createdAt?: number; trimStart: number; trimEnd: number; edits: BaseEdit[] }[],
    activeSeqReadIds?: string[],
    savedAlignments?: SavedAlignment[],
    savedReadAlignments?: ReadAlignment[],
    savedContigs?: Contig[],
    activeAlignmentId?: string | null,
    activeContigId?: string | null,
    activeReadAlignmentId?: string | null,
    itemMeta?: Record<string, ItemMeta>,
    tagColors?: Record<string, string>,
  ) => void

  // Merge imported session into existing state (adds items alongside existing ones)
  mergeSession: (
    tabs: { id: string; doc: DocumentState; createdAt?: number; modifiedAt?: number; viewMode: ViewMode; zoomLevel: number; hiddenAnnotationIds?: string[]; showOrfs?: boolean; showEnzymes?: boolean; showPrimers?: boolean; showAutoAnnotations?: boolean; readOnly?: boolean }[],
    folders: ExplorerFolder[],
    seqReads?: { id: string; data: Ab1Data; createdAt?: number; trimStart: number; trimEnd: number; edits: BaseEdit[] }[],
    savedAlignments?: SavedAlignment[],
    savedReadAlignments?: ReadAlignment[],
    savedContigs?: Contig[],
    itemMeta?: Record<string, ItemMeta>,
    tagColors?: Record<string, string>,
  ) => void

  // Legacy compat
  loadDocument: (name: string, bases: string, topology?: 'linear' | 'circular') => void
  loadDocumentState: (state: DocumentState) => void

  // Sequencing reads
  sequencingReads: SequencingRead[]
  activeSequencingReadIds: string[]
  addSequencingRead: (data: Ab1Data) => string
  removeSequencingRead: (id: string) => void
  setActiveSequencingRead: (id: string | null) => void
  toggleSequencingRead: (id: string) => void
  setSequencingTrim: (id: string, start: number, end: number) => void
  renameSequencingRead: (id: string, name: string) => void
  editSequencingBase: (id: string, edit: BaseEdit) => void
  resetSequencingEdits: (id: string) => void
  undoSequencing: (id: string) => void
  redoSequencing: (id: string) => void

  // Alignments
  alignments: SavedAlignment[]
  activeAlignmentId: string | null
  addAlignment: (result: AlignmentResult, seqType: 'dna' | 'protein', algorithm: 'nw' | 'sw' | 'msa' | 'mafft') => string
  removeAlignment: (id: string) => void
  renameAlignment: (id: string, name: string) => void
  setActiveAlignment: (id: string | null) => void
  setAlignmentZoom: (id: string, level: number) => void

  // Read Alignments
  readAlignments: ReadAlignment[]
  activeReadAlignmentId: string | null
  addReadAlignment: (readId: string, tabId: string, result: AlignmentResult) => string
  removeReadAlignment: (id: string) => void
  renameReadAlignment: (id: string, name: string) => void
  setActiveReadAlignment: (id: string | null) => void
  setReadAlignmentZoom: (id: string, level: number) => void
  toggleReadAlignmentChromatogram: (id: string) => void
  updateReadAlignmentResult: (id: string, result: AlignmentResult) => void
  addReadAlignmentResolvedCol: (id: string, col: number) => void
  clearReadAlignmentResolvedCols: (id: string) => void

  // Contigs
  contigs: Contig[]
  activeContigId: string | null
  addContig: (tabId: string, readAlignmentIds: string[]) => string
  removeContig: (id: string) => void
  renameContig: (id: string, name: string) => void
  setActiveContig: (id: string | null) => void
  setContigZoom: (id: string, level: number) => void
  setContigExpandedRead: (id: string, readAlignmentId: string | null) => void
}

const emptyDoc: DocumentState = {
  name: 'Untitled',
  sequence: new Sequence(''),
  annotations: [],
}

const emptySearch: SearchState = { query: '', options: { ...defaultSearchOptions }, matches: [], currentMatch: -1 }

const DEFAULT_ZOOM = 14  // default zoom level - shows individual letters

function makeTab(doc: DocumentState): DocumentTab {
  const now = Date.now()
  return {
    id: nextTabId(),
    doc,
    createdAt: now,
    modifiedAt: now,
    selection: { anchor: 0, caret: 0 },
    search: { ...emptySearch },
    undoStack: [],
    redoStack: [],
    viewMode: doc.sequence.topology === 'circular' ? 'split' : 'linear',
    zoomLevel: DEFAULT_ZOOM,
    readOnly: false,
    hiddenAnnotationIds: [],
    showOrfs: false,
    showEnzymes: false,
    showPrimers: false,
    showAutoAnnotations: false,
    orfResults: [],
    enzymeCutSites: [],
    enzymeNames: [],
    primerResults: [],
    selectedPrimerIndices: new Set(),
    autoAnnotations: [],
  }
}

/** IUPAC ambiguity code → regex character class */
const IUPAC_MAP: Record<string, string> = {
  A: 'A', C: 'C', G: 'G', T: '[TU]', U: '[TU]',
  R: '[AG]', Y: '[CTU]', S: '[GC]', W: '[ATU]',
  K: '[GTU]', M: '[AC]', B: '[CGTU]', D: '[AGTU]',
  H: '[ACTU]', V: '[ACG]', N: '[ACGTU]',
}

/** Convert an IUPAC nucleotide query to a regex pattern. */
function iupacToRegex(query: string): string {
  return query.toUpperCase().split('').map(ch => IUPAC_MAP[ch] ?? ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('')
}

import { translate as translateForSearch } from './utils/codon'

/**
 * Find all protein query matches in a DNA sequence.
 * Searches all 3 reading frames on the forward strand.
 * Returns nucleotide-level [start, end] ranges.
 */
function proteinMatches(query: string, bases: string): [number, number][] {
  const upperQ = query.toUpperCase()
  const matches: [number, number][] = []
  for (let frame = 0; frame < 3; frame++) {
    const protein = translateForSearch(bases.slice(frame))
    let idx = 0
    while ((idx = protein.indexOf(upperQ, idx)) !== -1) {
      const ntStart = frame + idx * 3
      const ntEnd = ntStart + upperQ.length * 3
      if (ntEnd <= bases.length) {
        matches.push([ntStart, ntEnd])
      }
      idx++
    }
  }
  return matches.sort((a, b) => a[0] - b[0])
}

function runRegexMatches(pattern: RegExp, text: string): [number, number][] {
  const matches: [number, number][] = []
  let m: RegExpExecArray | null
  while ((m = pattern.exec(text)) !== null) {
    if (m[0].length === 0) { pattern.lastIndex++; continue }
    matches.push([m.index, m.index + m[0].length])
  }
  return matches
}

function computeMatches(query: string, options: SearchOptions, bases: string, circular: boolean = false): [number, number][] {
  if (!query) return []

  try {
    // --- Protein mode ---
    if (options.mode === 'protein') {
      return proteinMatches(query, bases)
    }

    // --- Nucleotide mode ---
    let patternStr: string
    if (options.isRegex) {
      patternStr = query
    } else if (options.ambiguity) {
      patternStr = iupacToRegex(query)
    } else {
      patternStr = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    }

    const pattern = new RegExp(patternStr, 'gi')
    const matches = runRegexMatches(pattern, bases)

    // Reverse complement search
    if (options.revComplement && !options.isRegex) {
      const rcQuery = reverseComplement(query)
      // Only search if rc differs from the original query
      if (rcQuery.toUpperCase() !== query.toUpperCase()) {
        const rcPatternStr = options.ambiguity ? iupacToRegex(rcQuery) : rcQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const rcPattern = new RegExp(rcPatternStr, 'gi')
        const rcMatches = runRegexMatches(rcPattern, bases)
        matches.push(...rcMatches)
        // Sort and deduplicate
        matches.sort((a, b) => a[0] - b[0] || a[1] - b[1])
      }
    }

    // Circular wrap-around search
    if (circular && bases.length > 0) {
      const wrapLen = Math.min(bases.length - 1, query.length * 2 + 100)
      if (wrapLen > 0) {
        const wrapped = bases + bases.slice(0, wrapLen)
        const wrapPattern = new RegExp(patternStr, 'gi')
        wrapPattern.lastIndex = Math.max(0, bases.length - wrapLen)
        let m: RegExpExecArray | null
        while ((m = wrapPattern.exec(wrapped)) !== null) {
          if (m[0].length === 0) { wrapPattern.lastIndex++; continue }
          const mStart = m.index
          const mEnd = m.index + m[0].length
          if (mStart < bases.length && mEnd > bases.length) {
            matches.push([mStart, mEnd - bases.length])
          }
          if (mStart >= bases.length) break
        }
      }
    }

    return matches
  } catch {
    return []
  }
}

/**
 * Every persisted display preference, read off the store in one place.
 *
 * The two callers used to each list the fields by hand, which meant adding a
 * preference silently reset the others wherever someone forgot to extend the
 * list. One projection, so that cannot happen again.
 */
function displaySnapshot(s: EditorStore): DisplaySettings {
  return {
    colorScheme: s.colorScheme,
    colorTarget: s.colorTarget,
    showComplement: s.showComplement,
    showAnnotationTracks: s.showAnnotationTracks,
    plasmidStyle: s.plasmidStyle,
    showGcRing: s.showGcRing,
    showPlasmidLegend: s.showPlasmidLegend,
    showTranslation: s.showTranslation,
    translationFrame: s.translationFrame,
    translationCodeId: s.translationCodeId,
    aminoAcidStyle: s.aminoAcidStyle,
    threeLetterAminoAcids: s.threeLetterAminoAcids,
  }
}

export const useEditorStore = create<EditorStore>((set, get) => {
  function getActiveTab(): DocumentTab | null {
    const { tabs, activeTabId } = get()
    return tabs.find(t => t.id === activeTabId) ?? null
  }

  function updateActiveTab(patch: Partial<DocumentTab>) {
    const { tabs, activeTabId } = get()
    const updated = tabs.map(t => t.id === activeTabId ? { ...t, ...patch } : t)
    const active = updated.find(t => t.id === activeTabId)
    set({
      tabs: updated,
      ...(active ? {
        doc: active.doc,
        selection: active.selection,
        search: active.search,
        viewMode: active.viewMode,
        zoomLevel: active.zoomLevel,
        readOnly: active.readOnly,
        hiddenAnnotationIds: active.hiddenAnnotationIds,
        showOrfs: active.showOrfs,
        showEnzymes: active.showEnzymes,
        showPrimers: active.showPrimers,
        showAutoAnnotations: active.showAutoAnnotations,
      } : {}),
    })
  }

  /**
   * Which interaction the top undo entry belongs to, for coalescing.
   *
   * Deliberately a closure variable rather than a field on DocumentTab: tabs
   * are serialised into session export, and this is transient drag state that
   * must not be written to disk or restored.
   */
  let coalesce: { tabId: string; key: string } | null = null

  /** Forget any in-flight coalescing run, so the next mutation starts a new entry. */
  function endCoalesce() {
    coalesce = null
  }

  /**
   * Turn the annotation tracks back on after something is added.
   *
   * Adding a feature and seeing nothing happen reads as a failure. Rather than
   * make every call site remember this, it hangs off the add actions, which is
   * the only place new annotations enter the document.
   */
  function revealAnnotationTracks() {
    if (get().showAnnotationTracks) return
    set({ showAnnotationTracks: true })
    saveDisplaySettings(displaySnapshot(get()))
  }

  function pushUndo() {
    const tab = getActiveTab()
    if (!tab) return
    const stack = [...tab.undoStack, undoSnapshot(tab.doc)]
    if (stack.length > MAX_UNDO) stack.shift()
    updateActiveTab({ undoStack: stack, redoStack: [], modifiedAt: Date.now() })
    endCoalesce()
  }

  /**
   * Apply a document mutation as one undoable unit.
   *
   * Replaces the `pushUndo()` + `updateActiveTab()` pair every mutator used to
   * repeat. Two reasons it matters beyond tidiness:
   *
   *  - It writes the snapshot and the new document in a *single* `set()`, where
   *    the old pair issued two — so even single mutations halve their renders.
   *  - `coalesceKey` lets a continuous interaction collapse into one undo entry.
   *    A colour picker fires `change` on every frame of a drag; without this,
   *    one drag over a large group could push hundreds of full-document
   *    snapshots and evict the user's real history past MAX_UNDO.
   *
   * Callers mint a fresh key per interaction (on pointerdown/focus), so two
   * separate drags never merge into one entry.
   *
   * Returns false when there was nothing to do (no active tab, read-only, or
   * the mutation was a no-op), in which case no undo entry is created.
   *
   * Only for mutations that leave the PieceTable alone. The snapshot is taken
   * after `mutate` has run, which is harmless for annotation edits because
   * they build a new array and leave the old one for the snapshot to capture,
   * but would capture the post-edit bases for anything that rewrites the
   * sequence in place. Those call pushUndo() first, as insert and delete do.
   */
  function transact(
    mutate: (doc: DocumentState) => DocumentState,
    opts?: { coalesceKey?: string },
  ): boolean {
    const tab = getActiveTab()
    if (!tab || tab.readOnly) return false

    const doc = mutate(tab.doc)
    // A no-op must not consume an undo slot, and must not disturb an in-flight
    // coalescing run either.
    if (doc === tab.doc) return false

    const key = opts?.coalesceKey
    const continuing =
      key !== undefined && coalesce !== null &&
      coalesce.tabId === tab.id && coalesce.key === key

    if (continuing) {
      // The existing top-of-stack already holds the pre-interaction state.
      updateActiveTab({ doc, modifiedAt: Date.now() })
    } else {
      const undoStack = [...tab.undoStack, undoSnapshot(tab.doc)]
      if (undoStack.length > MAX_UNDO) undoStack.shift()
      updateActiveTab({ doc, undoStack, redoStack: [], modifiedAt: Date.now() })
    }

    coalesce = key === undefined ? null : { tabId: tab.id, key }
    return true
  }

  return {
    tabs: [],
    activeTabId: null,
    doc: emptyDoc,
    selection: { anchor: 0, caret: 0 },
    search: { ...emptySearch },
    viewMode: 'linear',
    zoomLevel: DEFAULT_ZOOM,
    readOnly: false,
    readOnlyBlockCount: 0,
    notifyReadOnlyBlock: () => {
      set(s => ({ readOnlyBlockCount: s.readOnlyBlockCount + 1 }))
    },
    explorerSelectedIds: new Set<string>(),
    setExplorerSelectedIds: (ids) => {
      if (typeof ids === 'function') {
        set({ explorerSelectedIds: ids(get().explorerSelectedIds) })
      } else {
        set({ explorerSelectedIds: ids })
      }
    },
    hiddenAnnotationIds: [],
    toggleAnnotationVisibility: (id) => {
      const tab = getActiveTab()
      if (!tab) return
      const hidden = tab.hiddenAnnotationIds
      const next = hidden.includes(id) ? hidden.filter(h => h !== id) : [...hidden, id]
      updateActiveTab({ hiddenAnnotationIds: next })
    },
    setTypeVisibility: (type, visible) => {
      const tab = getActiveTab()
      if (!tab) return
      const idsOfType = tab.doc.annotations.filter(a => a.type === type).map(a => a.id)
      const hidden = tab.hiddenAnnotationIds
      if (visible) {
        // Remove all IDs of this type from hidden
        const removeSet = new Set(idsOfType)
        updateActiveTab({ hiddenAnnotationIds: hidden.filter(h => !removeSet.has(h)) })
      } else {
        // Add all IDs of this type to hidden (dedup)
        const existing = new Set(hidden)
        const next = [...hidden, ...idsOfType.filter(id => !existing.has(id))]
        updateActiveTab({ hiddenAnnotationIds: next })
      }
    },
    setAnnotationsVisibility: (ids, hidden) => {
      const tab = getActiveTab()
      if (!tab) return
      const target = new Set(ids)
      if (target.size === 0) return
      const current = tab.hiddenAnnotationIds
      if (hidden) {
        const existing = new Set(current)
        const added = [...target].filter(id => !existing.has(id))
        if (added.length === 0) return
        updateActiveTab({ hiddenAnnotationIds: [...current, ...added] })
      } else {
        const next = current.filter(id => !target.has(id))
        if (next.length === current.length) return
        updateActiveTab({ hiddenAnnotationIds: next })
      }
    },
    setAllAnnotationsVisible: () => {
      updateActiveTab({ hiddenAnnotationIds: [] })
    },

    // --- Global display preferences ---
    ...(() => {
      const initial = loadDisplaySettings()
      /**
       * Persist the whole record whenever any one field changes. The patch is
       * applied on top because `set` has not necessarily been flushed by the
       * time the setter calls this.
       */
      const persist = (patch: Partial<DisplaySettings>) => {
        saveDisplaySettings({ ...displaySnapshot(get()), ...patch })
      }
      return {
        colorScheme: initial.colorScheme,
        colorTarget: initial.colorTarget,
        showComplement: initial.showComplement,
        showAnnotationTracks: initial.showAnnotationTracks,
        plasmidStyle: initial.plasmidStyle,
        showGcRing: initial.showGcRing,
        showPlasmidLegend: initial.showPlasmidLegend,
        showTranslation: initial.showTranslation,
        translationFrame: initial.translationFrame,
        translationCodeId: initial.translationCodeId,
        aminoAcidStyle: initial.aminoAcidStyle,
        threeLetterAminoAcids: initial.threeLetterAminoAcids,
        setColorScheme: (id: ColorSchemeId) => {
          set({ colorScheme: id })
          persist({ colorScheme: id })
        },
        setColorTarget: (t: ColorTarget) => {
          set({ colorTarget: t })
          persist({ colorTarget: t })
        },
        toggleComplement: () => {
          const next = !get().showComplement
          set({ showComplement: next })
          persist({ showComplement: next })
        },
        toggleAnnotationTracks: () => {
          const next = !get().showAnnotationTracks
          set({ showAnnotationTracks: next })
          persist({ showAnnotationTracks: next })
        },
        setPlasmidStyle: (id: PlasmidStyleId) => {
          set({ plasmidStyle: id })
          persist({ plasmidStyle: id })
        },
        toggleGcRing: () => {
          const next = !get().showGcRing
          set({ showGcRing: next })
          persist({ showGcRing: next })
        },
        togglePlasmidLegend: () => {
          const next = !get().showPlasmidLegend
          set({ showPlasmidLegend: next })
          persist({ showPlasmidLegend: next })
        },
        toggleTranslation: () => {
          const next = !get().showTranslation
          set({ showTranslation: next })
          persist({ showTranslation: next })
        },
        setTranslationFrame: (id: TranslationFrameId) => {
          set({ translationFrame: id })
          persist({ translationFrame: id })
        },
        setTranslationCode: (id: number) => {
          set({ translationCodeId: id })
          persist({ translationCodeId: id })
        },
        setAminoAcidStyle: (id: AminoAcidStyleId) => {
          set({ aminoAcidStyle: id })
          persist({ aminoAcidStyle: id })
        },
        toggleThreeLetterAminoAcids: () => {
          const next = !get().threeLetterAminoAcids
          set({ threeLetterAminoAcids: next })
          persist({ threeLetterAminoAcids: next })
        },
      }
    })(),
    hoveredAnnotationId: null,
    setHoveredAnnotation: (id) => set({ hoveredAnnotationId: id }),
    editAnnotationId: null,
    setEditAnnotation: (id) => set({ editAnnotationId: id }),
    requestAddAnnotation: false,
    setRequestAddAnnotation: (v) => set({ requestAddAnnotation: v }),
    smoothScrollRequested: false,
    enzymeCutSites: [],
    enzymeNames: [],
    setEnzymeCutSites: (sites) => { set({ enzymeCutSites: sites }); updateActiveTab({ enzymeCutSites: sites }) },
    setEnzymeNames: (names) => { set({ enzymeNames: names }); updateActiveTab({ enzymeNames: names }) },
    clearEnzymes: () => { set({ enzymeCutSites: [], enzymeNames: [] }); updateActiveTab({ enzymeCutSites: [], enzymeNames: [] }) },
    enzymeSubset: 'common6',
    enzymeSearchQuery: '',
    enzymeFilterByCount: true,
    enzymeMinCuts: 1,
    enzymeMaxCuts: 1,
    setEnzymeParams: (params) => set(params),

    // ORF display
    orfResults: [],
    setOrfResults: (orfs) => {
      set({ orfResults: orfs })
      updateActiveTab({ orfResults: orfs })
      // A re-scan with different settings returns different ORFs; picks for
      // ones it no longer finds have nothing left to point at.
      const picks = get().orfPicks
      if (picks.size > 0) {
        const live = new Set(orfs.map(orfKey))
        const kept = new Set([...picks].filter(k => live.has(k)))
        if (kept.size !== picks.size) set({ orfPicks: kept })
      }
    },
    clearOrfs: () => { set({ orfResults: [], orfPicks: new Set() }); updateActiveTab({ orfResults: [] }) },
    orfPicks: new Set<string>(),
    toggleOrfPick: (key) => {
      const next = new Set(get().orfPicks)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      set({ orfPicks: next })
    },
    clearOrfPicks: () => set({ orfPicks: new Set() }),
    applyOrfs: (keys) => {
      const state = get()
      // Re-filter rather than trust the caller: an ORF the document has since
      // acquired a CDS for must not be added a second time.
      const convertible = convertibleOrfs(state.orfResults, state.doc.annotations)
      const wanted = keys ? new Set(keys) : null
      const chosen = wanted ? convertible.filter(o => wanted.has(orfKey(o))) : convertible
      if (chosen.length === 0) return 0

      get().addAnnotations(chosen.map(orfToAnnotationData))
      set({ orfPicks: new Set() })
      updateActiveTab({ showOrfs: false })
      return chosen.length
    },
    orfMinCodons: 300,
    orfStartCodons: ['ATG'],
    orfAllowInterior: true,
    setOrfParams: (params) => set(params),

    // Primer display
    primerResults: [],
    selectedPrimerIndices: new Set<number>(),
    setPrimerResults: (pairs) => {
      const sel = pairs.length > 0 ? new Set([0]) : new Set<number>()
      set({ primerResults: pairs, selectedPrimerIndices: sel })
      updateActiveTab({ primerResults: pairs, selectedPrimerIndices: sel })
    },
    toggleSelectedPrimer: (idx) => {
      const prev = get().selectedPrimerIndices
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      set({ selectedPrimerIndices: next })
    },
    clearPrimers: () => { set({ primerResults: [], selectedPrimerIndices: new Set() }); updateActiveTab({ primerResults: [], selectedPrimerIndices: new Set() }) },

    // Auto-annotation proposals
    autoAnnotations: [],
    setAutoAnnotations: (matches) => {
      set({ autoAnnotations: matches })
      updateActiveTab({ autoAnnotations: matches })
      // A pick only means anything while its match is on screen. A re-scan at
      // the same settings reproduces the same keys, so picks survive that;
      // picks for matches the new scan no longer returns are dropped.
      const live = new Set(matches.map(matchKey))
      const picks = get().autoAnnotationPicks
      if (picks.size > 0) {
        const kept = new Set([...picks].filter(k => live.has(k)))
        if (kept.size !== picks.size) set({ autoAnnotationPicks: kept })
      }
    },
    clearAutoAnnotations: () => {
      set({ autoAnnotations: [], autoAnnotationPicks: new Set() })
      updateActiveTab({ autoAnnotations: [] })
    },
    autoAnnotationPicks: new Set<string>(),
    toggleAutoAnnotationPick: (key) => {
      const next = new Set(get().autoAnnotationPicks)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      set({ autoAnnotationPicks: next })
    },
    setAutoAnnotationPicks: (keys) => set({ autoAnnotationPicks: new Set(keys) }),
    clearAutoAnnotationPicks: () => set({ autoAnnotationPicks: new Set() }),

    applyAutoAnnotations: (keys) => {
      const state = get()
      // Re-filter rather than trust the caller: a proposal the document has
      // since acquired must not be added a second time, whatever the UI held.
      const proposals = proposalsFrom(
        state.autoAnnotations,
        state.doc.annotations,
        state.autoAnnotateOverlapThreshold,
      )
      const wanted = keys ? new Set(keys) : null
      const chosen = wanted ? proposals.filter(m => wanted.has(matchKey(m))) : proposals
      if (chosen.length === 0) return 0

      get().addAnnotations(chosen.map(matchToAnnotationData))
      // They are ordinary features now, so the preview has done its job.
      set({ autoAnnotationPicks: new Set() })
      updateActiveTab({ showAutoAnnotations: false })
      return chosen.length
    },
    autoAnnotateScanning: false,
    setAutoAnnotateScanning: (v) => set({ autoAnnotateScanning: v }),
    autoAnnotateMinSimilarity: 85,
    autoAnnotateOverlapThreshold: 75,
    setAutoAnnotateParams: (params) => set(params),

    // Codon optimization
    codonSettings: { ...DEFAULT_CODON_SETTINGS },
    setCodonSettings: (patch) => set(state => ({
      codonSettings: { ...state.codonSettings, ...patch },
    })),
    customUsageTables: [],
    loadCustomUsageTables: async () => {
      let stored: CodonUsageTable[] = []
      try {
        stored = (await idbLoadUsageTables()) as CodonUsageTable[]
      } catch {
        // No IndexedDB: the built-in tables still work, which is where this
        // feature started anyway.
        return
      }
      const tables = stored.filter(t => t && t.id && t.fractions)
      for (const t of tables) {
        const m = /^usage_(\d+)$/.exec(t.id)
        if (m) usageTableIds.syncTo(parseInt(m[1], 10))
      }
      set({ customUsageTables: tables })
    },
    addCustomUsageTable: (table) => {
      const id = nextUsageTableId()
      const stored: CodonUsageTable = { ...table, id }
      set(state => ({ customUsageTables: [...state.customUsageTables, stored] }))
      void saveUsageTable(id, stored).catch(() => {})
      return id
    },
    removeCustomUsageTable: (id) => {
      set(state => ({ customUsageTables: state.customUsageTables.filter(t => t.id !== id) }))
      void idbDeleteUsageTable(id).catch(() => {})
    },
    substituteBases: (edits) => {
      if (edits.length === 0) return false
      const tab = getActiveTab()
      if (!tab || tab.readOnly) return false
      // Validate before the snapshot, so a rejected edit cannot leave an undo
      // entry behind for a change that never happened.
      assertSubstitutions(tab.doc, edits)
      // pushUndo first, not transact: this mutates the PieceTable in place, and
      // transact snapshots after its mutation has already run.
      pushUndo()
      updateActiveTab({ doc: substituteBasesInPlace(tab.doc, edits) })
      return true
    },

    // Feature source databases
    featureSources: [builtinSource()],
    loadFeatureSources: async () => {
      let stored: StoredFeatureSource[] = []
      try {
        stored = (await idbLoadFeatureSources()) as StoredFeatureSource[]
      } catch {
        // No IndexedDB (private mode, quota, an old browser): the built-in
        // library still works, which is the pre-import behaviour.
        return
      }
      const custom = stored
        .filter(s => s && Array.isArray(s.features))
        .map(s => ({ ...s, builtin: false }))
        .sort((a, b) => a.addedAt - b.addedAt)
      // Keep the generator above every restored id, or the next import
      // overwrites a database from a previous session.
      for (const s of custom) {
        const m = /^fsrc_(\d+)$/.exec(s.id)
        if (m) featureSourceIds.syncTo(parseInt(m[1], 10))
      }
      const existing = get().featureSources.find(s => s.builtin)
      set({ featureSources: [builtinSource(existing?.enabled ?? true), ...custom] })
    },
    addFeatureSource: (name, features) => {
      const id = nextFeatureSourceId()
      const source: FeatureSource = {
        id, name, builtin: false, enabled: true, addedAt: Date.now(), features,
      }
      set(state => ({ featureSources: [...state.featureSources, source] }))
      void saveFeatureSource(id, toStoredSource(source)).catch(() => {
        // The import still works for this session; only persistence failed.
      })
      return id
    },
    removeFeatureSource: (id) => {
      if (id === BUILTIN_SOURCE_ID) return
      set(state => ({ featureSources: state.featureSources.filter(s => s.id !== id) }))
      void idbDeleteFeatureSource(id).catch(() => {})
    },
    toggleFeatureSource: (id) => {
      const next = get().featureSources.map(s =>
        s.id === id ? { ...s, enabled: !s.enabled } : s)
      set({ featureSources: next })
      const changed = next.find(s => s.id === id)
      if (changed && !changed.builtin) void saveFeatureSource(id, toStoredSource(changed)).catch(() => {})
    },
    renameFeatureSource: (id, name) => {
      const trimmed = name.trim()
      if (!trimmed || id === BUILTIN_SOURCE_ID) return
      const next = get().featureSources.map(s => s.id === id ? { ...s, name: trimmed } : s)
      set({ featureSources: next })
      const changed = next.find(s => s.id === id)
      if (changed) void saveFeatureSource(id, toStoredSource(changed)).catch(() => {})
    },

    // Undo/redo feedback
    lastUndoRedoAction: null,
    clearUndoRedoAction: () => set({ lastUndoRedoAction: null }),

    // Visibility toggles
    showOrfs: false,
    showEnzymes: false,
    showPrimers: false,
    showAutoAnnotations: false,
    toggleOrfs: () => {
      const tab = getActiveTab()
      if (!tab) return
      const next = !tab.showOrfs
      updateActiveTab({ showOrfs: next })
      // Picks are about what is on screen; hiding the overlay forgets them.
      if (!next) set({ orfPicks: new Set() })
    },
    toggleEnzymes: () => {
      const tab = getActiveTab()
      if (!tab) return
      const next = !tab.showEnzymes
      updateActiveTab({ showEnzymes: next })
    },
    togglePrimers: () => {
      const tab = getActiveTab()
      if (!tab) return
      const next = !tab.showPrimers
      updateActiveTab({ showPrimers: next })
    },
    toggleAutoAnnotations: () => {
      const tab = getActiveTab()
      if (!tab) return
      const next = !tab.showAutoAnnotations
      updateActiveTab({ showAutoAnnotations: next })
      // Suggestions are drawn in the annotation tracks. Switching the overlay
      // on while those are hidden would look like the scan found nothing.
      if (next) revealAnnotationTracks()
      // Picks are about what is on screen; hiding the overlay forgets them.
      else set({ autoAnnotationPicks: new Set() })
    },

    recentlyDeleted: [],

    // Per-item user metadata (favourites, notes)
    itemMeta: {},
    toggleItemStar: (uid) => {
      set(s => {
        const current = s.itemMeta[uid]
        const starred = !current?.starred
        // An entry with nothing left in it is dropped rather than kept as
        // `{ starred: false }`, so unstarring everything leaves an empty map
        // and the session stays small.
        const next = { ...current, starred: starred || undefined }
        return { itemMeta: pruneEmptyMeta(s.itemMeta, uid, next) }
      })
    },
    setItemNote: (uid, note) => {
      set(s => {
        const trimmed = note?.trim()
        const next = { ...s.itemMeta[uid], note: trimmed || undefined }
        return { itemMeta: pruneEmptyMeta(s.itemMeta, uid, next) }
      })
    },
    tagColors: {},
    addTag: (uid, tag) => {
      const name = tag.trim()
      if (!name) return
      set(s => {
        const current = s.itemMeta[uid]?.tags ?? []
        if (current.includes(name)) return {}
        return {
          itemMeta: pruneEmptyMeta(s.itemMeta, uid, { ...s.itemMeta[uid], tags: [...current, name] }),
          // A new tag picks the next unused colour, so two tags created in a
          // row never look the same.
          tagColors: s.tagColors[name]
            ? s.tagColors
            : { ...s.tagColors, [name]: nextTagColor(s.tagColors) },
        }
      })
    },
    removeTag: (uid, tag) => {
      set(s => {
        const current = s.itemMeta[uid]?.tags
        if (!current?.includes(tag)) return {}
        const tags = current.filter(t => t !== tag)
        return {
          itemMeta: pruneEmptyMeta(s.itemMeta, uid, {
            ...s.itemMeta[uid], tags: tags.length > 0 ? tags : undefined,
          }),
        }
      })
    },
    renameTag: (from, to) => {
      const name = to.trim()
      if (!name || name === from) return
      set(s => {
        const itemMeta: Record<string, ItemMeta> = {}
        for (const [uid, meta] of Object.entries(s.itemMeta)) {
          if (!meta.tags?.includes(from)) { itemMeta[uid] = meta; continue }
          // Renaming onto an existing tag merges the two, so the item does
          // not end up carrying the same name twice.
          const tags = [...new Set(meta.tags.map(t => (t === from ? name : t)))]
          itemMeta[uid] = { ...meta, tags }
        }
        const { [from]: color, ...rest } = s.tagColors
        return { itemMeta, tagColors: { ...rest, [name]: rest[name] ?? color ?? nextTagColor(rest) } }
      })
    },
    deleteTag: (tag) => {
      set(s => {
        const itemMeta: Record<string, ItemMeta> = {}
        for (const [uid, meta] of Object.entries(s.itemMeta)) {
          if (!meta.tags?.includes(tag)) { itemMeta[uid] = meta; continue }
          const tags = meta.tags.filter(t => t !== tag)
          const next: ItemMeta = { ...meta, tags: tags.length > 0 ? tags : undefined }
          if (!Object.values(next).every(v => v === undefined)) itemMeta[uid] = next
        }
        const tagColors = { ...s.tagColors }
        delete tagColors[tag]
        return { itemMeta, tagColors }
      })
    },
    setTagColor: (tag, color) => {
      set(s => ({ tagColors: { ...s.tagColors, [tag]: color } }))
    },
    pruneItemMeta: () => {
      const s = get()
      const live = new Set<string>([
        ...s.tabs.map(t => toUid('sequence', t.id)),
        ...s.sequencingReads.map(r => toUid('read', r.id)),
        ...s.alignments.map(a => toUid('alignment', a.id)),
        ...s.readAlignments.map(ra => toUid('read-alignment', ra.id)),
        ...s.contigs.map(c => toUid('contig', c.id)),
      ])
      const next: Record<string, ItemMeta> = {}
      let dropped = false
      for (const [uid, meta] of Object.entries(s.itemMeta)) {
        if (live.has(uid)) next[uid] = meta
        else dropped = true
      }
      if (dropped) set({ itemMeta: next })
    },

    // Explorer folders
    folders: [],
    createFolder: (name, parentId = null) => {
      const id = nextFolderId()
      set(state => ({
        folders: [...state.folders, { id, name, itemUids: [], parentId, collapsed: false }],
      }))
      return id
    },
    renameFolder: (id, name) => {
      set(state => ({ folders: state.folders.map(f => f.id === id ? { ...f, name } : f) }))
    },
    deleteFolder: (id) => {
      // Children are promoted to where the deleted folder sat rather than
      // deleted with it: "Delete folder, keep contents" has to mean the whole
      // subtree survives, not just the items one level down.
      set(state => {
        const parentId = state.folders.find(f => f.id === id)?.parentId ?? null
        return {
          folders: state.folders
            .filter(f => f.id !== id)
            .map(f => f.parentId === id ? { ...f, parentId } : f),
        }
      })
    },
    deleteFolderWithContents: (folderId) => {
      const state = get()
      if (!state.folders.some(f => f.id === folderId)) return

      // The whole subtree goes, and so does everything filed anywhere in it.
      const doomedFolders = folderSubtree(state.folders, folderId)
      const doomed = { sequence: new Set<string>(), read: new Set<string>(), alignment: new Set<string>(), 'read-alignment': new Set<string>(), contig: new Set<string>() }
      for (const f of state.folders) {
        if (!doomedFolders.has(f.id)) continue
        for (const uid of f.itemUids) {
          const parsed = parseUid(uid)
          if (parsed) doomed[parsed.kind].add(parsed.id)
        }
      }

      const newTabs = state.tabs.filter(t => !doomed.sequence.has(t.id))
      let newActiveId = state.activeTabId
      if (state.activeTabId && doomed.sequence.has(state.activeTabId)) {
        const idx = state.tabs.findIndex(t => t.id === state.activeTabId)
        const next = newTabs[Math.min(idx, newTabs.length - 1)]
        newActiveId = next?.id ?? null
      }
      const active = newTabs.find(t => t.id === newActiveId)

      const readAlignments = state.readAlignments.filter(ra => !doomed['read-alignment'].has(ra.id))
      const survivingRaIds = new Set(readAlignments.map(ra => ra.id))
      const contigs = state.contigs
        .filter(c => !doomed.contig.has(c.id))
        .map(c => ({ ...c, readAlignmentIds: c.readAlignmentIds.filter(id => survivingRaIds.has(id)) }))
        .filter(c => c.readAlignmentIds.length > 0)
      const contigIds = new Set(contigs.map(c => c.id))

      set({
        tabs: newTabs,
        activeTabId: newActiveId,
        doc: active?.doc ?? emptyDoc,
        selection: active?.selection ?? { anchor: 0, caret: 0 },
        search: active?.search ?? { ...emptySearch },
        viewMode: active?.viewMode ?? 'linear',
        zoomLevel: active?.zoomLevel ?? DEFAULT_ZOOM,
        readOnly: active?.readOnly ?? false,
        hiddenAnnotationIds: active?.hiddenAnnotationIds ?? [],
        showOrfs: active?.showOrfs ?? false,
        showEnzymes: active?.showEnzymes ?? false,
        showPrimers: active?.showPrimers ?? false,
        showAutoAnnotations: active?.showAutoAnnotations ?? false,
        autoAnnotations: active?.autoAnnotations ?? [],
        autoAnnotationPicks: new Set<string>(),
        orfPicks: new Set<string>(),
        sequencingReads: state.sequencingReads.filter(r => !doomed.read.has(r.id)),
        activeSequencingReadIds: state.activeSequencingReadIds.filter(id => !doomed.read.has(id)),
        alignments: state.alignments.filter(a => !doomed.alignment.has(a.id)),
        activeAlignmentId: doomed.alignment.has(state.activeAlignmentId ?? '') ? null : state.activeAlignmentId,
        readAlignments,
        activeReadAlignmentId: survivingRaIds.has(state.activeReadAlignmentId ?? '') ? state.activeReadAlignmentId : null,
        contigs,
        activeContigId: contigIds.has(state.activeContigId ?? '') ? state.activeContigId : null,
        folders: state.folders.filter(f => !doomedFolders.has(f.id)),
      })
    },
    toggleFolder: (id) => {
      set(state => ({ folders: state.folders.map(f => f.id === id ? { ...f, collapsed: !f.collapsed } : f) }))
    },
    moveItemToFolder: (uid, folderId) => {
      set(state => {
        // Pulled out of every folder first, so an item can never end up filed
        // in two places by a dropped drag that was not cleaned up.
        let folders = state.folders.map(f => ({
          ...f,
          itemUids: f.itemUids.filter(u => u !== uid),
        }))
        if (folderId) {
          folders = folders.map(f => f.id === folderId ? { ...f, itemUids: [...f.itemUids, uid] } : f)
        }
        return { folders }
      })
    },
    moveTabToFolder: (tabId, folderId) => {
      get().moveItemToFolder(toUid('sequence', tabId), folderId)
    },
    setFolderParent: (id, parentId) => {
      set(state => {
        if (id === parentId) return {}
        // Rejected rather than repaired: a folder dropped into its own
        // descendant would otherwise detach that whole subtree from the root
        // and make it unreachable.
        if (parentId && folderSubtree(state.folders, id).has(parentId)) return {}
        return { folders: state.folders.map(f => f.id === id ? { ...f, parentId } : f) }
      })
    },
    setFolderColor: (id, color) => {
      set(state => ({
        folders: state.folders.map(f => f.id === id ? { ...f, color: color ?? undefined } : f),
      }))
    },

    openDocument(name, bases, topology = 'linear', description, origin) {
      const doc: DocumentState = {
        name,
        description: description || undefined,
        sequence: new Sequence(bases, topology),
        annotations: [],
        metadata: origin ? { origin } : undefined,
      }
      const tab = makeTab(doc)
      set(state => ({
        tabs: [...state.tabs, tab],
        activeTabId: tab.id,
        doc: tab.doc,
        selection: tab.selection,
        search: tab.search,
        viewMode: tab.viewMode,
        zoomLevel: tab.zoomLevel,
        readOnly: tab.readOnly,
        hiddenAnnotationIds: tab.hiddenAnnotationIds,
        showOrfs: tab.showOrfs,
        showEnzymes: tab.showEnzymes,
        showPrimers: tab.showPrimers,
        showAutoAnnotations: tab.showAutoAnnotations,
        autoAnnotations: [],
        autoAnnotationPicks: new Set<string>(),
        orfPicks: new Set<string>(),
      }))
      return tab.id
    },

    openDocumentState(state) {
      const tab = makeTab(state)
      set(s => ({
        tabs: [...s.tabs, tab],
        activeTabId: tab.id,
        doc: tab.doc,
        selection: tab.selection,
        search: tab.search,
        viewMode: tab.viewMode,
        zoomLevel: tab.zoomLevel,
        readOnly: tab.readOnly,
        hiddenAnnotationIds: tab.hiddenAnnotationIds,
        showOrfs: tab.showOrfs,
        showEnzymes: tab.showEnzymes,
        showPrimers: tab.showPrimers,
        showAutoAnnotations: tab.showAutoAnnotations,
        autoAnnotations: [],
        autoAnnotationPicks: new Set<string>(),
        orfPicks: new Set<string>(),
      }))
      return tab.id
    },

    closeTab(tabId) {
      const { tabs, activeTabId, folders, recentlyDeleted } = get()
      const closing = tabs.find(t => t.id === tabId)
      const newTabs = tabs.filter(t => t.id !== tabId)
      let newActiveId = activeTabId
      if (activeTabId === tabId) {
        const idx = tabs.findIndex(t => t.id === tabId)
        const next = newTabs[Math.min(idx, newTabs.length - 1)]
        newActiveId = next?.id ?? null
      }
      const active = newTabs.find(t => t.id === newActiveId)
      set({
        tabs: newTabs,
        activeTabId: newActiveId,
        doc: active?.doc ?? emptyDoc,
        selection: active?.selection ?? { anchor: 0, caret: 0 },
        search: active?.search ?? { ...emptySearch },
        viewMode: active?.viewMode ?? 'linear',
        zoomLevel: active?.zoomLevel ?? DEFAULT_ZOOM,
        readOnly: active?.readOnly ?? false,
        hiddenAnnotationIds: active?.hiddenAnnotationIds ?? [],
        showOrfs: active?.showOrfs ?? false,
        showEnzymes: active?.showEnzymes ?? false,
        showPrimers: active?.showPrimers ?? false,
        showAutoAnnotations: active?.showAutoAnnotations ?? false,
        autoAnnotations: active?.autoAnnotations ?? [],
        autoAnnotationPicks: new Set<string>(),
        orfPicks: new Set<string>(),
        // Remove closed tab from any folder
        folders: withoutItem(folders, toUid('sequence', tabId)),
        // Keep enough to put it back. Deleting a sequence discards it
        // outright, and a mis-aimed click on a dense explorer list is easy.
        recentlyDeleted: closing
          ? pushDeleted(recentlyDeleted, {
              kind: 'sequence',
              tab: closing,
              index: tabs.findIndex(t => t.id === tabId),
              folderId: folderOf(folders, toUid('sequence', tabId)),
            })
          : recentlyDeleted,
      })
    },

    undoDelete() {
      const state = get()
      const last = state.recentlyDeleted[state.recentlyDeleted.length - 1]
      if (!last) return
      const rest = state.recentlyDeleted.slice(0, -1)

      switch (last.kind) {
        case 'sequence': {
          // Put it back where it was, not on the end.
          const restored = state.tabs.slice()
          restored.splice(Math.min(last.index, restored.length), 0, last.tab)
          set({
            tabs: restored,
            recentlyDeleted: rest,
            folders: withItem(state.folders, toUid('sequence', last.tab.id), last.folderId),
          })
          // Focus it, so an undo lands the user back where they were. This
          // also repopulates doc/selection/view state from the restored tab.
          // Cached analysis results (ORFs, cut sites) are not restored: they
          // are only written back to a tab on switch, so the closed tab's
          // copy was stale.
          get().setActiveTab(last.tab.id)
          return
        }
        case 'read': {
          set({
            sequencingReads: insertAt(state.sequencingReads, last.index, last.read),
            folders: withItem(state.folders, toUid('read', last.read.id), last.folderId),
            recentlyDeleted: rest,
          })
          if (last.wasActive) get().setActiveSequencingRead(last.read.id)
          return
        }
        case 'alignment': {
          set({
            alignments: insertAt(state.alignments, last.index, last.alignment),
            folders: withItem(state.folders, toUid('alignment', last.alignment.id), last.folderId),
            recentlyDeleted: rest,
          })
          get().setActiveAlignment(last.alignment.id)
          return
        }
        case 'read-alignment': {
          // The contig list is restored wholesale: removing a read alignment
          // can empty a contig, and deleting that contig is part of the same
          // action the user is taking back.
          set({
            readAlignments: insertAt(state.readAlignments, last.index, last.readAlignment),
            contigs: last.contigs,
            folders: withItem(state.folders, toUid('read-alignment', last.readAlignment.id), last.folderId),
            recentlyDeleted: rest,
          })
          get().setActiveReadAlignment(last.readAlignment.id)
          return
        }
        case 'contig': {
          set({
            contigs: insertAt(state.contigs, last.index, last.contig),
            folders: withItem(state.folders, toUid('contig', last.contig.id), last.folderId),
            recentlyDeleted: rest,
          })
          get().setActiveContig(last.contig.id)
          return
        }
      }
    },

    reopenClosedTab() {
      get().undoDelete()
    },

    setActiveTab(tabId) {
      const state = get()
      const tab = state.tabs.find(t => t.id === tabId)
      if (!tab) return

      // Save current analysis results to the outgoing tab
      const outgoing = state.activeTabId
      let tabs = state.tabs
      if (outgoing && outgoing !== tabId) {
        tabs = tabs.map(t => t.id === outgoing ? {
          ...t,
          orfResults: state.orfResults,
          enzymeCutSites: state.enzymeCutSites,
          enzymeNames: state.enzymeNames,
          primerResults: state.primerResults,
          selectedPrimerIndices: state.selectedPrimerIndices,
          autoAnnotations: state.autoAnnotations,
        } : t)
      }

      set({
        tabs,
        activeTabId: tabId,
        activeSequencingReadIds: [],
        activeAlignmentId: null,
        activeReadAlignmentId: null,
        activeContigId: null,
        doc: tab.doc,
        selection: tab.selection,
        search: tab.search,
        viewMode: tab.viewMode,
        zoomLevel: tab.zoomLevel,
        readOnly: tab.readOnly,
        hiddenAnnotationIds: tab.hiddenAnnotationIds,
        showOrfs: tab.showOrfs,
        showEnzymes: tab.showEnzymes,
        showPrimers: tab.showPrimers,
        showAutoAnnotations: tab.showAutoAnnotations,
        // Restore cached results from the incoming tab
        orfResults: tab.orfResults,
        enzymeCutSites: tab.enzymeCutSites,
        enzymeNames: tab.enzymeNames,
        primerResults: tab.primerResults,
        selectedPrimerIndices: tab.selectedPrimerIndices,
        autoAnnotations: tab.autoAnnotations,
        // Picks belong to what was on screen, not to the app.
        autoAnnotationPicks: new Set<string>(),
        orfPicks: new Set<string>(),
      })
    },

    renameTab(tabId, name) {
      const { tabs, activeTabId } = get()
      const updated = tabs.map(t =>
        t.id === tabId ? { ...t, doc: { ...t.doc, name } } : t
      )
      // If renaming the active tab, also update the convenience `doc` field
      if (tabId === activeTabId) {
        const active = updated.find(t => t.id === activeTabId)
        set({ tabs: updated, ...(active ? { doc: active.doc } : {}) })
      } else {
        set({ tabs: updated })
      }
    },

    duplicateTab(tabId) {
      const tab = get().tabs.find(t => t.id === tabId)
      if (!tab) return
      const snap = snapshot(tab.doc)
      const newDoc = restore({ ...snap, name: `${snap.name} (copy)` })
      const newTab = makeTab(newDoc)
      set(state => ({
        tabs: [...state.tabs, newTab],
        activeTabId: newTab.id,
        doc: newTab.doc,
        selection: newTab.selection,
        search: newTab.search,
        viewMode: newTab.viewMode,
        zoomLevel: newTab.zoomLevel,
        readOnly: newTab.readOnly,
        hiddenAnnotationIds: newTab.hiddenAnnotationIds,
        showOrfs: newTab.showOrfs,
        showEnzymes: newTab.showEnzymes,
        showPrimers: newTab.showPrimers,
        showAutoAnnotations: newTab.showAutoAnnotations,
        autoAnnotations: [],
        autoAnnotationPicks: new Set<string>(),
        orfPicks: new Set<string>(),
      }))
    },

    setViewMode(mode) {
      updateActiveTab({ viewMode: mode })
    },

    setZoom(level) {
      const clamped = Math.max(0, Math.min(20, level))
      updateActiveTab({ zoomLevel: clamped })
    },

    toggleReadOnly() {
      const tab = getActiveTab()
      if (!tab) return
      updateActiveTab({ readOnly: !tab.readOnly })
    },

    restoreSession(restoredTabs, restoredActiveId, restoredFolders, seqReads, activeSeqReadIds, savedAlignments, savedReadAlignments, savedContigs, restoredActiveAlignmentId, restoredActiveContigId, restoredActiveReadAlignmentId, restoredItemMeta, restoredTagColors) {
      const tabs: DocumentTab[] = restoredTabs.map(rt => ({
        id: rt.id,
        doc: rt.doc,
        createdAt: rt.createdAt ?? 0,
        modifiedAt: rt.modifiedAt ?? rt.createdAt ?? 0,
        selection: { anchor: 0, caret: 0 },
        search: { ...emptySearch },
        undoStack: rt.undoStack ?? [],
        redoStack: rt.redoStack ?? [],
        viewMode: rt.viewMode,
        zoomLevel: rt.zoomLevel,
        readOnly: rt.readOnly ?? false,
        hiddenAnnotationIds: rt.hiddenAnnotationIds ?? [],
        showOrfs: rt.showOrfs ?? false,
        showEnzymes: rt.showEnzymes ?? false,
        showPrimers: rt.showPrimers ?? false,
        showAutoAnnotations: rt.showAutoAnnotations ?? false,
        orfResults: [],
        enzymeCutSites: [],
        enzymeNames: [],
        primerResults: [],
        selectedPrimerIndices: new Set(),
        autoAnnotations: [],
      }))
      // Sync ID counters above all restored IDs to avoid collisions
      const syncId = (id: string, gen: ReturnType<typeof makeIdGenerator>, prefix: string) => {
        const m = id.match(new RegExp(`^${prefix}_(\\d+)$`))
        if (m) gen.syncTo(parseInt(m[1], 10))
      }
      for (const t of tabs) syncId(t.id, tabIds, 'tab')
      for (const f of restoredFolders) syncId(f.id, folderIds, 'folder')

      // Restore sequencing reads
      const sequencingReads: SequencingRead[] = (seqReads ?? []).map(sr => {
        syncId(sr.id, seqReadIds, 'seqread')
        return {
          id: sr.id,
          data: sr.data,
          createdAt: sr.createdAt ?? 0,
          trimStart: sr.trimStart,
          trimEnd: sr.trimEnd,
          edits: sr.edits ?? [],
          undoStack: [],
          redoStack: [],
        }
      })

      // Restore alignments
      const alignments: SavedAlignment[] = (savedAlignments ?? []).map(a => {
        syncId(a.id, alignIds, 'align')
        return a
      })

      // Restore read alignments
      const readAlignments: ReadAlignment[] = (savedReadAlignments ?? []).map(ra => {
        syncId(ra.id, readAlignIds, 'readalign')
        return ra
      })

      // Restore contigs
      const contigs: Contig[] = (savedContigs ?? []).map(c => {
        syncId(c.id, contigIds, 'contig')
        return c
      })

      // Determine which view was last active – validate that the referenced entity still exists
      const validActiveAlignId = restoredActiveAlignmentId && alignments.some(a => a.id === restoredActiveAlignmentId)
        ? restoredActiveAlignmentId : null
      const validActiveContigId = restoredActiveContigId && contigs.some(c => c.id === restoredActiveContigId)
        ? restoredActiveContigId : null
      const validActiveRAId = restoredActiveReadAlignmentId && readAlignments.some(ra => ra.id === restoredActiveReadAlignmentId)
        ? restoredActiveReadAlignmentId : null

      // If a non-tab view was active, don't force a tab active
      const hasNonTabView = (activeSeqReadIds && activeSeqReadIds.length > 0) || validActiveAlignId || validActiveContigId || validActiveRAId
      const active = hasNonTabView ? null : (tabs.find(t => t.id === restoredActiveId) ?? tabs[0] ?? null)

      set({
        tabs,
        activeTabId: active?.id ?? (hasNonTabView ? null : null),
        doc: active?.doc ?? emptyDoc,
        selection: active?.selection ?? { anchor: 0, caret: 0 },
        search: active?.search ?? { ...emptySearch },
        viewMode: active?.viewMode ?? 'linear',
        zoomLevel: active?.zoomLevel ?? DEFAULT_ZOOM,
        readOnly: active?.readOnly ?? false,
        hiddenAnnotationIds: active?.hiddenAnnotationIds ?? [],
        showOrfs: active?.showOrfs ?? false,
        showEnzymes: active?.showEnzymes ?? false,
        showPrimers: active?.showPrimers ?? false,
        showAutoAnnotations: active?.showAutoAnnotations ?? false,
        autoAnnotations: active?.autoAnnotations ?? [],
        autoAnnotationPicks: new Set<string>(),
        orfPicks: new Set<string>(),
        folders: restoredFolders,
        sequencingReads,
        activeSequencingReadIds: activeSeqReadIds ?? [],
        alignments,
        activeAlignmentId: validActiveAlignId,
        readAlignments,
        activeReadAlignmentId: validActiveRAId,
        contigs,
        activeContigId: validActiveContigId,
        itemMeta: restoredItemMeta ?? {},
        tagColors: restoredTagColors ?? {},
      })
    },

    mergeSession(mergedTabs, mergedFolders, seqReads, savedAlignments, savedReadAlignments, savedContigs, importedItemMeta, importedTagColors) {
      const state = get()

      // Convert imported tabs to DocumentTab objects
      const newTabs: DocumentTab[] = mergedTabs.map(rt => ({
        id: rt.id,
        doc: rt.doc,
        createdAt: rt.createdAt ?? Date.now(),
        modifiedAt: rt.modifiedAt ?? rt.createdAt ?? Date.now(),
        selection: { anchor: 0, caret: 0 },
        search: { ...emptySearch },
        undoStack: [],
        redoStack: [],
        viewMode: rt.viewMode,
        zoomLevel: rt.zoomLevel,
        readOnly: rt.readOnly ?? false,
        hiddenAnnotationIds: rt.hiddenAnnotationIds ?? [],
        showOrfs: rt.showOrfs ?? false,
        showEnzymes: rt.showEnzymes ?? false,
        showPrimers: rt.showPrimers ?? false,
        showAutoAnnotations: rt.showAutoAnnotations ?? false,
        orfResults: [],
        enzymeCutSites: [],
        enzymeNames: [],
        primerResults: [],
        selectedPrimerIndices: new Set(),
        autoAnnotations: [],
      }))

      // Merge folders: match by name, add new items to existing folders
      const existingFoldersByName = new Map(state.folders.map(f => [f.name, f]))
      const finalFolders = [...state.folders]
      for (const importedFolder of mergedFolders) {
        const existing = existingFoldersByName.get(importedFolder.name)
        if (existing) {
          // Add item uids to the existing folder, avoiding duplicates
          const existingIds = new Set(existing.itemUids)
          for (const uid of importedFolder.itemUids) {
            if (!existingIds.has(uid)) existing.itemUids.push(uid)
          }
        } else {
          finalFolders.push(importedFolder)
        }
      }

      // Merge sequencing reads
      const newReads: SequencingRead[] = (seqReads ?? []).map(sr => ({
        id: sr.id,
        data: sr.data,
        createdAt: sr.createdAt ?? Date.now(),
        trimStart: sr.trimStart,
        trimEnd: sr.trimEnd,
        edits: sr.edits ?? [],
        undoStack: [],
        redoStack: [],
      }))

      set({
        tabs: [...state.tabs, ...newTabs],
        folders: finalFolders,
        sequencingReads: [...state.sequencingReads, ...newReads],
        alignments: [...state.alignments, ...(savedAlignments ?? [])],
        readAlignments: [...state.readAlignments, ...(savedReadAlignments ?? [])],
        contigs: [...state.contigs, ...(savedContigs ?? [])],
        // Imported ids were remapped before this call, so the incoming keys
        // cannot collide with metadata already in the map.
        itemMeta: { ...state.itemMeta, ...(importedItemMeta ?? {}) },
        // Existing colours win: an import must not repaint tags already here.
        tagColors: { ...(importedTagColors ?? {}), ...state.tagColors },
      })
    },

    // Legacy compat - these just delegate to the multi-doc versions
    loadDocument(name, bases, topology = 'linear') {
      // If there are no tabs, open a new one. Otherwise replace the active tab.
      const { tabs } = get()
      if (tabs.length === 0) {
        get().openDocument(name, bases, topology)
      } else {
        const doc: DocumentState = { name, sequence: new Sequence(bases, topology), annotations: [] }
        updateActiveTab({ doc, selection: { anchor: 0, caret: 0 }, undoStack: [], redoStack: [], search: { ...emptySearch } })
      }
    },

    loadDocumentState(state) {
      const { tabs } = get()
      if (tabs.length === 0) {
        get().openDocumentState(state)
      } else {
        updateActiveTab({ doc: state, selection: { anchor: 0, caret: 0 }, undoStack: [], redoStack: [], search: { ...emptySearch } })
      }
    },

    updateDocumentProperties(props) {
      const tab = getActiveTab()
      if (!tab) return
      pushUndo()
      const doc = { ...tab.doc }
      if (props.name !== undefined) doc.name = props.name
      if (props.description !== undefined) doc.description = props.description
      if (props.topology !== undefined && props.topology !== doc.sequence.topology) {
        doc.sequence = doc.sequence.withTopology(props.topology)
      }
      const meta = { ...(doc.metadata || {}) }
      if (props.strandedness !== undefined) meta.strandedness = props.strandedness
      if (props.damMethylated !== undefined) meta.damMethylated = props.damMethylated
      if (props.dcmMethylated !== undefined) meta.dcmMethylated = props.dcmMethylated
      if (props.ecoKIMethylated !== undefined) meta.ecoKIMethylated = props.ecoKIMethylated
      if (props.displayOrigin !== undefined) meta.displayOrigin = props.displayOrigin
      doc.metadata = meta

      // Reset displayOrigin when switching to linear
      if (props.topology === 'linear' && meta.displayOrigin) {
        meta.displayOrigin = 0
      }

      const patch: Partial<DocumentTab> = { doc }
      // Auto-switch view mode on topology change
      if (props.topology === 'circular' && tab.viewMode === 'linear') {
        patch.viewMode = 'split'
      } else if (props.topology === 'linear' && tab.viewMode !== 'linear') {
        patch.viewMode = 'linear'
      }
      updateActiveTab(patch)
    },

    setDisplayOrigin(pos) {
      const tab = getActiveTab()
      if (!tab) return
      if (tab.doc.sequence.topology !== 'circular') return
      const doc = { ...tab.doc }
      const meta = { ...(doc.metadata || {}) }
      meta.displayOrigin = pos
      doc.metadata = meta
      updateActiveTab({ doc })
    },

    rotateOrigin(newOrigin) {
      const tab = getActiveTab()
      if (!tab) return
      if (tab.doc.sequence.topology !== 'circular') return
      if (newOrigin === 0) return
      pushUndo()
      const doc = rotateOriginDoc(tab.doc, newOrigin)
      updateActiveTab({ doc })
    },

    insert(pos, fragment) {
      const tab = getActiveTab()
      if (!tab || tab.readOnly) return
      pushUndo()
      updateActiveTab({ doc: insertBasesInPlace(tab.doc, pos, fragment) })
    },

    delete(start, end) {
      const tab = getActiveTab()
      if (!tab || tab.readOnly) return
      pushUndo()
      updateActiveTab({ doc: deleteBasesInPlace(tab.doc, start, end) })
    },

    deleteTwo(start1, end1, start2, end2, insertAtZero) {
      const tab = getActiveTab()
      if (!tab || tab.readOnly) return
      pushUndo()
      let doc = deleteBasesInPlace(tab.doc, start1, end1)
      doc = deleteBasesInPlace(doc, start2, end2)
      if (insertAtZero) doc = insertBasesInPlace(doc, 0, insertAtZero)
      updateActiveTab({ doc })
    },

    replace(start, end, fragment) {
      const tab = getActiveTab()
      if (!tab || tab.readOnly) return
      pushUndo()
      updateActiveTab({ doc: replaceBasesInPlace(tab.doc, start, end, fragment) })
    },

    // All of these route through transact(), so each is exactly one undo entry
    // and one store write, whether it touches one annotation or five hundred.

    addAnnotation(data) {
      if (transact(doc => addAnnotation(doc, data))) revealAnnotationTracks()
    },

    addAnnotations(dataArray) {
      if (dataArray.length === 0) return
      if (transact(doc => dataArray.reduce(addAnnotation, doc))) revealAnnotationTracks()
    },

    removeAnnotation(id) {
      transact(doc => removeAnnotation(doc, id))
    },

    removeAnnotations(ids) {
      transact(doc => removeAnnotations(doc, ids))
    },

    updateAnnotation(id, patch) {
      transact(doc => updateAnnotation(doc, id, patch))
    },

    updateAnnotations(ids, patch, opts) {
      transact(doc => updateAnnotations(doc, ids, patch), opts)
    },

    setSelection(sel) {
      updateActiveTab({ selection: sel })
    },

    setCaret(pos) {
      updateActiveTab({ selection: { anchor: pos, caret: pos } })
    },

    undo() {
      const tab = getActiveTab()
      if (!tab || tab.readOnly || tab.undoStack.length === 0) return
      // A drag that is still coalescing must not keep folding into an entry
      // the user has just stepped away from.
      endCoalesce()
      const prev = tab.undoStack[tab.undoStack.length - 1]
      const redoSnap = undoSnapshot(tab.doc)
      updateActiveTab({
        doc: restoreUndo(prev, tab.doc.sequence),
        undoStack: tab.undoStack.slice(0, -1),
        redoStack: [...tab.redoStack, redoSnap],
      })
      set({ lastUndoRedoAction: 'undo' })
    },

    redo() {
      const tab = getActiveTab()
      if (!tab || tab.readOnly || tab.redoStack.length === 0) return
      endCoalesce()
      const next = tab.redoStack[tab.redoStack.length - 1]
      const undoSnap = undoSnapshot(tab.doc)
      updateActiveTab({
        doc: restoreUndo(next, tab.doc.sequence),
        redoStack: tab.redoStack.slice(0, -1),
        undoStack: [...tab.undoStack, undoSnap],
      })
      set({ lastUndoRedoAction: 'redo' })
    },

    canUndo() {
      const tab = getActiveTab()
      return tab ? tab.undoStack.length > 0 : false
    },

    canRedo() {
      const tab = getActiveTab()
      return tab ? tab.redoStack.length > 0 : false
    },

    setSearch(query, options) {
      const tab = getActiveTab()
      if (!tab) return
      const bases = tab.doc.sequence.bases
      const circular = tab.doc.sequence.topology === 'circular'
      const matches = computeMatches(query, options, bases, circular)
      let currentMatch = -1
      if (matches.length > 0) {
        const caret = tab.selection.caret
        currentMatch = matches.findIndex(([s]) => s >= caret)
        if (currentMatch === -1) currentMatch = 0
        const [s, e] = matches[currentMatch]
        updateActiveTab({ search: { query, options, matches, currentMatch }, selection: { anchor: s, caret: e } })
      } else {
        updateActiveTab({ search: { query, options, matches, currentMatch } })
      }
    },

    nextMatch() {
      const tab = getActiveTab()
      if (!tab || tab.search.matches.length === 0) return
      const next = (tab.search.currentMatch + 1) % tab.search.matches.length
      const [s, e] = tab.search.matches[next]
      updateActiveTab({ search: { ...tab.search, currentMatch: next }, selection: { anchor: s, caret: e } })
    },

    prevMatch() {
      const tab = getActiveTab()
      if (!tab || tab.search.matches.length === 0) return
      const prev = (tab.search.currentMatch - 1 + tab.search.matches.length) % tab.search.matches.length
      const [s, e] = tab.search.matches[prev]
      updateActiveTab({ search: { ...tab.search, currentMatch: prev }, selection: { anchor: s, caret: e } })
    },

    clearSearch() {
      updateActiveTab({ search: { ...emptySearch } })
    },

    replaceCurrentMatch(replacement) {
      const tab = getActiveTab()
      if (!tab || tab.readOnly || tab.search.currentMatch < 0 || tab.search.currentMatch >= tab.search.matches.length) return
      const [s, e] = tab.search.matches[tab.search.currentMatch]
      pushUndo()
      const newDoc = replaceBasesInPlace(get().doc, s, e, replacement.toUpperCase())
      const bases = newDoc.sequence.bases
      const circular = newDoc.sequence.topology === 'circular'
      const matches = computeMatches(tab.search.query, tab.search.options, bases, circular)
      const nextIdx = Math.min(tab.search.currentMatch, matches.length - 1)
      if (matches.length > 0 && nextIdx >= 0) {
        const [ns, ne] = matches[nextIdx]
        updateActiveTab({ doc: newDoc, search: { ...tab.search, matches, currentMatch: nextIdx }, selection: { anchor: ns, caret: ne } })
      } else {
        updateActiveTab({ doc: newDoc, search: { ...tab.search, matches, currentMatch: -1 } })
      }
    },

    replaceAllMatches(replacement) {
      const tab = getActiveTab()
      if (!tab || tab.readOnly || tab.search.matches.length === 0) return
      pushUndo()
      const upper = replacement.toUpperCase()
      let doc = tab.doc
      for (let i = tab.search.matches.length - 1; i >= 0; i--) {
        const [s, e] = tab.search.matches[i]
        doc = replaceBasesInPlace(doc, s, e, upper)
      }
      const bases = doc.sequence.bases
      const circular = doc.sequence.topology === 'circular'
      const matches = computeMatches(tab.search.query, tab.search.options, bases, circular)
      updateActiveTab({ doc, search: { ...tab.search, matches, currentMatch: matches.length > 0 ? 0 : -1 } })
    },

    // ---- Sequencing reads ----
    sequencingReads: [],
    activeSequencingReadIds: [],

    addSequencingRead(data) {
      const id = nextSeqReadId()
      const read: SequencingRead = {
        id,
        data,
        createdAt: Date.now(),
        trimStart: 0,
        trimEnd: data.bases.length,
        edits: [],
        undoStack: [],
        redoStack: [],
      }
      set(s => ({
        sequencingReads: [...s.sequencingReads, read],
        activeSequencingReadIds: [id],
        activeTabId: null,
        activeAlignmentId: null,
        activeReadAlignmentId: null,
      }))
      return id
    },

    removeSequencingRead(id) {
      set(s => {
        const index = s.sequencingReads.findIndex(r => r.id === id)
        if (index === -1) return {}
        return {
          sequencingReads: s.sequencingReads.filter(r => r.id !== id),
          activeSequencingReadIds: s.activeSequencingReadIds.filter(rid => rid !== id),
          folders: withoutItem(s.folders, toUid('read', id)),
          recentlyDeleted: pushDeleted(s.recentlyDeleted, {
            kind: 'read',
            index,
            folderId: folderOf(s.folders, toUid('read', id)),
            read: s.sequencingReads[index],
            wasActive: s.activeSequencingReadIds.includes(id),
          }),
        }
      })
    },

    setActiveSequencingRead(id) {
      set({
        activeSequencingReadIds: id ? [id] : [],
        activeTabId: id ? null : get().activeTabId,
        activeAlignmentId: id ? null : get().activeAlignmentId,
        activeReadAlignmentId: id ? null : get().activeReadAlignmentId,
        activeContigId: id ? null : get().activeContigId,
      })
    },

    toggleSequencingRead(id) {
      set(s => {
        const has = s.activeSequencingReadIds.includes(id)
        const next = has
          ? s.activeSequencingReadIds.filter(rid => rid !== id)
          : [...s.activeSequencingReadIds, id]
        return {
          activeSequencingReadIds: next,
          activeAlignmentId: next.length > 0 ? null : s.activeAlignmentId,
          activeReadAlignmentId: next.length > 0 ? null : s.activeReadAlignmentId,
          activeContigId: next.length > 0 ? null : s.activeContigId,
          activeTabId: next.length > 0 ? null : s.activeTabId,
        }
      })
    },

    setSequencingTrim(id, start, end) {
      set(s => ({
        sequencingReads: s.sequencingReads.map(r => {
          if (r.id !== id) return r
          const snap: SeqUndoSnapshot = { edits: r.edits, trimStart: r.trimStart, trimEnd: r.trimEnd }
          return { ...r, trimStart: start, trimEnd: end, undoStack: [...r.undoStack, snap].slice(-50), redoStack: [] }
        }),
      }))
    },

    renameSequencingRead(id, name) {
      set(s => ({
        sequencingReads: s.sequencingReads.map(r =>
          r.id === id ? { ...r, data: { ...r.data, name } } : r
        ),
      }))
    },

    editSequencingBase(id, edit) {
      set(s => ({
        sequencingReads: s.sequencingReads.map(r => {
          if (r.id !== id) return r
          const snap: SeqUndoSnapshot = { edits: r.edits, trimStart: r.trimStart, trimEnd: r.trimEnd }
          let edits = r.edits
          if (edit.type === 'substitute' || edit.type === 'delete') {
            edits = edits.filter(e => !(e.pos === edit.pos && (e.type === 'substitute' || e.type === 'delete')))
          }
          return { ...r, edits: [...edits, edit], undoStack: [...r.undoStack, snap].slice(-50), redoStack: [] }
        }),
      }))
    },

    resetSequencingEdits(id) {
      set(s => ({
        sequencingReads: s.sequencingReads.map(r => {
          if (r.id !== id) return r
          const snap: SeqUndoSnapshot = { edits: r.edits, trimStart: r.trimStart, trimEnd: r.trimEnd }
          return { ...r, edits: [], undoStack: [...r.undoStack, snap].slice(-50), redoStack: [] }
        }),
      }))
    },

    undoSequencing(id) {
      set(s => ({
        sequencingReads: s.sequencingReads.map(r => {
          if (r.id !== id || r.undoStack.length === 0) return r
          const prev = r.undoStack[r.undoStack.length - 1]
          const redoSnap: SeqUndoSnapshot = { edits: r.edits, trimStart: r.trimStart, trimEnd: r.trimEnd }
          return {
            ...r,
            edits: prev.edits,
            trimStart: prev.trimStart,
            trimEnd: prev.trimEnd,
            undoStack: r.undoStack.slice(0, -1),
            redoStack: [...r.redoStack, redoSnap],
          }
        }),
      }))
    },

    redoSequencing(id) {
      set(s => ({
        sequencingReads: s.sequencingReads.map(r => {
          if (r.id !== id || r.redoStack.length === 0) return r
          const next = r.redoStack[r.redoStack.length - 1]
          const undoSnap: SeqUndoSnapshot = { edits: r.edits, trimStart: r.trimStart, trimEnd: r.trimEnd }
          return {
            ...r,
            edits: next.edits,
            trimStart: next.trimStart,
            trimEnd: next.trimEnd,
            redoStack: r.redoStack.slice(0, -1),
            undoStack: [...r.undoStack, undoSnap],
          }
        }),
      }))
    },

    // ---- Alignments ----
    alignments: [],
    activeAlignmentId: null,

    addAlignment(result, seqType, algorithm) {
      const id = nextAlignId()
      const names = result.sequences.map(s => s.name)
      const name = names.length === 2
        ? `${names[0]} vs ${names[1]}`
        : `MSA (${names.length} sequences)`
      const saved: SavedAlignment = {
        id,
        name,
        result,
        seqType,
        algorithm,
        createdAt: Date.now(),
        zoomLevel: 7, // default zoom (10px cells)
      }
      set({
        alignments: [...get().alignments, saved],
        activeAlignmentId: id,
        activeTabId: null,
        activeSequencingReadIds: [],
        activeReadAlignmentId: null,
      })
      return id
    },

    removeAlignment(id) {
      set(s => {
        const index = s.alignments.findIndex(a => a.id === id)
        if (index === -1) return {}
        return {
          alignments: s.alignments.filter(a => a.id !== id),
          activeAlignmentId: s.activeAlignmentId === id ? null : s.activeAlignmentId,
          folders: withoutItem(s.folders, toUid('alignment', id)),
          recentlyDeleted: pushDeleted(s.recentlyDeleted, {
            kind: 'alignment', index,
            folderId: folderOf(s.folders, toUid('alignment', id)),
            alignment: s.alignments[index],
          }),
        }
      })
    },

    renameAlignment(id, name) {
      set(s => ({
        alignments: s.alignments.map(a =>
          a.id === id ? { ...a, name } : a
        ),
      }))
    },

    setActiveAlignment(id) {
      set({
        activeAlignmentId: id,
        activeTabId: id ? null : get().activeTabId,
        activeSequencingReadIds: id ? [] : get().activeSequencingReadIds,
        activeReadAlignmentId: id ? null : get().activeReadAlignmentId,
        activeContigId: id ? null : get().activeContigId,
      })
    },

    setAlignmentZoom(id, level) {
      set(s => ({
        alignments: s.alignments.map(a =>
          a.id === id ? { ...a, zoomLevel: level } : a
        ),
      }))
    },

    // ---- Read Alignments ----
    readAlignments: [],
    activeReadAlignmentId: null,

    addReadAlignment(readId, tabId, result) {
      const id = nextReadAlignId()
      const read = get().sequencingReads.find(r => r.id === readId)
      const tab = get().tabs.find(t => t.id === tabId)
      const readName = read?.data.name ?? 'Read'
      const refName = tab?.doc.name ?? 'Reference'
      const ra: ReadAlignment = {
        id,
        name: `${readName} → ${refName}`,
        readId,
        tabId,
        result,
        createdAt: Date.now(),
        zoomLevel: 7,
        showChromatogram: true,
        resolvedCols: [],
      }
      set({
        readAlignments: [...get().readAlignments, ra],
        activeReadAlignmentId: id,
        activeTabId: null,
        activeSequencingReadIds: [],
        activeAlignmentId: null,
      })
      return id
    },

    removeReadAlignment(id) {
      set(s => {
        const index = s.readAlignments.findIndex(r => r.id === id)
        if (index === -1) return {}
        // Remove from contigs; delete contigs that become empty
        const updatedContigs = s.contigs
          .map(c => c.readAlignmentIds.includes(id)
            ? { ...c, readAlignmentIds: c.readAlignmentIds.filter(rid => rid !== id) }
            : c)
          .filter(c => c.readAlignmentIds.length > 0)
        const removedContigIds = s.contigs.filter(c => !updatedContigs.find(uc => uc.id === c.id)).map(c => c.id)
        return {
          readAlignments: s.readAlignments.filter(r => r.id !== id),
          activeReadAlignmentId: s.activeReadAlignmentId === id ? null : s.activeReadAlignmentId,
          contigs: updatedContigs,
          activeContigId: removedContigIds.includes(s.activeContigId ?? '') ? null : s.activeContigId,
          folders: withoutItem(s.folders, toUid('read-alignment', id)),
          recentlyDeleted: pushDeleted(s.recentlyDeleted, {
            kind: 'read-alignment',
            index,
            folderId: folderOf(s.folders, toUid('read-alignment', id)),
            readAlignment: s.readAlignments[index],
            contigs: s.contigs,
          }),
        }
      })
    },

    renameReadAlignment(id, name) {
      set(s => ({
        readAlignments: s.readAlignments.map(r =>
          r.id === id ? { ...r, name } : r
        ),
      }))
    },

    setActiveReadAlignment(id) {
      set({
        activeReadAlignmentId: id,
        activeTabId: id ? null : get().activeTabId,
        activeSequencingReadIds: id ? [] : get().activeSequencingReadIds,
        activeAlignmentId: id ? null : get().activeAlignmentId,
        activeContigId: id ? null : get().activeContigId,
      })
    },

    setReadAlignmentZoom(id, level) {
      set(s => ({
        readAlignments: s.readAlignments.map(r =>
          r.id === id ? { ...r, zoomLevel: level } : r
        ),
      }))
    },

    toggleReadAlignmentChromatogram(id) {
      set(s => ({
        readAlignments: s.readAlignments.map(r =>
          r.id === id ? { ...r, showChromatogram: !r.showChromatogram } : r
        ),
      }))
    },

    updateReadAlignmentResult(id, result) {
      set(s => ({
        readAlignments: s.readAlignments.map(r =>
          r.id === id ? { ...r, result } : r
        ),
      }))
    },

    addReadAlignmentResolvedCol(id, col) {
      set(s => ({
        readAlignments: s.readAlignments.map(r =>
          r.id === id && !r.resolvedCols.includes(col)
            ? { ...r, resolvedCols: [...r.resolvedCols, col] }
            : r
        ),
      }))
    },

    clearReadAlignmentResolvedCols(id) {
      set(s => ({
        readAlignments: s.readAlignments.map(r =>
          r.id === id ? { ...r, resolvedCols: [] } : r
        ),
      }))
    },

    // ---- Contigs ----
    contigs: [],
    activeContigId: null,

    addContig(tabId, readAlignmentIds) {
      const id = nextContigId()
      const tab = get().tabs.find(t => t.id === tabId)
      const refName = tab?.doc.name ?? 'Reference'
      const contig: Contig = {
        id,
        name: `Contig: ${refName}`,
        tabId,
        readAlignmentIds,
        createdAt: Date.now(),
        zoomLevel: 7,
        expandedReadId: null,
      }
      set(s => ({
        contigs: [...s.contigs, contig],
        activeContigId: id,
        activeTabId: null,
        activeSequencingReadIds: [],
        activeAlignmentId: null,
        activeReadAlignmentId: null,
      }))
      return id
    },

    removeContig(id) {
      set(s => {
        const index = s.contigs.findIndex(c => c.id === id)
        if (index === -1) return {}
        return {
          contigs: s.contigs.filter(c => c.id !== id),
          activeContigId: s.activeContigId === id ? null : s.activeContigId,
          folders: withoutItem(s.folders, toUid('contig', id)),
          recentlyDeleted: pushDeleted(s.recentlyDeleted, {
            kind: 'contig', index,
            folderId: folderOf(s.folders, toUid('contig', id)),
            contig: s.contigs[index],
          }),
        }
      })
    },

    renameContig(id, name) {
      set(s => ({
        contigs: s.contigs.map(c =>
          c.id === id ? { ...c, name } : c
        ),
      }))
    },

    setActiveContig(id) {
      set({
        activeContigId: id,
        activeTabId: id ? null : get().activeTabId,
        activeSequencingReadIds: id ? [] : get().activeSequencingReadIds,
        activeAlignmentId: id ? null : get().activeAlignmentId,
        activeReadAlignmentId: id ? null : get().activeReadAlignmentId,
      })
    },

    setContigZoom(id, level) {
      set(s => ({
        contigs: s.contigs.map(c =>
          c.id === id ? { ...c, zoomLevel: level } : c
        ),
      }))
    },

    setContigExpandedRead(id, readAlignmentId) {
      set(s => ({
        contigs: s.contigs.map(c =>
          c.id === id ? { ...c, expandedReadId: readAlignmentId } : c
        ),
      }))
    },
  }
})
