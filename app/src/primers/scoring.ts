/**
 * Primer candidate scoring.
 *
 * Evaluates individual primer oligos on multiple criteria and produces
 * a weighted penalty score. Lower penalty = better primer.
 *
 * Criteria (mirrors Primer3's penalty model):
 *   - Tm deviation from optimal
 *   - GC% deviation from optimal range
 *   - Length deviation from optimal
 *   - 3' end stability (ΔG of last 5 bases)
 *   - GC clamp (terminal G/C at 3' end)
 *   - Homopolymer runs (e.g. AAAA)
 *   - Self-complementarity (self-dimer potential)
 *   - Hairpin potential
 */

import { calcTm, gcPercent, deltaG37 } from './thermodynamics'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PrimerConstraints {
  minLength: number       // default 18
  maxLength: number       // default 25
  optLength: number       // default 20
  minTm: number           // default 57 °C
  maxTm: number           // default 63 °C
  optTm: number           // default 60 °C
  minGC: number           // default 40 %
  maxGC: number           // default 60 %
  maxHomopolymer: number  // default 4
  primerConc: number      // nM, default 250
  naConc: number          // mM, default 50
  mgConc: number          // mM, default 1.5
  dntpConc: number        // mM, default 0.6
}

export const DEFAULT_CONSTRAINTS: PrimerConstraints = {
  minLength: 18,
  maxLength: 25,
  optLength: 20,
  minTm: 57,
  maxTm: 63,
  optTm: 60,
  minGC: 40,
  maxGC: 60,
  maxHomopolymer: 4,
  primerConc: 250,
  naConc: 50,
  mgConc: 1.5,
  dntpConc: 0.6,
}

export interface PrimerCandidate {
  /** 0-based start position on the template (sense strand). */
  start: number
  /** 0-based end position (exclusive). */
  end: number
  /** The oligo sequence (5'→3'). */
  sequence: string
  /** 1 = forward primer, -1 = reverse primer. */
  strand: 1 | -1
  /** Melting temperature in °C. */
  tm: number
  /** GC content as percentage. */
  gc: number
  /** Length in bases. */
  length: number
  /** Penalty score (lower = better). */
  penalty: number
  /** Whether this primer passes all hard constraints. */
  ok: boolean
  /** Reasons for rejection (empty if ok). */
  problems: string[]
}

// ---------------------------------------------------------------------------
// Scoring helpers
// ---------------------------------------------------------------------------

/**
 * Longest homopolymer run in a sequence.
 */
export function maxHomopolymerRun(seq: string): number {
  let max = 1
  let run = 1
  for (let i = 1; i < seq.length; i++) {
    if (seq[i] === seq[i - 1]) {
      run++
      if (run > max) max = run
    } else {
      run = 1
    }
  }
  return max
}

/**
 * Check for GC clamp: at least one G or C in the last 2 bases at the 3' end.
 */
export function hasGCClamp(seq: string): boolean {
  const s = seq.toUpperCase()
  const last2 = s.slice(-2)
  return last2.includes('G') || last2.includes('C')
}

/**
 * Self-complementarity score using a simplified alignment.
 *
 * Slides the reverse complement against the original sequence and counts
 * the maximum number of contiguous matches. A score ≥ 8 indicates
 * significant self-dimer potential.
 */
export function selfComplementarity(seq: string): number {
  const s = seq.toUpperCase()
  const rc = reverseComplement(s)
  let maxScore = 0

  // Slide rc across s in all offsets and find the longest contiguous
  // match. s[i] === rc[j] means the bases at those positions can pair
  // (since rc is already the reverse complement).
  for (let offset = -(s.length - 1); offset < s.length; offset++) {
    let run = 0
    let best = 0
    for (let i = 0; i < s.length; i++) {
      const j = i - offset
      if (j < 0 || j >= rc.length) {
        run = 0
        continue
      }
      if (s[i] === rc[j]) {
        run++
        if (run > best) best = run
      } else {
        run = 0
      }
    }
    if (best > maxScore) maxScore = best
  }

  return maxScore
}

/**
 * 3' end self-complementarity - checks the last 5 bases for dimer potential.
 * This is the most problematic type of self-dimer because it directly
 * interferes with extension.
 */
export function endSelfComplementarity(seq: string): number {
  const s = seq.toUpperCase()
  const tail = s.slice(-5)
  const rc = reverseComplement(tail)

  // Check if the 3' tail can pair with any part of the full sequence
  let maxRun = 0
  for (let i = 0; i <= s.length - rc.length; i++) {
    let run = 0
    for (let j = 0; j < rc.length; j++) {
      if (s[i + j] === rc[j]) {
        run++
        if (run > maxRun) maxRun = run
      } else {
        run = 0
      }
    }
  }
  return maxRun
}

