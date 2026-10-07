/**
 * Lining contigs up with the sequences they are expected to be, as the
 * assembly is made, so they come out in the coordinates the user knows.
 *
 * Each contig is scored against every sequence offered (the open sequences,
 * or one chosen) by shared rare 15-mers (compare.ts, no alignment); the best
 * match above the threshold is aligned to it, and the contig takes its
 * strand and (circular) starts where it starts. When the contig then has
 * the same length and no insertion or deletion against it (substitutions at
 * most), the two share coordinates, so the contig is linked to that
 * sequence: the Reads page draws its features and translation over the
 * reads. A contig matching nothing is left as the assembler made it.
 */

import { anchorScore, compareToExpected } from './compare'
import type { AssembledContig, DeNovoReport } from './types'

export interface LineUpTarget {
  name: string
  tabId: string
  bases: string
  circular: boolean
}

/** Sequences longer than this are not offered (a genome, where lining up a plasmid contig means nothing). */
export const MAX_TARGET = 2_000_000

export function lineUpContigs(contigs: readonly AssembledContig[], targets: readonly LineUpTarget[]): { contigs: AssembledContig[]; matched: NonNullable<DeNovoReport['matched']> } {
  const matched: NonNullable<DeNovoReport['matched']> = []
  const out = contigs.map((c, i): AssembledContig => {
    let best: LineUpTarget | null = null
    let score = 0
    for (const t of targets) {
      const s = anchorScore(c.bases, t.bases, t.circular)
      if (s > score) { score = s; best = t }
    }
    if (!best) return c
    try {
      const cmp = compareToExpected({ contig: c.bases, contigCircular: c.circular, expected: best.bases, expectedCircular: best.circular })
      const linked = cmp.bases.length === best.bases.length && cmp.differences.every(d => d.type === 'SNP')
      matched.push({ contig: i, expected: best.name, reversed: cmp.reversed, shift: cmp.shift, at: Date.now(), auto: true, linked })
      return { ...c, bases: cmp.bases, tabId: linked ? best.tabId : null }
    } catch {
      return c
    }
  })
  return { contigs: out, matched }
}

/** The open sequences to offer, from the editor's tabs (all of them, or the one chosen). */
export function lineUpTargets(
  tabs: readonly { id: string; doc: { name: string; sequence: { bases: string; topology: string; length: number } } }[],
  choice: 'auto' | 'none' | string,
): LineUpTarget[] {
  if (choice === 'none') return []
  return tabs
    .filter(t => (choice === 'auto' || t.id === choice) && t.doc.sequence.length >= 100 && t.doc.sequence.length <= MAX_TARGET)
    .map(t => ({ name: t.doc.name, tabId: t.id, bases: t.doc.sequence.bases, circular: t.doc.sequence.topology === 'circular' }))
}
