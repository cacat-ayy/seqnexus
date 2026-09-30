/**
 * Primer pair design.
 *
 * Enumerates forward candidates upstream of the target and reverse candidates
 * downstream, scores each on its own, then pairs the best of both sides. The
 * candidates themselves are returned too (thinned to the best per 3' end), so
 * the workbench can show the whole landscape and let the user pick sides
 * independently rather than only from a list of precomputed pairs.
 *
 * Pure; runs in a Web Worker (see workers/primer-design.worker.ts).
 */

import { reverseComplement, scorePrimer, type PenaltyTerm } from '../scoring'
import { evaluatePair } from './pairing'
import type { Candidate, DesignPair, DesignRequest, DesignResult, ProbeConstraints, Region } from './types'

/** Candidates per side considered for pairing; keeps pairing to 40k checks. */
const PAIRING_POOL = 200

const ACGT = /^[ACGT]+$/

export function designPrimers(req: DesignRequest): DesignResult {
  const {
    template, topology, target, excluded = [], constraints,
    minProductSize, maxProductSize, maxPairs = 20,
  } = req
  const n = template.length
  const circular = topology === 'circular'
  const empty = (error: string): DesignResult => ({
    forward: [], reverse: [], pairs: [], window: { start: 0, end: 0 },
    target: { start: 0, end: 0 }, seqLen: n, counts: { forward: 0, reverse: 0 }, error,
  })

  if (n === 0) return empty('The sequence is empty.')
  const wraps = target.start >= target.end
  if (wraps && !circular) return empty('Select the region the product must contain.')
  const span = wraps ? n - target.start + target.end : target.end - target.start
  if (span <= 0) return empty('Select the region the product must contain.')
  if (span > maxProductSize) {
    return empty(`The target (${span} bp) is longer than the largest product allowed (${maxProductSize} bp). Raise the maximum product size.`)
  }
  if (minProductSize > maxProductSize) return empty('The minimum product size is above the maximum.')

  // A circle is scanned as three copies with the target in the middle one,
  // so there is a full sequence of room on either side.
  const upper = template.toUpperCase()
  const scan = circular ? upper + upper + upper : upper
  const tStart = circular ? target.start + n : target.start
  const tEnd = circular ? (wraps ? target.end + 2 * n : target.end + n) : target.end

  // Windows. A forward primer sits upstream with its 3' end at or before the
  // target; the product (forward 5' to reverse 5') can be at most
  // maxProductSize, which bounds how far out either side can start. On a
  // linear sequence with no room upstream (or downstream), the primer is
  // allowed to reach into the target instead, as the old finder did.
  const { maxLength, minLength } = constraints
  const fwdFrom = Math.max(0, tEnd - maxProductSize)
  const fwdTo = !circular && tStart < maxLength ? Math.min(tStart + maxLength, tEnd) : tStart
  const revFrom = !circular && n - tEnd < maxLength ? Math.max(tEnd - maxLength, tStart) : tEnd
  const revTo = Math.min(scan.length, tStart + maxProductSize)

  const blocked = excludedTester(excluded, n, circular)

  const forward: Candidate[] = []
  for (let len = minLength; len <= maxLength; len++) {
    for (let end3 = fwdTo; end3 - len >= fwdFrom; end3--) {
      const start = end3 - len
      const oligo = scan.slice(start, end3)
      if (!ACGT.test(oligo) || blocked(start, end3)) continue
      const scored = scorePrimer(oligo, start % n, 1, constraints)
      if (!scored.ok) continue
      forward.push({ ...scored, id: `f${start}:${len}`, start: start % n, end: end3 % n || n, linStart: start, linEnd: end3 })
    }
  }

  const reverse: Candidate[] = []
  for (let len = minLength; len <= maxLength; len++) {
    for (let start5 = revFrom; start5 + len <= revTo; start5++) {
      const end = start5 + len
      if (!circular && end > n) continue
      const region = scan.slice(start5, end)
      if (!ACGT.test(region) || blocked(start5, end)) continue
      const scored = scorePrimer(reverseComplement(region), start5 % n, -1, constraints)
      if (!scored.ok) continue
      reverse.push({ ...scored, id: `r${start5}:${len}`, start: start5 % n, end: end % n || n, linStart: start5, linEnd: end })
    }
  }

  const result: DesignResult = {
    forward: thin(forward, c => c.linEnd),
    reverse: thin(reverse, c => c.linStart),
    pairs: [],
    window: { start: fwdFrom, end: revTo },
    target: { start: tStart, end: tEnd },
    seqLen: n,
    counts: { forward: forward.length, reverse: reverse.length },
  }
  if (forward.length === 0) {
    result.error = 'No forward primer upstream of the target meets the Tm, length and GC limits.'
    return result
  }
  if (reverse.length === 0) {
    result.error = 'No reverse primer downstream of the target meets the Tm, length and GC limits.'
    return result
  }

  // --- Pairs ---
  const byPenalty = (a: Candidate, b: Candidate) => a.penalty - b.penalty
  const topFwd = [...forward].sort(byPenalty).slice(0, PAIRING_POOL)
  const topRev = [...reverse].sort(byPenalty).slice(0, PAIRING_POOL)
  const ctx = { minProductSize, maxProductSize }
  const seen = new Set<string>()
  let pairs: DesignPair[] = []
  for (const f of topFwd) {
    for (const r of topRev) {
      const productSize = r.linEnd - f.linStart
      if (productSize < minProductSize || productSize > maxProductSize) continue
      if (circular && productSize > n) continue
      const key = `${f.start}:${f.end}:${r.start}:${r.end}`
      if (seen.has(key)) continue
      seen.add(key)
      const evaluation = evaluatePair(f, r, productSize, ctx)
      pairs.push({ forward: f, reverse: r, evaluation, penalty: evaluation.penalty })
    }
  }
  pairs.sort((a, b) => a.penalty - b.penalty)
  pairs = pairs.slice(0, maxPairs)

  if (req.probe) {
    const probe = req.probe
    pairs = pairs.map(pair => {
      const found = bestProbe(scan, n, pair, probe)
      return found ? { ...pair, probe: found, penalty: pair.penalty + found.penalty * 0.3 } : pair
    })
    pairs.sort((a, b) => a.penalty - b.penalty)
  }

  result.pairs = pairs
  if (pairs.length === 0) {
    result.error = `Primers were found on both sides, but no pair gives a product of ${minProductSize}–${maxProductSize} bp.`
  }
  return result
}

