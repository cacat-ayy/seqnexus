/**
 * Restriction enzyme site finder.
 *
 * Scans a DNA sequence for recognition sites of selected enzymes.
 * Searches both strands. Returns cut site positions with fragment info.
 */

import { type RestrictionEnzyme, recognitionToRegex } from './db'
import { reverseComplement } from '../models/complement'

/** Where one double-strand break falls, in top-strand coordinates. */
export interface CutPair {
  fwdCut: number
  revCut: number
}

export interface CutSite {
  enzyme: RestrictionEnzyme
  /** Start of the recognition site (0-based) on the sense strand. */
  position: number
  /** End of the recognition site (exclusive). */
  end: number
  /**
   * Cut position on the sense strand. On a circular sequence always in
   * [0, length): a Type IIS site near the end cuts past the origin.
   */
  fwdCut: number
  /** Cut position on the antisense strand, in sense-strand coordinates; wrapped like fwdCut. */
  revCut: number
  /**
   * A Type IIB enzyme's second break, on the other side of its site, placed
   * like the first. The site is one site; it cuts the molecule twice.
   */
  cut2?: CutPair
  /** Which strand the recognition site was found on: 1 = sense, -1 = antisense. */
  strand: 1 | -1
  /**
   * Set on a linear sequence when the enzyme would cut beyond an end (a Type
   * IIS site near the end). The site is there, but nothing is cut: anything
   * that digests, counts cuts or simulates a gel must skip it.
   */
  offEnd?: true
}

/** Sites that actually cut the molecule. */
export function cuttingSites<T extends Pick<CutSite, 'offEnd'>>(sites: readonly T[]): T[] {
  return sites.filter(s => !s.offEnd)
}

/** The breaks a site makes: one, or two for a Type IIB enzyme. */
export function cutPairs(site: Pick<CutSite, 'fwdCut' | 'revCut' | 'cut2'>): CutPair[] {
  const first = { fwdCut: site.fwdCut, revCut: site.revCut }
  return site.cut2 ? [first, site.cut2] : [first]
}

/**
 * One entry per break: a Type IIB site becomes two entries, the second
 * carrying its second cut pair. For anything that turns sites into
 * fragments, where each break is a boundary.
 */
export function splitCuts(sites: readonly CutSite[]): CutSite[] {
  const out: CutSite[] = []
  for (const site of sites) {
    if (!site.cut2) { out.push(site); continue }
    const { cut2, ...first } = site
    out.push(first, { ...first, fwdCut: cut2.fwdCut, revCut: cut2.revCut })
  }
  return out
}

const outside = (p: number, seqLen: number) => p < 0 || p > seqLen
const wrap = (p: number, seqLen: number) => ((p % seqLen) + seqLen) % seqLen

/**
 * Cut positions as stored: wrapped into the sequence when circular; when
 * linear, as they fall, with `offEnd` set if any of them is outside it.
 */
function placeCuts(
  pairs: [number, number][],
  seqLen: number,
  circular: boolean,
): Pick<CutSite, 'fwdCut' | 'revCut' | 'cut2' | 'offEnd'> {
  const placed = pairs.map(([f, r]) => circular ? [wrap(f, seqLen), wrap(r, seqLen)] : [f, r])
  const [[fwdCut, revCut], second] = placed
  const out: Pick<CutSite, 'fwdCut' | 'revCut' | 'cut2' | 'offEnd'> = { fwdCut, revCut }
  if (second) out.cut2 = { fwdCut: second[0], revCut: second[1] }
  if (!circular && pairs.some(([f, r]) => outside(f, seqLen) || outside(r, seqLen))) out.offEnd = true
  return out
}

