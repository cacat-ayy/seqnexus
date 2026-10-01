/**
 * Restriction cut sites: a tick per site, with the enzymes that cut only
 * once — the ones that matter for cloning — drawn full height and named.
 * Enzymes with several sites get short, faint ticks; sites blocked by
 * methylation are drawn faded and left unlabelled.
 */

import type { MinimapTrack, MinimapTheme, TrackArea } from '../types'
import { enzymeGroupKey, type GroupedCutSite } from '../../../enzymes/grouping'

export interface CutMark {
  /** Stable identity; the hovered item id is `enzyme:<key>`. */
  key: string
  label: string
  /** Cut position on the top strand. */
  pos: number
  /** Fewest sites any enzyme in this group has; 1 means a unique cutter. */
  sites: number
  methylation: 'blocked' | 'impaired' | null
}

const LABEL_H = 12
const TICK_H = 7
const SHORT_TICK_H = 3
const LABEL_GAP = 4

export const ENZYME_ITEM_PREFIX = 'enzyme:'

export function cutSiteTrack(marks: readonly CutMark[], formatPosition: (pos: number) => string): MinimapTrack {
  const sorted = [...marks].sort((a, b) => a.pos - b.pos)
  const unique = sorted.filter(m => m.sites === 1)
  // Label extents from the last draw, in units, for hit-testing the label row.
  let labelSpans: { start: number; end: number; mark: CutMark }[] = []

  const tickX = (a: TrackArea, m: CutMark) => Math.round(a.toX(m.pos)) + 0.5

  const drawTick = (ctx: CanvasRenderingContext2D, a: TrackArea, theme: MinimapTheme, m: CutMark) => {
    const x = tickX(a, m)
    const h = m.sites === 1 ? TICK_H : SHORT_TICK_H
    const bottom = a.y + a.h
    ctx.strokeStyle = theme.enzyme
    ctx.globalAlpha = m.methylation === 'blocked' ? 0.35 : m.sites === 1 ? 1 : 0.45
    ctx.lineWidth = m.sites === 1 ? 1.5 : 1
    ctx.beginPath()
    ctx.moveTo(x, bottom - h)
    ctx.lineTo(x, bottom)
    ctx.stroke()
  }

  return {
    id: 'cut-sites',
    height: LABEL_H + TICK_H,
    draw(ctx, a, theme) {
      ctx.fillStyle = theme.grid
      ctx.fillRect(a.x, a.y + a.h - 0.5, a.w, 1)
      // Repeat cutters first so unique cutters draw on top of them.
      for (const m of sorted) if (m.sites !== 1) drawTick(ctx, a, theme, m)
      for (const m of unique) drawTick(ctx, a, theme, m)
      ctx.globalAlpha = 1

      ctx.font = `10px ${theme.font}`
      ctx.textBaseline = 'top'
      ctx.textAlign = 'left'
      labelSpans = []
      let lastRight = -Infinity
      const unitsPerPx = a.w > 0 ? a.length / a.w : 1
      for (const m of unique) {
        if (m.methylation === 'blocked') continue
        const w = ctx.measureText(m.label).width
        const left = Math.max(a.x, Math.min(a.x + a.w - w, a.toX(m.pos) - w / 2))
        if (left < lastRight + LABEL_GAP) continue
        ctx.lineJoin = 'round'
        ctx.lineWidth = 3
        ctx.strokeStyle = theme.bg
        ctx.strokeText(m.label, left, a.y + 1)
        ctx.fillStyle = theme.enzyme
        ctx.fillText(m.label, left, a.y + 1)
        lastRight = left + w
        labelSpans.push({ start: (left - a.x) * unitsPerPx, end: (left + w - a.x) * unitsPerPx, mark: m })
      }
    },
    hit(pos, y, unitsPerPx, theme) {
      let mark: CutMark | undefined
      if (y < LABEL_H) mark = labelSpans.find(s => pos >= s.start && pos <= s.end)?.mark
      if (!mark) {
        const slop = Math.max(0.5, unitsPerPx * 3)
        let best = Infinity
        for (const m of sorted) {
          const d = Math.abs(m.pos - pos)
          // Prefer a unique cutter when two sites are equally close.
          if (d <= slop && (d < best || (d === best && m.sites === 1))) { best = d; mark = m }
        }
      }
      if (!mark) return null
      const count = mark.sites === 1 ? 'unique cutter' : `${mark.sites} sites`
      const meth = mark.methylation ? ` · ${mark.methylation} by methylation` : ''
      return {
        label: mark.label,
        detail: `cuts at ${formatPosition(mark.pos)} · ${count}${meth}`,
        color: theme.enzyme,
        itemId: ENZYME_ITEM_PREFIX + mark.key,
      }
    },
    highlight(ctx, a, theme, itemId) {
      if (!itemId.startsWith(ENZYME_ITEM_PREFIX)) return
      const key = itemId.slice(ENZYME_ITEM_PREFIX.length)
      const m = sorted.find(s => s.key === key)
      if (!m) return
      const x = tickX(a, m)
      ctx.strokeStyle = theme.accent
      ctx.lineWidth = 1.5
      ctx.strokeRect(x - 2.5, a.y + a.h - TICK_H - 1.5, 5, TICK_H + 1)
    },
  }
}

/**
 * One mark per group, at its cut. A group counts as a unique cutter when any
 * of its enzymes cuts the sequence exactly once.
 */
export function toCutMarks(groups: readonly GroupedCutSite[], seqLen: number): CutMark[] {
  const perEnzyme = new Map<string, number>()
  for (const g of groups) for (const s of g.sites) perEnzyme.set(s.enzyme.name, (perEnzyme.get(s.enzyme.name) ?? 0) + 1)
  return groups.map(g => ({
    key: enzymeGroupKey(g),
    label: g.label,
    pos: seqLen > 0 ? ((g.fwdCut % seqLen) + seqLen) % seqLen : 0,
    sites: Math.min(...g.sites.map(s => perEnzyme.get(s.enzyme.name) ?? 1)),
    methylation: g.methEffect,
  }))
}
