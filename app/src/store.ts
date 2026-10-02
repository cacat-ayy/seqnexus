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
  rotateOriginInPlace,
  addPrimers,
  updatePrimer,
  removePrimers,
} from './models/Document'
import { newPrimerId, primerOligoFromFeature, type PrimerData, type LibraryOligo, type OligoRole } from './primers/oligo'
import { reverseComplement } from './models/complement'
import type { ColorSchemeId, ColorTarget } from './utils/base-colors'
import { loadDisplaySettings, saveDisplaySettings, type DisplaySettings } from './utils/display-settings'
import type { PlasmidStyleId } from './plasmid/styles'
import type { Ab1Data } from './io/ab1'
import type { CutSite } from './enzymes/finder'
import type { ORFResult } from './workers/orf-finder'
import type { DesignResult } from './primers/design/types'
import type { ContigDoc } from './assembly/types'
import { DEFAULT_CONTIG_VIEW, type ContigView } from './assembly/view'
import type { AlnDoc } from './msa/model'
import { DEFAULT_VIEW, type AlnView } from './msa/view'
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
import { defaultWorkspace, type GelWorkspaceState } from './gel/workspace'

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
  showAutoAnnotations: boolean
  // Cached analysis results (preserved across tab switches)
  orfResults: ORFResult[]
  enzymeCutSites: CutSite[]
  enzymeNames: string[]
  primerDesign: PrimerDesignState
  autoAnnotations: AnnotationMatch[]
}

/**
 * The primer workbench's session on one tab: the last design run and what
 * has been picked from it. Picks are oligo sequences, not candidate ids, so
 * a pick trimmed or extended by hand is still a pick; where it binds is
 * worked out the same way as for a saved primer.
 */
export interface DesignPicks {
  forward: string | null
  reverse: string | null
  probe: string | null
}

export interface PrimerDesignState {
  result: DesignResult | null
  picks: DesignPicks
  /** Many unsaved oligos at once, e.g. a sequencing primer set. */
  batch: { name: string; sequence: string }[]
}

export const EMPTY_DESIGN: PrimerDesignState = {
  result: null,
  picks: { forward: null, reverse: null, probe: null },
  batch: [],
}

export type SidebarTab = 'features' | 'primers'
export type PrimerView = 'list' | 'design'

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
  | { kind: 'contig'; index: number; folderId: string | null; contig: Contig }
  | { kind: 'oligo'; index: number; folderId: string | null; oligo: LibraryOligo }
  | { kind: 'gel'; index: number; folderId: string | null; gel: GelDoc; wasActive: boolean }

/** How many deletes can be taken back. Small on purpose: this is an undo
    buffer, and every entry pins a full sequence or trace in memory. */
export const MAX_RECENTLY_CLOSED = 5

export type BaseEdit =
  /** `by: 'mixed'`: an IUPAC call made from second peaks, not typed by the user. */
  | { type: 'substitute'; pos: number; original: string; base: string; by?: 'mixed' }
  | { type: 'insert'; pos: number; offset: number; base: string }
  | { type: 'delete'; pos: number; original: string }

interface SeqUndoSnapshot {
  edits: BaseEdit[]
  trimStart: number
  trimEnd: number
  /** What the change after this snapshot did ("Delete 3 bases"), for undo labels. */
  label?: string
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
  /** Shown reverse complemented (a reverse-primer read). A view choice; the data stays forward. */
  reversed?: boolean
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
const contigIds = makeIdGenerator('contig')
const oligoIds = makeIdGenerator('libo')
const gelIds = makeIdGenerator('gel')

/** Edits to one gel with the same key within this window make one undo step. */
const GEL_COALESCE_MS = 1000
const MAX_GEL_UNDO = 100
let gelCoalesce: { id: string; key: string; at: number } | null = null

/** Same idea for alignment edits: typing a run of residues is one step. */
const ALN_COALESCE_MS = 1000
const MAX_ALN_UNDO = 200
/**
 * Undo snapshots share every row an edit left alone, so most steps cost a
 * row or two. Column edits copy every row, though, so history is also capped
 * by the characters it holds on its own (about 128 MB of strings).
 */
const ALN_UNDO_BUDGET = 64_000_000
let alnCoalesce: { id: string; key: string; at: number } | null = null

/** Characters held by `prev` that `next` does not share. */
function alnStepCost(prev: AlnDoc, next: AlnDoc): number {
  const kept = new Set(next.rows)
  let n = 0
  for (const r of prev.rows) if (!kept.has(r)) n += r.seq.length
  return n
}

function trimAlnHistory(stack: AlnHistoryEntry[]): AlnHistoryEntry[] {
  let total = 0
  let from = stack.length
  while (from > 0 && stack.length - from < MAX_ALN_UNDO) {
    total += stack[from - 1].cost
    if (total > ALN_UNDO_BUDGET && from < stack.length) break
    from--
  }
  return from === 0 ? stack : stack.slice(from)
}

const nextTabId = () => tabIds.next()
const nextSeqReadId = () => seqReadIds.next()
const nextFolderId = () => folderIds.next()
const nextFeatureSourceId = () => featureSourceIds.next()
const nextUsageTableId = () => usageTableIds.next()
const nextAlignId = () => alignIds.next()
const nextContigId = () => contigIds.next()
const nextOligoId = () => oligoIds.next()

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

/** One contig undo step: the document before the edit, and what the edit was. */
export interface ContigHistoryEntry {
  doc: ContigDoc
  label: string
}

/** A contig: reads assembled to a reference or to each other. */
export interface Contig {
  id: string
  name: string
  doc: ContigDoc
  createdAt: number
  modifiedAt: number
  /** How it is shown; not part of its undo history. */
  view: ContigView
  /** Earlier documents, newest last. Not persisted. */
  undoStack: ContigHistoryEntry[]
  redoStack: ContigHistoryEntry[]
}

/** A virtual gel: what is on it, how it was run and imaged, and its history. */
export interface GelDoc {
  id: string
  name: string
  createdAt: number
  modifiedAt: number
  state: GelWorkspaceState
  /** Earlier states, newest last. Not persisted. */
  undoStack: GelWorkspaceState[]
  redoStack: GelWorkspaceState[]
}

/** One alignment undo step: the document before the edit, and what the edit was. */
export interface AlnHistoryEntry {
  doc: AlnDoc
  label: string
  /** Characters this snapshot holds that the next one does not share. */
  cost: number
}

/** A multiple or pairwise alignment the user owns and edits. */
export interface SavedAlignment {
  id: string
  name: string
  doc: AlnDoc
  createdAt: number
  modifiedAt: number
  /** How it is shown; not part of its undo history. */
  view: AlnView
  /** Earlier documents, newest last. Not persisted. */
  undoStack: AlnHistoryEntry[]
  redoStack: AlnHistoryEntry[]
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
  // Unlike showOrfs/showEnzymes, which are per tab, these are
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
  /** Primer the Primers panel should open and scroll to, e.g. after a
   *  double-click on it in the sequence. Null once the panel has shown it. */
  focusedPrimerId: string | null
  setFocusedPrimer: (id: string | null) => void
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

