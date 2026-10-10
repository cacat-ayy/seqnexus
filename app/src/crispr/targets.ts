/**
 * What the off-target search is allowed to look at.
 *
 * The app ships no genome, and pretending otherwise would be the worst thing
 * this feature could do: a specificity score from a 5 kb plasmid reads
 * exactly like one from a chromosome. So the search space is always
 * something the user named, and every report carries the names back so the
 * panel can print them beside the count.
 *
 * Three sources, all sequence the user already has: the open document, the
 * other open documents, and a FASTA file (one record or many) loaded for the
 * purpose. A contig the user assembled is an open document like any other
 * once it is opened, so it needs no case of its own here.
 */

import { readFasta } from '../io/fasta'
import type { SearchTarget } from './offtarget'

export type TargetScope = 'document' | 'open' | 'file'

export const SCOPE_LABEL: Record<TargetScope, string> = {
  document: 'This sequence',
  open: 'All open sequences',
  file: 'A FASTA file',
}

/** A file loaded for searching, kept until the user replaces or clears it. */
export interface LoadedTargets {
  /** The file it came from, shown in the scope line. */
  fileName: string
  records: { id: string; name: string; bases: string }[]
  /** Bases across every record, for the size the panel reports. */
  totalBases: number
}

/**
 * How much sequence a browser tab will hold without trouble. A bacterial
 * genome is comfortably inside it; a mammalian one is not, and saying so is
 * better than a tab that dies while the user waits.
 */
export const MAX_TARGET_BASES = 120_000_000

export interface LoadError {
  message: string
}

/** Parse a FASTA file's text into targets, or say why not. */
export function loadTargetFile(text: string, fileName: string): LoadedTargets | LoadError {
  const read = readFasta(text, fileName)
  if (read.records.length === 0) {
    return {
      message: read.proteins.length > 0
        ? `${fileName} holds protein records. The search needs DNA.`
        : `${fileName} holds no DNA records.`,
    }
  }
  let totalBases = 0
  const records = read.records.map((r, i) => {
    totalBases += r.bases.length
    return { id: `file:${i}`, name: r.name || `${fileName} record ${i + 1}`, bases: r.bases }
  })
  if (totalBases > MAX_TARGET_BASES) {
    return {
      message: `${fileName} is ${(totalBases / 1_000_000).toFixed(0)} Mb, more than this page can search. `
        + 'Load the chromosome or the region you care about instead.',
    }
  }
  return { fileName, records, totalBases }
}

export interface DocumentLike {
  id: string
  name: string
  bases: string
  topology: 'linear' | 'circular'
  isProtein: boolean
  features?: readonly { name: string; type: string; start: number; end: number }[]
}

/**
 * The targets a scope resolves to.
 *
 * A protein document is left out rather than refused: the scope means "the
 * sequences I have open", and the ones with no bases to search simply are
 * not searched.
 */
export function resolveTargets(
  scope: TargetScope,
  activeId: string | null,
  documents: readonly DocumentLike[],
  loaded: LoadedTargets | null,
): SearchTarget[] {
  if (scope === 'file') {
    if (!loaded) return []
    return loaded.records.map(r => ({
      id: r.id,
      name: r.name,
      bases: r.bases,
      topology: 'linear' as const,
      source: 'file' as const,
    }))
  }
  const wanted = scope === 'document'
    ? documents.filter(d => d.id === activeId)
    : documents
  return wanted
    .filter(d => !d.isProtein && d.bases.length > 0)
    .map(d => ({
      id: d.id,
      name: d.name,
      bases: d.bases,
      topology: d.topology,
      source: 'document' as const,
      ...(d.features && d.features.length > 0 ? { features: d.features } : {}),
    }))
}

/** One line naming what was searched, for under the hit count. */
export function searchedLine(searched: readonly { name: string; length: number }[]): string {
  if (searched.length === 0) return 'Nothing was searched.'
  const bases = searched.reduce((n, s) => n + s.length, 0)
  const size = bases >= 1_000_000
    ? `${(bases / 1_000_000).toFixed(1)} Mb`
    : bases >= 1000 ? `${Math.round(bases / 1000)} kb` : `${bases} bp`
  if (searched.length === 1) return `Searched ${searched[0].name} (${size}).`
  if (searched.length <= 3) {
    return `Searched ${searched.map(s => s.name).join(', ')} (${size} in all).`
  }
  return `Searched ${searched.length} sequences, ${size} in all.`
}
