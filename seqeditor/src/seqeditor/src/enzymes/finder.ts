/**
 * Restriction enzyme site finder.
 *
 * Scans a DNA sequence for recognition sites of selected enzymes.
 * Searches both strands. Returns cut site positions with fragment info.
 */

import { type RestrictionEnzyme, recognitionToRegex } from './db'
import { reverseComplement } from '../models/complement'

export interface CutSite {
  enzyme: RestrictionEnzyme
  /** Start of the recognition site (0-based) on the sense strand. */
  position: number
  /** End of the recognition site (exclusive). */
  end: number
  /** Absolute cut position on the sense strand. */
  fwdCut: number
  /** Absolute cut position on the antisense strand. */
  revCut: number
  /** Which strand the recognition site was found on: 1 = sense, -1 = antisense. */
  strand: 1 | -1
}

/**
 * Find all cut sites for a single enzyme in the given sequence.
 * Searches both strands unless the recognition site is a palindrome
 * (in which case forward matches already cover both strands).
 */
export function findCutSites(
  bases: string,
  enzyme: RestrictionEnzyme,
  topology: 'linear' | 'circular' = 'linear',
): CutSite[] {
  const sites: CutSite[] = []
  const upper = bases.toUpperCase()
  const seqLen = upper.length
  if (seqLen === 0) return sites

  const pattern = new RegExp(recognitionToRegex(enzyme.recognition), 'gi')
  const recLen = enzyme.recognition.length

  // Check if palindromic (recognition == reverse complement of itself)
  const rc = reverseComplement(enzyme.recognition.toUpperCase())
  const isPalindrome = enzyme.recognition.toUpperCase() === rc

  // For circular topology, search across the origin by appending a prefix
  const searchSeq = topology === 'circular'
    ? upper + upper.slice(0, recLen - 1)
    : upper

  // Forward strand
  let m: RegExpExecArray | null
  pattern.lastIndex = 0
  while ((m = pattern.exec(searchSeq)) !== null) {
    const pos = m.index
    if (pos >= seqLen) break // past the real sequence (circular overlap region)
    sites.push({
      enzyme,
      position: pos,
      end: (pos + recLen) % (topology === 'circular' ? seqLen : seqLen + recLen),
      fwdCut: pos + enzyme.fwd_cut,
      revCut: pos + enzyme.rev_cut,
      strand: 1,
    })
    // Prevent overlapping matches from consuming characters
    pattern.lastIndex = m.index + 1
  }

  // Reverse strand (only if not palindromic)
  if (!isPalindrome) {
    const revPattern = new RegExp(recognitionToRegex(rc), 'gi')
    revPattern.lastIndex = 0
    while ((m = revPattern.exec(searchSeq)) !== null) {
      const pos = m.index
      if (pos >= seqLen) break
      // For antisense matches, cut positions are relative to the sense strand
      // The recognition site on the antisense strand at position pos means
      // the enzyme binds the reverse complement there
      sites.push({
        enzyme,
        position: pos,
        end: (pos + recLen) % (topology === 'circular' ? seqLen : seqLen + recLen),
        fwdCut: pos + (recLen - enzyme.rev_cut),
        revCut: pos + (recLen - enzyme.fwd_cut),
        strand: -1,
      })
      revPattern.lastIndex = m.index + 1
    }
  }

  // Sort by position
  sites.sort((a, b) => a.position - b.position)

  // Deduplicate sites at the same position (can happen with palindromes + overlap)
  const deduped: CutSite[] = []
  for (const site of sites) {
    if (deduped.length === 0 || deduped[deduped.length - 1].position !== site.position) {
      deduped.push(site)
    }
  }

  return deduped
}

/**
 * Compute fragment sizes from cut sites.
 */
export function computeFragments(
  seqLen: number,
  sites: CutSite[],
  topology: 'linear' | 'circular' = 'linear',
): number[] {
  if (sites.length === 0) return [seqLen]

  const cutPositions = [...new Set(sites.map(s => s.fwdCut))].sort((a, b) => a - b)

  const fragments: number[] = []
  if (topology === 'circular') {
    for (let i = 0; i < cutPositions.length; i++) {
      const next = cutPositions[(i + 1) % cutPositions.length]
      const curr = cutPositions[i]
      const size = next > curr ? next - curr : seqLen - curr + next
      fragments.push(size)
    }
  } else {
    // Linear: first fragment from 0 to first cut, then between cuts, then last cut to end
    fragments.push(cutPositions[0])
    for (let i = 1; i < cutPositions.length; i++) {
      fragments.push(cutPositions[i] - cutPositions[i - 1])
    }
    fragments.push(seqLen - cutPositions[cutPositions.length - 1])
  }

  return fragments.filter(f => f > 0).sort((a, b) => b - a)
}

/**
/**
 * Find all sites for multiple enzymes, returning a flat list sorted by position.
 */
export function findAllSites(
  bases: string,
  enzymes: RestrictionEnzyme[],
  topology: 'linear' | 'circular' = 'linear',
): CutSite[] {
  const allSites: CutSite[] = []
  for (const enzyme of enzymes) {
    allSites.push(...findCutSites(bases, enzyme, topology))
  }
  return allSites.sort((a, b) => a.position - b.position)
}
