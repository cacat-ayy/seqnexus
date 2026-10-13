/**
 * Guides spread across a region.
 *
 * For a screen, or for walking a promoter, what matters is coverage: a set
 * whose cuts are spaced out, each as good as can be had near its place,
 * rather than the best few guides in the region, which usually cluster. So
 * this is a greedy pick down the quality order with a spacing rule, and it
 * reports the stretches where nothing was found, since a gap in coverage is
 * the thing a tiling set is judged on.
 */

import type { GuideCandidate, Nuclease } from '../types'
import { cutPosition } from '../finder'
import { worstSeverity } from '../score/rules'
import { csvRow } from '../../utils/csv-cell'

export interface TileSettings {
  /** Bases that must separate two cuts. */
  spacing: number
  /** Guides to pick, at most. */
  count: number
  /** Leave out guides carrying a disqualifying flag. */
  skipFlagged: boolean
}

export const DEFAULT_TILE: TileSettings = { spacing: 100, count: 10, skipFlagged: true }

export interface TilePick {
  candidate: GuideCandidate
  cut: number
}

export interface TilePlan {
  picks: TilePick[]
  /** Stretches of the region with no picked guide, longer than the spacing. */
  gaps: [number, number][]
  /** Candidates left out for carrying a flag. */
  skipped: number
}

export function planTiling(
  candidates: readonly GuideCandidate[],
  region: { start: number; end: number },
  seqLen: number,
  circular: boolean,
  nuclease: Nuclease,
  settings: TileSettings = DEFAULT_TILE,
): TilePlan {
  const usable: TilePick[] = []
  let skipped = 0
  for (const candidate of candidates) {
    if (candidate.site.offEnd) continue
    if (settings.skipFlagged && worstSeverity(candidate.scores.flags) === 'bad') { skipped++; continue }
    const cut = nuclease.cleaves === 'none'
      ? candidate.site.start
      : cutPosition(candidate.site, seqLen, circular)
    if (cut < region.start || cut > region.end) continue
    usable.push({ candidate, cut })
  }

  // Best first, then keep one only if it clears the spacing from every pick
  // already taken.
  const order = [...usable].sort((a, b) => {
    const score = (p: TilePick) => p.candidate.scores.onTarget ?? 50
    return score(b) - score(a)
  })
  const picks: TilePick[] = []
  for (const pick of order) {
    if (picks.length >= settings.count) break
    if (picks.every(p => Math.abs(p.cut - pick.cut) >= settings.spacing)) picks.push(pick)
  }
  picks.sort((a, b) => a.cut - b.cut)

  const gaps: [number, number][] = []
  let from = region.start
  for (const pick of picks) {
    if (pick.cut - from > settings.spacing) gaps.push([from, pick.cut])
    from = pick.cut
  }
  if (region.end - from > settings.spacing) gaps.push([from, region.end])

  return { picks, gaps, skipped }
}

/** The set as a table to paste or save, one row per guide. */
export function tilingCsv(plan: TilePlan, nucleaseName: string): string {
  const rows = [['name', 'spacer', 'pam', 'cut', 'strand', 'score', 'nuclease'].join(',')]
  plan.picks.forEach((pick, i) => {
    const { site, } = pick.candidate
    rows.push(csvRow([
      `guide_${i + 1}`,
      site.spacer,
      site.pam,
      pick.cut + 1,
      site.strand === 1 ? '+' : '-',
      pick.candidate.scores.onTarget === null ? '' : pick.candidate.scores.onTarget,
      nucleaseName,
    ]))
  })
  return rows.join('\n')
}
