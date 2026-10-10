/**
 * Where else a spacer could bind, in the sequences you give it.
 *
 * The search is the site finder run in reverse. Instead of taking every
 * protospacer a nuclease could target, it takes one spacer and looks for
 * places in a set of sequences where a near copy of it sits next to a usable
 * PAM. PAM positions are found first, which is cheap, and the spacer is then
 * compared from its PAM-proximal end outward so a site that cannot qualify is
 * abandoned after a few bases.
 *
 * Bulges are optional and cost more: with them on, each PAM position also
 * gets a small banded comparison that allows one unpaired base on either
 * side. They are off by default for that reason, not because they do not
 * happen.
 *
 * Scoring is a transparent heuristic, like the activity model in
 * score/ontarget.ts, and for the same reason: the published tables are
 * fitted data that belong in a data file, and a borrowed number that looks
 * fitted is worse than an honest rule. A mismatch costs most next to the PAM
 * and least at the far end, an alternative PAM costs a fixed factor, and a
 * bulge costs another. What the numbers mean is stated where they are
 * defined, and the UI never shows a hit count without saying which sequences
 * were searched.
 */

import { recognitionToRegex } from '../models/iupac'
import { reverseComplement } from '../models/complement'
import type { Nuclease } from './types'

/** A sequence to search, with whatever is known about it. */
export interface SearchTarget {
  id: string
  name: string
  bases: string
  topology: 'linear' | 'circular'
  /** Where it came from, for the line that says what was searched. */
  source: 'document' | 'file' | 'contig'
  /** Features, when the target has any, for saying what a hit lands in. */
  features?: readonly { name: string; type: string; start: number; end: number }[]
}

export interface OffTargetHit {
  targetId: string
  targetName: string
  /** Protospacer start on the target's sense strand. */
  start: number
  end: number
  strand: 1 | -1
  /** The protospacer as it reads on its own strand, for the diagram. */
  protospacer: string
  pam: string
  mismatches: number
  /** Which spacer positions differ, 0-based from the spacer's 5' end. */
  mismatchPositions: number[]
  /** An unpaired base, when the search allowed one. */
  bulge?: { kind: 'dna' | 'rna'; position: number }
  /** Whether the PAM is the nuclease's own or one of its weaker alternatives. */
  pamKind: 'canonical' | 'alternative'
  /** Relative likelihood that this site is cut, 0 to 1. */
  score: number
  /** The feature it falls in, when the target has features. */
  feature?: { name: string; type: string }
}

export interface OffTargetSettings {
  /** Mismatches allowed between the spacer and the site. */
  maxMismatches: number
  /** Allow one unpaired base on either side. */
  bulges: boolean
  /** Also search the nuclease's weaker alternative PAMs. */
  alternativePams: boolean
  /** Stop after this many hits, so a relaxed search cannot run away. */
  maxHits: number
}

export const DEFAULT_OFFTARGET: OffTargetSettings = {
  maxMismatches: 3,
  bulges: false,
  alternativePams: false,
  maxHits: 1000,
}

export const MAX_MISMATCHES = 6