/**
 * Hairpin detection: checks if the sequence can fold back on itself.
 * Returns the length of the longest stem found.
 */
export function hairpinScore(seq: string): number {
  const s = seq.toUpperCase()
  const len = s.length
  let maxStem = 0

  // Try all possible loop positions (minimum loop size = 3)
  for (let loopStart = 3; loopStart < len - 3; loopStart++) {
    for (let loopEnd = loopStart + 3; loopEnd < len; loopEnd++) {
      let stem = 0
      let i = loopStart - 1
      let j = loopEnd
      while (i >= 0 && j < len) {
        if (isComplement(s[i], s[j])) {
          stem++
          i--
          j++
        } else {
          break
        }
      }
      if (stem > maxStem) maxStem = stem
    }
  }
  return maxStem
}

// ---------------------------------------------------------------------------
// Score a single primer candidate
// ---------------------------------------------------------------------------

/**
 * Evaluate a primer candidate against constraints.
 * Returns a PrimerCandidate with penalty score and pass/fail status.
 */
export function scorePrimer(
  seq: string,
  start: number,
  strand: 1 | -1,
  constraints: PrimerConstraints,
): PrimerCandidate {
  const s = seq.toUpperCase()
  const tm = calcTm(s, {
    primerConc: constraints.primerConc,
    naConc: constraints.naConc,
    mgConc: constraints.mgConc,
    dntpConc: constraints.dntpConc,
  })
  const gc = gcPercent(s)
  const len = s.length
  const problems: string[] = []
  let penalty = 0

  // --- Hard constraints ---
  if (tm < constraints.minTm) problems.push(`Tm ${tm.toFixed(1)}°C < ${constraints.minTm}°C`)
  if (tm > constraints.maxTm) problems.push(`Tm ${tm.toFixed(1)}°C > ${constraints.maxTm}°C`)
  if (gc < constraints.minGC) problems.push(`GC ${gc.toFixed(0)}% < ${constraints.minGC}%`)
  if (gc > constraints.maxGC) problems.push(`GC ${gc.toFixed(0)}% > ${constraints.maxGC}%`)

  const homoRun = maxHomopolymerRun(s)
  if (homoRun > constraints.maxHomopolymer) {
    problems.push(`Homopolymer run of ${homoRun}`)
  }

  // --- Soft penalties (weighted) ---

  // Tm deviation from optimal: 1 point per °C
  penalty += Math.abs(tm - constraints.optTm) * 1.0

  // Length deviation from optimal: 0.5 points per base
  penalty += Math.abs(len - constraints.optLength) * 0.5

  // GC% deviation from optimal (50%): 0.1 points per %
  penalty += Math.abs(gc - 50) * 0.1

  // GC clamp: penalize if no G/C in last 2 bases
  if (!hasGCClamp(s)) {
    penalty += 1.0
  }

  // 3' stability: ΔG of last 5 bases should be moderate
  // Too stable (very negative) = mispriming; too weak = poor binding
  const tail5 = s.slice(-5)
  if (tail5.length === 5) {
    const dg = deltaG37(tail5)
    if (dg < -9.0) penalty += 2.0  // too stable
    if (dg > -5.0) penalty += 1.0  // too weak
  }

  // Self-complementarity penalty
  const selfComp = selfComplementarity(s)
  if (selfComp >= 8) {
    penalty += 3.0
    problems.push(`Self-dimer (${selfComp} bp match)`)
  } else if (selfComp >= 5) {
    penalty += 1.0
  }

  // 3' end self-complementarity (more severe)
  const endComp = endSelfComplementarity(s)
  if (endComp >= 4) {
    penalty += 4.0
    problems.push(`3' self-dimer (${endComp} bp match)`)
  } else if (endComp >= 3) {
    penalty += 1.5
  }

  // Hairpin penalty
  const hp = hairpinScore(s)
  if (hp >= 4) {
    penalty += 2.0
    problems.push(`Hairpin (${hp} bp stem)`)
  } else if (hp >= 3) {
    penalty += 0.5
  }

  // Homopolymer run penalty (soft, in addition to hard cutoff)
  if (homoRun >= 3) {
    penalty += (homoRun - 2) * 0.5
  }

  return {
    start,
    end: start + len,
    sequence: s,
    strand,
    tm,
    gc,
    length: len,
    penalty,
    ok: problems.length === 0,
    problems,
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const COMP: Record<string, string> = {
  A: 'T', T: 'A', G: 'C', C: 'G', N: 'N',
}

function reverseComplement(seq: string): string {
  const result: string[] = []
  for (let i = seq.length - 1; i >= 0; i--) {
    result.push(COMP[seq[i]] ?? 'N')
  }
  return result.join('')
}

function isComplement(a: string, b: string): boolean {
  return COMP[a] === b
}

export { reverseComplement }
