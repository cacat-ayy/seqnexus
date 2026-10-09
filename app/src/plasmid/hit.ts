/**
 * What is under the pointer on a plasmid map.
 *
 * Shared by the map view and the cloning workspace's maps, which used to carry
 * one copy each of a test that returned the first enzyme mark within 14 px.
 * In a multiple cloning site a dozen marks sit a pixel or two apart on the
 * backbone, so "first within 14 px" meant whichever site happened to come
 * first in the list, wherever the pointer was. The order now is:
 *
 * 1. A cut-site name, over the whole of its text. The layout has already
 *    spread the names out so none overlap, which makes them the one target
 *    in a crowded stretch that can be hit on purpose.
 * 2. The nearest mark on the backbone, not the first one in range.
 * 3. A feature or primer arc, the topmost (last drawn) first.
 */

import type { HitRegion, PlasmidScene } from './scene'
import { normalizeAngle } from './geometry'

/** Slack around a name's text, along it and across it. Across is kept under
 *  half the gap between two rows of names, so a click between rows still
 *  lands on the nearer one rather than on both. */
const ALONG_PAD = 3
const ACROSS_PAD = 1.5

/** Where a point falls in a name's own frame: x along the text, y across it. */
function local(r: Extract<HitRegion, { kind: 'label' }>, x: number, y: number) {
  const dx = x - r.x
  const dy = y - r.y
  const c = Math.cos(-r.rotate)
  const s = Math.sin(-r.rotate)
  return { u: dx * c - dy * s, v: dx * s + dy * c }
}

export function hitTestScene(scene: PlasmidScene, x: number, y: number): HitRegion | null {
  let best: HitRegion | null = null
  let bestDist = Infinity

  for (const r of scene.hitRegions) {
    if (r.kind !== 'label') continue
    const { u, v } = local(r, x, y)
    if (Math.abs(u) > r.w / 2 + ALONG_PAD || Math.abs(v) > r.h / 2 + ACROSS_PAD) continue
    // Two boxes can only both contain the point within their padding; the
    // one whose middle is closer is the one meant.
    const d = (u / (r.w / 2 + ALONG_PAD)) ** 2 + (v / (r.h / 2 + ACROSS_PAD)) ** 2
    if (d < bestDist) { best = r; bestDist = d }
  }
  if (best) return best

  for (const r of scene.hitRegions) {
    if (r.kind !== 'point') continue
    const d = (x - r.x) ** 2 + (y - r.y) ** 2
    if (d < r.r * r.r && d < bestDist) { best = r; bestDist = d }
  }
  if (best) return best

  const c = scene.size / 2
  const dist = Math.hypot(x - c, y - c)
  const angle = Math.atan2(y - c, x - c)
  for (let i = scene.hitRegions.length - 1; i >= 0; i--) {
    const r = scene.hitRegions[i]
    if (r.kind !== 'arc') continue
    if (dist < r.radius - r.halfWidth || dist > r.radius + r.halfWidth) continue
    if (normalizeAngle(angle - r.startAngle) <= r.span) return r
  }
  return null
}
