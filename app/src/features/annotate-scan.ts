/**
 * Where a list of known annotation sequences occur in a document, on either
 * strand, allowing mismatches. A k-mer index of the document picks candidate
 * positions for each reference and a full comparison confirms them, so a
 * long document is not scanned base by base for every reference. Runs in the
 * annotate-list worker, or on the page when no worker can start.
 */

import { reverseComplement } from '../models/complement'
import { IUPAC } from '../models/iupac'

export interface ReferenceAnnotation {
  name: string
  type: string
  sequence: string  // nucleotide sequence of the annotation
  color?: string
  /**
   * The element this reference is a version of, when a library holds several
   * (the lacZ alpha of pUC19 and of pBluescript). Overlapping hits of one
   * group and type are one feature, like overlapping hits of one reference.
   */
  group?: string
}

export interface AnnotateListRequest {
  documentBases: string
  references: ReferenceAnnotation[]
  minSimilarity: number  // 0-100 (percentage)
  bestMatchOnly: boolean // if true, keep only the best match per reference per location
  /** Residues rather than bases: one strand, no reverse complement. */
  protein?: boolean
  /** The document is circular, so a hit may run across its origin. */
  circular?: boolean
}

export interface AnnotationMatch {
  refName: string
  refType: string
  /** 0-based start in the document. */
  start: number
  /**
   * Exclusive end. Smaller than `start` when the hit runs across the origin
   * of a circular document, the way an origin-spanning feature is stored.
   */
  end: number
  strand: 1 | -1
  /** Percent identity over the whole reference: the number the threshold applies to. */
  similarity: number
  color?: string
  /**
   * Percent of the reference the reported span covers, present only when it
   * is less than all of it: a copy with an end missing, trimmed to the part
   * that is there.
   */
  coverage?: number
}

/**
 * DNA references shorter than this are matched exactly, as short peptides
 * are. One mismatch in a 9 bp element leaves a 9-mer that turns up every few
 * kilobases of any DNA, so a near hit says nothing. Twenty bases carry about
 * the information of the ten residues below which a peptide is matched
 * exactly.
 */
export const EXACT_BELOW_BP = 20

/**
 * A DNA reference is not searched in a document where it would be expected
 * to occur by chance this often (both strands, at the threshold it is
 * matched at). A hit that random sequence of this length would produce
 * anyway is no evidence of the element. Long references never come near it;
 * short ones are searched in a plasmid and skipped in a genome.
 */
export const MAX_CHANCE_COPIES = 0.05

/**
 * A candidate start is compared base by base when it has at least this share
 * of the k-mer votes a copy at the threshold is expected to give. A copy at
 * identity p shares about p^k of its k-mers with the reference, not p of
 * them, so the expectation is clean k-mers x p^k. The share leaves room for
 * mismatches that fall unevenly.
 */
const SEED_SHARE = 0.25

/** An end of a hit is trimmed only when at least this many bases go. */
const MIN_TRIM = 10

/** Bit sets of the bases each IUPAC code allows: A 1, C 2, G 4, T 8. */
const MASK = new Uint8Array(128)
{
  const bit: Record<string, number> = { A: 1, C: 2, G: 4, T: 8 }
  for (const [code, bases] of Object.entries(IUPAC)) {
    let m = 0
    for (const b of bases) m |= bit[b]
    MASK[code.charCodeAt(0)] = m
  }
  MASK['U'.charCodeAt(0)] = bit.T
}
const isPlainBase = (m: number) => m !== 0 && (m & (m - 1)) === 0
const hasCodes = (s: string) => /[^ACGT]/.test(s)

/**
 * Does reference letter `r` accept document letter `d`? An ambiguity code in
 * the reference accepts any base it stands for; an ambiguity code in the
 * document is an unknown base, and matches only the same letter.
 */
function accepts(r: number, d: number): boolean {
  if (r === d) return true
  const dm = MASK[d]
  return isPlainBase(dm) && (MASK[r] & dm) !== 0
}

/**
 * Matches of `ref` against `s` at `at`, or -1 as soon as the mismatches
 * exceed `maxMismatches`.
 */
function countMatches(ref: string, s: string, at: number, maxMismatches: number, degenerate: boolean): number {
  let mismatches = 0
  let matches = 0
  for (let i = 0; i < ref.length; i++) {
    const r = ref.charCodeAt(i)
    const d = s.charCodeAt(at + i)
    if (r === d || (degenerate && accepts(r, d))) matches++
    else if (++mismatches > maxMismatches) return -1
  }
  return matches
}

/**
 * Bases to drop from each end of an accepted hit: the stretch at either end
 * whose mismatches outnumber its matches (score +1 / -1), as long as at
 * least MIN_TRIM bases go. A copy whose last 10% is missing is still above a
 * 85% threshold over the whole reference, and would otherwise be reported
 * running on into whatever follows it.
 */
