/**
 * Rows of tick marks for sparse positions: N calls, mixed bases, alignment
 * differences, search hits. Each layer gets its own thin row so the kinds
 * never hide each other, and every marker is at least a pixel wide however
 * long the sequence.
 */

import type { MinimapTheme, MinimapTrack } from '../types'

export interface MarkerLayer {
  label: string
  /** Sorted start positions; each marker covers [start, start + width). */
  positions: readonly number[]
  /** Units each marker covers (a search hit's length). Defaults to 1. */
  width?: number
  color: (theme: MinimapTheme) => string
}

const ROW_H = 4
const ROW_GAP = 1

export function markerTrack(id: string, layers: readonly MarkerLayer[]): MinimapTrack {
  const height = Math.max(1, layers.length * (ROW_H + ROW_GAP) - ROW_GAP)
  return {
    id,
    height,
    draw(ctx, a, theme) {
      layers.forEach((layer, row) => {
        const y = a.y + row * (ROW_H + ROW_GAP)
        ctx.fillStyle = theme.grid
        ctx.globalAlpha = 0.5
        ctx.fillRect(a.x, y + ROW_H / 2 - 0.5, a.w, 1)
        ctx.globalAlpha = 1
        ctx.fillStyle = layer.color(theme)
        // Merge markers that land in the same pixel column into one rect.
        let runX = -1
        let runEnd = -1
        const flush = () => { if (runX >= 0) ctx.fillRect(runX, y, Math.max(1, runEnd - runX), ROW_H) }
        for (const p of layer.positions) {
          const x1 = Math.floor(a.toX(p))
          const x2 = Math.max(x1 + 1, Math.ceil(a.toX(p + (layer.width ?? 1))))
          if (x1 <= runEnd) runEnd = Math.max(runEnd, x2)
          else { flush(); runX = x1; runEnd = x2 }
        }
        flush()
      })
    },
    hit(pos, y, unitsPerPx, theme) {
      const layer = layers[Math.floor(y / (ROW_H + ROW_GAP))]
      if (!layer || layer.positions.length === 0) return null
      const slop = Math.max(0.5, unitsPerPx * 2)
      const w = layer.width ?? 1
      const near = nearest(layer.positions, pos - w / 2)
      if (near === null || Math.abs(near + w / 2 - pos) > slop + w / 2) return null
      const total = layer.positions.length
      return { label: layer.label, detail: `${total.toLocaleString()} in total`, color: layer.color(theme) }
    },
  }
}

/** The value in a sorted list closest to `target`. */
function nearest(sorted: readonly number[], target: number): number | null {
  if (sorted.length === 0) return null
  let lo = 0
  let hi = sorted.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (sorted[mid] < target) lo = mid + 1
    else hi = mid
  }
  const after = sorted[lo]
  const before = lo > 0 ? sorted[lo - 1] : after
  return Math.abs(before - target) <= Math.abs(after - target) ? before : after
}