/** The enzyme's cut pairs relative to the site's first base, on the strand it was found on. */
function sitePairs(enzyme: RestrictionEnzyme, strand: 1 | -1): [number, number][] {
  const recLen = enzyme.recognition.length
  const pairs: [number, number][] = [[enzyme.fwd_cut, enzyme.rev_cut]]
  if (enzyme.fwd_cut2 !== undefined && enzyme.rev_cut2 !== undefined) pairs.push([enzyme.fwd_cut2, enzyme.rev_cut2])
  // On the antisense strand the site reads backwards: its top-strand cut
  // lands where the sense strand's bottom-strand cut would, mirrored.
  return strand === 1 ? pairs : pairs.map(([f, r]) => [recLen - r, recLen - f])
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

  const recLen = enzyme.recognition.length

  // Check if palindromic (recognition == reverse complement of itself)
  const rc = reverseComplement(enzyme.recognition.toUpperCase())
  const isPalindrome = enzyme.recognition.toUpperCase() === rc

  // For circular topology, search across the origin by appending a prefix
  const circular = topology === 'circular'
  const searchSeq = circular
    ? upper + upper.slice(0, recLen - 1)
    : upper

  const scan = (recognition: string, strand: 1 | -1) => {
    const pattern = new RegExp(recognitionToRegex(recognition), 'gi')
    const pairs = sitePairs(enzyme, strand)
    let m: RegExpExecArray | null
    while ((m = pattern.exec(searchSeq)) !== null) {
      const pos = m.index
      if (pos >= seqLen) break // past the real sequence (circular overlap region)
      sites.push({
        enzyme,
        position: pos,
        end: (pos + recLen) % (circular ? seqLen : seqLen + recLen),
        ...placeCuts(pairs.map(([f, r]) => [pos + f, pos + r]), seqLen, circular),
        strand,
      })
      // Prevent overlapping matches from consuming characters
      pattern.lastIndex = m.index + 1
    }
  }

  scan(enzyme.recognition, 1)
  if (!isPalindrome) scan(rc, -1)

  // Sort by position
  sites.sort((a, b) => a.position - b.position)

  // One site per position and strand. A palindrome is only searched for once,
  // so this only ever keeps the two strands of a site apart: MspJI's CNNR and
  // its reverse complement YNNG both read CAAG, and the enzyme cuts on both
  // sides of it, 13 bases away on each.
  const deduped: CutSite[] = []
  const seen = new Set<string>()
  for (const site of sites) {
    const key = `${site.position}/${site.strand}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(site)
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

  const cuts = new Set<number>()
  for (const site of cuttingSites(sites)) for (const pair of cutPairs(site)) cuts.add(pair.fwdCut)
  const cutPositions = [...cuts].sort((a, b) => a - b)
  if (cutPositions.length === 0) return [seqLen]

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
 * Find all sites for multiple enzymes, returning a flat list sorted by position.
 */
export function findAllSites(
  bases: string,
  enzymes: RestrictionEnzyme[],
  topology: 'linear' | 'circular' = 'linear',
): CutSite[] {
  const allSites: CutSite[] = []
  for (const enzyme of enzymes) {
    // A loop, not push(...sites): a frequent cutter on a genome has hundreds
    // of thousands of sites, more arguments than a call can take.
    for (const site of findCutSites(bases, enzyme, topology)) allSites.push(site)
  }
  return allSites.sort((a, b) => a.position - b.position)
}

/**
 * Most sites one enzyme may have for its sites to be listed and drawn. An
 * enzyme past it (a 4-cutter on a bacterial genome has tens of thousands)
 * is counted, not listed: four million sites from every enzyme on a genome
 * is more than a list or a map can show or anyone can read, and building it
 * stalled the app for minutes.
 */
export const MAX_LISTED_SITES = 5000

export interface EnzymeScan {
  /** Sites of the enzymes within the limit, sorted by position. */
  sites: CutSite[]
  /** Enzymes past the limit, by name, with how many times they cut. */
  tooMany: Map<string, number>
}

/** Sites of several enzymes for display: what the panel lists and the views draw. */
export function scanEnzymes(
  bases: string,
  enzymes: readonly RestrictionEnzyme[],
  topology: 'linear' | 'circular',
  maxSites: number = MAX_LISTED_SITES,
): EnzymeScan {
  const sites: CutSite[] = []
  const tooMany = new Map<string, number>()
  for (const enzyme of enzymes) {
    const found = findCutSites(bases, enzyme, topology)
    if (found.length > maxSites) { tooMany.set(enzyme.name, cuttingSites(found).length); continue }
    for (const site of found) sites.push(site)
  }
  sites.sort((a, b) => a.position - b.position)
  return { sites, tooMany }
}