function trimEnds(ref: string, s: string, at: number, degenerate: boolean): [number, number] {
  const n = ref.length
  const hit = (i: number) => {
    const r = ref.charCodeAt(i), d = s.charCodeAt(at + i)
    return r === d || (degenerate && accepts(r, d))
  }
  let sum = 0, min = 0, left = 0
  for (let i = 0; i < n; i++) {
    sum += hit(i) ? 1 : -1
    if (sum < min) { min = sum; left = i + 1 }
  }
  sum = 0; min = 0
  let right = 0
  for (let i = n - 1; i >= left; i--) {
    sum += hit(i) ? 1 : -1
    if (sum < min) { min = sum; right = n - i }
  }
  return [left >= MIN_TRIM ? left : 0, right >= MIN_TRIM ? right : 0]
}

/**
 * How many copies of `ref` random sequence of `positions` starts on two
 * strands would hold, allowing `maxMismatches`. Each position matches with
 * the share of the four bases its code allows. Zero for anything long, where
 * the number is too small to matter and costly to compute.
 */
function expectedChanceCopies(ref: string, positions: number, maxMismatches: number): number {
  if (ref.length > 60) return 0
  // dp[j]: probability of exactly j mismatches so far.
  let dp = new Float64Array(maxMismatches + 1)
  dp[0] = 1
  for (let i = 0; i < ref.length; i++) {
    const m = MASK[ref.charCodeAt(i)]
    let bits = 0
    for (let b = m; b; b &= b - 1) bits++
    const q = (bits || 1) / 4
    const next = new Float64Array(maxMismatches + 1)
    for (let j = 0; j <= maxMismatches; j++) {
      next[j] += dp[j] * q
      if (j + 1 <= maxMismatches) next[j + 1] += dp[j] * (1 - q)
    }
    dp = next
  }
  let p = 0
  for (const v of dp) p += v
  return 2 * positions * p
}

/** Each k-mer of `seq` and where it occurs; k-mers holding an ambiguity code are left out. */
function kmerPositions(seq: string, k: number, skipCodes: boolean): Map<string, number[]> {
  const index = new Map<string, number[]>()
  for (let i = 0; i <= seq.length - k; i++) {
    const kmer = seq.slice(i, i + k)
    if (skipCodes && hasCodes(kmer)) continue
    let positions = index.get(kmer)
    if (!positions) {
      positions = []
      index.set(kmer, positions)
    }
    positions.push(i)
  }
  return index
}

/**
 * Candidate starts below `starts` (the document length) where `ref` might
 * match: every start that collects enough k-mer votes, or every start of all
 * when the reference has no clean k-mer to seed with.
 */
function candidateStarts(
  searchLen: number,
  starts: number,
  ref: string,
  refKmers: Map<string, number[]>,
  docIndex: Map<string, number[]>,
  k: number,
  minSimilarity: number,
): number[] {
  const refLen = ref.length
  const last = Math.min(starts - 1, searchLen - refLen)
  let cleanKmers = 0
  for (const list of refKmers.values()) cleanKmers += list.length
  if (cleanKmers === 0) {
    const all: number[] = []
    for (let i = 0; i <= last; i++) all.push(i)
    return all
  }

  // Each shared k-mer (refPos, docPos) votes for the start docPos - refPos.
  const votes = new Map<number, number>()
  for (const [kmer, refPositions] of refKmers) {
    const docPositions = docIndex.get(kmer)
    if (!docPositions) continue
    for (const rj of refPositions) {
      for (const dp of docPositions) {
        const cs = dp - rj
        if (cs < 0 || cs > last) continue
        votes.set(cs, (votes.get(cs) ?? 0) + 1)
      }
    }
  }

  const p = minSimilarity / 100
  const minVotes = Math.max(1, Math.floor(cleanKmers * Math.pow(p, k) * SEED_SHARE))
  const out: number[] = []
  for (const [pos, n] of votes) if (n >= minVotes) out.push(pos)
  return out
}

/** A hit in search coordinates: start below the document length, end up to start + reference length. */
type RawMatch = AnnotationMatch

function searchReference(
  search: string,
  docLen: number,
  ref: ReferenceAnnotation,
  docIndex: Map<string, number[]>,
  k: number,
  minSimilarity: number,
  protein: boolean,
): RawMatch[] {
  const refUpper = ref.sequence.toUpperCase()
  const refLen = refUpper.length
  if (refLen === 0 || refLen > docLen) return []
  const degenerate = !protein && hasCodes(refUpper)
  const maxMismatches = Math.floor(refLen * (1 - minSimilarity / 100) + 1e-9)
  const out: RawMatch[] = []

  const strands: [string, 1 | -1][] = protein
    ? [[refUpper, 1]]
    : [[refUpper, 1], [reverseComplement(refUpper), -1]]
  for (const [query, strand] of strands) {
    const refKmers = kmerPositions(query, k, !protein)
    for (const pos of candidateStarts(search.length, docLen, query, refKmers, docIndex, k, minSimilarity)) {
      const matches = countMatches(query, search, pos, maxMismatches, degenerate)
      if (matches < 0) continue
      const sim = (matches / refLen) * 100
      if (sim < minSimilarity) continue
      const [left, right] = protein ? [0, 0] : trimEnds(query, search, pos, degenerate)
      const m: RawMatch = {
        refName: ref.name,
        refType: ref.type,
        start: pos + left,
        end: pos + refLen - right,
        strand,
        similarity: Math.round(sim * 10) / 10,
        color: ref.color,
      }
      if (left + right > 0) m.coverage = Math.round(((refLen - left - right) / refLen) * 1000) / 10
      out.push(m)
    }
  }
  return out
}

