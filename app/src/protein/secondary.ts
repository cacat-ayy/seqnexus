/**
 * Secondary structure by Chou and Fasman (1978): the propensity of each
 * residue for helix, strand and turn, and the nucleate-and-extend rule that
 * turns the propensities into predicted helices and strands.
 *
 * The method is forty years old and about 55 to 60% accurate per residue,
 * which is why every modern tool uses a neural network trained on
 * alignments. It is kept because it is transparent: a helix is predicted
 * where the residues known to favour helices cluster, and the propensity
 * table says which those are. The segments are offered as provisional
 * features, never written into the document on their own.
 */

/** Chou-Fasman conformational parameters, scaled by 100: P(alpha), P(beta), P(turn). */
const PARAMS: Readonly<Record<string, [number, number, number]>> = {
  A: [142, 83, 66], R: [98, 93, 95], N: [67, 89, 156], D: [101, 54, 146], C: [70, 119, 119],
  Q: [111, 110, 98], E: [151, 37, 74], G: [57, 75, 156], H: [100, 87, 95], I: [108, 160, 47],
  L: [121, 130, 59], K: [114, 74, 101], M: [145, 105, 60], F: [113, 138, 60], P: [57, 55, 152],
  S: [77, 75, 143], T: [83, 119, 96], W: [108, 137, 96], Y: [69, 147, 114], V: [106, 170, 50],
}

export const CF_HELIX: Readonly<Record<string, number>> = Object.fromEntries(Object.entries(PARAMS).map(([r, p]) => [r, p[0] / 100]))
export const CF_SHEET: Readonly<Record<string, number>> = Object.fromEntries(Object.entries(PARAMS).map(([r, p]) => [r, p[1] / 100]))
export const CF_TURN: Readonly<Record<string, number>> = Object.fromEntries(Object.entries(PARAMS).map(([r, p]) => [r, p[2] / 100]))

export interface StructureSegment {
  kind: 'helix' | 'strand'
  /** 0-based, half-open. */
  start: number
  end: number
  /** Mean propensity of the segment for its own kind. */
  score: number
}

/** Helix nucleation: 4 of 6 residues with P(a) above this. */
const HELIX_NUCLEATE = 1.03
const HELIX_WINDOW = 6
const HELIX_NEEDED = 4
/** Strand nucleation: 3 of 5 residues with P(b) above this. */
const STRAND_NUCLEATE = 1.05
const STRAND_WINDOW = 5
const STRAND_NEEDED = 3
/** Extension continues while the mean over this window stays at or above 1. */
const EXTEND_WINDOW = 4
const EXTEND_MIN = 1.0
const MIN_HELIX = 6
const MIN_STRAND = 5

function mean(values: Float32Array, a: number, b: number): number {
  let s = 0
  let n = 0
  for (let i = a; i < b; i++) {
    const v = values[i]
    if (!Number.isNaN(v)) { s += v; n++ }
  }
  return n > 0 ? s / n : 0
}

function table(residues: string, which: 0 | 1 | 2): Float32Array {
  const out = new Float32Array(residues.length)
  for (let i = 0; i < residues.length; i++) {
    const p = PARAMS[residues[i].toUpperCase()]
    out[i] = p ? p[which] / 100 : NaN
  }
  return out
}

/**
 * Segments of one kind: nucleate where enough residues of a window favour
 * it, extend both ways while the local mean holds, keep those long enough
 * whose own propensity beats the other kind's.
 */
function segments(
  own: Float32Array, other: Float32Array, kind: StructureSegment['kind'],
  window: number, needed: number, nucleate: number, minLength: number,
): StructureSegment[] {
  const n = own.length
  const found: StructureSegment[] = []
  let i = 0
  while (i + window <= n) {
    let count = 0
    for (let k = i; k < i + window; k++) if (own[k] > nucleate) count++
    if (count < needed) { i++; continue }
    let a = i
    let b = i + window
    while (a > 0 && mean(own, a - 1, Math.min(n, a - 1 + EXTEND_WINDOW)) >= EXTEND_MIN) a--
    while (b < n && mean(own, Math.max(0, b + 1 - EXTEND_WINDOW), b + 1) >= EXTEND_MIN) b++
    const score = mean(own, a, b)
    if (b - a >= minLength && score > mean(other, a, b)) found.push({ kind, start: a, end: b, score })
    i = b
  }
  return found
}

/**
 * Predicted helices and strands. Where a helix and a strand overlap, the
 * one with the higher mean propensity keeps the residues; the other is
 * trimmed, and dropped when too short remains.
 */
export function chouFasman(residues: string): StructureSegment[] {
  const helix = table(residues, 0)
  const sheet = table(residues, 1)
  const helices = segments(helix, sheet, 'helix', HELIX_WINDOW, HELIX_NEEDED, HELIX_NUCLEATE, MIN_HELIX)
  const strands = segments(sheet, helix, 'strand', STRAND_WINDOW, STRAND_NEEDED, STRAND_NUCLEATE, MIN_STRAND)
  const out: StructureSegment[] = [...helices]
  for (const s of strands) {
    let seg: StructureSegment | null = { ...s }
    for (const h of helices) {
      if (!seg || h.end <= seg.start || h.start >= seg.end) continue
      if (h.score >= seg.score) {
        // The helix keeps the overlap: cut the strand down to what is outside it.
        const cur: StructureSegment = seg
        const left: StructureSegment | null = cur.start < h.start ? { ...cur, end: h.start } : null
        const right: StructureSegment | null = cur.end > h.end ? { ...cur, start: h.end } : null
        seg = left && left.end - left.start >= MIN_STRAND ? left : right && right.end - right.start >= MIN_STRAND ? right : null
      } else {
        const idx = out.indexOf(h)
        if (idx >= 0) {
          const left = h.start < seg.start ? { ...h, end: seg.start } : null
          const right = h.end > seg.end ? { ...h, start: seg.end } : null
          out.splice(idx, 1)
          if (left && left.end - left.start >= MIN_HELIX) out.push(left)
          if (right && right.end - right.start >= MIN_HELIX) out.push(right)
        }
      }
    }
    if (seg) out.push(seg)
  }
  return out.sort((a, b) => a.start - b.start)
}
