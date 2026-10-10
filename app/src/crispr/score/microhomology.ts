/**
 * What the break is likely to become: microhomology-mediated deletions.
 *
 * End joining often uses a short identical stretch on either side of the
 * break, deleting everything between the two copies and keeping one. Which
 * deletions are available is a property of the sequence around the cut, so it
 * can be predicted, and the share of them that shift the reading frame is the
 * single most useful number when the goal is to knock a gene out: a guide
 * whose likely deletions are all multiples of three tends to give a protein
 * that still works.
 *
 * Method, following Bae et al. 2014. Every pair of identical stretches
 * flanking the cut within a window is enumerated. Each pair scores
 *
 *   pattern = 100 * exp(-deletionLength / 20) * (length + gcCount)
 *
 * so short deletions and GC-rich microhomologies dominate, and the
 * out-of-frame score is the share of the total carried by deletions whose
 * length is not a multiple of three.
 *
 * Pairs are enumerated once per deletion length by walking the diagonals of
 * the comparison, which keeps each maximal microhomology counted a single
 * time; a nested shorter copy of the same stretch is not a separate outcome.
 *
 * Limits: the formula is implemented as published, and the tests here check
 * its invariants rather than numeric agreement with the authors' own tool.
 * The window is sequence either side of the cut, so a cut too near the end of
 * a linear molecule returns nothing rather than a number from a short window.
 */

export interface MicrohomologyPattern {
  /** Start of the deleted span, in sequence coordinates. */
  deletionStart: number
  deletionLength: number
  /** The identical stretch that mediates it. */
  microhomology: string
  patternScore: number
  /** Whether the deletion shifts the reading frame. */
  frameshift: boolean
}

export interface MicrohomologyResult {
  /** Share of the pattern score carried by frameshifting deletions, 0 to 100. */
  outOfFrame: number
  /** Sum of every pattern score, which the shares are taken from. */
  totalScore: number
  /** The patterns, heaviest first. */
  patterns: MicrohomologyPattern[]
}

export interface MicrohomologyOptions {
  /** Bases considered either side of the cut. */
  window?: number
  /** Shortest identical stretch counted as a microhomology. */
  minLength?: number
  /** Longest deletion considered. */
  maxDeletion?: number
  /** Patterns kept in the result; the score uses all of them regardless. */
  keep?: number
}

export const DEFAULT_WINDOW = 40
export const DEFAULT_MIN_LENGTH = 3
export const DEFAULT_MAX_DELETION = 40
/** The length that halves a pattern's weight roughly every 14 bases. */
export const LENGTH_WEIGHT = 20

function wrap(i: number, len: number): number {
  return ((i % len) + len) % len
}

/** The window around a cut, plus where it starts, or null when it cannot be built. */
function windowAround(
  bases: string,
  cut: number,
  topology: 'linear' | 'circular',
  window: number,
): { seq: string; start: number } | null {
  const len = bases.length
  if (topology === 'circular') {
    if (len < 2 * window) return null
    const start = wrap(cut - window, len)
    let seq = ''
    for (let i = 0; i < 2 * window; i++) seq += bases[wrap(start + i, len)]
    return { seq: seq.toUpperCase(), start }
  }
  if (cut - window < 0 || cut + window > len) return null
  return { seq: bases.slice(cut - window, cut + window).toUpperCase(), start: cut - window }
}

function gcCount(s: string): number {
  let n = 0
  for (const c of s) if (c === 'G' || c === 'C') n++
  return n
}

/**
 * Predict the deletions available at a cut.
 *
 * `cut` is the blunt cut position in sequence coordinates. For a staggered
 * cutter, pass the position the caller treats as the break.
 */
export function microhomologyOutcome(
  bases: string,
  cut: number,
  topology: 'linear' | 'circular' = 'linear',
  options: MicrohomologyOptions = {},
): MicrohomologyResult | null {
  const window = options.window ?? DEFAULT_WINDOW
  const minLength = options.minLength ?? DEFAULT_MIN_LENGTH
  const maxDeletion = Math.min(options.maxDeletion ?? DEFAULT_MAX_DELETION, 2 * window - 1)
  const keep = options.keep ?? 20

  const built = windowAround(bases, cut, topology, window)
  if (!built) return null
  const { seq, start } = built
  if (!/^[ACGT]+$/.test(seq)) return null

  const cutInWindow = window
  const patterns: MicrohomologyPattern[] = []

  // One diagonal per deletion length: positions x and x + d are compared, and
  // a maximal run of matches along the diagonal is one microhomology.
  for (let d = minLength; d <= maxDeletion; d++) {
    let runStart = -1
    for (let x = 0; x <= seq.length - d; x++) {
      const matches = x + d < seq.length && seq[x] === seq[x + d]
      if (matches && runStart === -1) runStart = x
      if (!matches || x === seq.length - d) {
        if (runStart !== -1) {
          const runEnd = matches ? x + 1 : x
          // Keep the part of the run whose left copy stays left of the cut
          // and whose right copy starts at or after it.
          const from = Math.max(runStart, cutInWindow - d)
          const to = Math.min(runEnd, cutInWindow)
          const length = to - from
          if (length >= minLength) {
            const mh = seq.slice(from, from + length)
            const score = 100 * Math.exp(-d / LENGTH_WEIGHT) * (length + gcCount(mh))
            patterns.push({
              deletionStart: topology === 'circular'
                ? wrap(start + from + length, bases.length)
                : start + from + length,
              deletionLength: d,
              microhomology: mh,
              patternScore: score,
              frameshift: d % 3 !== 0,
            })
          }
          runStart = -1
        }
      }
    }
  }

  const totalScore = patterns.reduce((sum, p) => sum + p.patternScore, 0)
  if (totalScore === 0) return { outOfFrame: 0, totalScore: 0, patterns: [] }
  const shifted = patterns.reduce((sum, p) => sum + (p.frameshift ? p.patternScore : 0), 0)
  patterns.sort((a, b) => b.patternScore - a.patternScore)

  return {
    outOfFrame: (shifted / totalScore) * 100,
    totalScore,
    patterns: patterns.slice(0, keep),
  }
}
