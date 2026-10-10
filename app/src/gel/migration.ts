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

import { isProteinGel, type DnaForm, type GelConditions, type GelFormat } from './model'

export const AGAROSE_MIN = 0.5
export const AGAROSE_MAX = 3

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
 * SDS-PAGE: the same sigmoid in log mass. SDS gives every chain the same
 * charge per mass, so a protein's mobility is set by its size alone, and
 * the distance travelled is linear in log mass across the gel's useful
 * window (the Ferguson relation on which every standard curve is drawn).
 * Each acrylamide percentage is given the mass window it is recommended
 * for; the characteristic mass is the window's geometric centre and the
 * steepness puts the window's ends near 15% and 95% of the run. In SDS-PAGE
 * the bromophenol blue runs with the ion front, so the dye front is the
 * front of the run.
 */
export const ACRYLAMIDE_OPTIONS = [6, 8, 10, 12, 15] as const
export const DEFAULT_ACRYLAMIDE_PCT = 12
/** Recommended separation window per %T, in Da. */
export const PAGE_WINDOWS: Record<number, [number, number]> = {
  6: [60_000, 250_000],
  8: [40_000, 180_000],
  10: [25_000, 120_000],
  12: [15_000, 80_000],
  15: [8_000, 50_000],
}
const PAGE_ALPHA = 2.2
const PAGE_LIMIT = 0.04
const PAGE_DYE = 1.0

export function clampAcrylamide(pct: number | undefined): number {
  if (pct === undefined || !Number.isFinite(pct)) return DEFAULT_ACRYLAMIDE_PCT
  return ACRYLAMIDE_OPTIONS.reduce((best, p) => (Math.abs(p - pct) < Math.abs(best - pct) ? p : best), DEFAULT_ACRYLAMIDE_PCT as number)
}

function pageWindow(c: GelConditions): [number, number] {
  return PAGE_WINDOWS[clampAcrylamide(c.acrylamidePct)]
}

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
  if (isProteinGel(c)) {
    const [lo, hi] = pageWindow(c)
    return Math.sqrt(lo * hi)
  }
  const pct = clampAgarose(c.agarosePct)
  return LC_1PCT * Math.pow(pct, -LC_EXPONENT) * (c.buffer === 'TBE' ? TBE_LC_FACTOR : 1)
}

function limitingMobility(c: GelConditions): number {
  if (isProteinGel(c)) return PAGE_LIMIT
  return LIMIT_1PCT / Math.sqrt(clampAgarose(c.agarosePct))
}

function steepness(c: GelConditions): number {
  return isProteinGel(c) ? PAGE_ALPHA : ALPHA
}

/** The bromophenol blue front's mobility: behind free DNA on agarose, the ion front on SDS-PAGE. */
function dyeMobility(c: GelConditions): number {
  return isProteinGel(c) ? PAGE_DYE : BROMOPHENOL_BLUE
}

/** Mobility of linear DNA of `bp` (or a protein of `bp` daltons) relative to the free front (0..1]. */
export function relativeMobility(bp: number, c: GelConditions): number {
  const m = limitingMobility(c)
  const x = Math.max(bp, 1) / characteristicSize(c)
  return m + (1 - m) / (1 + Math.pow(x, steepness(c)))
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
  return (bpbFrontMm(c) * r) / dyeMobility(c)
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
  return characteristicSize(c) * Math.pow((1 - m) / (r - m) - 1, 1 / steepness(c))
}

/**
 * The linear DNA size whose band would sit `mm` below the well: the inverse
 * of `migrationMm`, for a size cursor. Null where no size lands (inside the
 * compression zone or past the free-DNA front).
 */
export function sizeAtMm(mm: number, c: GelConditions): number | null {
  const r = (mm * dyeMobility(c)) / bpbFrontMm(c)
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
  // SDS-PAGE sample buffer carries bromophenol blue only, at the front.
  const dyes: [string, number, string][] = isProteinGel(c)
    ? [['Bromophenol blue', PAGE_DYE, '#5b3fc4']]
    : [
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
  const mobilityAt = (mm: number) => (mm * dyeMobility(c)) / bpbFrontMm(c)
  const lo = sizeForMobility(Math.min(mobilityAt(len * 0.95), FREE_RUNNING), c)
  const hi = sizeForMobility(mobilityAt(len * 0.1), c)
  return [Math.round(lo ?? 1), Math.round(hi ?? 100_000)]
}

/** "1% agarose · TAE · Mini (7 cm)" or "12% SDS-PAGE · Mini (7 cm)". */
export function gelCaption(c: GelConditions): string {
  const format = GEL_FORMATS[c.format]?.label ?? c.format
  if (isProteinGel(c)) return `${clampAcrylamide(c.acrylamidePct)}% SDS-PAGE · ${format}`
  return `${c.agarosePct}% agarose · ${c.buffer} · ${format}`
}