  // Primer workbench session for the active tab (cross-view: the sequence
  // and map draw the picks as previews)
  primerDesign: PrimerDesignState
  setDesignResult: (result: DesignResult | null) => void
  setDesignPicks: (patch: Partial<DesignPicks>) => void
  setDesignBatch: (batch: PrimerDesignState['batch']) => void
  clearDesign: () => void

  // Right sidebar: which tab, and which view of the Primers tab
  sidebarTab: SidebarTab
  setSidebarTab: (tab: SidebarTab) => void
  primerView: PrimerView
  setPrimerView: (view: PrimerView) => void
  /** Bumped by openSidebar; App opens the sidebar whenever it changes. */
  sidebarRequest: number
  /** Show a sidebar tab (and, for Primers, a view), opening the sidebar. */
  openSidebar: (tab: SidebarTab, view?: PrimerView) => void

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
  showAutoAnnotations: boolean
  toggleOrfs: () => void
  toggleEnzymes: () => void
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
  /** Primers are oligos on the document; each of these is one undo entry. */
  addPrimers: (primers: PrimerData[]) => void
  updatePrimer: (id: string, patch: Partial<Omit<PrimerData, 'id'>>) => void
  removePrimers: (ids: Iterable<string>) => void
  /**
   * Turn `primer_bind` features into primers, in one undo entry. The oligo is
   * the feature's recorded sequence when it has one (which keeps any tail),
   * otherwise the bases it covers read along its strand. Returns how many
   * were converted.
   */
  convertFeaturesToPrimers: (ids: Iterable<string>) => number
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
    tabs: { id: string; doc: DocumentState; createdAt?: number; modifiedAt?: number; viewMode: ViewMode; zoomLevel: number; hiddenAnnotationIds?: string[]; showOrfs?: boolean; showEnzymes?: boolean; showAutoAnnotations?: boolean; readOnly?: boolean; undoStack?: UndoSnapshot[]; redoStack?: UndoSnapshot[] }[],
    activeTabId: string | null,
    folders: ExplorerFolder[],
    seqReads?: { id: string; data: Ab1Data; createdAt?: number; trimStart: number; trimEnd: number; edits: BaseEdit[]; reversed?: boolean }[],
    activeSeqReadIds?: string[],
    savedAlignments?: SavedAlignment[],
    savedContigs?: Contig[],
    activeAlignmentId?: string | null,
    activeContigId?: string | null,
    itemMeta?: Record<string, ItemMeta>,
    tagColors?: Record<string, string>,
    oligos?: LibraryOligo[],
  ) => void

  // Merge imported session into existing state (adds items alongside existing ones)
  mergeSession: (
    tabs: { id: string; doc: DocumentState; createdAt?: number; modifiedAt?: number; viewMode: ViewMode; zoomLevel: number; hiddenAnnotationIds?: string[]; showOrfs?: boolean; showEnzymes?: boolean; showAutoAnnotations?: boolean; readOnly?: boolean }[],
    folders: ExplorerFolder[],
    seqReads?: { id: string; data: Ab1Data; createdAt?: number; trimStart: number; trimEnd: number; edits: BaseEdit[]; reversed?: boolean }[],
    savedAlignments?: SavedAlignment[],
    savedContigs?: Contig[],
    itemMeta?: Record<string, ItemMeta>,
    tagColors?: Record<string, string>,
    oligos?: LibraryOligo[],
  ) => void

  // Legacy compat
  loadDocument: (name: string, bases: string, topology?: 'linear' | 'circular') => void
  loadDocumentState: (state: DocumentState) => void

  // Sequencing reads
  sequencingReads: SequencingRead[]
  activeSequencingReadIds: string[]
  addSequencingRead: (data: Ab1Data) => string
  /**
   * Add several reads in one update, already trimmed, optionally filed into
   * a new folder. The first read is opened. Returns the new read ids.
   */
  addSequencingReads: (reads: { data: Ab1Data; trimStart: number; trimEnd: number }[], folderName?: string) => string[]
  removeSequencingRead: (id: string) => void
  setActiveSequencingRead: (id: string | null) => void
  toggleSequencingRead: (id: string) => void
  setSequencingTrim: (id: string, start: number, end: number) => void
  renameSequencingRead: (id: string, name: string) => void
  editSequencingBase: (id: string, edit: BaseEdit) => void
  resetSequencingEdits: (id: string) => void
  undoSequencing: (id: string) => void
  redoSequencing: (id: string) => void
  /** Change a read's edits and/or trim as one named undo step. */
  changeSequencingRead: (id: string, patch: { edits?: BaseEdit[]; trimStart?: number; trimEnd?: number }, label: string) => void
  setSequencingReversed: (id: string, reversed: boolean) => void

  // Primer library: oligos kept across sequences, listed in the explorer
  oligos: LibraryOligo[]
  /** Add to the library; returns the new ids. Oligos already there (same
   *  sequence and name) are skipped rather than duplicated. */
  addLibraryOligos: (oligos: Omit<LibraryOligo, 'id' | 'createdAt'>[]) => string[]
  updateLibraryOligo: (id: string, patch: Partial<Omit<LibraryOligo, 'id' | 'createdAt'>>) => void
  /** Into the delete buffer, like every explorer item. */
  removeLibraryOligo: (id: string) => void
  /** Ask the workbench's Check task to look at an oligo. */
  checkRequest: { sequence: string; role: OligoRole; at: number } | null
  /**
   * Tab most recently opened by the user (file, paste, product), not by a
   * session restore; App uses it to say which library primers bind it.
   */
  lastOpenedTabId: string | null
  requestCheck: (sequence: string, role?: OligoRole) => void