/** Best candidate per key (a 3' end position), in position order. */
function thin(cands: Candidate[], key: (c: Candidate) => number): Candidate[] {
  const best = new Map<number, Candidate>()
  for (const c of cands) {
    const k = key(c)
    const cur = best.get(k)
    if (!cur || c.penalty < cur.penalty) best.set(k, c)
  }
  return [...best.entries()].sort((a, b) => a[0] - b[0]).map(e => e[1])
}

/**
 * Does [linStart, linEnd) in scan coordinates touch an excluded region? On
 * a circle each region is checked in every copy of the template.
 */
function excludedTester(regions: Region[], n: number, circular: boolean) {
  if (regions.length === 0) return () => false
  const spans: [number, number][] = []
  for (const r of regions) {
    const end = r.start < r.end ? r.end : r.end + n
    // Copies -1..3 cover every scan position a wrapped region can reach.
    for (const k of circular ? [-1, 0, 1, 2, 3] : [0]) spans.push([r.start + k * n, end + k * n])
  }
  return (s: number, e: number) => spans.some(([a, b]) => s < b && a < e)
}

/**
 * Best internal probe between a pair, on either strand.
 *
 * TaqMan conventions: no G at the 5' end (it quenches the reporter), and a
 * Tm a few degrees above both primers so the probe is bound before they
 * extend.
 */
function bestProbe(scan: string, n: number, pair: DesignPair, pc: ProbeConstraints): Candidate | undefined {
  const from = pair.forward.linEnd
  const to = pair.reverse.linStart
  if (to - from < pc.minLength) return undefined
  const maxPrimerTm = Math.max(pair.forward.tm, pair.reverse.tm)

  let best: Candidate | undefined
  for (let len = pc.minLength; len <= pc.maxLength; len++) {
    for (let start = from; start + len <= to; start++) {
      const sense = scan.slice(start, start + len)
      if (!ACGT.test(sense)) continue
      for (const strand of [1, -1] as const) {
        const oligo = strand === 1 ? sense : reverseComplement(sense)
        const scored = scorePrimer(oligo, start % n, strand, pc)
        const terms: PenaltyTerm[] = [...scored.terms]
        if (oligo[0] === 'G') terms.push({ label: '5′ G quenches reporter', penalty: 2.0 })
        if (scored.tm < maxPrimerTm + 3) {
          terms.push({ label: 'Tm not above primers', penalty: (maxPrimerTm + 3 - scored.tm) * 0.5 })
        }
        terms.push({ label: 'Probe Tm off optimum', penalty: Math.abs(scored.tm - pc.optTm) * 0.8 })
        if (!scored.ok) continue
        const penalty = terms.reduce((s, t) => s + t.penalty, 0)
        if (!best || penalty < best.penalty) {
          best = {
            ...scored, terms, penalty,
            id: `p${start}:${len}:${strand}`,
            start: start % n, end: (start + len) % n || n,
            linStart: start, linEnd: start + len,
          }
        }
      }
    }
  }
  return best
}