/** Overlap of two spans in search coordinates, allowing for the wrap of a circular document. */
function overlapOf(a: RawMatch, b: RawMatch, wrapLen: number): number {
  const lin = (s: number, e: number) => Math.max(0, Math.min(a.end, e) - Math.max(a.start, s))
  let ov = lin(b.start, b.end)
  if (wrapLen > 0) ov = Math.max(ov, lin(b.start + wrapLen, b.end + wrapLen), lin(b.start - wrapLen, b.end - wrapLen))
  return ov
}

/**
 * One match per stretch: the most similar, and of equally similar ones the
 * longest, so a short version of an element found inside a longer version
 * gives way to it. A match is dropped when one already kept covers 75% of the
 * shorter of the two. Each match is checked against every match kept, not
 * against a running best, so a chain of overlapping hits does not swallow two
 * that do not overlap each other.
 */
export function keepBest(matches: AnnotationMatch[], wrapLen = 0): AnnotationMatch[] {
  if (matches.length < 2) return matches
  const order = [...matches].sort((a, b) =>
    b.similarity - a.similarity || (b.end - b.start) - (a.end - a.start) || a.start - b.start)
  const kept: AnnotationMatch[] = []
  for (const m of order) {
    const len = m.end - m.start
    const clash = kept.some(o => overlapOf(m, o, wrapLen) >= Math.min(len, o.end - o.start) * 0.75)
    if (!clash) kept.push(m)
  }
  return kept
}

/** Every reference found in the document, sorted by position. */
export function scanForReferences(req: AnnotateListRequest): AnnotationMatch[] {
  const { documentBases, references, minSimilarity, bestMatchOnly, protein = false } = req
  const docUpper = documentBases.toUpperCase()
  const docLen = docUpper.length
  if (docLen === 0) return []
  const circular = !protein && !!req.circular

  // Short DNA references are matched exactly, and a reference random
  // sequence of this size would contain anyway is not searched at all.
  const plan: { ref: ReferenceAnnotation; sim: number }[] = []
  for (const ref of references) {
    const len = ref.sequence.length
    if (len === 0 || len > docLen) continue
    if (protein) { plan.push({ ref, sim: minSimilarity }); continue }
    const sim = len < EXACT_BELOW_BP ? 100 : minSimilarity
    const maxMismatches = Math.floor(len * (1 - sim / 100) + 1e-9)
    const positions = circular ? docLen : docLen - len + 1
    if (expectedChanceCopies(ref.sequence.toUpperCase(), positions, maxMismatches) >= MAX_CHANCE_COPIES) continue
    plan.push({ ref, sim })
  }
  if (plan.length === 0) return []

  // A circular document is searched with its start repeated after its end,
  // so a copy across the origin is in one piece.
  let longest = 0
  for (const { ref } of plan) longest = Math.max(longest, ref.sequence.length)
  const search = circular ? docUpper + docUpper.slice(0, Math.min(longest - 1, docLen)) : docUpper

  // Choose k based on document size (larger k = faster but less sensitive).
  // Residues carry more information per letter than bases, and a protein
  // is short, so a shorter seed keeps short tags findable.
  const k = protein ? 3 : docLen > 100000 ? 10 : docLen > 10000 ? 8 : 6
  const docIndex = kmerPositions(search, k, false)

  // Matches by group and type; a reference without a group is its own.
  const byGroup = new Map<string, AnnotationMatch[]>()
  for (const { ref, sim } of plan) {
    const found = searchReference(search, docLen, ref, docIndex, k, sim, protein)
    if (found.length === 0) continue
    const key = `${ref.group ?? ref.name}\u0000${ref.type}`
    const list = byGroup.get(key)
    if (list) list.push(...found)
    else byGroup.set(key, found)
  }

  const wrapLen = circular ? docLen : 0
  const all: AnnotationMatch[] = []
  for (const list of byGroup.values()) all.push(...(bestMatchOnly ? keepBest(list, wrapLen) : list))

  // Back to document coordinates: a span that runs past the end wraps.
  for (const m of all) {
    const len = m.end - m.start
    m.start %= docLen
    m.end = m.start + len
    if (m.end > docLen) m.end -= docLen
  }
  all.sort((a, b) => a.start - b.start)
  return all
}
