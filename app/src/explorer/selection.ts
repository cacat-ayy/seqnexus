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
import type { ExportItemKind } from '../components/exportFormats'

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

/**
 * Kinds with no place in the export dialog: they are exported from their own
 * page (a read set as FASTQ.gz, a gel as an image, a clone's parts and
 * oligos from the cloning workspace).
 */
const EXPORTED_ELSEWHERE: readonly ItemKind[] = ['readset', 'gel', 'clone']

/** How many selected items Export Selected can write. */
export function countSelectable(selected: Iterable<string>): number {
  let n = 0
  for (const uid of selected) {
    const parsed = parseUid(uid)
    if (parsed && !EXPORTED_ELSEWHERE.includes(parsed.kind)) n++
  }
  return n
}

/** A selection sorted by where each part of it is exported. */
export interface ExportPick {
  /** What the export dialog writes, by its kinds. A protein is a sequence there. */
  items: Partial<Record<ExportItemKind, string[]>>
  /** Library oligos, which have their own export (CSV, FASTA, order sheet). */
  oligos: string[]
  /** Kinds that were picked but are exported from their own page. */
  elsewhere: ItemKind[]
}

/**
 * The selection grouped for export. An assembly stands for its contigs: the
 * export dialog writes contigs, and an assembly's data is its contigs.
 */
export function exportSelection(
  selected: Iterable<string>,
  contigIdsOf: (assemblyId: string) => readonly string[],
): ExportPick {
  const grouped = groupSelection(selected)
  const items: ExportPick['items'] = {}
  const sequences = [...(grouped.sequence ?? []), ...(grouped.protein ?? [])]
  if (sequences.length > 0) items.sequence = sequences
  if (grouped.read) items.read = grouped.read
  if (grouped.alignment) items.alignment = grouped.alignment
  if (grouped.contig || grouped.assembly) {
    const contigs = new Set(grouped.contig ?? [])
    for (const id of grouped.assembly ?? []) for (const c of contigIdsOf(id)) contigs.add(c)
    if (contigs.size > 0) items.contig = [...contigs]
  }
  return {
    items,
    oligos: grouped.oligo ?? [],
    elsewhere: EXPORTED_ELSEWHERE.filter(k => grouped[k]?.length),
  }
}
