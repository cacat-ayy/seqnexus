/**
 * The PDF's fonts: four of the standard 14 that every PDF reader has built
 * in, so nothing is embedded and the files stay small.
 *
 * Their glyph widths are fixed by the format (the Adobe font metrics), which
 * lets the export measure text exactly without a canvas. The price is the
 * character set: these fonts use WinAnsiEncoding, Latin-1 plus a few
 * typographic marks. Greek letters, common in gene names, are spelled out
 * ("beta-lactamase"); anything else outside the set prints as "?".
 */

export type PdfFontId = 'F1' | 'F2' | 'F3' | 'F4'| 'F2' | 'F3'

/** Resource name to base font. */
export const PDF_FONTS: Record<PdfFontId, string> = {
  F1: 'Helvetica',
  F2: 'Helvetica-Bold',
  F3: 'Courier',
  F4: 'Courier-Bold',
}

/** Helvetica advance widths for codes 32..126, in 1/1000 em (Adobe AFM). */
const HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
]

/** Helvetica-Bold advance widths for codes 32..126, in 1/1000 em (Adobe AFM). */
const HELVETICA_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
]

/** WinAnsi codes 128..159 that are in use, with their Helvetica widths. */
const WIN_ANSI_EXTRA: Record<string, [code: number, width: number]> = {
  '€': [0x80, 556], '‚': [0x82, 222], 'ƒ': [0x83, 556], '„': [0x84, 333],
  '…': [0x85, 1000], '†': [0x86, 556], '‡': [0x87, 556], 'ˆ': [0x88, 333],
  '‰': [0x89, 1000], 'Š': [0x8a, 667], '‹': [0x8b, 333], 'Œ': [0x8c, 1000],
  'Ž': [0x8e, 611], '‘': [0x91, 222], '’': [0x92, 222], '“': [0x93, 333],
  '”': [0x94, 333], '•': [0x95, 350], '\u2013': [0x96, 556], '\u2014': [0x97, 1000],
  '˜': [0x98, 333], '™': [0x99, 1000], 'š': [0x9a, 500], '›': [0x9b, 333],
  'œ': [0x9c, 944], 'ž': [0x9e, 500], 'Ÿ': [0x9f, 667],
}
const EXTRA_WIDTH_BY_CODE = new Map(Object.values(WIN_ANSI_EXTRA).map(([c, w]) => [c, w]))

/** Greek letters spelled out, the way gene and protein names are written in plain text. */
const GREEK: Record<string, string> = {
  α: 'alpha', β: 'beta', γ: 'gamma', δ: 'delta', ε: 'epsilon', ζ: 'zeta', η: 'eta',
  θ: 'theta', ι: 'iota', κ: 'kappa', λ: 'lambda', ν: 'nu', ξ: 'xi', π: 'pi',
  ρ: 'rho', σ: 'sigma', τ: 'tau', υ: 'upsilon', φ: 'phi', χ: 'chi', ψ: 'psi', ω: 'omega',
  Α: 'Alpha', Β: 'Beta', Γ: 'Gamma', Δ: 'Delta', Ε: 'Epsilon', Ζ: 'Zeta', Η: 'Eta',
  Θ: 'Theta', Ι: 'Iota', Κ: 'Kappa', Λ: 'Lambda', Μ: 'Mu', Ν: 'Nu', Ξ: 'Xi', Π: 'Pi',
  Ρ: 'Rho', Σ: 'Sigma', Τ: 'Tau', Υ: 'Upsilon', Φ: 'Phi', Χ: 'Chi', Ψ: 'Psi', Ω: 'Omega',
}

/**
 * The text as WinAnsi bytes, one char per byte (codes 0..255).
 * µ (U+00B5) is Latin-1 and survives as itself; the Greek mu, U+03BC, is
 * mapped to it, since the two look the same and the micro sign is what
 * units mean.
 */
export function encodeWinAnsi(text: string): string {
  let out = ''
  for (const ch of text) {
    const code = ch.codePointAt(0)!
    if ((code >= 32 && code <= 126) || (code >= 160 && code <= 255)) out += ch
    else if (ch === 'μ') out += 'µ'
    else if (WIN_ANSI_EXTRA[ch]) out += String.fromCharCode(WIN_ANSI_EXTRA[ch][0])
    else if (GREEK[ch]) out += GREEK[ch]
    else if (ch === '\t') out += ' '
    else if (code >= 32) out += '?'
  }
  return out
}

/** Width of one encoded byte in a font, in 1/1000 em. */
function charWidth(font: PdfFontId, code: number): number {
  if (font === 'F3' || font === 'F4') return 600
  const table = font === 'F2' ? HELVETICA_BOLD : HELVETICA
  if (code >= 32 && code <= 126) return table[code - 32]
  const extra = EXTRA_WIDTH_BY_CODE.get(code)
  if (extra !== undefined) return extra
  if (code >= 160) {
    // Accented Latin-1 letters share their base letter's advance.
    const base = String.fromCharCode(code).normalize('NFD').charCodeAt(0)
    if (base >= 32 && base <= 126) return table[base - 32]
  }
  return 556
}

/** Width of already-encoded text at a size, in the size's units. */
export function encodedWidth(font: PdfFontId, encoded: string, size: number): number {
  let w = 0
  for (let i = 0; i < encoded.length; i++) w += charWidth(font, encoded.charCodeAt(i))
  return (w * size) / 1000
}

export interface PdfFont {
  id: PdfFontId
  size: number
}

/**
 * The PDF font for a CSS font shorthand, as the canvas code writes them
 * ("500 11px Inter, sans-serif", "10.5px 'SF Mono', monospace"). Monospaced
 * families become Courier, the rest Helvetica, each bold from weight 600.
 */
export function pdfFontFor(css: string): PdfFont {
  const m = /(?:^|\s)([\d.]+)px\s+(.*)$/.exec(css)
  const size = m ? parseFloat(m[1]) : 10
  const family = (m ? m[2] : css).toLowerCase()
  const prefix = m ? css.slice(0, m.index).toLowerCase() : ''
  const weight = /\bbold\b/.test(prefix) ? 700 : parseInt(/\b(\d{3})\b/.exec(prefix)?.[1] ?? '400', 10)
  if (/mono|courier|consolas|menlo/.test(family)) return { id: weight >= 600 ? 'F4' : 'F3', size }
  return { id: weight >= 600 ? 'F2' : 'F1', size }
}

/** Width of text in a CSS font, as the PDF will set it. */
export function pdfMeasure(css: string, text: string): number {
  const f = pdfFontFor(css)
  return encodedWidth(f.id, encodeWinAnsi(text), f.size)
}
