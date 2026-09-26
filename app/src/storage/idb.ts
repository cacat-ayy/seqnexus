/**
 * IndexedDB wrapper for storing large sequence base strings.
 *
 * Uses the `idb` library for a promise-based API. The database has a single
 * object store `sequences` keyed by tab ID, each value being the raw base
 * string. Metadata (annotations, folders, theme, etc.) stays in localStorage.
 */

import { openDB, type IDBPDatabase } from 'idb'

const DB_NAME = 'seqnexus'
const DB_VERSION = 5
const STORE_NAME = 'sequences'
const TRACE_STORE = 'traces'
const ALIGN_STORE = 'alignments'
const UNDO_STORE = 'undoHistory'
const FEATURE_SOURCE_STORE = 'featureSources'

let _db: IDBPDatabase | null = null

async function getDB(): Promise<IDBPDatabase> {
  if (_db) return _db
  _db = await openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
      if (!db.objectStoreNames.contains(TRACE_STORE)) {
        db.createObjectStore(TRACE_STORE)
      }
      if (!db.objectStoreNames.contains(ALIGN_STORE)) {
        db.createObjectStore(ALIGN_STORE)
      }
      if (!db.objectStoreNames.contains(UNDO_STORE)) {
        db.createObjectStore(UNDO_STORE)
      }
      if (!db.objectStoreNames.contains(FEATURE_SOURCE_STORE)) {
        db.createObjectStore(FEATURE_SOURCE_STORE)
      }
    },
  })
  return _db
}

/** Check whether IndexedDB is available in this browser context. */
export async function isAvailable(): Promise<boolean> {
  try {
    const db = await getDB()
    return !!db
  } catch {
    return false
  }
}

/** Save base strings for one or more tabs. */
export async function saveSequences(
  entries: { tabId: string; bases: string }[],
): Promise<void> {
  const db = await getDB()
  const tx = db.transaction(STORE_NAME, 'readwrite')
  for (const { tabId, bases } of entries) {
    tx.store.put(bases, tabId)
  }
  await tx.done
}

/** Load base strings for the given tab IDs. Returns a Map of tabId → bases. */
export async function loadSequences(
  tabIds: string[],
): Promise<Map<string, string>> {
  const db = await getDB()
  const result = new Map<string, string>()
  const tx = db.transaction(STORE_NAME, 'readonly')
  for (const id of tabIds) {
    const val = await tx.store.get(id)
    if (typeof val === 'string') {
      result.set(id, val)
    }
  }
  await tx.done
  return result
}

/** Delete base strings for the given tab IDs. */
export async function deleteSequences(tabIds: string[]): Promise<void> {
  if (tabIds.length === 0) return
  const db = await getDB()
  const tx = db.transaction(STORE_NAME, 'readwrite')
  for (const id of tabIds) {
    tx.store.delete(id)
  }
  await tx.done
}

/** Get all tab IDs currently stored in IndexedDB. */
export async function getAllStoredIds(): Promise<string[]> {
  const db = await getDB()
  const keys = await db.getAllKeys(STORE_NAME)
  return keys.map(k => String(k))
}

/** Clear all stored sequences, traces, alignments, and undo history. */
export async function clearAll(): Promise<void> {
  const db = await getDB()
  await db.clear(STORE_NAME)
  await db.clear(TRACE_STORE)
  if (db.objectStoreNames.contains(ALIGN_STORE)) {
    await db.clear(ALIGN_STORE)
  }
  if (db.objectStoreNames.contains(UNDO_STORE)) {
    await db.clear(UNDO_STORE)
  }
}

// ---- Feature source databases (auto-annotation references) ----
//
// Imported libraries run to megabytes of sequence, which rules out
// localStorage. Unlike everything else here they are keyed by their own id
// rather than a tab's: they belong to the app, not to a document, and outlive
// every session that used them.

/** Save one imported feature database. */
export async function saveFeatureSource(id: string, source: unknown): Promise<void> {
  const db = await getDB()
  await db.put(FEATURE_SOURCE_STORE, source, id)
}

/** All imported feature databases, oldest first is up to the caller. */
export async function loadFeatureSources(): Promise<unknown[]> {
  const db = await getDB()
  if (!db.objectStoreNames.contains(FEATURE_SOURCE_STORE)) return []
  return db.getAll(FEATURE_SOURCE_STORE)
}

export async function deleteFeatureSource(id: string): Promise<void> {
  const db = await getDB()
  await db.delete(FEATURE_SOURCE_STORE, id)
}

// ---- Trace data (sequencing reads) ----

