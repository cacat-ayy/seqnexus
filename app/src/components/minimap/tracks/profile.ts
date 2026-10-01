/**
 * A per-position value drawn as coloured bars: alignment conservation,
 * read quality. Values are binned to the pixel, so every position counts
 * toward some bar rather than one sample per pixel standing in for many.
 */

import type { MinimapHit, MinimapTheme, MinimapTrack } from '../types'
import { binValues } from '../geometry'
import { drawCaption } from '../theme'

export interface ProfileTrackOptions {
  id: string
  values: ArrayLike<number>
  /** The value that fills the track's full height. */
  max: number
  height: number
  color: (theme: MinimapTheme, value: number) => string
  /** Caption drawn in the top-left corner. */
  caption?: string
  /** A dashed guide at this value (a quality cut-off). */
  threshold?: number
  /** Stretches drawn faded, such as trimmed read ends. */
  excluded?: readonly (readonly [number, number])[]
  describe: (pos: number, value: number) => MinimapHit
}

export function profileTrack(o: ProfileTrackOptions): MinimapTrack {
  let cache: { bins: number; values: Float32Array } | null = null
  const binned = (bins: number) => {
    if (!cache || cache.bins !== bins) cache = { bins, values: binValues(o.values, bins, 'mean') }
    return cache.values
  }
  const n = o.values.length
  const frac = (v: number) => Math.max(0, Math.min(1, v / o.max))

  return {
    id: o.id,
    height: o.height,
    draw(ctx, a, theme) {
      if (n === 0) return
      // One bar per pixel, or per position when positions are wider.
      const bins = Math.max(1, Math.min(Math.round(a.w), n))
      const values = binned(bins)
      const bw = a.w / bins
      for (let b = 0; b < bins; b++) {
        const v = values[b]
        const h = frac(v) * a.h
        ctx.fillStyle = o.color(theme, v)
        ctx.fillRect(a.x + b * bw, a.y + a.h - h, Math.max(1, bw + 0.25), h)
      }
      for (const [s, e] of o.excluded ?? []) {
        if (e <= s) continue
        const x1 = a.toX(s)
        ctx.globalAlpha = 0.65
        ctx.fillStyle = theme.bg
        ctx.fillRect(x1, a.y, a.toX(e) - x1, a.h)
        ctx.globalAlpha = 1
      }
      if (o.threshold !== undefined) {
        const y = Math.round(a.y + a.h * (1 - frac(o.threshold))) + 0.5
        ctx.strokeStyle = theme.danger
        ctx.globalAlpha = 0.6
        ctx.setLineDash([2, 2])
        ctx.beginPath()
        ctx.moveTo(a.x, y)
        ctx.lineTo(a.x + a.w, y)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.globalAlpha = 1
      }
      if (o.caption) drawCaption(ctx, theme, o.caption, a.x + 2, a.y + 1)
    },
    drawCompact(ctx, a, theme) {
      if (n === 0) return
      const bins = Math.max(1, Math.min(Math.round(a.w), n))
      const values = binned(bins)
      const bw = a.w / bins
      for (let b = 0; b < bins; b++) {
        ctx.fillStyle = o.color(theme, values[b])
        ctx.fillRect(a.x + b * bw, a.y, Math.max(1, bw + 0.25), a.h)
      }
    },
    hit(pos) {
      if (n === 0) return null
      const i = Math.min(n - 1, Math.floor(pos))
      return o.describe(i, o.values[i])
    },
  }
}
