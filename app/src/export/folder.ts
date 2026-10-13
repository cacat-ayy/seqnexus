/**
 * An explorer folder, its subfolders and everything filed in them, as the
 * entries of one ZIP: the way to hand a project to a colleague or another
 * tool in files every editor reads, rather than as a SeqNexus session.
 *
 * Each item goes out in its kind's richest open format: a sequence as
 * GenBank (a protein as GenPept), a read as FASTQ, an alignment or a contig
 * as aligned FASTA, an assembly as a folder of its contigs, and a folder's
 * oligos as one oligos.csv. Subfolders become directories. Read sets, gels
 * and clones have their own exports and are counted, not written.
 */

import type { ExplorerFolder, useEditorStore } from '../store'
import type { DocumentState } from '../models/Document'
import { parseUid, type ItemKind } from '../explorer/types'
import { itemFile, type ExportItem } from './items'
import { toCsv } from '../primers/library-io'
import type { ZipEntry } from '../utils/zip'

type State = ReturnType<typeof useEditorStore.getState>

export interface FolderExport {
  entries: ZipEntry[]
  /** Items written, and items left out by kind (exported from their own page). */
  written: number
  skipped: Partial<Record<ItemKind, number>>
}

/** A folder's name as a directory name. */
const dirName = (name: string) => name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'folder'

/**
 * The folder `rootId` and everything under it, as ZIP entries under a
 * directory named after it. `doc` is the open document as it is now.
 */
export function folderExport(state: State, rootId: string, doc: DocumentState): FolderExport {
  const out: FolderExport = { entries: [], written: 0, skipped: {} }
  const byParent = new Map<string | null, ExplorerFolder[]>()
  for (const f of state.folders) {
    const list = byParent.get(f.parentId) ?? []
    list.push(f)
    byParent.set(f.parentId, list)
  }
  const root = state.folders.find(f => f.id === rootId)
  if (!root) return out

  const add = (dir: string, item: ExportItem, format: Parameters<typeof itemFile>[1]) => {
    const f = itemFile(item, format)
    out.entries.push({ path: `${dir}/${f.base}${f.ext}`, data: f.data })
    out.written++
  }
  const skip = (kind: ItemKind) => { out.skipped[kind] = (out.skipped[kind] ?? 0) + 1 }

  const walk = (folder: ExplorerFolder, dir: string, seen: Set<string>) => {
    if (seen.has(folder.id)) return
    seen.add(folder.id)
    const oligoIds: string[] = []
    for (const uid of folder.itemUids) {
      const parsed = parseUid(uid)
      if (!parsed) continue
      const { kind, id } = parsed
      if (kind === 'sequence' || kind === 'protein') {
        const tab = state.tabs.find(t => t.id === id)
        if (tab) add(dir, { kind: 'sequence', doc: tab.id === state.activeTabId ? doc : tab.doc }, 'gb')
      } else if (kind === 'read') {
        const read = state.sequencingReads.find(r => r.id === id)
        if (read) add(dir, { kind: 'read', read }, 'fastq')
      } else if (kind === 'alignment') {
        const align = state.alignments.find(a => a.id === id)
        if (align) add(dir, { kind: 'alignment', name: align.name, doc: align.doc }, 'aligned-fasta')
      } else if (kind === 'contig') {
        const contig = state.contigs.find(c => c.id === id)
        if (contig) add(dir, { kind: 'contig', contig }, 'aligned-fasta')
      } else if (kind === 'assembly') {
        const assembly = state.assemblies.find(a => a.id === id)
        if (!assembly) continue
        const sub = `${dir}/${dirName(assembly.name)}`
        for (const cid of assembly.contigIds) {
          const contig = state.contigs.find(c => c.id === cid)
          if (contig) add(sub, { kind: 'contig', contig }, 'aligned-fasta')
        }
      } else if (kind === 'oligo') {
        oligoIds.push(id)
      } else {
        skip(kind)
      }
    }
    const oligos = state.oligos.filter(o => oligoIds.includes(o.id))
    if (oligos.length > 0) {
      out.entries.push({ path: `${dir}/oligos.csv`, data: toCsv(oligos) })
      out.written += oligos.length
    }
    for (const child of byParent.get(folder.id) ?? []) walk(child, `${dir}/${dirName(child.name)}`, seen)
  }
  walk(root, dirName(root.name), new Set())
  return out
}
