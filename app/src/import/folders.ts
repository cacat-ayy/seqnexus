/**
 * The explorer folders an import files its items into.
 *
 * A folder opened with Import Folder, or dropped on the window, keeps its
 * shape: each directory becomes an explorer folder inside its parent's,
 * named as it was. Folders are made when the first item is filed into
 * them, so a directory whose files could not be opened leaves nothing
 * behind. Files with no directory go to the root given (the folder dropped
 * on, or the top level).
 */

import { useEditorStore } from '../store'

/** Where one file's items go: made on first use; null is the top level. */
export type Place = () => string | null

/** The directory parts of a relative path: "Plate 1/A/A01.ab1" gives ["Plate 1", "A"]. */
export function directoryOf(path: string): string[] {
  return path.split('/').filter(Boolean).slice(0, -1)
}

/**
 * Places for the files of one import. `root` is where files with no
 * directory, and the top directory itself, go.
 */
export function folderMaker(root: string | null) {
  const made = new Map<string, string>()
  const ensure = (parts: string[]): string | null => {
    if (parts.length === 0) return root
    const key = parts.join('/')
    const known = made.get(key)
    // A folder deleted while the import ran is made again rather than filed into.
    if (known && useEditorStore.getState().folders.some(f => f.id === known)) return known
    const parent = ensure(parts.slice(0, -1))
    const id = useEditorStore.getState().createFolder(parts[parts.length - 1], parent)
    made.set(key, id)
    return id
  }
  return {
    /** The place for a file at this path inside what was imported. */
    placeFor(path: string): Place {
      const parts = directoryOf(path)
      return () => ensure(parts)
    },
  }
}

/** File these items into a place: the place's folder, or the top level when it has none. */
export function fileInto(uids: readonly string[], place: Place | undefined): void {
  const folder = place?.() ?? null
  if (!folder) return
  const store = useEditorStore.getState()
  for (const uid of uids) store.moveItemToFolder(uid, folder)
}

/** A new folder for several items from one file, inside the place's folder. */
export function groupInto(uids: readonly string[], name: string, place: Place | undefined): string {
  const store = useEditorStore.getState()
  const folder = store.createFolder(name, place?.() ?? null)
  for (const uid of uids) store.moveItemToFolder(uid, folder)
  return folder
}
