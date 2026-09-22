/**
 * Primer pair finder.
 *
 * Given a template sequence and a target region, enumerates forward and
 * reverse primer candidates flanking the target, scores each individually,
 * then ranks pairs by combined penalty.
 *
 * Designed to run in a Web Worker (see primer-finder.worker.ts).
 */

import { scorePrimer, reverseComplement, type PrimerCandidate, type PrimerConstraints, DEFAULT_CONSTRAINTS } from './scoring'
import { nnParams } from './thermodynamics'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProbeConstraints {
  minLength: number       // default 18
  maxLength: number       // default 30
  optLength: number       // default 24
  minTm: number           // default 68 °C (typically 6-10 °C above primer Tm)
  maxTm: number           // default 72 °C
  optTm: number           // default 70 °C
  minGC: number           // default 30 %
  maxGC: number           // default 80 %
  maxHomopolymer: number  // default 4
  primerConc: number      // nM
  naConc: number          // mM
  mgConc: number          // mM
  dntpConc: number        // mM
}

export const DEFAULT_PROBE_CONSTRAINTS: ProbeConstraints = {
  minLength: 18,
  maxLength: 30,
  optLength: 24,
  minTm: 68,
  maxTm: 72,
  optTm: 70,
  minGC: 30,
  maxGC: 80,
  maxHomopolymer: 4,
  primerConc: 250,
  naConc: 50,
  mgConc: 1.5,
  dntpConc: 0.6,
}

export interface PrimerPairRequest {
  /** Full template sequence (sense strand, 5'→3'). */
  template: string
  /** 0-based start of the target region to amplify. */
  targetStart: number
  /** 0-based end of the target region (exclusive). For origin-spanning targets on circular sequences, targetEnd < targetStart. */
  targetEnd: number
  /** Minimum product size (including primers). */
  minProductSize: number
  /** Maximum product size (including primers). */
  maxProductSize: number
  /** Primer constraints. */
  constraints: PrimerConstraints
  /** Maximum number of pairs to return (default 10). */
  maxResults?: number
  /** Sequence topology (default 'linear'). */
  topology?: 'linear' | 'circular'
  /** Include forward primers in results (default true). */
  wantForward?: boolean
  /** Include reverse primers in results (default true). */
  wantReverse?: boolean
  /** Whether to find a probe between the primers. */
  findProbe?: boolean
  /** Probe constraints (uses defaults if not provided). */
  probeConstraints?: ProbeConstraints
}

export interface PrimerPair {
  forward: PrimerCandidate
  reverse: PrimerCandidate
  /** Optional internal probe (for qPCR / TaqMan). */
  probe?: PrimerCandidate
  /** Product size in bp (from fwd start to rev end). */
  productSize: number
  /** Combined penalty: fwd.penalty + rev.penalty + pair penalties. */
  penalty: number
}

// ---------------------------------------------------------------------------
// Pair finder
// ---------------------------------------------------------------------------

/**
 * Find primer pairs flanking a target region.
 *
 * Forward primers are placed upstream of targetStart.
 * Reverse primers are placed downstream of targetEnd.
 * Both must satisfy individual constraints, and the pair must produce
 * a product within the specified size range.
 *
 * For circular sequences, primers can wrap around the origin.
 */
