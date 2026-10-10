/**
 * One site, scored: the model number, the repair outlook and the flags.
 *
 * Two entry points, because the two callers want different things. The table
 * scores every site the scan found, so it takes the cheap parts always and
 * the repair prediction only while the count stays reasonable. The inspector
 * scores one site and wants everything, including the term-by-term reason for
 * the model number and the deletions behind the out-of-frame share.
 */

import { cutPosition } from '../finder'
import type { GuideCandidate, GuideScores, GuideSite, Nuclease, PromoterId } from '../types'
import { microhomologyOutcome, type MicrohomologyResult } from './microhomology'
import { onTargetScore, type OnTargetBreakdown } from './ontarget'
import { gcFraction, spacerFlags } from './rules'

/**
 * Above this many sites the repair prediction is left out of the batch: it is
 * quadratic in the window and the user cannot read ten thousand rows anyway.
 * The inspector fills it in for whichever site is selected.
 */
export const REPAIR_CAP = 2000

export interface ScoreOptions {
  /** Promoter whose start-base note applies; defaults to the nuclease's own. */
  promoter?: PromoterId
  /** Force the repair prediction on or off instead of letting REPAIR_CAP decide. */
  repair?: boolean
}

/** The cheap parts: the model score, GC and the flags. */
function baseScores(site: GuideSite, nuclease: Nuclease, options: ScoreOptions): GuideScores {
  const onTarget = onTargetScore(site.spacer, nuclease, site.pam)
  return {
    onTarget: onTarget.score,
    onTargetModel: onTarget.model,
    gc: gcFraction(site.spacer),
    outOfFrame: null,
    flags: spacerFlags(site.spacer, nuclease, site, options.promoter),
  }
}

/** The repair prediction for one site, or null when it cannot be made. */
function repairFor(
  site: GuideSite,
  nuclease: Nuclease,
  bases: string,
  topology: 'linear' | 'circular',
): MicrohomologyResult | null {
  if (nuclease.cleaves === 'none' || site.offEnd) return null
  const cut = cutPosition(site, bases.length, topology === 'circular')
  return microhomologyOutcome(bases, cut, topology, {})
}

/** Score every site the scan found. */
export function scoreSites(
  sites: readonly GuideSite[],
  nuclease: Nuclease,
  bases: string,
  topology: 'linear' | 'circular' = 'linear',
  options: ScoreOptions = {},
): GuideCandidate[] {
  const withRepair = options.repair ?? sites.length <= REPAIR_CAP
  return sites.map(site => {
    const scores = baseScores(site, nuclease, options)
    if (withRepair) {
      const repair = repairFor(site, nuclease, bases, topology)
      if (repair) scores.outOfFrame = repair.outOfFrame
    }
    return { site, scores }
  })
}

export interface GuideDetail {
  scores: GuideScores
  onTarget: OnTargetBreakdown
  repair: MicrohomologyResult | null
  /** The blunt cut position, or the midpoint of a staggered pair. */
  cut: number
}

/** Everything about one site, for the inspector. */
export function guideDetail(
  site: GuideSite,
  nuclease: Nuclease,
  bases: string,
  topology: 'linear' | 'circular' = 'linear',
  options: ScoreOptions = {},
): GuideDetail {
  const onTarget = onTargetScore(site.spacer, nuclease, site.pam)
  const repair = repairFor(site, nuclease, bases, topology)
  return {
    scores: {
      onTarget: onTarget.score,
      onTargetModel: onTarget.model,
      gc: gcFraction(site.spacer),
      outOfFrame: repair?.outOfFrame ?? null,
      flags: spacerFlags(site.spacer, nuclease, site, options.promoter),
    },
    onTarget,
    repair,
    cut: cutPosition(site, bases.length, topology === 'circular'),
  }
}
