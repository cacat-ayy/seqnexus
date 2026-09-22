/**
 * Gibson Assembly simulation.
 *
 * Finds overlapping homology regions between adjacent fragments (ordered),
 * merges them into a single product, and validates the assembly.
 *
 * Includes Tm validation on overlaps (Gibson requires Tm ≥ 48°C for the
 * exonuclease chew-back step) and optional auto-ordering of fragments.
 */

import { reverseComplement } from '../models/complement'
import { calcTm } from '../primers/thermodynamics'
import type { AnnotationData } from '../models/Annotation'
import type { DocumentState } from '../models/Document'
import type { CloningProduct } from './types'
import { productNameFromDocs } from './naming'

export interface GibsonFragment {
  doc: DocumentState
  /** Optional sub-region [start, end). If omitted, uses the full sequence. */
  regionStart?: number
  regionEnd?: number
}

export interface GibsonInput {
  /** Ordered fragments. Adjacent fragments must share terminal homology. */
  fragments: GibsonFragment[]
  /** Minimum overlap length in bp (default: 15). */
  minOverlap?: number
  /** Maximum overlap length to search (default: 80). */
  maxOverlap?: number
  /**
   * Try all permutations of fragments to find a valid assembly order.
   * Feasible for ≤ 6 fragments (720 permutations). When enabled, the
   * best ordering (most overlaps found) is used automatically.
   */
  autoOrder?: boolean
}

export interface OverlapInfo {
  /** Index of the left fragment in the input array. */
  leftIdx: number
  /** Index of the right fragment in the input array. */
  rightIdx: number
  /** Overlap length in bp. */
  length: number
  /** Overlap sequence. */
  sequence: string
  /** Melting temperature of the overlap region (°C). */
  tm: number
}

export interface GibsonResult {
  products: CloningProduct[]
  warnings: string[]
  /** Details about each overlap found between adjacent fragments. */
  overlaps: OverlapInfo[]
}

/**
 * Find the longest suffix of seqA that matches a prefix of seqB.
 * Returns the overlap length, or 0 if none found >= minLen.
 */
export function findOverlap(
  seqA: string,
  seqB: string,
  minLen: number,
  maxLen: number,
): number {
  const maxCheck = Math.min(maxLen, seqA.length, seqB.length)
  const a = seqA.toUpperCase()
  const b = seqB.toUpperCase()
  for (let len = maxCheck; len >= minLen; len--) {
    const suffix = a.slice(-len)
    const prefix = b.slice(0, len)
    if (suffix === prefix) return len
  }
  return 0
}

/**
 * Check for internal homology between non-adjacent fragments that could
 * cause mis-assembly.
 */
function checkInternalHomology(
  sequences: string[],
  minOverlap: number,
  maxOverlap: number,
): string[] {
  const warnings: string[] = []
  for (let i = 0; i < sequences.length; i++) {
    for (let j = i + 2; j < sequences.length; j++) {
      // Skip adjacent pairs (and last↔first which is also adjacent in circular)
      if (i === 0 && j === sequences.length - 1) continue

      // Check suffix of i vs prefix of j
      const fwd = findOverlap(sequences[i], sequences[j], minOverlap, maxOverlap)
      if (fwd > 0) {
        warnings.push(
          `Fragments ${i + 1} and ${j + 1} share ${fwd} bp internal homology – possible mis-assembly`
        )
      }

      // Check suffix of i vs reverse complement of suffix of j (inverted repeat)
      const rcJ = reverseComplement(sequences[j])
      const inv = findOverlap(sequences[i], rcJ, minOverlap, maxOverlap)
      if (inv > 0) {
        warnings.push(
          `Fragments ${i + 1} and ${j + 1} share ${inv} bp inverted repeat – possible mis-assembly`
        )
      }
    }
  }
  return warnings
}

/** Minimum Tm (°C) for a Gibson overlap to work reliably. */
const GIBSON_MIN_TM = 48

/** Maximum number of fragments for auto-ordering (n! grows fast). */
const MAX_AUTO_ORDER_FRAGMENTS = 6

/**
 * Simulate Gibson Assembly.
 */
