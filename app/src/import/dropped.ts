/**
 * The files of a drop, with folders walked. A dropped folder used to arrive
 * as one unreadable "file" named after it; now its files come with their
 * paths inside it ("Plate 1/A01.ab1"), so the import can rebuild its shape.
 *
 * The entries have to be taken from the DataTransfer during the drop event
 * itself (the browser empties it afterwards), so this reads them at once and
 * only the walk is asynchronous.
 */

export interface Dropped {
  files: File[]
  /** Each file's path inside what was dropped, for files that came from a folder. */
  paths: Map<File, string>
}

const fileOf = (entry: FileSystemFileEntry) => new Promise<File>((resolve, reject) => entry.file(resolve, reject))

/** Every entry in a directory: readEntries gives them a batch at a time. */
async function entriesOf(dir: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = dir.createReader()
  const all: FileSystemEntry[] = []
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject))
    if (batch.length === 0) return all
    all.push(...batch)
  }
}

async function walk(entry: FileSystemEntry, prefix: string, out: Dropped): Promise<void> {
  const path = prefix ? `${prefix}/${entry.name}` : entry.name
  if (entry.isFile) {
    const file = await fileOf(entry as FileSystemFileEntry)
    out.files.push(file)
    if (prefix) out.paths.set(file, path)
  } else if (entry.isDirectory) {
    for (const child of await entriesOf(entry as FileSystemDirectoryEntry)) await walk(child, path, out)
  }
}

/** Read a drop's files, walking any folders in it. Call during the drop event. */
export function droppedFiles(dt: DataTransfer): Promise<Dropped> {
  const entries = Array.from(dt.items ?? [])
    .filter(item => item.kind === 'file')
    .map(item => item.webkitGetAsEntry?.() ?? null)
  // No entry API, or no folders among the entries: the plain file list is all there is.
  if (entries.length === 0 || entries.some(e => e === null) || !entries.some(e => e!.isDirectory)) {
    return Promise.resolve({ files: Array.from(dt.files ?? []), paths: new Map() })
  }
  const out: Dropped = { files: [], paths: new Map() }
  return (async () => {
    for (const entry of entries) await walk(entry!, '', out)
    return out
  })()
}
