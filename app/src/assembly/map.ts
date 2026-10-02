/**
 * Mapping reads to a reference.
 *
 * Each read is seeded on both strands, aligned end to end within a band
 * around its best diagonal (the reference's ends are free), and kept when
 * its identity reaches the minimum. A circular reference is extended by a
 * read's length past its end, so a read across the origin maps in one piece;
 * the extension is kept only as far as some read needs it.
 */

import { alignBanded, bandAround, GLOCAL, kmerIndex, seedBothStrands, type PairAlignment } from './align'
import { addAligned, emptyPileup, orient, toDoc } from './pileup'
import type { AssemblyInput, AssemblyReport, AssemblySettings, ContigDoc } from './types'

export interface MapReference {
  name: string
  tabId: string | null
  bases: string
  circular: boolean
}

export function mapToReference(
  ref: MapReference,
  inputs: readonly AssemblyInput[],
  s: AssemblySettings,
  onProgress?: (done: number, total: number) => void,
): AssemblyReport {
  const refBases = ref.bases.toUpperCase()
  const L = refBases.length
  const longest = inputs.reduce((m, r) => Math.max(m, r.seq.length), 0)
  const target = ref.circular ? refBases + refBases.slice(0, Math.min(L, longest + 50)) : refBases
  const index = kmerIndex(target, s.k)
  const unplaced: AssemblyReport['unplaced'] = []
  const placed: { input: AssemblyInput; reversed: boolean; aln: PairAlignment }[] = []

  inputs.forEach((input, n) => {
    onProgress?.(n, inputs.length)
    if (input.seq.length < 20) { unplaced.push({ name: input.name, readId: input.readId, reason: 'Too short after trimming' }); return }
    const hit = seedBothStrands(input.seq, index, s.k, 3)
    if (!hit) { unplaced.push({ name: input.name, readId: input.readId, reason: 'No match to the reference' }); return }
    const read = orient(input, hit.reversed)
    const aln = alignBanded(read.seq, target, GLOCAL, bandAround(hit.seed.diag, read.seq.length))
    if (!aln || aln.identity < s.minIdentity) {
      const pct = aln ? Math.round(aln.identity * 100) : 0
      unplaced.push({ name: input.name, readId: input.readId, reason: `Only ${pct}% identical to the reference (needs ${Math.round(s.minIdentity * 100)}%)` })
      return
    }
    // A read that lies wholly in the circular extension also lies at the start: use that copy.
    if (ref.circular && aln.tStart >= L) {
      placed.push({ input, reversed: hit.reversed, aln: { ...aln, tStart: aln.tStart - L, tEnd: aln.tEnd - L } })
    } else {
      placed.push({ input, reversed: hit.reversed, aln })
    }
  })
  onProgress?.(inputs.length, inputs.length)

  const reach = placed.reduce((m, p) => Math.max(m, p.aln.tEnd), L)
  const backbone = target.slice(0, Math.max(L, reach))
  const pile = emptyPileup(backbone)
  // Left to right, so the layout reads naturally.
  placed.sort((a, b) => a.aln.tStart - b.aln.tStart)
  let colOf = backbone.split('').map((_, i) => i)
  placed.forEach((p, i) => {
    addAligned(pile, orient(p.input, p.reversed), p.aln, colOf, `row${i + 1}`)
    colOf = refColumns(pile.ref!)
  })
  const doc: ContigDoc = toDoc(pile, 'reference', { name: ref.name, tabId: ref.tabId, length: L, circular: ref.circular })
  return { contigs: placed.length ? [{ name: `${ref.name} assembly`, doc }] : [], unplaced }
}

/** Column of every reference base. */
function refColumns(ref: readonly string[]): number[] {
  const out: number[] = []
  for (let c = 0; c < ref.length; c++) if (ref[c] !== '-') out.push(c)
  return out
}
