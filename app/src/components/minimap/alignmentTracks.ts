/**
 * Tracks for the alignment overview: conservation, then a row each for
 * variable columns, gap columns and search hits.
 */

import type { AlignmentResult } from '../../alignment/types'
import type { MinimapTrack } from './types'
import { rampColor } from './theme'
import { profileTrack } from './tracks/profile'
import { markerTrack } from './tracks/markers'

export function alignmentTracks(
  result: AlignmentResult,
  searchHits: readonly { col: number; len: number }[],
): MinimapTrack[] {
  const { conservation, consensus, sequences, alignmentLength } = result
  const variable: number[] = []
  const gaps: number[] = []
  for (let c = 0; c < alignmentLength; c++) {
    if (conservation[c] < 1) variable.push(c)
    if (sequences.some(s => s.alignedBases[c] === '-')) gaps.push(c)
  }
  // Hits in several sequences at one column are one marker.
  const hitCols = [...new Set(searchHits.map(h => h.col))].sort((a, b) => a - b)
  const hitLen = searchHits[0]?.len ?? 1

  return [
    profileTrack({
      id: 'conservation',
      values: conservation,
      max: 1,
      height: 18,
      caption: 'Conservation',
      color: (theme, v) => rampColor(theme, v),
      describe: (col, v) => ({
        label: `${Math.round(v * 100)}% conserved`,
        detail: `consensus ${consensus[col] ?? '–'}`,
      }),
    }),
    markerTrack('alignment-markers', [
      { label: 'Variable column', positions: variable, color: t => t.warning },
      { label: 'Gap', positions: gaps, color: t => t.muted },
      { label: 'Search hit', positions: hitCols, width: hitLen, color: t => t.accent },
    ]),
  ]
}