export function gibsonAssemble(input: GibsonInput): GibsonResult {
  const minOverlap = input.minOverlap ?? 15
  const maxOverlap = input.maxOverlap ?? 80
  const autoOrder = input.autoOrder ?? false
  const warnings: string[] = []

  if (input.fragments.length === 0) {
    return { products: [], warnings: ['No fragments provided'], overlaps: [] }
  }

  if (input.fragments.length === 1) {
    const frag = input.fragments[0]
    const seq = extractRegion(frag)
    const selfOverlap = findOverlap(seq, seq, minOverlap, maxOverlap)
    if (selfOverlap > 0) {
      const overlapSeq = seq.slice(seq.length - selfOverlap)
      const tm = calcTm(overlapSeq)
      if (tm < GIBSON_MIN_TM) {
        warnings.push(
          `Self-circularization overlap Tm is ${tm.toFixed(1)}°C (need ≥ ${GIBSON_MIN_TM}°C) – assembly may fail`
        )
      }
      const body = seq.slice(0, seq.length - selfOverlap)
      return {
        products: [{
          name: frag.doc.name,
          sequence: body,
          topology: 'circular',
          annotations: transferAnnotations(frag.doc, frag.regionStart, frag.regionEnd),
          size: body.length,
          isExpected: true,
          description: `Self-circularization of ${frag.doc.name}`,
        }],
        warnings,
        overlaps: [{
          leftIdx: 0, rightIdx: 0,
          length: selfOverlap, sequence: overlapSeq, tm,
        }],
      }
    }
    return { products: [], warnings: ['Single fragment with no self-homology – cannot assemble'], overlaps: [] }
  }

  // Auto-ordering: try all permutations and pick the one with the most valid overlaps
  let fragments = input.fragments
  if (autoOrder && fragments.length <= MAX_AUTO_ORDER_FRAGMENTS && fragments.length > 2) {
    const best = findBestOrder(fragments, minOverlap, maxOverlap)
    if (best) {
      fragments = best
      warnings.push('Fragments were automatically reordered for optimal assembly')
    }
  }

  // Extract sequences for each fragment
  const sequences = fragments.map(f => extractRegion(f))

  // Find overlaps between adjacent fragments
  const overlapLengths: number[] = []
  const overlapInfos: OverlapInfo[] = []
  let allValid = true

  for (let i = 0; i < sequences.length - 1; i++) {
    const overlap = findOverlap(sequences[i], sequences[i + 1], minOverlap, maxOverlap)
    overlapLengths.push(overlap)
    if (overlap === 0) {
      warnings.push(
        `Insufficient homology between fragments ${i + 1} and ${i + 2} (need ≥ ${minOverlap} bp)`
      )
      allValid = false
      overlapInfos.push({ leftIdx: i, rightIdx: i + 1, length: 0, sequence: '', tm: 0 })
    } else {
      const overlapSeq = sequences[i].slice(-overlap)
      const tm = calcTm(overlapSeq)
      overlapInfos.push({ leftIdx: i, rightIdx: i + 1, length: overlap, sequence: overlapSeq, tm })

      if (tm < GIBSON_MIN_TM) {
        warnings.push(
          `Overlap between fragments ${i + 1} and ${i + 2} has Tm ${tm.toFixed(1)}°C (need ≥ ${GIBSON_MIN_TM}°C) – assembly may fail`
        )
      }
      if (overlap > 40) {
        warnings.push(
          `Long overlap (${overlap} bp) between fragments ${i + 1} and ${i + 2} – verify this is intentional`
        )
      }
    }
  }

  // Check last↔first overlap for circular assembly
  const circularOverlap = findOverlap(
    sequences[sequences.length - 1],
    sequences[0],
    minOverlap,
    maxOverlap,
  )

  if (circularOverlap > 0) {
    const circOverlapSeq = sequences[sequences.length - 1].slice(-circularOverlap)
    const circTm = calcTm(circOverlapSeq)
    overlapInfos.push({
      leftIdx: sequences.length - 1, rightIdx: 0,
      length: circularOverlap, sequence: circOverlapSeq, tm: circTm,
    })
    if (circTm < GIBSON_MIN_TM) {
      warnings.push(
        `Circular junction overlap has Tm ${circTm.toFixed(1)}°C (need ≥ ${GIBSON_MIN_TM}°C) – assembly may fail`
      )
    }
  }

  // Check for internal homology
  warnings.push(...checkInternalHomology(sequences, minOverlap, maxOverlap))

  if (!allValid) {
    return { products: [], warnings, overlaps: overlapInfos }
  }

  // Assemble: concatenate fragments, removing overlap regions
  let assembled = sequences[0]
  let annOffset = 0
  const allAnnotations: AnnotationData[] = []

  const frag0 = fragments[0]
  allAnnotations.push(
    ...transferAnnotations(frag0.doc, frag0.regionStart, frag0.regionEnd)
  )

  for (let i = 1; i < sequences.length; i++) {
    const overlap = overlapLengths[i - 1]
    const newPart = sequences[i].slice(overlap)
    annOffset = assembled.length

    const frag = fragments[i]
    const fragAnns = transferAnnotations(frag.doc, frag.regionStart, frag.regionEnd)
    for (const ann of fragAnns) {
      // Skip annotations entirely within the overlap region
      if (ann.end <= overlap) continue
      // Truncate annotations that partially overlap
      const clampStart = Math.max(ann.start, overlap)
      const truncated = clampStart !== ann.start
      allAnnotations.push({
        ...ann,
        id: `${ann.id}_gibson_${i}`,
        start: clampStart - overlap + annOffset,
        end: ann.end - overlap + annOffset,
        ...(truncated ? { truncated: true } : {}),
      })
    }

    assembled += newPart
  }

  const products: CloningProduct[] = []

  if (circularOverlap > 0) {
    const circularSeq = assembled.slice(0, assembled.length - circularOverlap)
    const circAnns = allAnnotations.filter(a => a.end <= circularSeq.length)
    const docInfos = fragments.map(f => ({ name: f.doc.name, topology: f.doc.sequence.topology, seqLength: f.doc.sequence.length }))
    products.push({
      name: productNameFromDocs(docInfos),
      sequence: circularSeq,
      topology: 'circular',
      annotations: circAnns,
      size: circularSeq.length,
      isExpected: true,
      description: `Gibson assembly of ${fragments.map(f => f.doc.name).join(' + ')}`,
    })
  }

  const docInfos = fragments.map(f => ({ name: f.doc.name, topology: f.doc.sequence.topology, seqLength: f.doc.sequence.length }))
  products.push({
    name: productNameFromDocs(docInfos),
    sequence: assembled,
    topology: 'linear',
    annotations: allAnnotations,
    size: assembled.length,
    isExpected: circularOverlap === 0,
    description: `Linear Gibson assembly of ${fragments.map(f => f.doc.name).join(' + ')}`,
  })

  products.sort((a, b) => {
    if (a.isExpected !== b.isExpected) return a.isExpected ? -1 : 1
    return b.size - a.size
  })

  return { products, warnings, overlaps: overlapInfos }
}

