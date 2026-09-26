/**
 * Hybrid persistence: localStorage for metadata, IndexedDB for sequence data.
 *
 * Base strings, chromatogram traces, and alignment results are stored in
 * IndexedDB. Everything else (tab layout, annotations, folders, theme,
 * search parameters) is stored in localStorage.
 */

import { useEditorStore, type ExplorerFolder, type ViewMode, type BaseEdit, type SavedAlignment, type ReadAlignment, type Contig } from './store'
import type { Ab1Data } from './io/ab1'
import type { AlignmentResult } from './alignment/types'
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
  clearAll as idbClearAll,
} from './storage/idb'
import { showStorageError } from './components/StorageToast'

const STORAGE_KEY = 'seqnexus_session'
/** Where an unreadable session payload is parked so autosave cannot clobber it. */
const CORRUPT_KEY = 'seqnexus_session_corrupt'
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
  viewMode: ViewMode
  zoomLevel: number
  hiddenAnnotationIds?: string[]
  showOrfs?: boolean
  showEnzymes?: boolean
  showPrimers?: boolean
  showAutoAnnotations?: boolean
  readOnly?: boolean
}

/** Sequencing read metadata (trace data stored in IndexedDB). */
interface SerializedSeqRead {
  id: string
  name: string
  trimStart: number
  trimEnd: number
  edits: BaseEdit[]
}

/** Alignment metadata (result data stored in IndexedDB). */
interface SerializedAlignment {
  id: string
  name: string
  seqType: 'dna' | 'protein'
  algorithm: 'nw' | 'sw' | 'msa' | 'mafft'
  createdAt: number
  zoomLevel: number
}

/** Read alignment metadata (result data stored in IndexedDB). */
interface SerializedReadAlignment {
  id: string
  name: string
  readId: string
  tabId: string
  createdAt: number
  zoomLevel: number
  showChromatogram: boolean
  resolvedCols?: number[]
}

interface SerializedContig {
  id: string
  name: string
  tabId: string
  readAlignmentIds: string[]
  createdAt: number
  zoomLevel: number
  expandedReadId: string | null
}

interface SerializedSessionV2 {
  version: 2
  tabs: SerializedTabV2[]
  activeTabId: string | null
  folders: ExplorerFolder[]
  theme: string
  sequencingReads?: SerializedSeqRead[]
  activeSequencingReadIds?: string[]
  alignments?: SerializedAlignment[]
  readAlignments?: SerializedReadAlignment[]
  contigs?: SerializedContig[]
  activeAlignmentId?: string | null
  activeContigId?: string | null
  activeReadAlignmentId?: string | null
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

/** Build the session data from the current store state. */
function buildSessionData(theme: string): {
  meta: SerializedSessionV2
  sequences: { tabId: string; bases: string }[]
  traces: { readId: string; data: Ab1Data }[]
  alignmentData: { alignId: string; data: AlignmentResult }[]
  undoEntries: { tabId: string; data: SerializedUndoHistory }[]
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

    const { bases: _, ...docWithoutBases } = snap
    v2Tabs.push({
      id: tab.id, doc: docWithoutBases, viewMode: tab.viewMode, zoomLevel: tab.zoomLevel,
      hiddenAnnotationIds: tab.hiddenAnnotationIds.length > 0 ? tab.hiddenAnnotationIds : undefined,
      showOrfs: tab.showOrfs || undefined,
      showEnzymes: tab.showEnzymes || undefined,
      showPrimers: tab.showPrimers || undefined,
      showAutoAnnotations: tab.showAutoAnnotations || undefined,
      readOnly: tab.readOnly || undefined,
    })
  }

  // Sequencing reads: metadata in localStorage, trace data in IndexedDB
  const seqReads: SerializedSeqRead[] = state.sequencingReads.map(r => ({
    id: r.id,
    name: r.data.name,
    trimStart: r.trimStart,
    trimEnd: r.trimEnd,
    edits: r.edits,
  }))
  const traces = state.sequencingReads.map(r => ({ readId: r.id, data: r.data }))

