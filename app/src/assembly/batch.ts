/**
 * Assembling a plate: reads grouped into clones by name, several
 * references, one contig per clone.
 *
 * Mapping to several references, every read of a clone goes to the same
 * one, the reference the clone's reads match best: a clone is one
 * construct, and letting each read choose would split a clone whose reads
 * cover different parts of near-identical designs. The choice is made in
 * two steps:
 *
 * 1. Seeds. Each read is seeded on both strands against every reference
 *    and its best diagonal's votes are summed per reference. A read across
 *    the junction of a shared vector and its insert lines up on one
 *    diagonal only in the right construct, so the insert decides. A clone
 *    with no seed on any reference is left out.
 * 2. Alignment. When other references come close to the best one (within
 *    a fifth of its votes, as point mutants of one design do), the clone is
 *    mapped to each of them and the reference its reads agree with best is
 *    kept: matching bases count one, mismatched ones and gaps cost two.
 *    Seeds alone cannot tell designs that differ in a base or two apart.
 *
 * Without grouping, each read is a clone of its own for the choice, and the
 * reads that chose the same reference make one contig with it, as Geneious
 * maps reads to several references ("each read to the sequence with the
 * best match only, one contig per reference").
 *
 * De novo, each clone is assembled on its own, so reads of different clones
 * are never joined however alike they are.
 */

import { kmerIndex, seedBothStrands } from './align'
import { assembleDeNovo } from './denovo'
import { groupByName, type NameGrouping } from './groups'
import { mapToReference, type MapReference } from './map'
import type { AssemblyInput, AssemblyReport, AssemblySettings, ContigDoc } from './types'

export interface BatchRequest {
  mode: 'reference' | 'de-novo'
  /** Mapping: the references to choose from (one or more). */
  references: MapReference[]
  inputs: AssemblyInput[]
  /** Null assembles all reads together (de novo) or each read to its best reference. */
  grouping: NameGrouping | null
  settings: AssemblySettings
}

/** Other references are aligned to when their seed votes reach this share of the best. */
export const CLOSE_VOTES = 0.8
/** Fewest seed votes on a reference for a read to count as matching it at all. */
const MIN_VOTES = 3

interface IndexedReference {
  ref: MapReference
  index: Map<number, number[]>
}

function indexReference(ref: MapReference, k: number): IndexedReference {
  const bases = ref.bases.toUpperCase()
  // Wide enough for a Sanger read across the origin of a circular reference.
  const target = ref.circular ? bases + bases.slice(0, Math.min(bases.length, 1200)) : bases
  return { ref, index: kmerIndex(target, k) }
}

/** Longest open sequence looked at when guessing which ones the reads match. */
const GUESS_MAX_LENGTH = 200_000
/** Reads looked at when guessing. */
const GUESS_READS = 24
/** Seed votes a read needs on a sequence to count as matching it in a guess: a stretch of about 30 matching bases. */
const GUESS_VOTES = 20

/**
 * Which of some sequences the reads come from, to tick them as references
 * before the user chooses: those at least one of the first reads seeds on
 * well. Sequences longer than a plasmid or a small genome are not looked at.
 */
export function guessReferences(reads: readonly AssemblyInput[], candidates: readonly { bases: string; circular: boolean }[], k = 12): boolean[] {
  const sample = reads.slice(0, GUESS_READS)
  return candidates.map(c => {
    if (c.bases.length > GUESS_MAX_LENGTH || c.bases.length < k) return false
    const { index } = indexReference({ name: '', tabId: null, bases: c.bases, circular: c.circular }, k)
    return sample.some(r => (seedBothStrands(r.seq, index, k, GUESS_VOTES)?.seed.votes ?? 0) >= GUESS_VOTES)
  })
}

/** Seed votes of a set of reads on each reference: each read's best diagonal, either strand. */
export function referenceVotes(reads: readonly AssemblyInput[], refs: readonly IndexedReference[], k: number): number[] {
  return refs.map(r => reads.reduce((sum, read) => sum + (seedBothStrands(read.seq, r.index, k, MIN_VOTES)?.seed.votes ?? 0), 0))
}

/**
 * How well a contig's reads agree with its reference: matching bases count
 * one, mismatched bases and gaps (in the read or the reference) cost two.
 */
export function referenceAgreement(doc: ContigDoc): number {
  const ref = doc.reference?.seq
  if (!ref) return 0
  let score = 0
  for (const r of doc.rows) {
    for (let k = 0; k < r.seq.length; k++) {
      const a = r.seq[k]
      const b = ref[r.start + k]
      if (a === '-' && b === '-') continue
      score += a === b ? 1 : -2
    }
  }
  return score
}

