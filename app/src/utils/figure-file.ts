/**
 * A figure ready to be saved in each format, whatever drew it: the SVG
 * figure builders (alignment, trace, mapping) and the map scenes both hand
 * one to the figure dialogs' Save section (components/FigureSaveBar.tsx).
 */
export interface FigureFile {
  /** Its size in CSS pixels. */
  width: number
  height: number
  svg: () => string
  /** A PNG at `scale` times the CSS size, and the scale used (a canvas has a size limit). */
  png: (scale: number) => Promise<{ blob: Blob; scale: number }>
  pdf: () => Blob
}

/** `scale`, capped so a canvas `width` by `height` CSS pixels drawn at it stays within what browsers allow. */
export function canvasScale(width: number, height: number, scale: number): number {
  const maxSide = 16000
  return Math.max(0.5, Math.min(scale, maxSide / width, maxSide / height, Math.sqrt(2.4e8 / (width * height))))
}