export function findPrimerPairs(req: PrimerPairRequest): PrimerPair[] {
  const {
    template,
    targetStart,
    targetEnd,
    minProductSize,
    maxProductSize,
    constraints,
    maxResults = 10,
    topology = 'linear',
    wantForward = true,
    wantReverse = true,
  } = req

  const seqLen = template.length
  const circular = topology === 'circular'

  // For circular sequences, we linearize by tripling the template so that
  // primers near the origin always have room on both sides.
  // The target is shifted into the second copy (offset by seqLen).
  const upper = template.toUpperCase()
  const scanSeq = circular ? upper + upper + upper : upper
  const scanLen = scanSeq.length

  // Compute effective target coordinates in the scan sequence.
  let effTargetStart = targetStart
  let effTargetEnd = targetEnd
  if (circular) {
    // Place target in the second copy so there's a full seqLen upstream and downstream
    effTargetStart = targetStart + seqLen
    effTargetEnd = targetEnd + seqLen
    // Origin-spanning target: targetEnd wraps, so push it further
    if (targetStart >= targetEnd) {
      effTargetEnd = targetEnd + seqLen * 2
    }
  }
  const targetSpan = effTargetEnd - effTargetStart

  // --- Enumerate forward primer candidates ---
  const fwdCandidates: PrimerCandidate[] = []
  const fwdSearchStart = Math.max(0, effTargetStart - (maxProductSize - targetSpan) - constraints.maxLength)
  // Allow forward primers to overlap into the target when the target starts
  // near position 0 on a linear sequence (otherwise no upstream room exists).
  const fwdSearchEnd = !circular && effTargetStart < constraints.maxLength
    ? Math.min(effTargetStart + constraints.maxLength, effTargetEnd)
    : effTargetStart

  for (let len = constraints.minLength; len <= constraints.maxLength; len++) {
    for (let end3 = fwdSearchEnd; end3 >= fwdSearchStart + len; end3--) {
      const start = end3 - len
      if (start < 0) continue
      if (!circular && start >= seqLen) continue
      const oligo = scanSeq.slice(start, end3)
      const candidate = scorePrimer(oligo, start % seqLen, 1, constraints)
      candidate.start = start % seqLen
      candidate.end = end3 % seqLen || seqLen
      // Store the linear (unwrapped) position for product size calculation
      ;(candidate as any)._linearStart = start
      if (candidate.ok) {
        fwdCandidates.push(candidate)
      }
    }
  }

  // --- Enumerate reverse primer candidates ---
  const revCandidates: PrimerCandidate[] = []
  // Allow reverse primers to overlap into the target when the target ends
  // near the sequence end on a linear sequence.
  const revSearchStart = !circular && (seqLen - effTargetEnd) < constraints.maxLength
    ? Math.max(effTargetEnd - constraints.maxLength, effTargetStart)
    : effTargetEnd
  const revSearchEnd = Math.min(scanLen, effTargetEnd + (maxProductSize - targetSpan) + constraints.maxLength)

  for (let len = constraints.minLength; len <= constraints.maxLength; len++) {
    for (let start5 = revSearchStart; start5 + len <= revSearchEnd; start5++) {
      const end = start5 + len
      if (!circular && end > seqLen) continue
      const templateRegion = scanSeq.slice(start5, end)
      const oligo = reverseComplement(templateRegion)
      const candidate = scorePrimer(oligo, start5 % seqLen, -1, constraints)
      candidate.start = start5 % seqLen
      candidate.end = end % seqLen || seqLen
      ;(candidate as any)._linearEnd = end
      if (candidate.ok) {
        revCandidates.push(candidate)
      }
    }
  }

  // --- Sort candidates by individual penalty ---
  fwdCandidates.sort((a, b) => a.penalty - b.penalty)
  revCandidates.sort((a, b) => a.penalty - b.penalty)

  // Limit candidates to top N to avoid O(n²) explosion
  const MAX_CANDIDATES = 200
  const topFwd = fwdCandidates.slice(0, MAX_CANDIDATES)
  const topRev = revCandidates.slice(0, MAX_CANDIDATES)

  // --- Pair candidates and score ---
  const pairs: PrimerPair[] = []
  const seen = new Set<string>()

  for (const fwd of topFwd) {
    for (const rev of topRev) {
      // Use linear positions for product size calculation
      const linStart = (fwd as any)._linearStart ?? fwd.start
      const linEnd = (rev as any)._linearEnd ?? rev.end
      const productSize = linEnd - linStart
      if (productSize < minProductSize || productSize > maxProductSize) continue
      if (productSize > seqLen) continue // can't be larger than the whole sequence

      // Deduplicate (same pair found via different linearization offsets)
      const key = `${fwd.start}_${fwd.end}_${rev.start}_${rev.end}`
      if (seen.has(key)) continue
      seen.add(key)

      // Pair penalty – when only one direction is wanted, de-weight the other
      const tmDiff = Math.abs(fwd.tm - rev.tm)
      const fwdWeight = wantForward ? 1.0 : 0.1
      const revWeight = wantReverse ? 1.0 : 0.1
      let pairPenalty = fwd.penalty * fwdWeight + rev.penalty * revWeight
      pairPenalty += tmDiff * (wantForward && wantReverse ? 1.0 : 0.1)

      const optProduct = (minProductSize + maxProductSize) / 2
      pairPenalty += Math.abs(productSize - optProduct) * 0.01

      // Cross-dimer check: sliding window for longest complementary run,
      // plus ΔG-based penalty for the most stable heterodimer alignment
      const crossDimer = crossDimerScore(fwd.sequence, rev.sequence)
      if (crossDimer.maxRun >= 6) {
        pairPenalty += 4.0
      } else if (crossDimer.maxRun >= 4) {
        pairPenalty += 2.0
      }
      // Penalize thermodynamically stable heterodimers (ΔG < -6 kcal/mol)
      if (crossDimer.dG < -9) {
        pairPenalty += 4.0
      } else if (crossDimer.dG < -6) {
        pairPenalty += 2.0
      }
      // Extra penalty for 3' end involvement (blocks extension)
      if (crossDimer.endRun >= 3) {
        pairPenalty += 3.0
      }

      // Clean up internal properties before returning
      const fwdClean = { ...fwd }
      const revClean = { ...rev }
      delete (fwdClean as any)._linearStart
      delete (revClean as any)._linearEnd

      pairs.push({
        forward: fwdClean,
        reverse: revClean,
        productSize,
        penalty: pairPenalty,
        _fwdLinStart: linStart,
        _revLinEnd: linEnd,
      } as PrimerPair & { _fwdLinStart: number; _revLinEnd: number })
    }
  }

  pairs.sort((a, b) => a.penalty - b.penalty)
  let result = pairs.slice(0, maxResults)

  // --- Find probes if requested ---
  if (req.findProbe) {
    const pc = req.probeConstraints ?? DEFAULT_PROBE_CONSTRAINTS
    result = result.map(pair => {
      const p = pair as PrimerPair & { _fwdLinStart?: number; _revLinEnd?: number }
      const fwdLinEnd = (p._fwdLinStart ?? pair.forward.start) + pair.forward.length
      const revLinStart = (p._revLinEnd ?? pair.reverse.end) - pair.reverse.length
      const probe = findBestProbe(scanSeq, fwdLinEnd, revLinStart, seqLen, pair, pc)
      if (probe) {
        return { ...pair, probe, penalty: pair.penalty + probe.penalty * 0.3 }
      }
      return pair
    })
  }

  // Strip internal linear coordinate properties
  return result.map(({ _fwdLinStart, _revLinEnd, ...pair }: any) => pair as PrimerPair)
}

