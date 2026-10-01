/**
 * Tracks for a Sanger read's overview: per-base quality with the cut-off and
 * trimmed ends, then a row each for N calls, mixed bases and search hits.
 */

import type { MinimapTrack } from './types'
import { rampColor } from './theme'
import { profileTrack } from './tracks/profile'
import { markerTrack } from './tracks/markers'

/** Phred score that fills the quality track. */
const MAX_Q = 60
/** The ramp's top step starts at Q30, the usual "good base" line. */
const Q_GOOD = 40

export interface ChromatogramTrackInput {
  bases: string
  quality: readonly number[]
  trimStart: number
  trimEnd: number
  threshold: number
  mixedBases: ReadonlySet<number>
  searchHits: readonly number[]
  searchLength: number
}

export function chromatogramTracks(i: ChromatogramTrackInput): MinimapTrack[] {
  const n = i.bases.length
  const nCalls: number[] = []
  for (let p = 0; p < n; p++) if (i.bases.charCodeAt(p) === 78 || i.bases.charCodeAt(p) === 110) nCalls.push(p)
  const mixed = [...i.mixedBases].sort((a, b) => a - b)
  const trimmed = (p: number) => p < i.trimStart || p >= i.trimEnd

  return [
    profileTrack({
      id: 'quality',
      values: i.quality,
      max: MAX_Q,
      height: 18,
      caption: 'Quality',
      threshold: i.threshold,
      excluded: [[0, i.trimStart], [i.trimEnd, n]],
      color: (theme, q) => rampColor(theme, q / Q_GOOD),
      describe: (p, q) => ({
        label: `Q${Math.round(q)}`,
        detail: `${i.bases[p] ?? ''}${trimmed(p) ? ' · trimmed' : q < i.threshold ? ' · below cut-off' : ''}`,
      }),
    }),
    markerTrack('read-markers', [
      { label: 'N call', positions: nCalls, color: t => t.danger },
      { label: 'Mixed base', positions: mixed, color: t => t.warning },
      { label: 'Search hit', positions: i.searchHits, width: Math.max(1, i.searchLength), color: t => t.accent },
    ]),
  ]
}
