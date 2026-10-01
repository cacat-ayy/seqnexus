/**
 * Feature lanes either side of a backbone: forward strand above, reverse
 * below, each strand's first lane hugging the backbone.
 *
 * When a strand needs more lanes than fit, its outermost lane becomes an
 * overflow lane holding everything left over, drawn fainter; hovering it
 * names what is stacked there. Nothing is dropped.
 */

import type { MinimapHit, MinimapTrack, TrackArea } from '../types'
import { packLanes, spanContains, type Span } from '../geometry'
import { visibleStroke } from '../../../utils/color'

export interface FeatureLike extends Span {
  id: string
  name: string
  type: string
  strand: number
  color: string
}

const LANE_H = 4
const LANE_GAP = 1
const BACKBONE_H = 2
const OVERFLOW_ALPHA = 0.55

interface Strand<T> {
  lanes: T[][]
  overflow: T[]
}

export interface FeatureTrackOptions<T extends FeatureLike> {
  features: readonly T[]
  /** Lanes per strand, including the overflow lane. */
  maxLanes?: number
  /** "1,201–2,000"-style range label for the readout. */
  formatRange: (start: number, end: number) => string
}

export function featureTrack<T extends FeatureLike>({ features, maxLanes = 3, formatRange }: FeatureTrackOptions<T>): MinimapTrack {
  const fwd: T[] = []
  const rev: T[] = []
  for (const f of features) (f.strand === -1 ? rev : fwd).push(f)
  const strands: [Strand<T>, Strand<T>] = [packLanes(fwd, maxLanes), packLanes(rev, maxLanes)]

  const strandH = maxLanes * (LANE_H + LANE_GAP)
  const height = strandH * 2 + BACKBONE_H + 2

  /** Top y of a lane; `slot` counts outward from the backbone, overflow last. */
  const laneY = (a: TrackArea, strand: 0 | 1, slot: number) =>
    strand === 0
      ? a.y + strandH - (slot + 1) * (LANE_H + LANE_GAP)
      : a.y + strandH + BACKBONE_H + 2 + slot * (LANE_H + LANE_GAP)

  /** Every lane, outward from the backbone, with the overflow lane last. */
  const lanesOf = (s: Strand<T>): { items: T[]; overflow: boolean }[] => {
    const out = s.lanes.map(items => ({ items, overflow: false }))
    if (s.overflow.length > 0) out.push({ items: s.overflow, overflow: true })
    return out
  }

  const segments = (f: T, length: number): [number, number][] =>
    f.end >= f.start ? [[f.start, f.end]] : [[f.start, length], [0, f.end]]

  const paint = (ctx: CanvasRenderingContext2D, a: TrackArea, items: readonly T[], y: number, h: number) => {
    const byColor = new Map<string, [number, number][]>()
    for (const f of items) {
      let rects = byColor.get(f.color)
      if (!rects) byColor.set(f.color, rects = [])
      for (const [s, e] of segments(f, a.length)) {
        const x1 = a.toX(s)
        rects.push([x1, Math.max(1, a.toX(e) - x1)])
      }
    }
    for (const [color, rects] of byColor) {
      ctx.fillStyle = color
      for (const [x, w] of rects) ctx.fillRect(x, y, w, h)
      // Pale colours get a darker edge so they read against the background.
      const stroke = visibleStroke(color)
      if (stroke !== color) {
        ctx.strokeStyle = stroke
        ctx.lineWidth = 0.5
        for (const [x, w] of rects) if (w > 2) ctx.strokeRect(x + 0.25, y + 0.25, w - 0.5, h - 0.5)
      }
    }
  }

  const describe = (f: T): MinimapHit => ({
    label: f.name || f.type,
    detail: `${f.type} · ${formatRange(f.start, f.end)}${f.strand === -1 ? ' · reverse' : f.strand === 1 ? ' · forward' : ''}`,
    color: f.color,
    itemId: f.id,
  })

  // Where items overlap, the smallest is the one the pointer is most likely after.
  const shortest = (items: T[]) =>
    items.reduce((best, f) => (spanLen(f) < spanLen(best) ? f : best))

  return {
    id: 'features',
    height,
    draw(ctx, a, theme) {
      ctx.fillStyle = theme.ink
      ctx.fillRect(a.x, a.y + strandH + 1, a.w, BACKBONE_H)
      strands.forEach((s, si) => {
        lanesOf(s).forEach((lane, slot) => {
          ctx.globalAlpha = lane.overflow ? OVERFLOW_ALPHA : 1
          paint(ctx, a, lane.items, laneY(a, si as 0 | 1, slot), LANE_H)
        })
      })
      ctx.globalAlpha = 1
    },
    drawCompact(ctx, a, theme) {
      ctx.fillStyle = theme.ink
      ctx.globalAlpha = 0.5
      ctx.fillRect(a.x, a.y + a.h / 2 - 0.5, a.w, 1)
      ctx.globalAlpha = 1
      paint(ctx, a, features, a.y + 1, Math.max(1, a.h - 2))
    },
    hit(pos, y, unitsPerPx) {
      const strand: 0 | 1 = y < strandH + 1 ? 0 : 1
      const slot = strand === 0
        ? Math.floor((strandH - y) / (LANE_H + LANE_GAP))
        : Math.floor((y - strandH - BACKBONE_H - 2) / (LANE_H + LANE_GAP))
      const lane = lanesOf(strands[strand])[slot]
      if (!lane) return null
      const slop = unitsPerPx * 1.5
      const under = lane.items.filter(f => spanContains(f, pos, slop))
      if (under.length === 0) return null
      if (under.length === 1 || !lane.overflow) return describe(shortest(under))
      const names = under.slice(0, 3).map(f => f.name || f.type).join(', ')
      return {
        label: `${under.length} overlapping features`,
        detail: under.length > 3 ? `${names}, …` : names,
      }
    },
    highlight(ctx, a, theme, itemId) {
      strands.forEach((s, si) => {
        lanesOf(s).forEach((lane, slot) => {
          const f = lane.items.find(i => i.id === itemId)
          if (!f) return
          const y = laneY(a, si as 0 | 1, slot)
          ctx.strokeStyle = theme.accent
          ctx.lineWidth = 1.5
          for (const [st, e] of segments(f, a.length)) {
            const x1 = a.toX(st)
            ctx.strokeRect(x1 - 1, y - 1, Math.max(1, a.toX(e) - x1) + 2, LANE_H + 2)
          }
        })
      })
    },
  }
}

/** Length of a span; one wrapping the origin counts as longest. */
function spanLen(s: Span): number {
  return s.end >= s.start ? s.end - s.start : Infinity
}
