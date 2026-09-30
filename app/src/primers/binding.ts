/**
 * Where does an oligo anneal to a template?
 *
 * One pass over the template finds every place any primer's 10-mer seeds
 * occur, on both strands. Each hit fixes a diagonal (the offset between
 * oligo and template), and along that diagonal the best-scoring run of
 * paired bases is the annealed part. Whatever of the oligo lies outside that
 * run is its tail: a restriction site, a homology arm, a T7 promoter. That is
 * the whole of overhang support: nothing records the tail, it falls out of
 * the alignment.
 *
 * Mismatches inside the run are allowed (mutagenesis primers), gaps are not.
 * A primer only counts as bound where its 3' end pairs, because that is the
 * only place it can be extended; a probe is never extended, so any run will
 * do and it may carry tails at both ends (molecular beacons).
 *
 * Pure and DOM-free, so it can move into a worker for large genomes.
 */

import { reverseComplement } from '../models/complement'
import type { PrimerData } from './oligo'

export interface BindingOptions {
  /** Exact-match seed length. Oligos shorter than this never bind. */
  seed: number
  /** Paired bases a site needs. Oligos shorter than this must pair fully. */
  minMatched: number
  /** Mismatches tolerated inside the annealed part. */
  maxMismatches: number
  /** 3'-terminal bases of a primer that must pair for it to extend. */
  threePrimeExact: number
}

export const DEFAULT_BINDING_OPTIONS: BindingOptions = {
  seed: 10,
  minMatched: 15,
  maxMismatches: 3,
  threePrimeExact: 3,
}

export interface BindingSite {
  primerId: string
  /** Template span of the annealed part, annotation convention: 0-based,
   *  half-open, and start > end when it wraps the origin. */
  start: number
  end: number
  /** 1: the oligo reads along the top strand (a forward primer). */
  strand: 1 | -1
  /** Annealed part as indices into the oligo, [annealFrom, annealTo). */
  annealFrom: number
  annealTo: number
  /** Unpaired 5' overhang, as written in the oligo. */
  tail5: string
  /** Unpaired 3' part. Only ever non-empty for probes. */
  tail3: string
  /** Oligo indices inside the annealed part that do not pair. */
  mismatches: number[]
}

const MATCH = 1
/** Steep enough that a random tail (one base in four pairs by chance) is
 *  never absorbed, shallow enough that a 3-base substitution flanked by 15
 *  paired bases on each side still reads as one site. */
const MISMATCH = -3

/** Which template bases each oligo code pairs with (same-strand sense). */
const IUPAC: Record<string, string> = {
  A: 'A', C: 'C', G: 'G', T: 'T',
  R: 'AG', Y: 'CT', S: 'CG', W: 'AT', K: 'GT', M: 'AC',
  B: 'CGT', D: 'AGT', H: 'ACT', V: 'ACG', N: 'ACGT',
}

function pairs(oligoBase: string, templateBase: string): boolean {
  return (IUPAC[oligoBase] ?? '').includes(templateBase)
}

const CODE: Record<string, number> = { A: 0, C: 1, G: 2, T: 3 }

function encode(s: string, from: number, k: number): number {
  let code = 0
  for (let i = from; i < from + k; i++) {
    const b = CODE[s[i]]
    if (b === undefined) return -1
    code = code * 4 + b
  }
  return code
}

interface SeedRef {
  primer: number
  /** Seeded from the reverse complement, i.e. a strand -1 site. */
  rc: boolean
  offset: number
}

/**
 * Every binding site of every primer, keyed by primer id.
 *
 * Primers that bind nowhere map to an empty array, so a caller can tell
 * "unbound" from "not asked about".
 */