export interface OffTargetReport {
  spacer: string
  nucleaseId: string
  hits: OffTargetHit[]
  /**
   * 0 to 100. A guide with nothing else to bind scores 100, and every
   * credible hit pulls it down; see `specificity`.
   */
  specificity: number
  /** What was searched, named, so a count is never shown without its scope. */
  searched: { id: string; name: string; length: number }[]
  /** Perfect matches skipped as the guide's own site. */
  onTargetSites: number
  /** The hit cap stopped the search. */
  truncated: boolean
  settings: OffTargetSettings
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * What a mismatch leaves of the site's activity, by where it falls.
 *
 * Position 0 is the base against the PAM. Pairing there has to hold for the
 * nuclease to stay bound, so a mismatch is nearly disqualifying; at the far
 * end of the spacer it is often tolerated. The curve between the two is a
 * straight line in position, which is a deliberate simplification: the real
 * profile is bumpy and sequence-dependent, and smoothing it is more honest
 * than inventing the bumps.
 */
export const MISMATCH_AT_PAM = 0.08
export const MISMATCH_AT_FAR_END = 0.85
/** An alternative PAM is bound far less often than the canonical one. */
export const ALTERNATIVE_PAM_FACTOR = 0.2
/** An unpaired base costs more than a mismatch anywhere. */
export const BULGE_FACTOR = 0.25

export function mismatchFactor(distanceFromPam: number, spacerLength: number): number {
  if (spacerLength <= 1) return MISMATCH_AT_PAM
  const t = Math.min(1, Math.max(0, distanceFromPam / (spacerLength - 1)))
  return MISMATCH_AT_PAM + (MISMATCH_AT_FAR_END - MISMATCH_AT_PAM) * t
}

/**
 * One site's score: what is left of full activity after every mismatch, the
 * PAM it sits next to and any unpaired base.
 */
export function hitScore(
  mismatchPositions: readonly number[],
  spacerLength: number,
  pamSide: Nuclease['pamSide'],
  pamKind: 'canonical' | 'alternative',
  bulge: boolean,
): number {
  let score = 1
  for (const p of mismatchPositions) {
    // The spacer is written 5' to 3'; the PAM-proximal end is its 3' end for
    // a 3' PAM and its 5' end for a 5' PAM.
    const distance = pamSide === 'threePrime' ? spacerLength - 1 - p : p
    score *= mismatchFactor(distance, spacerLength)
  }
  if (pamKind === 'alternative') score *= ALTERNATIVE_PAM_FACTOR
  if (bulge) score *= BULGE_FACTOR
  return score
}

/**
 * The aggregate, in the shape the field uses: a guide with nothing else to
 * bind scores 100, and the score falls as credible hits accumulate. It is a
 * summary of the hits that were found, so it is only ever as good as the
 * sequences that were searched, which is why the report carries their names.
 */
export function specificity(hits: readonly OffTargetHit[]): number {
  const sum = hits.reduce((n, h) => n + h.score, 0)
  return Math.round((100 / (1 + sum)) * 10) / 10
}

// ---------------------------------------------------------------------------
// Searching
// ---------------------------------------------------------------------------

/** The PAMs to look for, canonical first. */
function pamsFor(nuclease: Nuclease, alternatives: boolean): { pam: string; kind: 'canonical' | 'alternative' }[] {
  const list: { pam: string; kind: 'canonical' | 'alternative' }[] = [{ pam: nuclease.pam, kind: 'canonical' }]
  if (alternatives) {
    for (const alt of nuclease.altPams ?? []) list.push({ pam: alt, kind: 'alternative' })
  }
  return list
}

function wrapIndex(i: number, len: number): number {
  return ((i % len) + len) % len
}

function sliceWrap(bases: string, start: number, count: number, circular: boolean): string {
  if (!circular) return bases.slice(start, start + count)
  const len = bases.length
  if (count > len) return ''
  const from = wrapIndex(start, len)
  if (from + count <= len) return bases.slice(from, from + count)
  return bases.slice(from) + bases.slice(0, from + count - len)
}

/**
 * Compare a candidate protospacer with the spacer, counting mismatches from
 * the PAM-proximal end outward and giving up as soon as the budget is spent.
 * Returns the mismatch positions (in spacer coordinates) or null.
 */
function compare(
  spacer: string,
  candidate: string,
  pamSide: Nuclease['pamSide'],
  budget: number,
): number[] | null {
  const n = spacer.length
  if (candidate.length !== n) return null
  const positions: number[] = []
  for (let k = 0; k < n; k++) {
    // k counts from the PAM-proximal end, so a hopeless site dies early.
    const i = pamSide === 'threePrime' ? n - 1 - k : k
    if (spacer[i] !== candidate[i]) {
      positions.push(i)
      if (positions.length > budget) return null
    }
  }
  positions.sort((a, b) => a - b)
  return positions
}

/**
 * The same comparison allowing one unpaired base: either an extra base in the
 * target (a DNA bulge, so the window is one longer) or one in the guide (an
 * RNA bulge, so the window is one shorter). The gap position is enumerated,
 * which is cheap for a single bulge and keeps the result exact rather than
 * heuristic.
 */
function compareWithBulge(
  spacer: string,
  window: string,
  kind: 'dna' | 'rna',
  budget: number,
): { positions: number[]; bulgeAt: number } | null {
  const n = spacer.length
  let best: { positions: number[]; bulgeAt: number } | null = null
  const gaps = kind === 'dna' ? window.length : n
  for (let g = 0; g < gaps; g++) {
    const candidate = kind === 'dna'
      ? window.slice(0, g) + window.slice(g + 1)
      : window
    const query = kind === 'dna' ? spacer : spacer.slice(0, g) + spacer.slice(g + 1)
    if (candidate.length !== query.length) continue
    const positions: number[] = []
    for (let i = 0; i < query.length; i++) {
      if (query[i] !== candidate[i]) {
        positions.push(i)
        if (positions.length > budget) break
      }
    }
    if (positions.length > budget) continue
    if (!best || positions.length < best.positions.length) best = { positions, bulgeAt: g }
  }
  return best
}

/** The feature a position falls in, smallest first, or undefined. */
function featureAt(target: SearchTarget, start: number, end: number) {
  if (!target.features || target.features.length === 0) return undefined
  let found: { name: string; type: string; span: number } | undefined
  for (const f of target.features) {
    if (f.start <= start && f.end >= end) {
      const span = f.end - f.start
      if (!found || span < found.span) found = { name: f.name, type: f.type, span }
    }
  }
  return found ? { name: found.name, type: found.type } : undefined
}

export interface SearchProgress {
  /** Targets finished so far. */
  done: number
  total: number
  /** The target being searched. */
  name: string
}

/**
 * Search one spacer against a set of targets.
 *
 * `exclude` names the site the spacer was designed against, so the guide's
 * own position is not reported as its own worst off-target. It is counted and
 * reported separately instead: a second perfect match elsewhere is something
 * the user needs to know about.
 */
export function findOffTargets(
  spacer: string,
  nuclease: Nuclease,
  targets: readonly SearchTarget[],
  settings: OffTargetSettings = DEFAULT_OFFTARGET,
  exclude?: { targetId: string; start: number; strand: 1 | -1 },
  onProgress?: (progress: SearchProgress) => void,
): OffTargetReport {
  const query = spacer.toUpperCase()
  const spacerLen = query.length
  const budget = Math.min(settings.maxMismatches, MAX_MISMATCHES)
  const hits: OffTargetHit[] = []
  const searched: { id: string; name: string; length: number }[] = []
  let onTargetSites = 0
  let truncated = false

  const pams = pamsFor(nuclease, settings.alternativePams)
  const threePrime = nuclease.pamSide === 'threePrime'

  for (let t = 0; t < targets.length; t++) {
    const target = targets[t]
    onProgress?.({ done: t, total: targets.length, name: target.name })
    const upper = target.bases.toUpperCase()
    const len = upper.length
    searched.push({ id: target.id, name: target.name, length: len })
    if (len === 0 || truncated) continue
    const circular = target.topology === 'circular'

    for (const { pam, kind } of pams) {
      const pamLen = pam.length
      if (len < spacerLen + pamLen) continue
      const searchSeq = circular ? upper + upper.slice(0, pamLen - 1) : upper

      for (const strand of [1, -1] as const) {
        const sensePam = strand === 1 ? pam : reverseComplement(pam.toUpperCase())
        const pattern = new RegExp(recognitionToRegex(sensePam), 'gi')
        pattern.lastIndex = 0
        let m: RegExpExecArray | null
        while ((m = pattern.exec(searchSeq)) !== null) {
          const pamStart = m.index
          pattern.lastIndex = pamStart + 1
          if (pamStart >= len) break
          const pamEnd = pamStart + pamLen
          const dir = (strand === 1) === threePrime ? -1 : 1
          const boundary = dir === -1 ? pamStart : pamEnd

          // Windows to try: the exact length, and one either side for a bulge.
          const widths: { width: number; bulge: 'dna' | 'rna' | null }[] = [{ width: spacerLen, bulge: null }]
          if (settings.bulges) {
            widths.push({ width: spacerLen + 1, bulge: 'dna' }, { width: spacerLen - 1, bulge: 'rna' })
          }

          for (const { width, bulge } of widths) {
            const windowStart = dir === -1 ? boundary - width : boundary
            if (!circular && (windowStart < 0 || windowStart + width > len)) continue
            const sense = sliceWrap(upper, windowStart, width, circular)
            if (sense.length !== width) continue
            if (!/^[ACGT]+$/.test(sense)) continue
            const candidate = strand === 1 ? sense : reverseComplement(sense)

            let positions: number[] | null = null
            let bulgeAt: number | undefined
            if (bulge === null) {
              positions = compare(query, candidate, nuclease.pamSide, budget)
            } else {
              const found = compareWithBulge(query, candidate, bulge, budget)
              if (found) { positions = found.positions; bulgeAt = found.bulgeAt }
            }
            if (!positions) continue

            const start = circular ? wrapIndex(windowStart, len) : windowStart
            const end = circular ? wrapIndex(windowStart + width, len) : windowStart + width

            // The guide's own site is not one of its off-targets.
            if (
              exclude && exclude.targetId === target.id
              && exclude.start === start && exclude.strand === strand
              && positions.length === 0 && bulge === null
            ) {
              onTargetSites++
              continue
            }

            const score = hitScore(positions, spacerLen, nuclease.pamSide, kind, bulge !== null)
            const feature = featureAt(target, Math.min(start, end), Math.max(start, end))
            hits.push({
              targetId: target.id,
              targetName: target.name,
              start,
              end,
              strand,
              protospacer: candidate,
              pam: strand === 1
                ? sliceWrap(upper, pamStart, pamLen, circular)
                : reverseComplement(sliceWrap(upper, pamStart, pamLen, circular)),
              mismatches: positions.length,
              mismatchPositions: positions,
              ...(bulge ? { bulge: { kind: bulge, position: bulgeAt ?? 0 } } : {}),
              pamKind: kind,
              score,
              ...(feature ? { feature } : {}),
            })
            if (hits.length >= settings.maxHits) { truncated = true; break }
          }
          if (truncated) break
        }
        if (truncated) break
      }
      if (truncated) break
    }
  }

  onProgress?.({ done: targets.length, total: targets.length, name: '' })
  hits.sort((a, b) => b.score - a.score || a.mismatches - b.mismatches)
  return {
    spacer: query,
    nucleaseId: nuclease.id,
    hits,
    specificity: specificity(hits),
    searched,
    onTargetSites,
    truncated,
    settings: { ...settings, maxMismatches: budget },
  }
}

/**
 * The hit as two lines for the inspector: the spacer, and the site under it
 * with matching bases shown as dots so the mismatches are what the eye finds.
 */
export function mismatchDiagram(spacer: string, hit: OffTargetHit): { query: string; site: string } {
  const site = [...hit.protospacer]
  const marked = site.map((base, i) => (hit.mismatchPositions.includes(i) ? base : '.'))
  return { query: spacer.toUpperCase(), site: marked.join('') }
}
