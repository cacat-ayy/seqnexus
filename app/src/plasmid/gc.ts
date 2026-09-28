/**
 * GC content and GC skew tracks for the map.
 *
 * Sampled to a fixed number of windows rather than a fixed window size, so the
 * cost is the same for a 3 kb plasmid and a 5 Mb genome and the ring never
 * draws more arcs than there are pixels to hold them.
 */

import type { SceneGcSeries } from './scene'

/** One sample per half degree. More is invisible at any realistic map size. */
export const GC_WINDOWS = 720

export interface MethylationSites {
  dam: number[]
  dcm: number[]
}

export function computeGcSeries(bases: string, windows = GC_WINDOWS): SceneGcSeries | null {
  const len = bases.length
  if (len < windows) return null

  const content: number[] = new Array(windows)
  const skew: number[] = new Array(windows)
  const step = len / windows

  let maxAbsSkew = 0
  for (let i = 0; i < windows; i++) {
    const from = Math.floor(i * step)
    const to = Math.floor((i + 1) * step)
    let g = 0, c = 0, at = 0
    for (let j = from; j < to; j++) {
      const ch = bases.charCodeAt(j)
      // Upper and lower case, without allocating a substring per window.
      if (ch === 71 || ch === 103) g++
      else if (ch === 67 || ch === 99) c++
      else at++
    }
    const gc = g + c
    const total = gc + at
    content[i] = total > 0 ? gc / total : 0
    const s = gc > 0 ? (g - c) / gc : 0
    skew[i] = s
    if (Math.abs(s) > maxAbsSkew) maxAbsSkew = Math.abs(s)
  }

  // Normalise skew to fill the track, otherwise a typical plasmid's skew of
  // about ±0.05 is a flat line.
  if (maxAbsSkew > 0) {
    for (let i = 0; i < windows; i++) skew[i] = skew[i] / maxAbsSkew
  }

  return { content, skew }
}

/**
 * Positions of Dam (GATC) and Dcm (CCWGG) sites.
 *
 * Only called when the corresponding flag is on. This used to run inside the
 * draw call, so it walked the whole sequence again on every hover.
 */
export function findMethylationSites(
  bases: string,
  dam: boolean,
  dcm: boolean,
): MethylationSites {
  const result: MethylationSites = { dam: [], dcm: [] }
  if (!dam && !dcm) return result

  const s = bases.toUpperCase()
  if (dam) {
    for (let i = 0; i <= s.length - 4; i++) {
      if (s[i] === 'G' && s[i + 1] === 'A' && s[i + 2] === 'T' && s[i + 3] === 'C') {
        result.dam.push(i + 2)
      }
    }
  }
  if (dcm) {
    for (let i = 0; i <= s.length - 5; i++) {
      if (
        s[i] === 'C' && s[i + 1] === 'C'
        && (s[i + 2] === 'A' || s[i + 2] === 'T')
        && s[i + 3] === 'G' && s[i + 4] === 'G'
      ) {
        result.dcm.push(i + 2)
      }
    }
  }
  return result
}
