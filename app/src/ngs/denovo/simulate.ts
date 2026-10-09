/**
 * Simulated long reads, for testing the assembler against a known answer.
 *
 * Reads are cut from a sequence (circular or linear), on either strand, and
 * given substitutions, insertions and deletions at set rates, as nanopore
 * reads have them. Deterministic for a given seed.
 */

import { reverseComplement } from '../../models/complement'

export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1
  return () => {
    // xorshift32
    s ^= s << 13
    s >>>= 0
    s ^= s >>> 17
    s ^= s << 5
    s >>>= 0
    return s / 4294967296
  }
}

export function randomSequence(n: number, rand: () => number): string {
  let s = ''
  for (let i = 0; i < n; i++) s += 'ACGT'[Math.floor(rand() * 4)]
  return s
}


export interface ErrorRates {
  sub: number
  ins: number
  del: number
}

export const NANOPORE_ERRORS: ErrorRates = { sub: 0.01, ins: 0.01, del: 0.01 }

/** A read with errors put in. */
export function withErrors(s: string, e: ErrorRates, rand: () => number): string {
  let out = ''
  for (const c of s) {
    const x = rand()
    if (x < e.del) continue
    if (x < e.del + e.sub) out += 'ACGT'.replace(c, '')[Math.floor(rand() * 3)]
    else out += c
    if (rand() < e.ins) out += 'ACGT'[Math.floor(rand() * 4)]
  }
  return out
}

export interface SimRead {
  id: string
  seq: string
  qual: string
}

/**
 * `n` reads of `template`: each starts at a random place (anywhere on a
 * circle, at the start of a linear template), is `length(rand)` long
 * (clipped to the template on a linear one), and is on a random strand.
 */
export function simulateReads(template: string, o: {
  n: number
  circular: boolean
  length: (rand: () => number) => number
  errors?: ErrorRates
  seed: number
  prefix?: string
  /** Linear: bases lost at each end, at most. */
  endLoss?: number
}): SimRead[] {
  const rand = rng(o.seed)
  const L = template.length
  const out: SimRead[] = []
  for (let i = 0; i < o.n; i++) {
    const len = Math.max(50, Math.round(o.length(rand)))
    let frag: string
    if (o.circular) {
      const start = Math.floor(rand() * L)
      let s = template.slice(start) + template
      while (s.length < len) s += template
      frag = s.slice(0, len)
    } else {
      const lossL = Math.floor(rand() * ((o.endLoss ?? 0) + 1))
      const lossR = Math.floor(rand() * ((o.endLoss ?? 0) + 1))
      const room = L - lossL - lossR
      const start = lossL + (len >= room ? 0 : Math.floor(rand() * (room - len)))
      frag = template.slice(start, Math.min(L - lossR, start + len))
    }
    if (rand() < 0.5) frag = reverseComplement(frag)
    const seq = withErrors(frag, o.errors ?? NANOPORE_ERRORS, rand)
    const q = 12 + Math.floor(rand() * 12)
    out.push({ id: `${o.prefix ?? 'read'}${i}`, seq, qual: String.fromCharCode(33 + q).repeat(seq.length) })
  }
  return out
}

/**
 * `n` read pairs of `template`, interleaved (mates 2i and 2i+1), as an
 * Illumina library has them: a fragment of about `insert` bases (normal,
 * spread `sd`), the first mate read from its start on the forward strand,
 * the second from its end on the reverse strand; each fragment is turned
 * around at random.
 */
export function simulatePairs(template: string, o: {
  n: number
  circular: boolean
  insert: number
  sd: number
  readLength: number
  errors?: ErrorRates
  seed: number
  prefix?: string
}): SimRead[] {
  const rand = rng(o.seed)
  const L = template.length
  const out: SimRead[] = []
  const twice = o.circular ? template + template.slice(0, Math.min(L, o.insert * 3)) : template
  const qual = 'I'.repeat(o.readLength)
  for (let i = 0; i < o.n; i++) {
    // Box-Muller for the insert.
    const z = Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand())
    const ins = Math.max(o.readLength, Math.round(o.insert + z * o.sd))
    const start = Math.floor(rand() * (o.circular ? L : Math.max(1, L - ins)))
    let frag = twice.slice(start, start + ins)
    if (rand() < 0.5) frag = reverseComplement(frag)
    const e = o.errors ?? { sub: 0.003, ins: 0.0001, del: 0.0001 }
    const m1 = withErrors(frag.slice(0, o.readLength), e, rand).slice(0, o.readLength)
    const m2 = withErrors(reverseComplement(frag).slice(0, o.readLength), e, rand).slice(0, o.readLength)
    out.push({ id: `${o.prefix ?? 'pair'}${i}/1`, seq: m1, qual: qual.slice(0, m1.length) })
    out.push({ id: `${o.prefix ?? 'pair'}${i}/2`, seq: m2, qual: qual.slice(0, m2.length) })
  }
  return out
}

/** True when `a` is `b` turned around the circle, on either strand. */
export function sameCircle(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  const bb = b + b
  return bb.includes(a) || bb.includes(reverseComplement(a))
}

/** Edit distance between two strings (small ones, for tests). */
export function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[b.length]
}

/** Smallest edit distance between `a` and any rotation of `b` (or of its reverse complement). */
export function circleDistance(a: string, b: string): number {
  if (sameCircle(a, b)) return 0
  let best = Infinity
  for (const t of [b, reverseComplement(b)]) {
    // Line `a` up with `t` at its first 20-mer, then compare.
    const probe = a.slice(0, 20)
    const at = (t + t).indexOf(probe)
    if (at < 0) continue
    const rot = (t + t).slice(at, at + t.length)
    best = Math.min(best, editDistance(a, rot))
  }
  return best
}
