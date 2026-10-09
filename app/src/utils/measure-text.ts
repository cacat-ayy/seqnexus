/**
 * Text width in a font, measured on one offscreen canvas and cached. Labels
 * are laid out every frame and hit-tested on every mouse move, but the set of
 * distinct strings is small, so the cache is what keeps that cheap. The
 * plasmid layout and its SVG export share it too, so both place every label
 * identically.
 */

let ctx: CanvasRenderingContext2D | null = null
const cache = new Map<string, number>()
const CACHE_LIMIT = 5000

export function measureText(text: string, font: string): number {
  const key = `${font}\u0000${text}`
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  if (!ctx) ctx = document.createElement('canvas').getContext('2d')
  let w: number
  if (ctx) {
    ctx.font = font
    w = ctx.measureText(text).width
  } else {
    // No 2D context (a test, or a page without canvas): a rough width keeps layout going.
    w = text.length * 6
  }
  if (cache.size > CACHE_LIMIT) cache.clear()
  cache.set(key, w)
  return w
}

/** Forget every measured width, after the families behind a font string changed. */
export function clearMeasureCache(): void {
  cache.clear()
}