  // Alignments: metadata in localStorage, result data in IndexedDB
  const serializedAlignments: SerializedAlignment[] = state.alignments.map(a => ({
    id: a.id,
    name: a.name,
    seqType: a.seqType,
    algorithm: a.algorithm,
    createdAt: a.createdAt,
    zoomLevel: a.zoomLevel,
  }))
  const alignmentData = state.alignments.map(a => ({ alignId: a.id, data: a.result }))

  // Read alignments: metadata in localStorage, result data in IndexedDB (shared store with alignments)
  const serializedReadAlignments: SerializedReadAlignment[] = state.readAlignments.map(ra => ({
    id: ra.id,
    name: ra.name,
    readId: ra.readId,
    tabId: ra.tabId,
    createdAt: ra.createdAt,
    zoomLevel: ra.zoomLevel,
    showChromatogram: ra.showChromatogram,
    resolvedCols: ra.resolvedCols.length > 0 ? ra.resolvedCols : undefined,
  }))
  const readAlignmentData = state.readAlignments.map(ra => ({ alignId: ra.id, data: ra.result }))

  const serializedContigs: SerializedContig[] = state.contigs.map(c => ({
    id: c.id,
    name: c.name,
    tabId: c.tabId,
    readAlignmentIds: c.readAlignmentIds,
    createdAt: c.createdAt,
    zoomLevel: c.zoomLevel,
    expandedReadId: c.expandedReadId,
  }))

  return {
    meta: {
      version: 2,
      tabs: v2Tabs,
      activeTabId: state.activeTabId,
      folders: state.folders,
      theme,
      sequencingReads: seqReads,
      activeSequencingReadIds: state.activeSequencingReadIds,
      activeAlignmentId: state.activeAlignmentId,
      activeContigId: state.activeContigId,
      activeReadAlignmentId: state.activeReadAlignmentId,
      alignments: serializedAlignments,
      readAlignments: serializedReadAlignments,
      contigs: serializedContigs.length > 0 ? serializedContigs : undefined,
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
    alignmentData: [...alignmentData, ...readAlignmentData],
    undoEntries,
  }
}

/** Callback invoked after each successful save so the UI can refresh the storage indicator. */
let _onSaveComplete: (() => void) | null = null
export function onSaveComplete(cb: (() => void) | null): void {
  _onSaveComplete = cb
}

/** Save session. Async - writes bases/traces/alignments to IndexedDB, metadata to localStorage. */
export async function saveSession(theme: string): Promise<void> {
  const { meta, sequences, traces, alignmentData, undoEntries } = buildSessionData(theme)

  try {
    if (await checkIdb()) {
      // Write bases to IndexedDB
      await saveSequences(sequences)

      // Write trace data to IndexedDB
      if (traces.length > 0) {
        await saveTraces(traces)
      }

      // Write alignment result data to IndexedDB
      if (alignmentData.length > 0) {
        await saveAlignments(alignmentData)
      }

      // Write undo history to IndexedDB
      if (undoEntries.length > 0) {
        await saveUndoHistory(undoEntries)
      }

      // Clean up orphaned IndexedDB entries (sequences)
      const currentIds = new Set(meta.tabs.map(t => t.id))
      const storedIds = await getAllStoredIds()
      const orphans = storedIds.filter(id => !currentIds.has(id))
      if (orphans.length > 0) await deleteSequences(orphans)

      // Clean up orphaned IndexedDB entries (traces)
      const currentReadIds = new Set((meta.sequencingReads ?? []).map(r => r.id))
      const storedTraceIds = await getAllStoredTraceIds()
      const traceOrphans = storedTraceIds.filter(id => !currentReadIds.has(id))
      if (traceOrphans.length > 0) await deleteTraces(traceOrphans)

      // Clean up orphaned IndexedDB entries (alignments)
      const currentAlignIds = new Set([
        ...(meta.alignments ?? []).map(a => a.id),
        ...(meta.readAlignments ?? []).map(ra => ra.id),
      ])
      const storedAlignIds = await getAllStoredAlignmentIds()
      const alignOrphans = storedAlignIds.filter(id => !currentAlignIds.has(id))
      if (alignOrphans.length > 0) await deleteAlignments(alignOrphans)

      // Clean up orphaned IndexedDB entries (undo history)
      const storedUndoIds = await getAllStoredUndoIds()
      const undoOrphans = storedUndoIds.filter(id => !currentIds.has(id))
      if (undoOrphans.length > 0) await deleteUndoHistory(undoOrphans)

      // Write metadata (without bases/traces/alignment results) to localStorage
      localStorage.setItem(STORAGE_KEY, JSON.stringify(meta))
    }
    _onSaveComplete?.()
  } catch (err) {
    const msg = err instanceof DOMException && err.name === 'QuotaExceededError'
      ? 'Storage quota exceeded – export your work to avoid data loss'
      : 'Session save failed – export your work to avoid data loss'
    showStorageError(msg)
  }
}

// ---- Load ----

export interface RestoredSeqRead {
  id: string
  data: Ab1Data
  trimStart: number
  trimEnd: number
  edits: BaseEdit[]
}

export interface RestoredSession {
  tabs: { id: string; doc: DocumentState; viewMode: ViewMode; zoomLevel: number; hiddenAnnotationIds?: string[]; showOrfs?: boolean; showEnzymes?: boolean; showPrimers?: boolean; showAutoAnnotations?: boolean; readOnly?: boolean; undoStack?: UndoSnapshot[]; redoStack?: UndoSnapshot[] }[]
  activeTabId: string | null
  folders: ExplorerFolder[]
  theme: string
  sequencingReads: RestoredSeqRead[]
  activeSequencingReadIds: string[]
  alignments: SavedAlignment[]
  readAlignments: ReadAlignment[]
  contigs: Contig[]
  activeAlignmentId?: string | null
  activeContigId?: string | null
  activeReadAlignmentId?: string | null
  orfParams?: { minCodons: number; startCodons: string[]; allowInterior: boolean }
  enzymeParams?: { subset: string; searchQuery: string; filterByCount: boolean; minCuts: number; maxCuts: number }
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
    // we can do — the warning below still tells the user what happened.
  }
}

