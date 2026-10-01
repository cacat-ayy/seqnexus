/**
 * The alignment's minimap tracks, and the columns where rows disagree with
 * the comparison (for "previous / next difference").
 */

import { GAP_SYM, NSYM, symOf } from '../../msa/stats'
import type { MinimapTrack } from '../minimap/types'
import { rampColor } from '../minimap/theme'
import { profileTrack } from '../minimap/tracks/profile'
import { markerTrack } from '../minimap/tracks/markers'
import type { PaintModel } from './layout'

const DIFF_CACHE = new WeakMap<PaintModel, number[]>()

/** Columns where at least one row differs from the comparison (consensus or reference). */
export function differenceColumns(pm: PaintModel): number[] {
  let out = DIFF_CACHE.get(pm)
  if (out) return out
  out = []
  const { counts, rows } = pm.profile
  for (let c = 0; c < pm.width; c++) {
    const s = symOf(pm.compare[c] ?? '-')
    const same = s >= 0 ? counts[c * NSYM + s] : 0
    if (same < rows) out.push(c)
  }
  DIFF_CACHE.set(pm, out)
  return out
}

export function overviewTracks(pm: PaintModel, hits: readonly { c0: number; c1: number }[]): MinimapTrack[] {
  const gaps: number[] = []
  for (let c = 0; c < pm.width; c++) if (pm.profile.counts[c * NSYM + GAP_SYM] > 0) gaps.push(c)
  const hitCols = [...new Set(hits.map(h => h.c0))].sort((a, b) => a - b)
  const label = pm.doc.kind === 'protein' ? 'Similarity' : 'Identity'
  const against = pm.view.compareTo === 'reference' && pm.reference ? 'the reference' : 'the consensus'
  return [
    profileTrack({
      id: 'identity',
      values: pm.graph,
      max: 1,
      height: 18,
      caption: label,
      color: (theme, v) => rampColor(theme, v),
      describe: (col, v) => ({ label: `${Math.round(v * 100)}% ${label.toLowerCase()}`, detail: `consensus ${pm.consensus[col] ?? '–'}` }),
    }),
    markerTrack('alignment-markers', [
      { label: `Differs from ${against}`, positions: differenceColumns(pm), color: t => t.warning },
      { label: 'Gap', positions: gaps, color: t => t.muted },
      { label: 'Search hit', positions: hitCols, color: t => t.accent },
    ]),
  ]
}