/** Save trace data for sequencing reads. */
export async function saveTraces(
  entries: { readId: string; data: unknown }[],
): Promise<void> {
  const db = await getDB()
  const tx = db.transaction(TRACE_STORE, 'readwrite')
  for (const { readId, data } of entries) {
    tx.store.put(data, readId)
  }
  await tx.done
}

/** Load trace data for the given read IDs. */
export async function loadTraces(
  readIds: string[],
): Promise<Map<string, unknown>> {
  const db = await getDB()
  const result = new Map<string, unknown>()
  const tx = db.transaction(TRACE_STORE, 'readonly')
  for (const id of readIds) {
    const val = await tx.store.get(id)
    if (val !== undefined) {
      result.set(id, val)
    }
  }
  await tx.done
  return result
}

/** Delete trace data for the given read IDs. */
export async function deleteTraces(readIds: string[]): Promise<void> {
  if (readIds.length === 0) return
  const db = await getDB()
  const tx = db.transaction(TRACE_STORE, 'readwrite')
  for (const id of readIds) {
    tx.store.delete(id)
  }
  await tx.done
}

/** Get all read IDs currently stored in the traces store. */
export async function getAllStoredTraceIds(): Promise<string[]> {
  const db = await getDB()
  const keys = await db.getAllKeys(TRACE_STORE)
  return keys.map(k => String(k))
}

// ---- Alignment data ----

/** Save alignment result data. */
export async function saveAlignments(
  entries: { alignId: string; data: unknown }[],
): Promise<void> {
  const db = await getDB()
  const tx = db.transaction(ALIGN_STORE, 'readwrite')
  for (const { alignId, data } of entries) {
    tx.store.put(data, alignId)
  }
  await tx.done
}

/** Load alignment result data for the given IDs. */
export async function loadAlignments(
  alignIds: string[],
): Promise<Map<string, unknown>> {
  const db = await getDB()
  const result = new Map<string, unknown>()
  const tx = db.transaction(ALIGN_STORE, 'readonly')
  for (const id of alignIds) {
    const val = await tx.store.get(id)
    if (val !== undefined) {
      result.set(id, val)
    }
  }
  await tx.done
  return result
}

/** Delete alignment data for the given IDs. */
export async function deleteAlignments(alignIds: string[]): Promise<void> {
  if (alignIds.length === 0) return
  const db = await getDB()
  const tx = db.transaction(ALIGN_STORE, 'readwrite')
  for (const id of alignIds) {
    tx.store.delete(id)
  }
  await tx.done
}

/** Get all alignment IDs currently stored. */
export async function getAllStoredAlignmentIds(): Promise<string[]> {
  const db = await getDB()
  const keys = await db.getAllKeys(ALIGN_STORE)
  return keys.map(k => String(k))
}

// ---- Undo history ----

/** Save undo history for tabs. Each entry stores buffers + undo/redo stacks. */
export async function saveUndoHistory(
  entries: { tabId: string; data: unknown }[],
): Promise<void> {
  const db = await getDB()
  const tx = db.transaction(UNDO_STORE, 'readwrite')
  for (const { tabId, data } of entries) {
    tx.store.put(data, tabId)
  }
  await tx.done
}

/** Load undo history for the given tab IDs. */
export async function loadUndoHistory(
  tabIds: string[],
): Promise<Map<string, unknown>> {
  const db = await getDB()
  const result = new Map<string, unknown>()
  const tx = db.transaction(UNDO_STORE, 'readonly')
  for (const id of tabIds) {
    const val = await tx.store.get(id)
    if (val !== undefined) {
      result.set(id, val)
    }
  }
  await tx.done
  return result
}

/** Delete undo history for the given tab IDs. */
export async function deleteUndoHistory(tabIds: string[]): Promise<void> {
  if (tabIds.length === 0) return
  const db = await getDB()
  const tx = db.transaction(UNDO_STORE, 'readwrite')
  for (const id of tabIds) {
    tx.store.delete(id)
  }
  await tx.done
}

/** Get all tab IDs with stored undo history. */
export async function getAllStoredUndoIds(): Promise<string[]> {
  const db = await getDB()
  const keys = await db.getAllKeys(UNDO_STORE)
  return keys.map(k => String(k))
}

/**
 * Estimate storage usage. Returns { usage, quota } in bytes, or null if
 * the Storage API is unavailable.
 */
export async function estimateStorage(): Promise<{
  usage: number
  quota: number
} | null> {
  if (navigator.storage?.estimate) {
    const est = await navigator.storage.estimate()
    return {
      usage: est.usage ?? 0,
      quota: est.quota ?? 0,
    }
  }
  return null
}