export function findBindingSites(
  primers: readonly PrimerData[],
  template: string,
  topology: 'linear' | 'circular',
  options: Partial<BindingOptions> = {},
): Map<string, BindingSite[]> {
  const opts = { ...DEFAULT_BINDING_OPTIONS, ...options }
  const k = opts.seed
  const result = new Map<string, BindingSite[]>()
  for (const p of primers) result.set(p.id, [])

  const T = template.toUpperCase()
  const n = T.length
  if (n === 0 || primers.length === 0) return result

  const oligos = primers.map(p => p.sequence.toUpperCase())
  const queries = oligos.map(o => [o, complementUpper(o)] as const)

  // Seed index over both orientations of every oligo.
  const index = new Map<number, SeedRef[]>()
  let maxLen = 0
  oligos.forEach((oligo, p) => {
    maxLen = Math.max(maxLen, oligo.length)
    if (oligo.length < k) return
    queries[p].forEach((q, orient) => {
      for (let offset = 0; offset + k <= q.length; offset++) {
        const code = encode(q, offset, k)
        if (code < 0) continue
        const list = index.get(code)
        const ref = { primer: p, rc: orient === 1, offset }
        if (list) list.push(ref)
        else index.set(code, [ref])
      }
    })
  })
  if (index.size === 0) return result

  // A circular template is scanned with its head appended, so a site across
  // the origin is one contiguous diagonal. Sites that start in the appended
  // copy are the same sites again and are skipped below.
  const circular = topology === 'circular'
  const ext = circular ? T + T.slice(0, Math.min(n, maxLen - 1)) : T

  const seen = new Set<string>()
  const mask = 4 ** (k - 1)
  let code = 0
  let valid = 0
  for (let i = 0; i < ext.length; i++) {
    const b = CODE[ext[i]]
    if (b === undefined) { valid = 0; code = 0; continue }
    code = (code % mask) * 4 + b
    if (++valid < k) continue

    const refs = index.get(code)
    if (!refs) continue
    const seedStart = i - k + 1
    for (const ref of refs) {
      // On a circle every diagonal has one canonical form in [0, n). Without
      // this, a site whose 5' part sits just before the origin is found twice:
      // once whole, and once cut off at position 0.
      let diag = seedStart - ref.offset
      if (circular) diag = ((diag % n) + n) % n
      const key = `${ref.primer}:${ref.rc ? 1 : 0}:${diag}`
      if (seen.has(key)) continue
      seen.add(key)

      const site = evaluate(
        primers[ref.primer], oligos[ref.primer], queries[ref.primer][ref.rc ? 1 : 0],
        ref.rc, diag, ext, n, circular, opts,
      )
      if (site) result.get(primers[ref.primer].id)!.push(site)
    }
  }

  for (const sites of result.values()) sites.sort((a, b) => a.start - b.start || a.strand - b.strand)
  return result
}

/** Reverse complement, uppercased and with IUPAC codes complemented. */
function complementUpper(s: string): string {
  return reverseComplement(s).toUpperCase()
}

/**
 * Best annealed run along one diagonal, or null if it is not a site.
 *
 * `query` is what reads along the top strand: the oligo itself for strand 1,
 * its reverse complement for strand -1.
 */
function evaluate(
  primer: PrimerData,
  oligo: string,
  query: string,
  rc: boolean,
  diag: number,
  ext: string,
  n: number,
  circular: boolean,
  opts: BindingOptions,
): BindingSite | null {
  const L = query.length

  // Maximum-scoring segment (Kadane). Off the end of a linear template
  // counts as a mismatch, so an oligo hanging off the end keeps that part as
  // a tail rather than claiming bases that are not there.
  let best = 0
  let bestFrom = 0
  let bestTo = 0
  let run = 0
  let runFrom = 0
  for (let i = 0; i < L; i++) {
    const t = diag + i
    const ok = t >= 0 && t < ext.length && pairs(query[i], ext[t])
    if (run <= 0) { run = 0; runFrom = i }
    run += ok ? MATCH : MISMATCH
    if (run > best) { best = run; bestFrom = runFrom; bestTo = i + 1 }
  }
  if (best <= 0) return null

  // A circular diagonal is canonical in [0, n), so a run may begin past the
  // origin; fold it back.
  let start = diag + bestFrom
  let endExt = diag + bestTo
  if (circular && start >= n) { start -= n; endExt -= n }
  if (start < 0 || start >= n) return null
  if (!circular && endExt > n) return null

  const mismatchesQ: number[] = []
  for (let i = bestFrom; i < bestTo; i++) {
    if (!pairs(query[i], ext[diag + i])) mismatchesQ.push(i)
  }
  const span = bestTo - bestFrom
  if (mismatchesQ.length > opts.maxMismatches) return null
  if (span - mismatchesQ.length < Math.min(opts.minMatched, oligo.length)) return null

  // Oligo coordinates. For strand -1 the query is reversed, so query index i
  // is oligo index L - 1 - i.
  const annealFrom = rc ? L - bestTo : bestFrom
  const annealTo = rc ? L - bestFrom : bestTo
  const mismatches = rc
    ? mismatchesQ.map(i => L - 1 - i).sort((a, b) => a - b)
    : mismatchesQ

  if (primer.role === 'primer') {
    if (annealTo !== L) return null
    const exact = Math.min(opts.threePrimeExact, L)
    if (mismatches.some(i => i >= L - exact)) return null
  }

  return {
    primerId: primer.id,
    start,
    end: endExt > n ? endExt - n : endExt,
    strand: rc ? -1 : 1,
    annealFrom,
    annealTo,
    tail5: oligo.slice(0, annealFrom),
    tail3: oligo.slice(annealTo),
    mismatches,
  }
}

/** The part of the oligo that pairs at this site. */
export function annealedPart(oligo: string, site: BindingSite): string {
  return oligo.slice(site.annealFrom, site.annealTo)
}