  // Alignments
  alignments: SavedAlignment[]
  activeAlignmentId: string | null
  /** Keep a new alignment and, unless told otherwise, open it. */
  addAlignment: (doc: AlnDoc, opts?: { name?: string; activate?: boolean }) => string
  /**
   * Edit an alignment, recording an undo step named `label`. Calls sharing a
   * `coalesceKey` in quick succession (typing, a drag) make one step. An edit
   * that returns the same document records nothing.
   */
  updateAlignment: (id: string, fn: (doc: AlnDoc) => AlnDoc, label: string, coalesceKey?: string) => void
  /** Step back or forward; returns the label of the step, or null if there was none. */
  undoAlignment: (id: string) => string | null
  redoAlignment: (id: string) => string | null
  duplicateAlignment: (id: string) => string | null
  removeAlignment: (id: string) => void
  renameAlignment: (id: string, name: string) => void
  setActiveAlignment: (id: string | null) => void
  /** Change how an alignment is shown. Not an undo step. */
  setAlignmentView: (id: string, patch: Partial<AlnView>) => void

  // Contigs
  contigs: Contig[]
  activeContigId: string | null
  /** Add assembled contigs, optionally filed into a new folder; the first is opened. */
  addContigs: (items: { name: string; doc: ContigDoc }[], folderName?: string) => string[]
  /** Change a contig's document as one named undo step. */
  updateContig: (id: string, fn: (doc: ContigDoc) => ContigDoc, label: string) => void
  undoContig: (id: string) => string | null
  redoContig: (id: string) => string | null
  removeContig: (id: string) => void
  renameContig: (id: string, name: string) => void
  setActiveContig: (id: string | null) => void
  /** Change how a contig is shown. Not an undo step. */
  setContigView: (id: string, patch: Partial<ContigView>) => void

  // Virtual gels
  gels: GelDoc[]
  /** The gel in the centre panel. Activating any other item clears it. */
  activeGelId: string | null
  /** The sequence to go back to when the gel closes. */
  gelReturnTabId: string | null
  /**
   * Make a gel and, unless told otherwise, open it. Without a state, it
   * starts from the sequence in view: a ladder, the sequence uncut, and a
   * digest with enzymes from its map.
   */
  createGel: (opts?: { name?: string; state?: GelWorkspaceState; activate?: boolean }) => string
  setActiveGel: (id: string | null) => void
  /**
   * Change a gel, recording an undo step. Calls sharing a `coalesceKey` in
   * quick succession (a slider drag, typing a label) make one step.
   */
  updateGel: (id: string, fn: (s: GelWorkspaceState) => GelWorkspaceState, coalesceKey?: string) => void
  undoGel: (id: string) => void
  redoGel: (id: string) => void
  renameGel: (id: string, name: string) => void
  duplicateGel: (id: string) => string | null
  removeGel: (id: string) => void
  /** Bring in gels from a saved or imported session. */
  restoreGels: (gels: GelDoc[], activeGelId: string | null) => void
  mergeGels: (gels: GelDoc[]) => void
}

const emptyDoc: DocumentState = {
  name: 'Untitled',
  sequence: new Sequence(''),
  annotations: [],
}

const SIDEBAR_TAB_KEY = 'seqnexus_feature_sidebar_tab'

function loadSidebarTab(): SidebarTab {
  try {
    return localStorage.getItem(SIDEBAR_TAB_KEY) === 'primers' ? 'primers' : 'features'
  } catch {
    return 'features'
  }
}

