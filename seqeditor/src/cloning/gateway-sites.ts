/**
 * Gateway att site consensus sequences and pattern-matching scanner.
 *
 * att sites are ~25 bp core recognition regions used by the λ integrase
 * family of recombinases. This module stores the consensus sequences for
 * attB, attP, attL, and attR sites (numbered 1–4 for MultiSite Gateway)
 * and provides a scanner that finds them in arbitrary DNA sequences with
 * up to 2 mismatches.
 */

import { reverseComplement } from '../models/complement'

// ---------------------------------------------------------------------------
// att site definitions
// ---------------------------------------------------------------------------

export type AttSiteType = 'attB' | 'attP' | 'attL' | 'attR'

export interface AttSiteDefinition {
  /** e.g. 'attB1', 'attL2', 'attR1' */
  name: string
  type: AttSiteType
  /** Numbered variant (1, 2, 3, 4) for MultiSite pairing */
  number: number
  /** Core recognition sequence (sense strand, 5'→3') */
  core: string
}

export interface AttSiteMatch {
  /** The site definition that matched */
  site: AttSiteDefinition
  /** Start position in the scanned sequence (0-based) */
  start: number
  /** End position (exclusive) */
  end: number
  /** Whether the match is on the reverse complement strand */
  reverseStrand: boolean
  /** Number of mismatches in the match */
  mismatches: number
}

/**
 * Core recognition sequences for Gateway att sites.
 *
 * These are the minimal sequences used for pattern matching. In a real
 * recombination, the full att sites include flanking arms (P and P' for
 * attP/attR, B and B' for attB/attL), but the core is sufficient for
 * identification.
 *
 * Sources: Invitrogen Gateway Technology manual, Hartley et al. (2000).
 */
export const ATT_SITES: AttSiteDefinition[] = [
  // attB sites (on PCR products / expression clones)
  { name: 'attB1', type: 'attB', number: 1, core: 'ACAAGTTTGTACAAAAAAGCAGGCT' },
  { name: 'attB2', type: 'attB', number: 2, core: 'ACCACTTTGTACAAGAAAGCTGGGT' },
  { name: 'attB3', type: 'attB', number: 3, core: 'ACAACTTTGTATAATAAAGTTG' },
  { name: 'attB4', type: 'attB', number: 4, core: 'ACAACTTTGTATAGAAAAGTTG' },

  // attP sites (on donor vectors)
  { name: 'attP1', type: 'attP', number: 1, core: 'ACAAGTTTGTACAAAAAAGCTGAAC' },
  { name: 'attP2', type: 'attP', number: 2, core: 'ACCACTTTGTACAAGAAAGCTGAAC' },
  { name: 'attP3', type: 'attP', number: 3, core: 'ACAACTTTGTATAATAAAGTTGGC' },
  { name: 'attP4', type: 'attP', number: 4, core: 'ACAACTTTGTATAGAAAAGTTGGC' },

  // attL sites (on entry clones – attB-half + attP-half)
  { name: 'attL1', type: 'attL', number: 1, core: 'ACAAGTTTGTACAAAAAAGCAGGCTCCGCGG' },
  { name: 'attL2', type: 'attL', number: 2, core: 'ACCCAGCTTTCTTGTACAAAGTTGGCATTA' },
  { name: 'attL3', type: 'attL', number: 3, core: 'ACAACTTTGTATAATAAAGTTGAAC' },
  { name: 'attL4', type: 'attL', number: 4, core: 'ACAACTTTGTATAGAAAAGTTGAAC' },

  // attR sites (on destination vectors – attP-half + attB-half)
  { name: 'attR1', type: 'attR', number: 1, core: 'ACAAGTTTGTACAAAAAAGCTGAACGAGAAAC' },
  { name: 'attR2', type: 'attR', number: 2, core: 'ACCACTTTGTACAAGAAAGCTGAACGAGAAAC' },
  { name: 'attR3', type: 'attR', number: 3, core: 'ACAACTTTGTATAATAAAGTTGGCAGTAAAC' },
  { name: 'attR4', type: 'attR', number: 4, core: 'ACAACTTTGTATAGAAAAGTTGGCAGTAAAC' },
]

// ---------------------------------------------------------------------------
// Pattern matching
// ---------------------------------------------------------------------------

const MAX_MISMATCHES = 2

/**
 * Count mismatches between two equal-length strings (case-insensitive).
 */
function countMismatches(a: string, b: string): number {
  let count = 0
  for (let i = 0; i < a.length; i++) {
    if (a[i].toUpperCase() !== b[i].toUpperCase()) count++
  }
  return count
}

/**
 * Scan a DNA sequence for all att sites of the given types.
 *
 * Searches both strands. Returns matches sorted by position.
 *
 * @param sequence - DNA sequence to scan
 * @param types - Which att site types to look for (e.g., ['attB', 'attP'])
 * @param maxMismatches - Maximum allowed mismatches (default: 2)
 */
export function findAttSites(
  sequence: string,
  types: AttSiteType[],
  maxMismatches: number = MAX_MISMATCHES,
): AttSiteMatch[] {
  const matches: AttSiteMatch[] = []
  const seq = sequence.toUpperCase()
  const rc = reverseComplement(seq)

  const sites = ATT_SITES.filter(s => types.includes(s.type))

  for (const site of sites) {
    const core = site.core.toUpperCase()
    const coreLen = core.length

    if (coreLen > seq.length) continue

    // Scan forward strand
    for (let i = 0; i <= seq.length - coreLen; i++) {
      const window = seq.slice(i, i + coreLen)
      const mm = countMismatches(window, core)
      if (mm <= maxMismatches) {
        matches.push({
          site,
          start: i,
          end: i + coreLen,
          reverseStrand: false,
          mismatches: mm,
        })
      }
    }

    // Scan reverse complement strand
    for (let i = 0; i <= rc.length - coreLen; i++) {
      const window = rc.slice(i, i + coreLen)
      const mm = countMismatches(window, core)
      if (mm <= maxMismatches) {
        // Convert RC position back to forward-strand coordinates
        const fwdStart = seq.length - i - coreLen
        const fwdEnd = seq.length - i
        matches.push({
          site,
          start: fwdStart,
          end: fwdEnd,
          reverseStrand: true,
          mismatches: mm,
        })
      }
    }
  }

  // Sort by position, then by mismatch count (prefer exact matches)
  matches.sort((a, b) => a.start - b.start || a.mismatches - b.mismatches)

  // Deduplicate: if two matches for the same site type overlap, keep the
  // one with fewer mismatches
  const deduped: AttSiteMatch[] = []
  for (const m of matches) {
    const dominated = deduped.some(
      d =>
        d.site.name === m.site.name &&
        d.reverseStrand === m.reverseStrand &&
        Math.abs(d.start - m.start) < 5 &&
        d.mismatches <= m.mismatches,
    )
    if (!dominated) deduped.push(m)
  }

  return deduped
}

/**
 * Get the recombination partner type for a given att site type.
 * BP reaction: attB × attP → attL + attR
 * LR reaction: attL × attR → attB + attP
 */