/**
 * A read left out by the mapper, its reason saying which reference it was
 * held against when there were several ("Only 62% identical to pX12, the
 * closest reference").
 */
function reasonAgainst(u: AssemblyReport['unplaced'][number], refName: string, several: boolean): AssemblyReport['unplaced'][number] {
  if (!several) return u
  if (u.reason === 'No match to the reference') return { ...u, reason: 'No match to any of the references' }
  return { ...u, reason: u.reason.replace('to the reference', `to ${refName}, the closest reference`) }
}

/**
 * The reference a clone's reads go to, with them mapped to it, or null
 * when they seed on none.
 */
function mapToBest(
  reads: AssemblyInput[], refs: readonly IndexedReference[], s: AssemblySettings,
): { refIndex: number; report: AssemblyReport } | null {
  const votes = referenceVotes(reads, refs, s.k)
  const top = Math.max(0, ...votes)
  if (top === 0) return null
  const close = votes.flatMap((v, i) => (v >= top * CLOSE_VOTES ? [i] : []))
  let best: { refIndex: number; report: AssemblyReport; score: number } | null = null
  for (const i of close) {
    const report = mapToReference(refs[i].ref, reads, s)
    const placed = report.contigs[0]?.doc
    // A reference that places no read loses to any that places one.
    const score = placed ? referenceAgreement(placed) : -Infinity
    if (!best || score > best.score || (score === best.score && votes[i] > votes[best.refIndex])) best = { refIndex: i, report, score }
  }
  return best && { refIndex: best.refIndex, report: best.report }
}

export function assembleBatch(req: BatchRequest, onProgress?: (done: number, total: number) => void): AssemblyReport {
  const s = req.settings
  const contigs: AssemblyReport['contigs'] = []
  const unplaced: AssemblyReport['unplaced'] = []
  const groups = req.grouping
    ? groupByName(req.inputs, r => r.name, req.grouping)
    : [{ key: '', items: req.inputs }]

  if (req.mode === 'de-novo') {
    groups.forEach((g, n) => {
      onProgress?.(n, groups.length)
      const report = assembleDeNovo(g.items, s)
      unplaced.push(...report.unplaced)
      report.contigs.forEach((c, i) => {
        const name = !g.key ? c.name : report.contigs.length === 1 ? g.key : `${g.key} ${i + 1}`
        contigs.push({ name, doc: c.doc })
      })
    })
    onProgress?.(groups.length, groups.length)
    return { contigs, unplaced }
  }

  if (req.references.length === 0) throw new Error('Choose a reference to map to')
  const refs = req.references.map(r => indexReference(r, s.k))
  const noMatch = req.references.length === 1 ? 'No match to the reference' : 'No match to any of the references'

  if (req.grouping) {
    groups.forEach((g, n) => {
      onProgress?.(n, groups.length)
      const best = mapToBest(g.items, refs, s)
      if (!best) {
        for (const r of g.items) unplaced.push({ name: r.name, readId: r.readId, reason: noMatch })
        return
      }
      unplaced.push(...best.report.unplaced.map(u => reasonAgainst(u, refs[best.refIndex].ref.name, refs.length > 1)))
      const doc = best.report.contigs[0]?.doc
      if (doc) contigs.push({ name: g.key, doc })
    })
    onProgress?.(groups.length, groups.length)
    return { contigs, unplaced }
  }

  // Each read to its best reference, then one contig per reference.
  const chosen: AssemblyInput[][] = refs.map(() => [])
  req.inputs.forEach((read, n) => {
    onProgress?.(n, req.inputs.length * 2)
    const best = refs.length === 1 ? { refIndex: 0 } : mapToBest([read], refs, s)
    if (!best) unplaced.push({ name: read.name, readId: read.readId, reason: noMatch })
    else chosen[best.refIndex].push(read)
  })
  chosen.forEach((reads, i) => {
    onProgress?.(req.inputs.length + i * req.inputs.length / refs.length, req.inputs.length * 2)
    if (reads.length === 0) return
    const report = mapToReference(refs[i].ref, reads, s)
    unplaced.push(...report.unplaced.map(u => reasonAgainst(u, refs[i].ref.name, refs.length > 1)))
    contigs.push(...report.contigs)
  })
  onProgress?.(1, 1)
  return { contigs, unplaced }
}