/** Load session. Async - reads metadata from localStorage, bases from IndexedDB. */
export async function loadSession(): Promise<RestoredSession | null> {
  loadWarnings = []
  let raw: string | null = null
  try {
    raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const data: SerializedSessionV2 = JSON.parse(raw)
    if (!data || data.version !== 2 || !Array.isArray(data.tabs)) {
      preserveCorruptSession(raw)
      loadWarnings.push(
        'Your saved session could not be read (unrecognised format). A copy has been kept — export it from Storage if you need to recover it.',
      )
      return null
    }

    return await loadV2(data)
  } catch (err) {
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

  try {
    basesMap = await loadSequences(tabIds)
  } catch (err) {
    // IndexedDB read failed - tabs without bases will be skipped
    loadWarnings.push(
      `Sequence data could not be read from storage (${err instanceof Error ? err.message : String(err)}). Affected tabs were not restored.`,
    )
  }

  try {
    undoMap = await loadUndoHistory(tabIds)
  } catch {
    // Undo history load failed - tabs will start with empty undo stacks.
    // Not surfaced: no user data is lost, only the ability to undo past edits.
  }

  const tabs: RestoredSession['tabs'] = []
  const droppedTabs: string[] = []
  for (const st of data.tabs) {
    const bases = basesMap.get(st.id)
    if (bases === undefined) {
      // bases lost - skip this tab, but remember it so the user is told which
      droppedTabs.push(st.doc?.name ?? st.id)
      continue
    }

    const undoData = undoMap.get(st.id) as SerializedUndoHistory | undefined
    let doc: DocumentState
    let undoStack: UndoSnapshot[] | undefined
    let redoStack: UndoSnapshot[] | undefined

    if (undoData && undoData.original !== undefined && undoData.currentTree) {
      // Reconstruct PieceTable from saved buffers so undo snapshots remain valid
      try {
        const pt = PieceTable.fromBuffers(undoData.original, undoData.add, undoData.currentTree)
        const seq = Sequence.fromPieceTable(pt, st.doc.topology)
        doc = {
          name: st.doc.name,
          description: st.doc.description,
          sequence: seq,
          annotations: (st.doc.annotations ?? []).map((d: AnnotationData) => new Annotation(d)),
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
      viewMode: st.viewMode,
      zoomLevel: st.zoomLevel,
      hiddenAnnotationIds: st.hiddenAnnotationIds,
      showOrfs: st.showOrfs,
      showEnzymes: st.showEnzymes,
      showPrimers: st.showPrimers,
      showAutoAnnotations: st.showAutoAnnotations,
      readOnly: st.readOnly,
      undoStack,
      redoStack,
    })
  }

  if (droppedTabs.length > 0) {
    loadWarnings.push(
      `${droppedTabs.length} saved ${droppedTabs.length === 1 ? 'sequence' : 'sequences'} could not be restored (data missing from storage): ${droppedTabs.join(', ')}`,
    )
  }

  // Restore sequencing reads from IndexedDB traces
  const seqReads: RestoredSeqRead[] = []
  const serializedReads = data.sequencingReads ?? []
  if (serializedReads.length > 0) {
    try {
      const readIds = serializedReads.map(r => r.id)
      const tracesMap = await loadTraces(readIds)
      for (const sr of serializedReads) {
        const traceData = tracesMap.get(sr.id) as Ab1Data | undefined
        if (!traceData) continue // trace data lost - skip
        seqReads.push({
          id: sr.id,
          data: { ...traceData, name: sr.name },
          trimStart: sr.trimStart,
          trimEnd: sr.trimEnd,
          edits: sr.edits ?? [],
        })
      }
    } catch (err) {
      // trace load failed - sequencing reads won't be restored
      loadWarnings.push(
        `${serializedReads.length} sequencing ${serializedReads.length === 1 ? 'read' : 'reads'} could not be restored (${err instanceof Error ? err.message : String(err)}).`,
      )
    }
  }

  // Restore alignments from IndexedDB
  const alignments: SavedAlignment[] = []
  const serializedAligns = data.alignments ?? []
  if (serializedAligns.length > 0) {
    try {
      const alignIds = serializedAligns.map(a => a.id)
      const alignMap = await loadAlignments(alignIds)
      for (const sa of serializedAligns) {
        const result = alignMap.get(sa.id) as AlignmentResult | undefined
        if (!result) continue // result data lost - skip
        alignments.push({
          id: sa.id,
          name: sa.name,
          result,
          seqType: sa.seqType,
          algorithm: sa.algorithm,
          createdAt: sa.createdAt,
          zoomLevel: sa.zoomLevel,
        })
      }
    } catch {
      // alignment load failed - alignments won't be restored
    }
  }

  // Restore read alignments from IndexedDB
  const readAlignments: ReadAlignment[] = []
  const serializedReadAligns = data.readAlignments ?? []
  if (serializedReadAligns.length > 0) {
    try {
      const raIds = serializedReadAligns.map(ra => ra.id)
      const raMap = await loadAlignments(raIds)
      for (const sra of serializedReadAligns) {
        const result = raMap.get(sra.id) as AlignmentResult | undefined
        if (!result) continue
        readAlignments.push({
          id: sra.id,
          name: sra.name,
          readId: sra.readId,
          tabId: sra.tabId,
          result,
          createdAt: sra.createdAt,
          zoomLevel: sra.zoomLevel,
          showChromatogram: sra.showChromatogram,
          resolvedCols: sra.resolvedCols ?? [],
        })
      }
    } catch {
      // read alignment load failed
    }
  }

  // Clean up orphaned IndexedDB entries
  try {
    const currentIds = new Set(tabIds)
    const storedIds = await getAllStoredIds()
    const orphans = storedIds.filter(id => !currentIds.has(id))
    if (orphans.length > 0) await deleteSequences(orphans)
  } catch {
    // best-effort cleanup
  }

  // Restore contigs (metadata only – they reference existing ReadAlignments)
  const contigs: Contig[] = (data.contigs ?? []).map(sc => ({
    id: sc.id,
    name: sc.name,
    tabId: sc.tabId,
    readAlignmentIds: sc.readAlignmentIds,
    createdAt: sc.createdAt,
    zoomLevel: sc.zoomLevel,
    expandedReadId: sc.expandedReadId,
  }))
  // Filter out contigs whose read alignments didn't survive restore
  const raIdSet = new Set(readAlignments.map(ra => ra.id))
  const validContigs = contigs
    .map(c => ({ ...c, readAlignmentIds: c.readAlignmentIds.filter(id => raIdSet.has(id)) }))
    .filter(c => c.readAlignmentIds.length > 0)

  return {
    tabs,
    activeTabId: data.activeTabId,
    folders: data.folders ?? [],
    theme: data.theme ?? 'light',
    sequencingReads: seqReads,
    activeSequencingReadIds: data.activeSequencingReadIds ?? [],
    alignments,
    readAlignments,
    contigs: validContigs,
    activeAlignmentId: data.activeAlignmentId ?? null,
    activeContigId: data.activeContigId ?? null,
    activeReadAlignmentId: data.activeReadAlignmentId ?? null,
    orfParams: data.orfParams,
    enzymeParams: data.enzymeParams,
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

/** Clear all persisted session data (both localStorage and IndexedDB). */
export async function clearSavedSession(): Promise<void> {
  localStorage.removeItem(STORAGE_KEY)
  try {
    if (await checkIdb()) await idbClearAll()
  } catch {
    // best-effort
  }
}

// ---- Session export / import ----

export interface SessionExportOptions {
  includeReads: boolean
  includeAlignments: boolean
  includeReadAlignments: boolean
}

interface SessionExportEnvelope {
  format: 'seqnexus-session'
  version: 1
  exportedAt: string
  include: {
    sequences: true
    reads: boolean
    alignments: boolean
    readAlignments: boolean
  }
  session: SerializedSessionV2
  sequences: { tabId: string; bases: string }[]
  traces?: { readId: string; data: Ab1Data }[]
  alignmentData?: { alignId: string; data: AlignmentResult }[]
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
      size += JSON.stringify(a.result).length
    }
  }
  if (opts.includeReadAlignments) {
    for (const ra of state.readAlignments) {
      size += JSON.stringify(ra.result).length
    }
    // Contig metadata is small
    size += state.contigs.length * 200
  }
  return size
}

/** Export the current session as a JSON Blob. */
export function exportSessionToJson(theme: string, opts: SessionExportOptions): Blob {
  const { meta, sequences, traces, alignmentData } = buildSessionData(theme)

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
  if (!opts.includeReadAlignments) {
    meta.readAlignments = []
    meta.contigs = undefined
    meta.activeContigId = null
    meta.activeReadAlignmentId = null
  }

  // Separate alignment data into alignment vs read-alignment
  const alignIds = new Set((meta.alignments ?? []).map(a => a.id))
  const raIds = new Set((meta.readAlignments ?? []).map(ra => ra.id))

  const envelope: SessionExportEnvelope = {
    format: 'seqnexus-session',
    version: 1,
    exportedAt: new Date().toISOString(),
    include: {
      sequences: true,
      reads: opts.includeReads,
      alignments: opts.includeAlignments,
      readAlignments: opts.includeReadAlignments,
    },
    session: meta,
    sequences,
    traces: opts.includeReads ? traces : undefined,
    alignmentData: alignmentData.filter(ad => alignIds.has(ad.alignId) || raIds.has(ad.alignId)),
  }

  // Remove empty optional fields to reduce size
  if (!envelope.traces?.length) delete envelope.traces
  if (!envelope.alignmentData?.length) delete envelope.alignmentData

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
  const alignMap = new Map<string, AlignmentResult>()
  if (envelope.alignmentData) {
    for (const ad of envelope.alignmentData) {
      alignMap.set(ad.alignId, ad.data)
    }
  }

  // Reconstruct tabs
  const tabs: RestoredSession['tabs'] = []
  for (const st of data.tabs) {
    const bases = basesMap.get(st.id)
    if (bases === undefined) continue
    const fullSnap: DocumentSnapshot = { ...st.doc, bases }
    const doc = restore(fullSnap)
    tabs.push({
      id: st.id, doc, viewMode: st.viewMode, zoomLevel: st.zoomLevel,
      hiddenAnnotationIds: st.hiddenAnnotationIds,
      showOrfs: st.showOrfs, showEnzymes: st.showEnzymes, showPrimers: st.showPrimers,
      showAutoAnnotations: st.showAutoAnnotations,
      readOnly: st.readOnly,
    })
  }

  // Reconstruct sequencing reads
  const seqReads: RestoredSeqRead[] = []
  for (const sr of data.sequencingReads ?? []) {
    const traceData = tracesMap.get(sr.id)
    if (!traceData) continue
    seqReads.push({
      id: sr.id,
      data: { ...traceData, name: sr.name },
      trimStart: sr.trimStart, trimEnd: sr.trimEnd,
      edits: sr.edits ?? [],
    })
  }

  // Reconstruct alignments
  const alignments: SavedAlignment[] = []
  for (const sa of data.alignments ?? []) {
    const result = alignMap.get(sa.id)
    if (!result) continue
    alignments.push({
      id: sa.id, name: sa.name, result,
      seqType: sa.seqType, algorithm: sa.algorithm,
      createdAt: sa.createdAt, zoomLevel: sa.zoomLevel,
    })
  }

  // Reconstruct read alignments
  const readAlignments: ReadAlignment[] = []
  for (const sra of data.readAlignments ?? []) {
    const result = alignMap.get(sra.id)
    if (!result) continue
    readAlignments.push({
      id: sra.id, name: sra.name, readId: sra.readId, tabId: sra.tabId,
      result, createdAt: sra.createdAt, zoomLevel: sra.zoomLevel,
      showChromatogram: sra.showChromatogram, resolvedCols: sra.resolvedCols ?? [],
    })
  }

  // Reconstruct contigs
  const raIdSet = new Set(readAlignments.map(ra => ra.id))
  const contigs: Contig[] = (data.contigs ?? [])
    .map(sc => ({
      id: sc.id, name: sc.name, tabId: sc.tabId,
      readAlignmentIds: sc.readAlignmentIds.filter(id => raIdSet.has(id)),
      createdAt: sc.createdAt, zoomLevel: sc.zoomLevel,
      expandedReadId: sc.expandedReadId,
    }))
    .filter(c => c.readAlignmentIds.length > 0)

  return {
    tabs,
    activeTabId: data.activeTabId,
    folders: data.folders ?? [],
    theme: data.theme ?? 'light',
    sequencingReads: seqReads,
    activeSequencingReadIds: data.activeSequencingReadIds ?? [],
    alignments,
    readAlignments,
    contigs,
    activeAlignmentId: data.activeAlignmentId ?? null,
    activeContigId: data.activeContigId ?? null,
    activeReadAlignmentId: data.activeReadAlignmentId ?? null,
    orfParams: data.orfParams,
    enzymeParams: data.enzymeParams,
  }
}

/** Generate a new unique ID (same format as tab IDs). */
function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

/**
 * Remap all IDs in a RestoredSession to avoid collisions during merge.
 * Returns a new session with fresh IDs and updated cross-references.
 */
export function remapSessionIds(session: RestoredSession): RestoredSession {
  const tabIdMap = new Map<string, string>()
  const readIdMap = new Map<string, string>()
  const alignIdMap = new Map<string, string>()
  const raIdMap = new Map<string, string>()
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
  for (const ra of session.readAlignments) {
    raIdMap.set(ra.id, newId())
  }
  for (const c of session.contigs) {
    contigIdMap.set(c.id, newId())
  }
  for (const f of session.folders) {
    folderIdMap.set(f.id, newId())
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
      tabIds: f.tabIds.map(tid => tabIdMap.get(tid) || tid),
    })),
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
    readAlignments: session.readAlignments.map(ra => ({
      ...ra,
      id: raIdMap.get(ra.id) || ra.id,
      readId: readIdMap.get(ra.readId) || ra.readId,
      tabId: tabIdMap.get(ra.tabId) || ra.tabId,
    })),
    contigs: session.contigs.map(c => ({
      ...c,
      id: contigIdMap.get(c.id) || c.id,
      tabId: tabIdMap.get(c.tabId) || c.tabId,
      readAlignmentIds: c.readAlignmentIds.map(id => raIdMap.get(id) || id),
    })),
    activeAlignmentId: session.activeAlignmentId ? (alignIdMap.get(session.activeAlignmentId) ?? session.activeAlignmentId) : null,
    activeContigId: session.activeContigId ? (contigIdMap.get(session.activeContigId) ?? session.activeContigId) : null,
    activeReadAlignmentId: session.activeReadAlignmentId ? (raIdMap.get(session.activeReadAlignmentId) ?? session.activeReadAlignmentId) : null,
    orfParams: session.orfParams,
    enzymeParams: session.enzymeParams,
  }
}
