/**
 * IndexedDB cache for WebAssembly binaries.
 *
 * Stores .wasm blobs keyed by tool name + version so they persist across
 * sessions and work offline after first download.
 */

const DB_NAME = 'seqnexus-wasm'
const DB_VERSION = 1
const STORE_NAME = 'binaries'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** Check if a WASM binary is cached. */
export async function hasCached(key: string): Promise<boolean> {
  try {
    const db = await openDb()
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const req = store.count(key)
      req.onsuccess = () => resolve(req.result > 0)
      req.onerror = () => resolve(false)
      tx.oncomplete = () => db.close()
    })
  } catch {
    return false
  }
}

/** Retrieve a cached WASM binary. Returns null if not found. */
export async function getCached(key: string): Promise<ArrayBuffer | null> {
  try {
    const db = await openDb()
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const req = store.get(key)
      req.onsuccess = () => resolve(req.result ?? null)
      req.onerror = () => resolve(null)
      tx.oncomplete = () => db.close()
    })
  } catch {
    return null
  }
}

/** Store a WASM binary in the cache. */
export async function putCached(key: string, data: ArrayBuffer): Promise<void> {
  try {
    const db = await openDb()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      store.put(data, key)
      tx.oncomplete = () => { db.close(); resolve() }
      tx.onerror = () => { db.close(); reject(tx.error) }
    })
  } catch {
    // Silently fail — tool will re-download next time
  }
}

/** Remove a cached WASM binary. */
export async function removeCached(key: string): Promise<void> {
  try {
    const db = await openDb()
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      store.delete(key)
      tx.oncomplete = () => { db.close(); resolve() }
      tx.onerror = () => { db.close(); resolve() }
    })
  } catch {
    // ok
  }
}
