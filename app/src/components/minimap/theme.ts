/**
 * Theme colours for the minimap canvases.
 *
 * Read from the `--minimap-*` tokens (App.css) at draw time, so a theme
 * switch only needs a repaint. The old bar hardcoded #333 for its backbone and
 * black washes for dimming, both near invisible on the dark themes.
 */

import type { MinimapTheme } from './types'

const FALLBACK: MinimapTheme = {
  bg: '#ffffff',
  ink: '#64748b',
  muted: '#64748b',
  grid: '#e2e8f0',
  accent: '#6366f1',
  dim: '#ffffff',
  gc: '#16a34a',
  enzyme: '#e53e3e',
  good: '#22c55e',
  fair: '#eab308',
  poor: '#f97316',
  bad: '#ef4444',
  danger: '#ef4444',
  warning: '#b45309',
  font: 'sans-serif',
}

export function readTheme(el: Element): MinimapTheme {
  const cs = getComputedStyle(el)
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback
  const bg = v('--minimap-bg', FALLBACK.bg)
  return {
    bg,
    ink: v('--minimap-ink', FALLBACK.ink),
    muted: v('--minimap-muted', FALLBACK.muted),
    grid: v('--minimap-grid', FALLBACK.grid),
    accent: v('--accent', FALLBACK.accent),
    // Outside the viewport is washed toward the background, which reads as
    // "receded" on light and dark themes alike.
    dim: bg,
    gc: v('--minimap-gc', FALLBACK.gc),
    enzyme: v('--canvas-enzyme', FALLBACK.enzyme),
    good: v('--minimap-good', FALLBACK.good),
    fair: v('--minimap-fair', FALLBACK.fair),
    poor: v('--minimap-poor', FALLBACK.poor),
    bad: v('--minimap-bad', FALLBACK.bad),
    danger: v('--danger', FALLBACK.danger),
    warning: v('--warning', FALLBACK.warning),
    font: v('--font-sans', '') || cs.fontFamily || FALLBACK.font,
  }
}

/**
 * A track's caption in its top-left corner, haloed in the background colour
 * so it stays legible over whatever the track drew beneath it.
 */
export function drawCaption(ctx: CanvasRenderingContext2D, theme: MinimapTheme, text: string, x: number, y: number) {
  ctx.font = `10px ${theme.font}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.lineJoin = 'round'
  ctx.lineWidth = 3
  ctx.strokeStyle = theme.bg
  ctx.strokeText(text, x, y)
  ctx.fillStyle = theme.muted
  ctx.fillText(text, x, y)
}

/** The four-step quality ramp: good ≥ 0.75 > fair ≥ 0.5 > poor ≥ 0.25 > bad. */
export function rampColor(theme: MinimapTheme, t: number): string {
  if (t >= 0.75) return theme.good
  if (t >= 0.5) return theme.fair
  if (t >= 0.25) return theme.poor
  return theme.bad
}
