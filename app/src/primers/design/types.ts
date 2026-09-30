/**
 * Types for the primer design engine.
 *
 * Coordinates come in two kinds and are named so they cannot be mixed up:
 * `start`/`end` are template positions (0-based, half-open, wrapping on a
 * circle, as everywhere else in the app); `linStart`/`linEnd` are positions
 * in the scan sequence, which for a circle is the template written out three
 * times so a primer can sit across the origin without special cases.
 */

import type { PenaltyTerm, PrimerCandidate, PrimerConstraints } from '../scoring'

/** A probe is scored exactly like a primer, against its own ranges. */
export type ProbeConstraints = PrimerConstraints

/** Template span, annotation convention: start > end wraps the origin. */
export interface Region {
  start: number
  end: number
}

export interface DesignRequest {
  template: string
  topology: 'linear' | 'circular'
  /** What the product must contain. */
  target: Region
  /** Primers may not overlap these. */
  excluded?: Region[]
  minProductSize: number
  maxProductSize: number
  constraints: PrimerConstraints
  /** Look for an internal probe in each of the best pairs. */
  probe?: ProbeConstraints | null
  /** Pairs to return (default 20). */
  maxPairs?: number
}

export interface Candidate extends PrimerCandidate {
  /** Unique within one design run. */
  id: string
  linStart: number
  linEnd: number
}

export interface PairEvaluation {
  productSize: number
  tmDiff: number
  crossDimer: { maxRun: number; endRun: number; dG: number }
  /** Pair-level penalty terms, on top of the two primers' own. */
  terms: PenaltyTerm[]
  /** Both primers' penalties plus the pair terms. */
  penalty: number
  warnings: string[]
}

export interface DesignPair {
  forward: Candidate
  reverse: Candidate
  probe?: Candidate
  evaluation: PairEvaluation
  /** Ranking score: the evaluation plus a share of the probe's penalty. */
  penalty: number
}

export interface DesignResult {
  /** Best forward candidate per 3' end position, by position. For the track. */
  forward: Candidate[]
  /** Best reverse candidate per 3' end position, by position. */
  reverse: Candidate[]
  pairs: DesignPair[]
  /** Scan-coordinate span the candidates were drawn from. */
  window: { start: number; end: number }
  /** The target, in scan coordinates. */
  target: { start: number; end: number }
  seqLen: number
  /** Everything that passed the hard constraints, before thinning. */
  counts: { forward: number; reverse: number }
  /** Why nothing could be designed, in words fit for the panel. */
  error?: string
}