const emptySearch: SearchState ={ query: '', options: { ...defaultSearchOptions }, matches: [], currentMatch: -1 }

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
    showAutoAnnotations: false,
    orfResults: [],
    enzymeCutSites: [],
    enzymeNames: [],
    primerDesign: EMPTY_DESIGN,
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

  /** "feature “lacZ”" for one item, "3 features" for several. */
  function describeItems(noun: string, names: readonly (string | undefined)[]): string {
    if (names.length === 1) return names[0] ? `${noun} “${names[0]}”` : noun
    return `${names.length} ${noun}s`
  }

  function annotationNames(ids: Iterable<string>): string[] {
    const annotations = getActiveTab()?.doc.annotations ?? []
    return [...ids].map(id => annotations.find(a => a.id === id)?.name ?? '')
  }

  function primerNames(ids: Iterable<string>): string[] {
    const primers = getActiveTab()?.doc.primers ?? []
    return [...ids].map(id => primers.find(p => p.id === id)?.name ?? '')
  }

  /** `label` names the change about to be made, for the Undo tooltip. */
  function pushUndo(label?: string) {
    const tab = getActiveTab()
    if (!tab) return
    const stack = [...tab.undoStack, { ...undoSnapshot(tab.doc), label }]
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
    opts?: { coalesceKey?: string; label?: string },
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
      const undoStack = [...tab.undoStack, { ...undoSnapshot(tab.doc), label: opts?.label }]
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
    focusedPrimerId: null,
    setFocusedPrimer: (id) => {
      set({ focusedPrimerId: id })
      if (id) get().openSidebar('primers', 'list')
    },
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

    // Primer workbench
    primerDesign: EMPTY_DESIGN,
    setDesignResult: (result) => {
      const primerDesign = { ...get().primerDesign, result }
      set({ primerDesign })
      updateActiveTab({ primerDesign })
    },
    setDesignPicks: (patch) => {
      const cur = get().primerDesign
      const primerDesign = { ...cur, picks: { ...cur.picks, ...patch } }
      set({ primerDesign })
      updateActiveTab({ primerDesign })
    },
    setDesignBatch: (batch) => {
      const primerDesign = { ...get().primerDesign, batch }
      set({ primerDesign })
      updateActiveTab({ primerDesign })
    },
    clearDesign: () => {
      set({ primerDesign: EMPTY_DESIGN })
      updateActiveTab({ primerDesign: EMPTY_DESIGN })
    },

    sidebarTab: loadSidebarTab(),
    setSidebarTab: (sidebarTab) => {
      set({ sidebarTab })
      try { localStorage.setItem(SIDEBAR_TAB_KEY, sidebarTab) } catch { /* private mode */ }
    },
    primerView: 'list',
    setPrimerView: (primerView) => set({ primerView }),
    sidebarRequest: 0,
    openSidebar: (tab, view) => {
      get().setSidebarTab(tab)
      set(s => ({ sidebarRequest: s.sidebarRequest + 1, ...(view ? { primerView: view } : {}) }))
    },

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
      pushUndo('Substitute bases')
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
        ...s.contigs.map(c => toUid('contig', c.id)),
        ...s.oligos.map(o => toUid('oligo', o.id)),
        ...s.gels.map(g => toUid('gel', g.id)),
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
      const doomed = { sequence: new Set<string>(), read: new Set<string>(), alignment: new Set<string>(), contig: new Set<string>(), oligo: new Set<string>(), gel: new Set<string>() }
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

      const contigs = state.contigs.filter(c => !doomed.contig.has(c.id))
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
        showAutoAnnotations: active?.showAutoAnnotations ?? false,
        autoAnnotations: active?.autoAnnotations ?? [],
        autoAnnotationPicks: new Set<string>(),
        orfPicks: new Set<string>(),
        primerDesign: active?.primerDesign ?? EMPTY_DESIGN,
        sequencingReads: state.sequencingReads.filter(r => !doomed.read.has(r.id)),
        activeSequencingReadIds: state.activeSequencingReadIds.filter(id => !doomed.read.has(id)),
        alignments: state.alignments.filter(a => !doomed.alignment.has(a.id)),
        activeAlignmentId: doomed.alignment.has(state.activeAlignmentId ?? '') ? null : state.activeAlignmentId,
        contigs,
        activeContigId: contigIds.has(state.activeContigId ?? '') ? state.activeContigId : null,
        oligos: state.oligos.filter(o => !doomed.oligo.has(o.id)),
        gels: state.gels.filter(g => !doomed.gel.has(g.id)),
        activeGelId: doomed.gel.has(state.activeGelId ?? '') ? null : state.activeGelId,
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
        activeGelId: null,
        doc: tab.doc,
        selection: tab.selection,
        search: tab.search,
        viewMode: tab.viewMode,
        zoomLevel: tab.zoomLevel,
        readOnly: tab.readOnly,
        hiddenAnnotationIds: tab.hiddenAnnotationIds,
        showOrfs: tab.showOrfs,
        showEnzymes: tab.showEnzymes,
        showAutoAnnotations: tab.showAutoAnnotations,
        autoAnnotations: [],
        autoAnnotationPicks: new Set<string>(),
        orfPicks: new Set<string>(),
        lastOpenedTabId: tab.id,
        primerDesign: tab.primerDesign,
      }))
      return tab.id
    },

    openDocumentState(state) {
      const tab = makeTab(state)
      set(s => ({
        tabs: [...s.tabs, tab],
        activeTabId: tab.id,
        activeGelId: null,
        doc: tab.doc,
        selection: tab.selection,
        search: tab.search,
        viewMode: tab.viewMode,
        zoomLevel: tab.zoomLevel,
        readOnly: tab.readOnly,
        hiddenAnnotationIds: tab.hiddenAnnotationIds,
        showOrfs: tab.showOrfs,
        showEnzymes: tab.showEnzymes,
        showAutoAnnotations: tab.showAutoAnnotations,
        autoAnnotations: [],
        autoAnnotationPicks: new Set<string>(),
        orfPicks: new Set<string>(),
        lastOpenedTabId: tab.id,
        primerDesign: tab.primerDesign,
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
        showAutoAnnotations: active?.showAutoAnnotations ?? false,
        autoAnnotations: active?.autoAnnotations ?? [],
        autoAnnotationPicks: new Set<string>(),
        orfPicks: new Set<string>(),
        primerDesign: active?.primerDesign ?? EMPTY_DESIGN,
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
        case 'contig': {
          set({
            contigs: insertAt(state.contigs, last.index, last.contig),
            folders: withItem(state.folders, toUid('contig', last.contig.id), last.folderId),
            recentlyDeleted: rest,
          })
          get().setActiveContig(last.contig.id)
          return
        }
        case 'oligo': {
          set({
            oligos: insertAt(state.oligos, last.index, last.oligo),
            folders: withItem(state.folders, toUid('oligo', last.oligo.id), last.folderId),
            recentlyDeleted: rest,
          })
          return
        }
        case 'gel': {
          set({
            gels: insertAt(state.gels, last.index, last.gel),
            folders: withItem(state.folders, toUid('gel', last.gel.id), last.folderId),
            recentlyDeleted: rest,
          })
          get().setActiveGel(last.gel.id)
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
          primerDesign: state.primerDesign,
          autoAnnotations: state.autoAnnotations,
        } : t)
      }

      set({
        tabs,
        activeTabId: tabId,
        activeGelId: null,
        activeSequencingReadIds: [],
        activeAlignmentId: null,
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
        showAutoAnnotations: tab.showAutoAnnotations,
        // Restore cached results from the incoming tab
        orfResults: tab.orfResults,
        enzymeCutSites: tab.enzymeCutSites,
        enzymeNames: tab.enzymeNames,
        primerDesign: tab.primerDesign,
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
        activeGelId: null,
        doc: newTab.doc,
        selection: newTab.selection,
        search: newTab.search,
        viewMode: newTab.viewMode,
        zoomLevel: newTab.zoomLevel,
        readOnly: newTab.readOnly,
        hiddenAnnotationIds: newTab.hiddenAnnotationIds,
        showOrfs: newTab.showOrfs,
        showEnzymes: newTab.showEnzymes,
        showAutoAnnotations: newTab.showAutoAnnotations,
        autoAnnotations: [],
        autoAnnotationPicks: new Set<string>(),
        orfPicks: new Set<string>(),
        primerDesign: newTab.primerDesign,
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

    restoreSession(restoredTabs, restoredActiveId, restoredFolders, seqReads, activeSeqReadIds, savedAlignments, savedContigs, restoredActiveAlignmentId, restoredActiveContigId, restoredItemMeta, restoredTagColors, restoredOligos) {
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
        showAutoAnnotations: rt.showAutoAnnotations ?? false,
        orfResults: [],
        enzymeCutSites: [],
        enzymeNames: [],
        primerDesign: EMPTY_DESIGN,
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
          ...(sr.reversed ? { reversed: true } : {}),
        }
      })

      // Restore alignments
      const alignments: SavedAlignment[] = (savedAlignments ?? []).map(a => {
        syncId(a.id, alignIds, 'align')
        return a
      })

      // Restore contigs
      const contigs: Contig[] = (savedContigs ?? []).map(c => {
        syncId(c.id, contigIds, 'contig')
        return c
      })
      for (const o of restoredOligos ?? []) syncId(o.id, oligoIds, 'libo')

      // Determine which view was last active – validate that the referenced entity still exists
      const validActiveAlignId = restoredActiveAlignmentId && alignments.some(a => a.id === restoredActiveAlignmentId)
        ? restoredActiveAlignmentId : null
      const validActiveContigId = restoredActiveContigId && contigs.some(c => c.id === restoredActiveContigId)
        ? restoredActiveContigId : null

      // If a non-tab view was active, don't force a tab active
      const hasNonTabView = (activeSeqReadIds && activeSeqReadIds.length > 0) || validActiveAlignId || validActiveContigId
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
        showAutoAnnotations: active?.showAutoAnnotations ?? false,
        autoAnnotations: active?.autoAnnotations ?? [],
        autoAnnotationPicks: new Set<string>(),
        orfPicks: new Set<string>(),
        primerDesign: active?.primerDesign ?? EMPTY_DESIGN,
        folders: restoredFolders,
        sequencingReads,
        activeSequencingReadIds: activeSeqReadIds ?? [],
        alignments,
        activeAlignmentId: validActiveAlignId,
        contigs,
        activeContigId: validActiveContigId,
        oligos: restoredOligos ?? [],
        itemMeta: restoredItemMeta ?? {},
        tagColors: restoredTagColors ?? {},
      })
    },

    mergeSession(mergedTabs, mergedFolders, seqReads, savedAlignments, savedContigs, importedItemMeta, importedTagColors, importedOligos) {
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
        showAutoAnnotations: rt.showAutoAnnotations ?? false,
        orfResults: [],
        enzymeCutSites: [],
        enzymeNames: [],
        primerDesign: EMPTY_DESIGN,
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
        ...(sr.reversed ? { reversed: true } : {}),
      }))

      set({
        tabs: [...state.tabs, ...newTabs],
        folders: finalFolders,
        sequencingReads: [...state.sequencingReads, ...newReads],
        alignments: [...state.alignments, ...(savedAlignments ?? [])],
        contigs: [...state.contigs, ...(savedContigs ?? [])],
        oligos: [...state.oligos, ...(importedOligos ?? [])],
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
      pushUndo('Edit sequence properties')
      const doc = { ...tab.doc }
      if (props.name !== undefined) doc.name = props.name
      if (props.description !== undefined) doc.description = props.description
      if (props.topology !== undefined && props.topology !== doc.sequence.topology) {
        // Wrap the same PieceTable: a fresh one (withTopology) would leave
        // every undo snapshot pointing into buffers the tab no longer has.
        doc.sequence = Sequence.fromPieceTable(doc.sequence.pieceTable, props.topology)
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
      pushUndo('Move origin')
      const doc = rotateOriginInPlace(tab.doc, newOrigin)
      updateActiveTab({ doc })
    },

    insert(pos, fragment) {
      const tab = getActiveTab()
      if (!tab || tab.readOnly) return
      pushUndo(`Insert ${fragment.length.toLocaleString()} bp`)
      updateActiveTab({ doc: insertBasesInPlace(tab.doc, pos, fragment) })
    },

    delete(start, end) {
      const tab = getActiveTab()
      if (!tab || tab.readOnly) return
      pushUndo(`Delete ${Math.abs(end - start).toLocaleString()} bp`)
      updateActiveTab({ doc: deleteBasesInPlace(tab.doc, start, end) })
    },

    deleteTwo(start1, end1, start2, end2, insertAtZero) {
      const tab = getActiveTab()
      if (!tab || tab.readOnly) return
      pushUndo(`Delete ${(Math.abs(end1 - start1) + Math.abs(end2 - start2)).toLocaleString()} bp`)
      let doc = deleteBasesInPlace(tab.doc, start1, end1)
      doc = deleteBasesInPlace(doc, start2, end2)
      if (insertAtZero) doc = insertBasesInPlace(doc, 0, insertAtZero)
      updateActiveTab({ doc })
    },

    replace(start, end, fragment) {
      const tab = getActiveTab()
      if (!tab || tab.readOnly) return
      pushUndo(`Replace ${Math.abs(end - start).toLocaleString()} bp`)
      updateActiveTab({ doc: replaceBasesInPlace(tab.doc, start, end, fragment) })
    },

    // All of these route through transact(), so each is exactly one undo entry
    // and one store write, whether it touches one annotation or five hundred.

    addAnnotation(data) {
      const label = `Add ${describeItems('feature', [data.name])}`
      if (transact(doc => addAnnotation(doc, data), { label })) revealAnnotationTracks()
    },

    addAnnotations(dataArray) {
      if (dataArray.length === 0) return
      const label = `Add ${describeItems('feature', dataArray.map(d => d.name))}`
      if (transact(doc => dataArray.reduce(addAnnotation, doc), { label })) revealAnnotationTracks()
    },

    removeAnnotation(id) {
      transact(doc => removeAnnotation(doc, id), { label: `Delete ${describeItems('feature', annotationNames([id]))}` })
    },

    removeAnnotations(ids) {
      transact(doc => removeAnnotations(doc, ids), { label: `Delete ${describeItems('feature', annotationNames(ids))}` })
    },

    updateAnnotation(id, patch) {
      transact(doc => updateAnnotation(doc, id, patch), { label: `Edit ${describeItems('feature', annotationNames([id]))}` })
    },

    updateAnnotations(ids, patch, opts) {
      transact(doc => updateAnnotations(doc, ids, patch), {
        ...opts,
        label: `Edit ${describeItems('feature', annotationNames(ids))}`,
      })
    },

    addPrimers(primers) {
      transact(doc => addPrimers(doc, primers), { label: `Add ${describeItems('primer', primers.map(p => p.name))}` })
    },

    updatePrimer(id, patch) {
      transact(doc => updatePrimer(doc, id, patch), { label: `Edit ${describeItems('primer', primerNames([id]))}` })
    },

    removePrimers(ids) {
      transact(doc => removePrimers(doc, ids), { label: `Delete ${describeItems('primer', primerNames(ids))}` })
    },

    convertFeaturesToPrimers(ids) {
      const wanted = new Set(ids)
      let converted = 0
      transact(doc => {
        const primers: PrimerData[] = []
        const done: string[] = []
        for (const ann of doc.annotations) {
          if (!wanted.has(ann.id) || ann.type !== 'primer_bind') continue
          const oligo = primerOligoFromFeature(ann, doc.sequence)
          if (!oligo) continue
          primers.push({
            id: newPrimerId(),
            name: ann.name,
            sequence: oligo,
            role: 'primer',
            ...(ann.qualifiers.note?.length ? { notes: ann.qualifiers.note.join('\n') } : {}),
          })
          done.push(ann.id)
        }
        converted = primers.length
        return addPrimers(removeAnnotations(doc, done), primers)
      }, { label: 'Convert features to primers' })
      return converted
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
      // The redo entry reapplies the same change, so it keeps the same name.
      const redoSnap = { ...undoSnapshot(tab.doc), label: prev.label }
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
      const undoSnap = { ...undoSnapshot(tab.doc), label: next.label }
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
      pushUndo('Replace match')
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
      const n = tab.search.matches.length
      pushUndo(`Replace ${n.toLocaleString()} match${n === 1 ? '' : 'es'}`)
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
      }))
      return id
    },

    addSequencingReads(items, folderName) {
      if (items.length === 0) return []
      const now = Date.now()
      const reads: SequencingRead[] = items.map(item => ({
        id: nextSeqReadId(),
        data: item.data,
        createdAt: now,
        trimStart: item.trimStart,
        trimEnd: item.trimEnd,
        edits: [],
        undoStack: [],
        redoStack: [],
      }))
      const folderId = folderName ? get().createFolder(folderName) : null
      set(s => ({
        sequencingReads: [...s.sequencingReads, ...reads],
        folders: folderId
          ? s.folders.map(f => f.id === folderId ? { ...f, itemUids: [...f.itemUids, ...reads.map(r => toUid('read', r.id))] } : f)
          : s.folders,
        activeSequencingReadIds: [reads[0].id],
        activeTabId: null,
        activeAlignmentId: null,
        activeContigId: null,
        activeGelId: null,
      }))
      return reads.map(r => r.id)
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
        activeGelId: id ? null : get().activeGelId,
        activeTabId: id ? null : get().activeTabId,
        activeAlignmentId: id ? null : get().activeAlignmentId,
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
          activeContigId: next.length > 0 ? null : s.activeContigId,
          activeTabId: next.length > 0 ? null : s.activeTabId,
        }
      })
    },

    changeSequencingRead(id, patch, label) {
      set(s => ({
        sequencingReads: s.sequencingReads.map(r => {
          if (r.id !== id) return r
          const next = {
            edits: patch.edits ?? r.edits,
            trimStart: patch.trimStart ?? r.trimStart,
            trimEnd: patch.trimEnd ?? r.trimEnd,
          }
          if (next.edits === r.edits && next.trimStart === r.trimStart && next.trimEnd === r.trimEnd) return r
          const snap: SeqUndoSnapshot = { edits: r.edits, trimStart: r.trimStart, trimEnd: r.trimEnd, label }
          return { ...r, ...next, undoStack: [...r.undoStack, snap].slice(-100), redoStack: [] }
        }),
      }))
    },

    setSequencingReversed(id, reversed) {
      set(s => ({
        sequencingReads: s.sequencingReads.map(r => (r.id === id ? { ...r, reversed: reversed || undefined } : r)),
      }))
    },

    setSequencingTrim(id, start, end) {
      set(s => ({
        sequencingReads: s.sequencingReads.map(r => {
          if (r.id !== id) return r
          const snap: SeqUndoSnapshot = { edits: r.edits, trimStart: r.trimStart, trimEnd: r.trimEnd, label: 'Trim' }
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
          const redoSnap: SeqUndoSnapshot = { edits: r.edits, trimStart: r.trimStart, trimEnd: r.trimEnd, label: prev.label }
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
          const undoSnap: SeqUndoSnapshot = { edits: r.edits, trimStart: r.trimStart, trimEnd: r.trimEnd, label: next.label }
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

    addAlignment(doc, opts = {}) {
      const id = nextAlignId()
      const names = doc.rows.map(r => r.name)
      const name = opts.name ?? (names.length === 2
        ? `${names[0]} vs ${names[1]}`
        : `Alignment (${names.length} sequences)`)
      const now = Date.now()
      const saved: SavedAlignment = {
        id, name, doc,
        createdAt: now,
        modifiedAt: now,
        view: DEFAULT_VIEW,
        undoStack: [],
        redoStack: [],
      }
      set({ alignments: [...get().alignments, saved] })
      if (opts.activate !== false) get().setActiveAlignment(id)
      return id
    },

    updateAlignment(id, fn, label, coalesceKey) {
      set(s => {
        const idx = s.alignments.findIndex(a => a.id === id)
        if (idx === -1) return {}
        const aln = s.alignments[idx]
        const next = fn(aln.doc)
        if (next === aln.doc) return {}
        const now = Date.now()
        const merge = !!coalesceKey && alnCoalesce !== null && alnCoalesce.id === id
          && alnCoalesce.key === coalesceKey && now - alnCoalesce.at < ALN_COALESCE_MS
          && aln.undoStack.length > 0
        alnCoalesce = coalesceKey ? { id, key: coalesceKey, at: now } : null
        let undoStack = aln.undoStack
        if (merge) {
          // The step keeps its starting point; only its cost grows.
          const top = undoStack[undoStack.length - 1]
          undoStack = [...undoStack.slice(0, -1), { ...top, cost: alnStepCost(top.doc, next) }]
        } else {
          undoStack = trimAlnHistory([...undoStack, { doc: aln.doc, label, cost: alnStepCost(aln.doc, next) }])
        }
        const alignments = [...s.alignments]
        alignments[idx] = { ...aln, doc: next, modifiedAt: now, undoStack, redoStack: [] }
        return { alignments }
      })
    },

    undoAlignment(id) {
      alnCoalesce = null
      const aln = get().alignments.find(a => a.id === id)
      const step = aln?.undoStack[aln.undoStack.length - 1]
      if (!aln || !step) return null
      set(s => ({
        alignments: s.alignments.map(a => a.id !== id ? a : {
          ...a,
          doc: step.doc,
          undoStack: a.undoStack.slice(0, -1),
          redoStack: [...a.redoStack, { doc: a.doc, label: step.label, cost: alnStepCost(a.doc, step.doc) }],
          modifiedAt: Date.now(),
        }),
      }))
      return step.label
    },

    redoAlignment(id) {
      alnCoalesce = null
      const aln = get().alignments.find(a => a.id === id)
      const step = aln?.redoStack[aln.redoStack.length - 1]
      if (!aln || !step) return null
      set(s => ({
        alignments: s.alignments.map(a => a.id !== id ? a : {
          ...a,
          doc: step.doc,
          redoStack: a.redoStack.slice(0, -1),
          undoStack: [...a.undoStack, { doc: a.doc, label: step.label, cost: alnStepCost(a.doc, step.doc) }],
          modifiedAt: Date.now(),
        }),
      }))
      return step.label
    },

    duplicateAlignment(id) {
      const s = get()
      const index = s.alignments.findIndex(a => a.id === id)
      if (index === -1) return null
      const src = s.alignments[index]
      const copyId = nextAlignId()
      const now = Date.now()
      const copy: SavedAlignment = {
        ...src, id: copyId, name: `${src.name} copy`, createdAt: now, modifiedAt: now, undoStack: [], redoStack: [],
      }
      const folderId = folderOf(s.folders, toUid('alignment', id))
      set({
        alignments: insertAt(s.alignments, index + 1, copy),
        folders: folderId ? withItem(s.folders, toUid('alignment', copyId), folderId) : s.folders,
      })
      get().setActiveAlignment(copyId)
      return copyId
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
          a.id === id ? { ...a, name, modifiedAt: Date.now() } : a
        ),
      }))
    },

    setActiveAlignment(id) {
      set({
        activeAlignmentId: id,
        activeTabId: id ? null : get().activeTabId,
        activeGelId: id ? null : get().activeGelId,
        activeSequencingReadIds: id ? [] : get().activeSequencingReadIds,
        activeContigId: id ? null : get().activeContigId,
      })
    },

    setAlignmentView(id, patch) {
      set(s => ({
        alignments: s.alignments.map(a =>
          a.id === id ? { ...a, view: { ...a.view, ...patch } } : a
        ),
      }))
    },

    // ---- Virtual gel ----
    // ---- Virtual gels ----
    gels: [],
    activeGelId: null,
    gelReturnTabId: null,

    createGel(opts = {}) {
      const s = get()
      let state = opts.state
      const srcId = s.activeTabId ?? s.gelReturnTabId
      const tab = s.tabs.find(t => t.id === srcId)
      if (!state) {
        // The tab record only holds analysis results for tabs in the
        // background; the open one's live in the store.
        const live = s.activeTabId === tab?.id
        const doc = live ? s.doc : tab?.doc
        state = defaultWorkspace(tab && doc ? {
          id: tab.id,
          bases: doc.sequence.bases,
          topology: doc.sequence.topology,
          shownEnzymes: live ? s.enzymeNames : tab.enzymeNames,
        } : null)
      }
      const id = gelIds.next()
      const now = Date.now()
      const name = opts.name ?? (tab ? `${(s.activeTabId === tab.id ? s.doc : tab.doc).name} gel` : `Gel ${s.gels.length + 1}`)
      set({ gels: [...s.gels, { id, name, createdAt: now, modifiedAt: now, state, undoStack: [], redoStack: [] }] })
      if (opts.activate !== false) get().setActiveGel(id)
      return id
    },

    setActiveGel(id) {
      const s = get()
      if (id) {
        if (!s.gels.some(g => g.id === id)) return
        // Keep the outgoing tab's analysis results with it, as switching tabs
        // does, so coming back to it restores them.
        const outgoing = s.activeTabId
        const tabs = outgoing ? s.tabs.map(t => t.id === outgoing ? {
          ...t,
          orfResults: s.orfResults,
          enzymeCutSites: s.enzymeCutSites,
          enzymeNames: s.enzymeNames,
          primerDesign: s.primerDesign,
          autoAnnotations: s.autoAnnotations,
        } : t) : s.tabs
        set({
          tabs,
          activeGelId: id,
          gelReturnTabId: outgoing ?? s.gelReturnTabId,
          activeTabId: null,
          activeSequencingReadIds: [],
          activeAlignmentId: null,
          activeContigId: null,
        })
        return
      }
      set({ activeGelId: null })
      const back = s.gelReturnTabId
      const nothingElseOpen = !s.activeTabId && !s.activeAlignmentId && !s.activeContigId
        && s.activeSequencingReadIds.length === 0
      if (nothingElseOpen && back && s.tabs.some(t => t.id === back)) get().setActiveTab(back)
    },

    updateGel(id, fn, coalesceKey) {
      set(s => {
        const idx = s.gels.findIndex(g => g.id === id)
        if (idx === -1) return {}
        const gel = s.gels[idx]
        const next = fn(gel.state)
        if (next === gel.state) return {}
        const now = Date.now()
        const merge = !!coalesceKey && gelCoalesce !== null && gelCoalesce.id === id
          && gelCoalesce.key === coalesceKey && now - gelCoalesce.at < GEL_COALESCE_MS
        gelCoalesce = coalesceKey ? { id, key: coalesceKey, at: now } : null
        const gels = [...s.gels]
        gels[idx] = {
          ...gel,
          state: next,
          modifiedAt: now,
          undoStack: merge ? gel.undoStack : [...gel.undoStack, gel.state].slice(-MAX_GEL_UNDO),
          redoStack: [],
        }
        return { gels }
      })
    },

    undoGel(id) {
      gelCoalesce = null
      set(s => {
        const idx = s.gels.findIndex(g => g.id === id)
        const gel = s.gels[idx]
        if (!gel || gel.undoStack.length === 0) return {}
        const gels = [...s.gels]
        gels[idx] = {
          ...gel,
          state: gel.undoStack[gel.undoStack.length - 1],
          undoStack: gel.undoStack.slice(0, -1),
          redoStack: [...gel.redoStack, gel.state],
          modifiedAt: Date.now(),
        }
        return { gels }
      })
    },

    redoGel(id) {
      gelCoalesce = null
      set(s => {
        const idx = s.gels.findIndex(g => g.id === id)
        const gel = s.gels[idx]
        if (!gel || gel.redoStack.length === 0) return {}
        const gels = [...s.gels]
        gels[idx] = {
          ...gel,
          state: gel.redoStack[gel.redoStack.length - 1],
          redoStack: gel.redoStack.slice(0, -1),
          undoStack: [...gel.undoStack, gel.state],
          modifiedAt: Date.now(),
        }
        return { gels }
      })
    },

    renameGel(id, name) {
      set(s => ({ gels: s.gels.map(g => (g.id === id ? { ...g, name, modifiedAt: Date.now() } : g)) }))
    },

    duplicateGel(id) {
      const s = get()
      const index = s.gels.findIndex(g => g.id === id)
      if (index === -1) return null
      const src = s.gels[index]
      const copyId = gelIds.next()
      const now = Date.now()
      const copy: GelDoc = { ...src, id: copyId, name: `${src.name} copy`, createdAt: now, modifiedAt: now, undoStack: [], redoStack: [] }
      const folderId = folderOf(s.folders, toUid('gel', id))
      set({
        gels: insertAt(s.gels, index + 1, copy),
        folders: folderId ? withItem(s.folders, toUid('gel', copyId), folderId) : s.folders,
      })
      get().setActiveGel(copyId)
      return copyId
    },

    removeGel(id) {
      const s = get()
      const index = s.gels.findIndex(g => g.id === id)
      if (index === -1) return
      const wasActive = s.activeGelId === id
      set({
        gels: s.gels.filter(g => g.id !== id),
        folders: withoutItem(s.folders, toUid('gel', id)),
        recentlyDeleted: pushDeleted(s.recentlyDeleted, {
          kind: 'gel', index,
          folderId: folderOf(s.folders, toUid('gel', id)),
          gel: s.gels[index],
          wasActive,
        }),
      })
      if (wasActive) get().setActiveGel(null)
    },

    restoreGels(gels, activeGelId) {
      for (const g of gels) {
        const m = g.id.match(/^gel_(\d+)$/)
        if (m) gelIds.syncTo(parseInt(m[1], 10))
      }
      set({ gels, activeGelId: null })
      if (activeGelId && gels.some(g => g.id === activeGelId)) get().setActiveGel(activeGelId)
    },

    mergeGels(gels) {
      if (gels.length === 0) return
      for (const g of gels) {
        const m = g.id.match(/^gel_(\d+)$/)
        if (m) gelIds.syncTo(parseInt(m[1], 10))
      }
      set(s => ({ gels: [...s.gels, ...gels] }))
    },

    // ---- Contigs ----
    contigs: [],
    activeContigId: null,

    addContigs(items, folderName) {
      if (items.length === 0) return []
      const now = Date.now()
      const made: Contig[] = items.map(it => ({
        id: nextContigId(), name: it.name, doc: it.doc, createdAt: now, modifiedAt: now,
        view: DEFAULT_CONTIG_VIEW, undoStack: [], redoStack: [],
      }))
      const folderId = folderName ? get().createFolder(folderName) : null
      set(s => ({
        contigs: [...s.contigs, ...made],
        folders: folderId
          ? s.folders.map(f => f.id === folderId ? { ...f, itemUids: [...f.itemUids, ...made.map(c => toUid('contig', c.id))] } : f)
          : s.folders,
        activeContigId: made[0].id,
        activeTabId: null,
        activeSequencingReadIds: [],
        activeAlignmentId: null,
        activeGelId: null,
      }))
      return made.map(c => c.id)
    },

    updateContig(id, fn, label) {
      set(s => {
        const idx = s.contigs.findIndex(c => c.id === id)
        if (idx === -1) return {}
        const c = s.contigs[idx]
        const next = fn(c.doc)
        if (next === c.doc) return {}
        const contigs = [...s.contigs]
        contigs[idx] = { ...c, doc: next, modifiedAt: Date.now(), undoStack: [...c.undoStack, { doc: c.doc, label }].slice(-60), redoStack: [] }
        return { contigs }
      })
    },

    undoContig(id) {
      const c = get().contigs.find(x => x.id === id)
      const step = c?.undoStack[c.undoStack.length - 1]
      if (!c || !step) return null
      set(s => ({
        contigs: s.contigs.map(x => x.id !== id ? x : {
          ...x, doc: step.doc, modifiedAt: Date.now(),
          undoStack: x.undoStack.slice(0, -1),
          redoStack: [...x.redoStack, { doc: x.doc, label: step.label }],
        }),
      }))
      return step.label
    },

    redoContig(id) {
      const c = get().contigs.find(x => x.id === id)
      const step = c?.redoStack[c.redoStack.length - 1]
      if (!c || !step) return null
      set(s => ({
        contigs: s.contigs.map(x => x.id !== id ? x : {
          ...x, doc: step.doc, modifiedAt: Date.now(),
          redoStack: x.redoStack.slice(0, -1),
          undoStack: [...x.undoStack, { doc: x.doc, label: step.label }],
        }),
      }))
      return step.label
    },

    setContigView(id, patch) {
      set(s => ({
        contigs: s.contigs.map(c => (c.id === id ? { ...c, view: { ...c.view, ...patch } } : c)),
      }))
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

    // --- Primer library ---
    oligos: [],
    addLibraryOligos(incoming) {
      const s = get()
      const have = new Set(s.oligos.map(o => `${o.name}\u0000${o.sequence}`))
      const now = Date.now()
      const added: LibraryOligo[] = []
      for (const o of incoming) {
        const key = `${o.name}\u0000${o.sequence}`
        if (have.has(key)) continue
        have.add(key)
        added.push({ ...o, id: nextOligoId(), createdAt: now })
      }
      if (added.length > 0) set({ oligos: [...s.oligos, ...added] })
      return added.map(o => o.id)
    },
    updateLibraryOligo(id, patch) {
      set(s => ({ oligos: s.oligos.map(o => (o.id === id ? { ...o, ...patch } : o)) }))
    },
    removeLibraryOligo(id) {
      set(s => {
        const index = s.oligos.findIndex(o => o.id === id)
        if (index === -1) return {}
        return {
          oligos: s.oligos.filter(o => o.id !== id),
          folders: withoutItem(s.folders, toUid('oligo', id)),
          recentlyDeleted: pushDeleted(s.recentlyDeleted, {
            kind: 'oligo', index,
            folderId: folderOf(s.folders, toUid('oligo', id)),
            oligo: s.oligos[index],
          }),
        }
      })
    },
    lastOpenedTabId: null,
    checkRequest: null,
    requestCheck(sequence, role = 'primer') {
      set({ checkRequest: { sequence, role, at: Date.now() } })
      get().openSidebar('primers', 'design')
    },

    setActiveContig(id) {
      set({
        activeContigId: id,
        activeTabId: id ? null : get().activeTabId,
        activeGelId: id ? null : get().activeGelId,
        activeSequencingReadIds: id ? [] : get().activeSequencingReadIds,
        activeAlignmentId: id ? null : get().activeAlignmentId,
      })
    },

  }
})