/**
 * Find the best internal probe between a forward and reverse primer.
 *
 * The probe must sit between the 3' end of the forward primer and the
 * 5' end of the reverse primer (on the template). It can bind either
 * strand. Probes should not overlap with the primers.
 *
 * For TaqMan probes, the 5' nucleotide should not be a G (quenches
 * reporter fluorescence), and Tm should be 6-10 °C above primer Tm.
 */
function findBestProbe(
  scanSeq: string,
  fwdLinEnd: number,
  revLinStart: number,
  seqLen: number,
  pair: PrimerPair,
  constraints: ProbeConstraints,
): PrimerCandidate | undefined {
  // Probe region: between forward primer 3' end and reverse primer 5' end
  const probeRegionStart = fwdLinEnd
  const probeRegionEnd = revLinStart
  if (probeRegionEnd - probeRegionStart < constraints.minLength) return undefined

  const candidates: PrimerCandidate[] = []

  for (let len = constraints.minLength; len <= constraints.maxLength; len++) {
    for (let start = probeRegionStart; start + len <= probeRegionEnd; start++) {
      // Sense strand probe
      const senseOligo = scanSeq.slice(start, start + len)
      const senseCandidate = scorePrimer(senseOligo, start % seqLen, 1, constraints as any)
      senseCandidate.start = start % seqLen
      senseCandidate.end = (start + len) % seqLen || seqLen

      // Apply probe-specific penalties
      applyProbePenalties(senseCandidate, pair, constraints)
      if (senseCandidate.ok) candidates.push(senseCandidate)

      // Antisense strand probe
      const antiOligo = reverseComplement(senseOligo)
      const antiCandidate = scorePrimer(antiOligo, start % seqLen, -1, constraints as any)
      antiCandidate.start = start % seqLen
      antiCandidate.end = (start + len) % seqLen || seqLen

      applyProbePenalties(antiCandidate, pair, constraints)
      if (antiCandidate.ok) candidates.push(antiCandidate)
    }
  }

  if (candidates.length === 0) return undefined

  candidates.sort((a, b) => a.penalty - b.penalty)
  return candidates[0]
}