/**
 * Try all permutations of fragments and return the ordering with the most
 * valid adjacent overlaps. Returns null if no ordering improves on the input.
 */
function findBestOrder(
  fragments: GibsonFragment[],
  minOverlap: number,
  maxOverlap: number,
): GibsonFragment[] | null {
  const sequences = fragments.map(f => extractRegion(f))
  const n = sequences.length

  // Pre-compute overlap matrix
  const overlapMatrix: number[][] = Array.from({ length: n }, () => new Array(n).fill(0))
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue
      overlapMatrix[i][j] = findOverlap(sequences[i], sequences[j], minOverlap, maxOverlap)
    }
  }

  // Score the original ordering.
  // Adjacent overlaps are weighted 10x more than circular closure because
  // all adjacent overlaps must be valid for assembly, while circular closure
  // is optional (produces circular vs linear product).
  function scoreOrder(perm: number[]): number {
    let score = 0
    for (let i = 0; i < perm.length - 1; i++) {
      if (overlapMatrix[perm[i]][perm[i + 1]] > 0) score += 10
    }
    // Circular closure bonus (lower weight – nice to have, not required)
    if (overlapMatrix[perm[perm.length - 1]][perm[0]] > 0) score += 1
    return score
  }

  const originalOrder = fragments.map((_, i) => i)
  let bestScore = scoreOrder(originalOrder)
  let bestPerm = originalOrder

  // Generate permutations (Heap's algorithm)
  const perm = [...originalOrder]
  const c = new Array(n).fill(0)
  let i = 0
  while (i < n) {
    if (c[i] < i) {
      const swapIdx = i % 2 === 0 ? 0 : c[i]
      ;[perm[swapIdx], perm[i]] = [perm[i], perm[swapIdx]]
      const score = scoreOrder(perm)
      if (score > bestScore) {
        bestScore = score
        bestPerm = [...perm]
      }
      c[i]++
      i = 0
    } else {
      c[i] = 0
      i++
    }
  }

  if (bestPerm === originalOrder) return null
  return bestPerm.map(i => fragments[i])
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractRegion(frag: { doc: DocumentState; regionStart?: number; regionEnd?: number }): string {
  const bases = frag.doc.sequence.bases
  if (frag.regionStart !== undefined && frag.regionEnd !== undefined) {
    return bases.slice(frag.regionStart, frag.regionEnd)
  }
  return bases
}

/**
 * Transfer annotations from a document that overlap with [regionStart, regionEnd),
 * adjusting coordinates to be relative to the region. Annotations that partially
 * overlap a boundary are truncated and marked with `truncated: true`.
 */
function transferAnnotations(
  doc: DocumentState,
  regionStart: number | undefined,
  regionEnd: number | undefined,
): AnnotationData[] {
  const start = regionStart ?? 0
  const end = regionEnd ?? doc.sequence.length
  const result: AnnotationData[] = []

  for (const ann of doc.annotations) {
    const data = ann.toData()
    // Skip origin-spanning annotations
    if (data.start > data.end) continue
    // Check for any overlap with [start, end)
    if (data.end > start && data.start < end) {
      const clampStart = Math.max(data.start, start)
      const clampEnd = Math.min(data.end, end)
      const truncated = clampStart !== data.start || clampEnd !== data.end
      if (clampEnd > clampStart) {
        result.push({
          ...data,
          start: clampStart - start,
          end: clampEnd - start,
          ...(truncated ? { truncated: true } : {}),
        })
      }
    }
  }

  return result
}
