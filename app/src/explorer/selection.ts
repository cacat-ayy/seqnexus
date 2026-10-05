/**
 * Turning an explorer selection into something the rest of the app can use.
 *
 * Selection is stored as uids (`${kind}:${id}`). The export and alignment
 * paths want raw store ids grouped by kind, and both App's File menu and the
 * explorer's own context menu need the same conversion, so it lives here
 * rather than being spelled out at each call site with id-prefix guesswork.
 */

import type { ItemKind } from './types'
import { parseUid } from './types'

/** Store ids grouped by kind, dropping anything unparseable. */
export function groupSelection(selected: Iterable<string>): Partial<Record<ItemKind, string[]>> {
  const out: Partial<Record<ItemKind, string[]>> = {}
  for (const uid of selected) {
    const parsed = parseUid(uid)
    if (!parsed) continue
    ;(out[parsed.kind] ??= []).push(parsed.id)
  }
  return out
}

/** How many selected items can be exported. Every kind can, so: all of them. */
export function countSelectable(selected: Iterable<string>): number {
  let n = 0
  for (const uid of selected) if (parseUid(uid)) n++
  return n
}

/**
 * The selection grouped for export. An assembly stands for its contigs: the
 * export dialog writes contigs, and an assembly's data is its contigs.
 */
export function exportSelection(
  selected: Iterable<string>,
  contigIdsOf: (assemblyId: string) => readonly string[],
): Partial<Record<ItemKind, string[]>> {
  const grouped = groupSelection(selected)
  if (grouped.assembly) {
    const contigs = new Set(grouped.contig ?? [])
    for (const id of grouped.assembly) for (const c of contigIdsOf(id)) contigs.add(c)
    delete grouped.assembly
    grouped.contig = [...contigs]
  }
  // Read sets are exported from their own page, as FASTQ.gz.
  delete grouped.readset
  return grouped
}
