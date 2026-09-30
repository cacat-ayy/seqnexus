/**
 * How a gel is imaged: stain plus light source plus camera, as one preset.
 *
 * Every raster look maps a normalised brightness (0 = bare gel, 1 = fully
 * saturated band) through a colour ramp. The ramp is the whole difference
 * between an ethidium bromide gel on a UV box and a SYBR Safe gel under blue
 * light seen through an amber filter. The frame colours are for the margin
 * around the gel slab and its labels, so exports look the same as the screen.
 *
 * `schematic` is the odd one out: flat vector bands for figures, drawn
 * without the raster pipeline.
 */

export type GelLookId = 'uv' | 'inverted' | 'sybr-safe' | 'gelgreen' | 'schematic'

type Rgb = [number, number, number]

export interface GelLook {
  id: GelLookId
  label: string
  /** One line for pickers. */
  description: string
  /** Colour ramp from bare gel (0) to saturated band (1), as sorted stops. */
  ramp: [number, Rgb][]
  /** Brightness of the bare gel: free stain and background glow. */
  background: number
  /** Margin around the slab. */
  frame: string
  /** Primary label colour on the frame. */
  text: string
  /** Secondary label colour. */
  textMuted: string
  /** Well slot fill and rim. */
  wellFill: string
  wellRim: string
  /**
   * How loading dyes show. Under fluorescence imaging they absorb light and
   * cast a darker shadow; in a visible-light or schematic view they show their
   * own colour.
   */
  dyeMode: 'shadow' | 'colour'
  /** Flat vector rendering instead of the raster pipeline. */
  vector?: boolean
}

export const GEL_LOOKS: Record<GelLookId, GelLook> = {
  uv: {
    id: 'uv',
    label: 'UV · Ethidium bromide',
    description: 'White bands on a dark gel, like a UV transilluminator photo',
    ramp: [[0, [14, 14, 16]], [0.55, [190, 190, 192]], [1, [255, 255, 255]]],
    background: 0.05,
    frame: '#0b0b0c',
    text: 'rgba(255,255,255,0.82)',
    textMuted: 'rgba(255,255,255,0.45)',
    wellFill: 'rgba(0,0,0,0.55)',
    wellRim: 'rgba(255,255,255,0.14)',
    dyeMode: 'shadow',
  },
  inverted: {
    id: 'inverted',
    label: 'Inverted',
    description: 'Dark bands on white, the way gels are printed',
    ramp: [[0, [250, 250, 250]], [0.55, [80, 80, 82]], [1, [8, 8, 10]]],
    background: 0.04,
    frame: '#ffffff',
    text: 'rgba(0,0,0,0.85)',
    textMuted: 'rgba(0,0,0,0.5)',
    wellFill: 'rgba(255,255,255,0.9)',
    wellRim: 'rgba(0,0,0,0.25)',
    dyeMode: 'colour',
  },
  'sybr-safe': {
    id: 'sybr-safe',
    label: 'Blue light · SYBR Safe',
    description: 'Yellow-green bands through an amber filter',
    ramp: [[0, [38, 20, 6]], [0.5, [214, 190, 60]], [1, [255, 250, 205]]],
    background: 0.07,
    frame: '#140b04',
    text: 'rgba(255,236,190,0.85)',
    textMuted: 'rgba(255,236,190,0.5)',
    wellFill: 'rgba(0,0,0,0.5)',
    wellRim: 'rgba(255,220,150,0.18)',
    dyeMode: 'shadow',
  },
  gelgreen: {
    id: 'gelgreen',
    label: 'Blue light · GelGreen',
    description: 'Green bands on black',
    ramp: [[0, [6, 12, 8]], [0.55, [60, 220, 110]], [1, [220, 255, 225]]],
    background: 0.05,
    frame: '#050906',
    text: 'rgba(210,255,220,0.85)',
    textMuted: 'rgba(210,255,220,0.48)',
    wellFill: 'rgba(0,0,0,0.55)',
    wellRim: 'rgba(160,255,190,0.16)',
    dyeMode: 'shadow',
  },
  schematic: {
    id: 'schematic',
    label: 'Schematic',
    description: 'Flat, clean bands for figures',
    ramp: [[0, [246, 247, 249]], [1, [30, 41, 59]]],
    background: 0,
    frame: '#ffffff',
    text: 'rgba(15,23,42,0.88)',
    textMuted: 'rgba(15,23,42,0.5)',
    wellFill: 'rgba(15,23,42,0.08)',
    wellRim: 'rgba(15,23,42,0.3)',
    dyeMode: 'colour',
    vector: true,
  },
}

export const GEL_LOOK_ORDER: GelLookId[] = ['uv', 'inverted', 'sybr-safe', 'gelgreen', 'schematic']

export const DEFAULT_LOOK: GelLookId = 'uv'

export function getLook(id: string | undefined): GelLook {
  return GEL_LOOKS[id as GelLookId] ?? GEL_LOOKS[DEFAULT_LOOK]
}

/**
 * Build a 256-entry lookup table from a look's ramp, as packed RGB triples,
 * so the per-pixel tone map is one table read.
 */
export function rampTable(look: GelLook): Uint8ClampedArray {
  const cached = tableCache.get(look)
  if (cached) return cached
  const table = new Uint8ClampedArray(256 * 3)
  const stops = look.ramp
  for (let i = 0; i < 256; i++) {
    const v = i / 255
    let k = 0
    while (k < stops.length - 2 && v > stops[k + 1][0]) k++
    const [v0, c0] = stops[k]
    const [v1, c1] = stops[Math.min(k + 1, stops.length - 1)]
    const t = v1 > v0 ? Math.min(1, Math.max(0, (v - v0) / (v1 - v0))) : 0
    for (let ch = 0; ch < 3; ch++) table[i * 3 + ch] = c0[ch] + (c1[ch] - c0[ch]) * t
  }
  tableCache.set(look, table)
  return table
}

const tableCache = new WeakMap<GelLook, Uint8ClampedArray>()

/** The colour of brightness `v` as a CSS rgb() string. */
export function rampColour(look: GelLook, v: number): string {
  const table = rampTable(look)
  const i = Math.round(Math.min(1, Math.max(0, v)) * 255) * 3
  return `rgb(${table[i]},${table[i + 1]},${table[i + 2]})`
}
