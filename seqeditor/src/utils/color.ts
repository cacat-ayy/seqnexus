/** Map a nucleotide base to its display color. */
export function baseColor(base: string): string {
  switch (base) {
    case 'A': case 'a': return '#2d8a4e'
    case 'T': case 't': return '#c0392b'
    case 'G': case 'g': return '#2874a6'
    case 'C': case 'c': return '#d4a017'
    default: return '#666666'
  }
}

/** Parse a hex color to RGB components. */
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const n = h.length === 3
    ? parseInt(h[0]+h[0]+h[1]+h[1]+h[2]+h[2], 16)
    : parseInt(h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Relative luminance (0–1) per WCAG formula. */
function luminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r, g, b].map(c => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs
}

/**
 * Return black or white text color for maximum contrast against a fill color.
 * Uses WCAG luminance threshold.
 */
export function contrastText(fillColor: string): string {
  try {
    const [r, g, b] = hexToRgb(fillColor)
    return luminance(r, g, b) > 0.4 ? '#000000' : '#ffffff'
  } catch {
    return '#000000'
  }
}

/**
 * Return a stroke color that's guaranteed to be visible against a light background.
 * If the color's luminance is too high, darken it by 50%.
 */
export function visibleStroke(color: string): string {
  try {
    const [r, g, b] = hexToRgb(color)
    const lum = luminance(r, g, b)
    if (lum > 0.7) {
      return `rgb(${Math.round(r * 0.5)},${Math.round(g * 0.5)},${Math.round(b * 0.5)})`
    }
    return color
  } catch {
    return color
  }
}