/**
 * Apply probe-specific penalty adjustments.
 * - 5' G penalty (quenches reporter in TaqMan assays)
 * - Tm should be higher than both primers
 */
function applyProbePenalties(
  probe: PrimerCandidate,
  pair: PrimerPair,
  constraints: ProbeConstraints,
): void {
  // 5' G penalty
  if (probe.sequence[0] === 'G') {
    probe.penalty += 2.0
  }

  // Probe Tm should be above both primer Tms
  const maxPrimerTm = Math.max(pair.forward.tm, pair.reverse.tm)
  if (probe.tm < maxPrimerTm + 3) {
    probe.penalty += (maxPrimerTm + 3 - probe.tm) * 0.5
  }

  // Optimal Tm deviation
  probe.penalty += Math.abs(probe.tm - constraints.optTm) * 0.8
}

/**
 * Cross-dimer analysis between two primer sequences.
 *
 * Slides the reverse complement of primer B across primer A to find:
 * - maxRun: longest contiguous complementary stretch (any position)
 * - endRun: longest complementary stretch involving the 3' end of either primer
 * - dG: most stable (most negative) ΔG across all alignments with ≥3bp overlap
 */
function crossDimerScore(
  seqA: string,
  seqB: string,
): { maxRun: number; endRun: number; dG: number } {
  const a = seqA.toUpperCase()
  const rcB = reverseComplement(seqB.toUpperCase())
  let maxRun = 0
  let endRun = 0
  let bestDG = 0 // least negative = least stable

  // Slide rcB across a in all offsets
  for (let offset = -(rcB.length - 1); offset < a.length; offset++) {
    let run = 0
    let bestRunThisOffset = 0
    let matchStart = -1

    for (let i = 0; i < a.length; i++) {
      const j = i - offset
      if (j < 0 || j >= rcB.length) {
        run = 0
        continue
      }
      if (a[i] === rcB[j]) {
        if (run === 0) matchStart = i
        run++
        if (run > bestRunThisOffset) bestRunThisOffset = run
      } else {
        // Compute ΔG for the run that just ended
        if (run >= 3) {
          const duplex = a.slice(matchStart, matchStart + run)
          const { dH, dS } = nnParams(duplex)
          const dG = (dH - (273.15 + 37) * dS) / 1000
          if (dG < bestDG) bestDG = dG
        }
        run = 0
      }
    }
    // Handle run that extends to the end
    if (run >= 3) {
      const duplex = a.slice(matchStart, matchStart + run)
      const { dH, dS } = nnParams(duplex)
      const dG = (dH - (273.15 + 37) * dS) / 1000
      if (dG < bestDG) bestDG = dG
    }

    if (bestRunThisOffset > maxRun) maxRun = bestRunThisOffset

    // Check 3' end involvement: does the match touch the last base of a
    // or the last base of rcB (= first base of seqB, i.e. 3' end of rev primer)?
    // a's 3' end = index a.length-1; rcB's 3' end = index rcB.length-1
    if (bestRunThisOffset >= 2) {
      // Check if match reaches 3' end of a
      const aEnd = a.length - 1
      const jForAEnd = aEnd - offset
      if (jForAEnd >= 0 && jForAEnd < rcB.length && a[aEnd] === rcB[jForAEnd]) {
        // Count how far back the match extends from a's 3' end
        let eRun = 1
        for (let k = 1; k < bestRunThisOffset; k++) {
          const ai = aEnd - k
          const ji = ai - offset
          if (ai < 0 || ji < 0 || ji >= rcB.length || a[ai] !== rcB[ji]) break
          eRun++
        }
        if (eRun > endRun) endRun = eRun
      }
      // Check if match reaches 3' end of rcB (= 3' of seqB)
      const bEnd = rcB.length - 1
      const iForBEnd = bEnd + offset
      if (iForBEnd >= 0 && iForBEnd < a.length && a[iForBEnd] === rcB[bEnd]) {
        let eRun = 1
        for (let k = 1; k < bestRunThisOffset; k++) {
          const ji = bEnd - k
          const ai = ji + offset
          if (ji < 0 || ai < 0 || ai >= a.length || a[ai] !== rcB[ji]) break
          eRun++
        }
        if (eRun > endRun) endRun = eRun
      }
    }
  }

  return { maxRun, endRun, dG: bestDG }
}

export { DEFAULT_CONSTRAINTS }
