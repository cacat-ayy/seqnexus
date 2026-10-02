/**
 * The trace view's overview bar: quality along the read with the trimmed
 * ends faded, then markers for ambiguous calls, strong second peaks, edits
 * and find hits. Positions are display columns, like the main view.
 */

import { KIND_DELETE, KIND_INSERT } from '../../sanger/layout'
import type { TraceModel } from '../../sanger/model'
import type { TraceView } from '../../sanger/view'
import type { MinimapTrack } from '../minimap/types'
import { rampColor } from '../minimap/theme'
import { profileTrack } from '../minimap/tracks/profile'
import { markerTrack } from '../minimap/tracks/markers'

export function overviewTracks(m: TraceModel, view: TraceView, hits: readonly [number, number][]): MinimapTrack[] {
  const ambiguous: number[] = []
  const mixed: number[] = []
  const edited: number[] = []
  const quality = new Float32Array(m.n)
  for (let d = 0; d < m.n; d++) {
    const b = m.shown[d]
    const k = m.kind[d]
    if (k !== 0) edited.push(d)
    if (k !== KIND_DELETE && b !== 'A' && b !== 'C' && b !== 'G' && b !== 'T') ambiguous.push(d)
    if (k !== KIND_INSERT && m.secondRatio[d] >= view.mixedRatio) mixed.push(d)
    quality[d] = m.quality[d] < 0 ? 40 : m.quality[d]
  }
  const tracks: MinimapTrack[] = []
  if (!m.data.metadata.qualityMissing) {
    tracks.push(profileTrack({
      id: 'quality',
      values: quality,
      max: 60,
      height: 18,
      caption: 'Quality',
      threshold: view.qualityCutoff,
      excluded: [[0, m.trim[0]], [m.trim[1], m.n]],
      color: (theme, q) => rampColor(theme, q / 40),
      describe: (d, q) => ({
        label: m.quality[d] < 0 ? 'Inserted base' : `Q${Math.round(q)}`,
        detail: `${m.shown[d] ?? ''}${d < m.trim[0] || d >= m.trim[1] ? ' · trimmed' : ''}`,
      }),
    }))
  }
  const hitStarts = hits.map(h => h[0])
  const hitWidth = hits.length ? Math.max(1, hits[0][1] - hits[0][0]) : 1
  tracks.push(markerTrack('read-markers', [
    { label: 'Ambiguous call', positions: ambiguous, color: t => t.danger },
    { label: 'Second peak', positions: mixed, color: t => t.warning },
    { label: 'Edited base', positions: edited, color: t => t.accent },
    ...(hits.length ? [{ label: 'Find hit', positions: hitStarts, width: hitWidth, color: (t: { accent: string }) => t.accent }] : []),
  ]))
  return tracks
}
