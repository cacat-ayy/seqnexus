/**
 * The minimap engine's contracts.
 *
 * Every view's overview bar is the same shell (ruler, viewport, drag, hover,
 * theming, collapse) around a stack of tracks the view supplies. Positions
 * are always in the view's own units — bases for a sequence or a read,
 * columns for an alignment — never in scroll pixels, so the viewport box
 * covers exactly what is on screen however unevenly the main view lays out.
 */

/** Colours resolved from the theme's CSS tokens, once per static draw. */
export interface MinimapTheme {
  bg: string
  /** Backbone and other strong strokes. */
  ink: string
  /** Ruler labels and track captions. */
  muted: string
  /** Ruler ticks and reference lines. */
  grid: string
  accent: string
  /** Wash over everything outside the viewport. */
  dim: string
  gc: string
  /** Restriction sites. */
  enzyme: string
  good: string
  fair: string
  poor: string
  bad: string
  danger: string
  warning: string
  font: string
}

/** Where a track draws, and how positions map onto it. */
export interface TrackArea {
  x: number
  y: number
  w: number
  h: number
  /** Total length in units. */
  length: number
  /** Position (units) to x pixel. */
  toX: (pos: number) => number
}

/** What sits under the pointer, for the hover readout. */
export interface MinimapHit {
  label: string
  detail?: string
  color?: string
  /** An item the host can highlight in its main view (an annotation id). */
  itemId?: string
}

export interface MinimapTrack {
  id: string
  /** Height in the expanded bar; a track draws within exactly this. */
  height: number
  draw: (ctx: CanvasRenderingContext2D, area: TrackArea, theme: MinimapTheme) => void
  /**
   * A one-line summary for the collapsed strip. Tracks without one are
   * left out of the strip.
   */
  drawCompact?: (ctx: CanvasRenderingContext2D, area: TrackArea, theme: MinimapTheme) => void
  /**
   * What is at `pos`; `y` is relative to the track's top. `unitsPerPx` lets
   * thin items be hit when they are narrower than a pixel.
   */
  hit?: (pos: number, y: number, unitsPerPx: number, theme: MinimapTheme) => MinimapHit | null
  /** Outline `itemId` if this track drew it (the host's hovered item). */
  highlight?: (ctx: CanvasRenderingContext2D, area: TrackArea, theme: MinimapTheme, itemId: string) => void
}

/** The visible stretch of the main view, half-open, in units. */
export interface Viewport {
  start: number
  end: number
}
