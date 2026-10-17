/**
 * The hard rules a spacer either passes or does not.
 *
 * These are kept apart from the activity model on purpose. A model gives a
 * number whose meaning depends on how it was fitted; these are properties of
 * the sequence that hold whatever the nuclease, so they are reported as named
 * flags that the panel shows as chips and the user can sort and filter on.
 *
 * Thresholds live here as named constants so the README can quote them and a
 * settings panel can move them later without hunting through the scorer.
 */

import { maxHomopolymerRun, hairpinScore } from '../../primers/scoring'
import { spacerStartsGuide } from '../scaffolds'
import type { GuideFlag, GuideSite, Nuclease, PromoterId } from '../types'

/** GC fraction outside this band is worth a warning. */
export const GC_WARN = { low: 0.35, high: 0.75 } as const
/** Outside this band the spacer is usually not worth ordering. */
export const GC_BAD = { low: 0.25, high: 0.85 } as const
/** A run of this many identical bases is worth a warning. */
export const HOMOPOLYMER_WARN = 5
/** A run this long is usually disqualifying: it both folds and mis-synthesises. */
export const HOMOPOLYMER_BAD = 6
/** A self-folding stem at least this long is worth a warning. */
export const STEM_WARN = 7

/** GC fraction of a spacer, counting only unambiguous bases. */
export function gcFraction(spacer: string): number {
  if (spacer.length === 0) return 0
  let gc = 0
  for (const c of spacer.toUpperCase()) if (c === 'G' || c === 'C') gc++
  return gc / spacer.length
}

/**
 * What a promoter expects at the start of the transcript. A U6 promoter
 * starts best on a G, a T7 promoter on two. This is a note, not a defect:
 * the usual answer is to order the guide with the extra base added, which is
 * what the construct builder does in a later phase.
 */
export function startBaseNote(spacer: string, promoter: PromoterId): string | null {
  const s = spacer.toUpperCase()
  if (promoter === 'u6') {
    return s.startsWith('G') ? null : 'U6 transcribes best from a G. Order this one with a G added at the 5′ end.'
  }
  if (promoter === 't7') {
    return s.startsWith('GG') ? null : 'T7 transcribes best from GG. Order this one with the missing G added at the 5′ end.'
  }
  return null
}

/**
 * Every flag that applies to one spacer.
 *
 * `site` is optional so that a spacer typed by hand, with no position in any
 * sequence, can be checked the same way as one the finder produced.
 */
export function spacerFlags(
  spacer: string,
  nuclease: Nuclease,
  site?: Pick<GuideSite, 'offEnd'>,
  promoter: PromoterId = nuclease.promoter ?? 'u6',
): GuideFlag[] {
  const flags: GuideFlag[] = []
  const s = spacer.toUpperCase()

  if (!/^[ACGT]*$/.test(s)) {
    flags.push({
      id: 'ambiguous',
      label: 'Ambiguous base',
      severity: 'bad',
      detail: 'The spacer holds a base that is not A, C, G or T, so it cannot be ordered as written.',
    })
  }

  const gc = gcFraction(s)
  const pct = Math.round(gc * 100)
  if (gc < GC_BAD.low) {
    flags.push({ id: 'gc-low', label: `GC ${pct}%`, severity: 'bad', detail: 'Very low GC. The guide is unlikely to stay bound.' })
  } else if (gc < GC_WARN.low) {
    flags.push({ id: 'gc-low', label: `GC ${pct}%`, severity: 'warn', detail: 'Low GC, below the band most active guides fall in.' })
  } else if (gc > GC_BAD.high) {
    flags.push({ id: 'gc-high', label: `GC ${pct}%`, severity: 'bad', detail: 'Very high GC, which both folds and tolerates mismatches.' })
  } else if (gc > GC_WARN.high) {
    flags.push({ id: 'gc-high', label: `GC ${pct}%`, severity: 'warn', detail: 'High GC, above the band most active guides fall in.' })
  }

  if (s.includes('TTTT')) {
    flags.push({
      id: 'polyt',
      label: 'TTTT',
      severity: 'bad',
      detail: 'Four or more T in a row reads as a terminator, so a transcribed guide is cut short.',
    })
  }

  const run = maxHomopolymerRun(s)
  if (run >= HOMOPOLYMER_BAD) {
    flags.push({ id: 'homopolymer', label: `${run}-base run`, severity: 'bad', detail: `A run of ${run} identical bases. Both synthesis and the repair readout suffer.` })
  } else if (run >= HOMOPOLYMER_WARN) {
    flags.push({ id: 'homopolymer', label: `${run}-base run`, severity: 'warn', detail: `A run of ${run} identical bases.` })
  }

  const stem = hairpinScore(s)
  if (stem >= STEM_WARN) {
    flags.push({
      id: 'self-structure',
      label: `${stem}-bp stem`,
      severity: 'warn',
      detail: `The spacer folds back on itself over ${stem} bases, which competes with loading into the nuclease.`,
    })
  }

  // The start-base rule is about the first base of the transcript. It only
  // concerns the spacer when the spacer comes first, which is true of an
  // sgRNA and false of a Cas12a crRNA, where the repeat is in front of it.
  if (spacerStartsGuide(nuclease)) {
    const note = startBaseNote(s, promoter)
    if (note) {
      // A note, not a warning. Three spacers in four do not start on a G, so
      // as a warning this crowded out the flags that say a guide is a poor
      // one, and the order step adds the base by itself and says it did.
      flags.push({ id: 'start-base', label: '5′ base', severity: 'note', detail: note })
    }
  }

  if (site?.offEnd) {
    flags.push({
      id: 'off-end',
      label: 'Cuts past the end',
      severity: 'bad',
      detail: 'One of the two cuts falls outside this linear sequence, so nothing is cut here.',
    })
  }

  return flags
}

/** The worst severity among a set of flags, for sorting and for the row tint. */
export function worstSeverity(flags: readonly GuideFlag[]): 'none' | 'warn' | 'bad' {
  if (flags.some(f => f.severity === 'bad')) return 'bad'
  if (flags.some(f => f.severity === 'warn')) return 'warn'
  return 'none'
}
