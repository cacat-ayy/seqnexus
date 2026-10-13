/**
 * Drawing pieces the track views share: text cut to a width, and a ruler
 * along reference positions at any scale.
 */

import type { AlnTheme } from '../alignment/theme'

/** `text`, cut with an ellipsis to fit `max` pixels in the context's font. */
export function truncate(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text
  let lo = 0
  let hi = text.length
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (ctx.measureText(text.slice(0, mid) + '…').width <= max) lo = mid
    else hi = mid - 1
  }
  return text.slice(0, lo) + '…'
}

/** A tick step of 1, 2 or 5 times a power of ten, at least `minPx` pixels apart at `pxPerUnit`. */
export function tickStep(pxPerUnit: number, minPx = 70): number {
  if (!(pxPerUnit > 0)) return 1
  let step = 1
  for (;;) {
    for (const m of [1, 2, 5]) if (m * step * pxPerUnit >= minPx) return m * step
    step *= 10
  }
}

/** Position as a ruler label: 1,500 or 2.5 kb or 1.2 Mb, short enough for the spacing. */
export function positionLabel(pos: number, step: number): string {
  if (step >= 1_000_000) return `${pos / 1_000_000} Mb`
  if (step >= 1000 && pos >= 10_000) return `${(pos / 1000).toLocaleString('en-US')} kb`
  return pos.toLocaleString('en-US')
}

/**
 * A ruler of 1-based reference positions across [x0, x1) pixels, where
 * position p (0-based) starts at `xOf(p)` and is `pxPerBase` wide. Ticks sit
 * at the centre of their base.
 */
export function paintPositionRuler(
  ctx: CanvasRenderingContext2D,
  theme: AlnTheme,
  o: { y0: number; y1: number; x0: number; x1: number; pxPerBase: number; xOf: (p: number) => number; first: number; last: number },
): void {
  const { y1, x0, x1, pxPerBase } = o
  ctx.fillStyle = theme.grid
  ctx.fillRect(x0, y1 - 1, x1 - x0, 1)
  ctx.font = `500 10px ${theme.sans}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  const step = tickStep(pxPerBase)
  const start = Math.max(step, Math.ceil((o.first + 1) / step) * step)
  for (let num = start; num <= o.last; num += step) {
    const x = o.xOf(num - 1) + pxPerBase / 2
    if (x < x0 - 40 || x > x1 + 40) continue
    ctx.fillStyle = theme.grid
    ctx.fillRect(Math.round(x), y1 - 5, 1, 4)
    ctx.fillStyle = theme.muted
    ctx.fillText(positionLabel(num, step), x, o.y0 + 11)
  }
  ctx.textBaseline = 'middle'
}
