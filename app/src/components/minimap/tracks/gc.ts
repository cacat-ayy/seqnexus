/**
 * GC content along the sequence, as a filled line against a 50% guide, with
 * the whole-sequence mean as its caption.
 */

import type { MinimapTrack } from '../types'
import { gcMean, gcProfile, type GcIndex } from '../geometry'
import { drawCaption } from '../theme'

const HEIGHT = 20
/** Floor on the averaging window, as a fraction of the sequence. */
const MIN_WINDOW_FRACTION = 1 / 100
/** And in bases, so short sequences are not smoothed into a flat line. */
const MIN_WINDOW_BASES = 20

export function gcTrack(index: GcIndex): MinimapTrack {
  const minWindow = Math.max(MIN_WINDOW_BASES, index.length * MIN_WINDOW_FRACTION)
  const mean = gcMean(index)
  // The profile depends on the bar's width; keep the last one.
  let cache: { bins: number; values: Float32Array } | null = null
  const profile = (bins: number) => {
    if (!cache || cache.bins !== bins) cache = { bins, values: gcProfile(index, bins, minWindow) }
    return cache.values
  }

  return {
    id: 'gc',
    height: HEIGHT,
    draw(ctx, a, theme) {
      const bins = Math.max(1, Math.round(a.w))
      const values = profile(bins)
      const yOf = (v: number) => a.y + 1 + (a.h - 2) * (1 - v)

      ctx.strokeStyle = theme.grid
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(a.x, Math.round(yOf(0.5)) + 0.5)
      ctx.lineTo(a.x + a.w, Math.round(yOf(0.5)) + 0.5)
      ctx.stroke()

      ctx.beginPath()
      ctx.moveTo(a.x, a.y + a.h)
      for (let b = 0; b < bins; b++) ctx.lineTo(a.x + ((b + 0.5) / bins) * a.w, yOf(values[b]))
      ctx.lineTo(a.x + a.w, a.y + a.h)
      ctx.closePath()
      ctx.fillStyle = theme.gc
      ctx.globalAlpha = 0.15
      ctx.fill()
      ctx.globalAlpha = 0.8

      ctx.beginPath()
      for (let b = 0; b < bins; b++) {
        const x = a.x + ((b + 0.5) / bins) * a.w
        if (b === 0) ctx.moveTo(x, yOf(values[b]))
        else ctx.lineTo(x, yOf(values[b]))
      }
      ctx.strokeStyle = theme.gc
      ctx.stroke()
      ctx.globalAlpha = 1

      drawCaption(ctx, theme, `GC ${Math.round(mean * 100)}%`, a.x + 2, a.y + 1)
    },
    hit(pos) {
      if (!cache) return null
      const b = Math.min(cache.bins - 1, Math.floor((pos / Math.max(1, index.length)) * cache.bins))
      return { label: `GC ${Math.round(cache.values[b] * 100)}%`, detail: `sequence mean ${Math.round(mean * 100)}%` }
    },
  }
}
