/**
 * Coordinate mapping and consensus utilities for contig (multi-read) views.
 *
 * Maps pairwise read-vs-reference alignments onto a shared reference
 * coordinate system so they can be rendered in a stacked contig view.
 */

import type { AlignmentResult } from './types'

/** A single read's bases mapped onto reference coordinates. */
export interface ReadMapping {
  /** Reference position (0-based) → read base at that position (or null if gap in read). */
  bases: Map<number, string>
  /** First reference position covered by this read. */
  startPos: number
  /** Last reference position covered by this read (inclusive). */
  endPos: number
}

/**
 * Map a pairwise alignment result onto reference coordinates.
 *
 * Walks the aligned reference and read sequences. For each non-gap
 * reference position, records the corresponding read base (or null
 * if the read has a gap there). Read insertions (gaps in reference)
 * are skipped – they only exist in the individual read alignment.
 */
export function buildReadMapping(result: AlignmentResult): ReadMapping {
  const refAligned = result.sequences[0].alignedBases
  const readAligned = result.sequences[1].alignedBases
  const bases = new Map<number, string>()
  let refPos = -1
  let startPos = -1
  let endPos = -1

  for (let i = 0; i < refAligned.length; i++) {
    const refCh = refAligned[i]
    const readCh = readAligned[i]

    if (refCh === '-') {
      // Insertion in read – skip (not shown in contig grid)
      continue
    }

    refPos++

    if (readCh !== '-') {
      bases.set(refPos, readCh)
      if (startPos < 0) startPos = refPos
      endPos = refPos
    }
  }

  return { bases, startPos: Math.max(0, startPos), endPos: Math.max(0, endPos) }
}

/** Per-position consensus and coverage data for a contig. */
export interface ContigStats {
  /** Reference length (number of columns in the contig grid). */
  refLength: number
  /** Per-position coverage depth. */
  coverage: number[]
  /** Per-position majority consensus base. */
  consensus: string[]
  /** Reference positions where at least one read disagrees with the reference. */
  disagreements: number[]
}

/**
 * Compute consensus and coverage across all read mappings.
 *
 * @param refBases - The ungapped reference sequence string.
 * @param mappings - One ReadMapping per read alignment in the contig.
 */
export function computeContigStats(refBases: string, mappings: ReadMapping[]): ContigStats {
  const refLength = refBases.length
  const coverage = new Array<number>(refLength).fill(0)
  const consensus = new Array<string>(refLength)
  const disagreements: number[] = []

  for (let pos = 0; pos < refLength; pos++) {
    const refBase = refBases[pos].toUpperCase()
    const counts = new Map<string, number>()
    let depth = 0

    for (const mapping of mappings) {
      const readBase = mapping.bases.get(pos)
      if (readBase != null) {
        depth++
        const upper = readBase.toUpperCase()
        counts.set(upper, (counts.get(upper) ?? 0) + 1)
      }
    }

    coverage[pos] = depth

    if (depth === 0) {
      // No reads cover this position – consensus is the reference base
      consensus[pos] = refBase
    } else {
      // Majority vote
      let bestBase = refBase
      let bestCount = 0
      for (const [base, count] of counts) {
        if (count > bestCount) {
          bestBase = base
          bestCount = count
        }
      }
      consensus[pos] = bestBase
    }

    // Check if any read disagrees with the reference at this position
    let hasDisagreement = false
    for (const mapping of mappings) {
      const readBase = mapping.bases.get(pos)
      if (readBase != null && readBase.toUpperCase() !== refBase) {
        hasDisagreement = true
        break
      }
    }
    if (hasDisagreement) disagreements.push(pos)
  }

  return { refLength, coverage, consensus, disagreements }
}
