/**
 * Theme colours for the alignment canvases, read from the app's CSS tokens
 * at draw time so every theme (light, dark, Dracula, ...) works without a
 * palette of its own.
 */

import { useEffect, useState } from 'react'
import { blend, luminance } from '../../msa/colors'

export interface AlnTheme {
  bg: string
  text: string
  muted: string
  grid: string
  rowSep: string
  accent: string
  danger: string
  warning: string
  good: string
  fair: string
  bad: string
  mono: string
  sans: string
  dark: boolean
  /** How strongly a scheme colour shows through a cell background. */
  cellAlpha: number
  /** Scheme colour (hex) to cell background, cached. */
  cell: (color: string) => string
  /** Scheme colour (hex) to a legible letter colour, cached. */
  letter: (color: string) => string
}

export type ThemeColors = Omit<AlnTheme, 'dark' | 'cellAlpha' | 'cell' | 'letter'>

/** A theme from plain colours: works out darkness, cell blending and letter colours. */
export function makeTheme(colors: ThemeColors): AlnTheme {
  const { bg, text } = colors
  const dark = luminance(bg) < 0.35
  const cellAlpha = dark ? 0.5 : 0.62
  const cells = new Map<string, string>()
  const letters = new Map<string, string>()
  return {
    ...colors,
    dark,
    cellAlpha,
    cell(color) {
      let c = cells.get(color)
      if (!c) { c = blend(color, bg, cellAlpha); cells.set(color, c) }
      return c
    },
    letter(color) {
      let c = letters.get(color)
      // Pure palette colours are too bright as text on white and too dark on
      // black; pulling them toward the text colour fixes both.
      if (!c) { c = blend(color, text, dark ? 0.85 : 0.7); letters.set(color, c) }
      return c
    },
  }
}

/** The app's current theme, from its CSS tokens. */
export function readAlnTheme(el: Element): AlnTheme {
  const cs = getComputedStyle(el)
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback
  return makeTheme({
    bg: v('--canvas-bg', '#ffffff'),
    text: v('--canvas-text', '#1e293b'),
    muted: v('--canvas-ruler', '#64748b'),
    grid: v('--canvas-ruler-tick', '#e2e8f0'),
    rowSep: v('--canvas-row-sep', '#f1f5f9'),
    accent: v('--accent', '#6366f1'),
    danger: v('--danger', '#ef4444'),
    warning: v('--warning', '#b45309'),
    good: v('--minimap-good', '#22c55e'),
    fair: v('--minimap-fair', '#eab308'),
    bad: v('--minimap-bad', '#ef4444'),
    mono: v('--font-mono', 'monospace'),
    sans: v('--font-sans', '') || cs.fontFamily || 'sans-serif',
  })
}

/** Print colours for figures: white paper, dark text, whatever the app theme. */
export const FIGURE_THEME: AlnTheme = makeTheme({
  bg: '#ffffff', text: '#1f2937', muted: '#9ca3af', grid: '#d1d5db', rowSep: '#eef0f3',
  accent: '#4f46e5', danger: '#dc2626', warning: '#b45309', good: '#16a34a', fair: '#ca8a04', bad: '#dc2626',
  mono: "Menlo, Consolas, 'DejaVu Sans Mono', 'Courier New', monospace",
  sans: "'Helvetica Neue', Helvetica, Arial, sans-serif",
})

/** A number that changes whenever the app's theme does, to key repaints on. */
export function useThemeVersion(ref: React.RefObject<Element>): number {
  const [version, setVersion] = useState(0)
  useEffect(() => {
    const app = ref.current?.closest('.app-root')
    if (!app) return
    const mo = new MutationObserver(() => setVersion(v => v + 1))
    mo.observe(app, { attributes: true, attributeFilter: ['data-theme', 'style', 'class'] })
    return () => mo.disconnect()
  }, [ref])
  return version
}
