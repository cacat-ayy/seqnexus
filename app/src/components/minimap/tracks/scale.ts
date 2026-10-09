/**
 * A windowed residue scale (hydropathy, charge, flexibility) along a
 * protein, as a filled line against its guide value, captioned with the
 * scale's name. The hover readout gives the value under the pointer and
 * which way it leans.
 */

import type { MinimapTrack } from '../types'
import { drawCaption } from '../theme'
import type { ProteinScale } from '../../../protein/scales'

const HEIGHT = 20

/** The mean of `values` over each of `bins` equal stretches, NaN skipped. */
function binned(values: Float32Array, bins: number): Float32Array {
  const out = new Float32Array(bins)
  const n = values.length
  for (let b = 0; b < bins; b++) {
    const s = Math.floor((b / bins) * n)
    const e = Math.max(s + 1, Math.floor(((b + 1) / bins) * n))
    let sum = 0
    let count = 0
    for (let i = s; i < e && i < n; i++) {
      const v = values[i]
      if (!Number.isNaN(v)) { sum += v; count++ }
    }
    out[b] = count > 0 ? sum / count : NaN
  }
  return out
}

export function scaleTrack(values: Float32Array, scale: ProteinScale, window: number): MinimapTrack {
  let cache: { bins: number; values: Float32Array } | null = null
  const profile = (bins: number) => {
    if (!cache || cache.bins !== bins) cache = { bins, values: binned(values, bins) }
    return cache.values
  }
  const span = scale.max - scale.min
  const unit = (v: number) => Math.max(0, Math.min(1, (v - scale.min) / span))

  return {
    id: `profile-${scale.id}`,
    height: HEIGHT,
    draw(ctx, a, theme) {
      const bins = Math.max(1, Math.min(Math.round(a.w), values.length))
      const vals = profile(bins)
      const yOf = (v: number) => a.y + 1 + (a.h - 2) * (1 - unit(v))
      const xOf = (b: number) => a.x + ((b + 0.5) / bins) * a.w
      const midY = Math.round(yOf(scale.mid)) + 0.5

      ctx.strokeStyle = theme.grid
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(a.x, midY)
      ctx.lineTo(a.x + a.w, midY)
      ctx.stroke()

      // Filled from the guide line, so above and below read as two tones of
      // the same thing rather than as a mountain range.
      ctx.beginPath()
      ctx.moveTo(a.x, midY)
      for (let b = 0; b < bins; b++) ctx.lineTo(xOf(b), Number.isNaN(vals[b]) ? midY : yOf(vals[b]))
      ctx.lineTo(a.x + a.w, midY)
      ctx.closePath()
      ctx.fillStyle = theme.accent
      ctx.globalAlpha = 0.15
      ctx.fill()
      ctx.globalAlpha = 0.8

      ctx.beginPath()
      let pen = false
      for (let b = 0; b < bins; b++) {
        if (Number.isNaN(vals[b])) { pen = false; continue }
        if (!pen) { ctx.moveTo(xOf(b), yOf(vals[b])); pen = true }
        else ctx.lineTo(xOf(b), yOf(vals[b]))
      }
      ctx.strokeStyle = theme.accent
      ctx.stroke()
      ctx.globalAlpha = 1

      drawCaption(ctx, theme, `${scale.short} (${window})`, a.x + 2, a.y + 1)
    },
    hit(pos) {
      if (!cache) return null
      const b = Math.min(cache.bins - 1, Math.floor((pos / Math.max(1, values.length)) * cache.bins))
      const v = cache.values[b]
      if (Number.isNaN(v)) return null
      const lean = v > scale.mid ? scale.above : v < scale.mid ? scale.below : 'neutral'
      return { label: `${scale.short} ${v.toFixed(2)}`, detail: `${lean}, window ${window}` }
    },
  }
}
