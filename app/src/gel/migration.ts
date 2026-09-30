/**
 * Gel electrophoresis migration model.
 *
 * Maps a DNA molecule to how far it travels from the well.
 *
 * Mobility relative to free (unsieved) DNA follows a sigmoid in log size:
 *
 *   r(L) = m + (1 − m) / (1 + (L / Lc)^α)
 *
 * Small fragments slip through the pores and approach r = 1. Large ones
 * reptate at a limiting mobility m, so everything above the resolution window
 * piles into a compression zone below the wells instead of spreading out. Lc
 * is the size the gel separates best; it falls steeply with agarose % because
 * pores shrink. TBE sieves a little harder than TAE, which is why it resolves
 * small fragments better.
 *
 * The run is timed by the bromophenol blue front, the way it is at the bench.
 * The dye is a small molecule with a fixed relative mobility, so the DNA size
 * it co-migrates with falls out of the model: ~350 bp in 1% TAE, ~100 bp in
 * 2%, matching loading-dye charts. Fragments that would travel past the end
 * of the gel have run off; callers get a distance beyond the run length and
 * decide what to show.
 *
 * Parameters were tuned by eye against published ladder images and dye
 * co-migration tables. The model is approximate by design: good enough to
 * judge whether two bands will separate, not a substitute for a real gel.
 */

import type { DnaForm, GelConditions, GelFormat } from './model'

export const AGAROSE_MIN = 0.5
export const AGAROSE_MAX = 3

/** Common agarose concentrations, for pickers. Any value in range works. */
export const AGAROSE_PRESETS = [0.5, 0.7, 0.8, 1, 1.2, 1.5, 2, 2.5, 3] as const

export const GEL_FORMATS: Record<GelFormat, { label: string; runLengthMm: number }> = {
  mini: { label: 'Mini (7 cm)', runLengthMm: 60 },
  midi: { label: 'Midi (15 cm)', runLengthMm: 130 },
  large: { label: 'Large (20 cm)', runLengthMm: 180 },
}

/** Lc at 1% TAE, in bp. */
const LC_1PCT = 1900
/** How steeply Lc falls with agarose %. */
const LC_EXPONENT = 1.8
/** TBE shifts the window towards smaller fragments. */
const TBE_LC_FACTOR = 0.8
/** Sigmoid steepness in log size. */
const ALPHA = 1.25
/** Limiting mobility at 1%; shrinks with denser gels. */
const LIMIT_1PCT = 0.05

/** Relative mobilities of the tracking dyes (vs free DNA). */
const BROMOPHENOL_BLUE = 0.9
const XYLENE_CYANOL = 0.32

/**
 * How much faster or slower each form runs than linear DNA of the same
 * length, expressed as the linear size it co-migrates with. Supercoiled
 * plasmid runs like ~0.65× its length; nicked plasmid like ~1.7×, lagging
 * more in denser gels. Real values shift with EtBr and ionic strength.
 */
function formFactor(form: DnaForm, pct: number): number {
  switch (form) {
    case 'linear': return 1
    case 'supercoiled': return 0.7 - 0.05 * pct
    case 'nicked': return 1.4 + 0.3 * pct
  }
}

export function clampAgarose(pct: number): number {
  if (!Number.isFinite(pct)) return 1
  return Math.min(AGAROSE_MAX, Math.max(AGAROSE_MIN, pct))
}

function characteristicSize(c: GelConditions): number {
  const pct = clampAgarose(c.agarosePct)
  return LC_1PCT * Math.pow(pct, -LC_EXPONENT) * (c.buffer === 'TBE' ? TBE_LC_FACTOR : 1)
}

function limitingMobility(c: GelConditions): number {
  return LIMIT_1PCT / Math.sqrt(clampAgarose(c.agarosePct))
}

/** Mobility of linear DNA of `bp` relative to free DNA (0..1]. */
export function relativeMobility(bp: number, c: GelConditions): number {
  const m = limitingMobility(c)
  const x = Math.max(bp, 1) / characteristicSize(c)
  return m + (1 - m) / (1 + Math.pow(x, ALPHA))
}

/** The linear size a molecule co-migrates with. */
export function apparentSize(bp: number, form: DnaForm, c: GelConditions): number {
  return bp * formFactor(form, clampAgarose(c.agarosePct))
}

export function runLengthMm(c: GelConditions): number {
  return GEL_FORMATS[c.format]?.runLengthMm ?? GEL_FORMATS.mini.runLengthMm
}

/** How far the bromophenol blue front has travelled, in mm. */
function bpbFrontMm(c: GelConditions): number {
  const front = Math.min(1, Math.max(0.05, c.dyeFront))
  return front * runLengthMm(c)
}

function mobilityToMm(r: number, c: GelConditions): number {
  return (bpbFrontMm(c) * r) / BROMOPHENOL_BLUE
}

/**
 * Distance travelled from the well, in mm. May exceed the run length, which
 * means the molecule ran off the gel.
 */
export function migrationMm(bp: number, form: DnaForm, c: GelConditions): number {
  return mobilityToMm(relativeMobility(apparentSize(bp, form, c), c), c)
}

/** Whether a molecule has run off the end of the gel. */
export function ranOff(mm: number, c: GelConditions): boolean {
  return mm > runLengthMm(c)
}

/** Linear size whose relative mobility is `r`, or null outside the curve. */
function sizeForMobility(r: number, c: GelConditions): number | null {
  const m = limitingMobility(c)
  if (r <= m || r >= 1) return null
  return characteristicSize(c) * Math.pow((1 - m) / (r - m) - 1, 1 / ALPHA)
}

/**
 * The linear DNA size whose band would sit `mm` below the well: the inverse
 * of `migrationMm`, for a size cursor. Null where no size lands (inside the
 * compression zone or past the free-DNA front).
 */
export function sizeAtMm(mm: number, c: GelConditions): number | null {
  const r = (mm * BROMOPHENOL_BLUE) / bpbFrontMm(c)
  return sizeForMobility(r, c)
}

export interface DyeFront {
  name: string
  /** Distance from the well in mm. */
  mm: number
  /** Linear DNA size it co-migrates with. */
  equivalentBp: number
  /** The dye's colour, for drawing it under visible light. */
  color: string
}

export function dyeFronts(c: GelConditions): DyeFront[] {
  const dyes: [string, number, string][] = [
    ['Xylene cyanol', XYLENE_CYANOL, '#3a5bd9'],
    ['Bromophenol blue', BROMOPHENOL_BLUE, '#5b3fc4'],
  ]
  return dyes.map(([name, r, color]) => ({
    name,
    mm: mobilityToMm(r, c),
    equivalentBp: Math.round(sizeForMobility(r, c) ?? 0),
    color,
  }))
}

/** Above this relative mobility fragments run nearly free and barely separate. */
const FREE_RUNNING = 0.97

/**
 * The size range a gel separates usefully: linear DNA landing between 10%
 * and 95% of the run length. Above it bands crowd into the compression
 * zone; below it they have run off, or on a short run, they run nearly as
 * fast as free DNA and pile up together.
 */
export function resolutionRange(c: GelConditions): [number, number] {
  const len = runLengthMm(c)
  const mobilityAt = (mm: number) => (mm * BROMOPHENOL_BLUE) / bpbFrontMm(c)
  const lo = sizeForMobility(Math.min(mobilityAt(len * 0.95), FREE_RUNNING), c)
  const hi = sizeForMobility(mobilityAt(len * 0.1), c)
  return [Math.round(lo ?? 1), Math.round(hi ?? 100_000)]
}
