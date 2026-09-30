/**
 * From species to bands: what the eye sees in a lane.
 *
 * Each species lands at a distance from the well with a vertical spread (a
 * Gaussian sigma, in mm). Spread comes from three places:
 *   - the sample stacking out of a ~1 mm well,
 *   - diffusion, which grows with distance and hits small fragments hardest,
 *   - overloading: a band holding hundreds of ng is visibly fatter.
 * Species closer together than the gel can separate merge into one band, so
 * 3000 and 2950 bp read as a single, brighter band, as they would for real.
 *
 * Everything is in mm from the well so a renderer can scale to any height.
 */

import type { DnaSpecies, GelConditions, GelSetup } from './model'
import { migrationMm, ranOff, runLengthMm, dyeFronts, type DyeFront } from './migration'
import { simulateLane, type GelResolver, type SourceResolver } from './simulate'

export interface BandOptions {
  /** Let heavily loaded bands grow thicker. Off draws every band alike. */
  massThickness: boolean
  /** Bands below this mass are too faint for the stain to show. */
  detectionNg: number
}

/** Ethidium bromide picks up roughly 1–5 ng in a band. */
export const DEFAULT_DETECTION_NG = 2

export const DEFAULT_BAND_OPTIONS: BandOptions = {
  massThickness: true,
  detectionNg: DEFAULT_DETECTION_NG,
}

/**
 * Sigma of a freshly stacked band. DNA entering the gel stacks into a layer
 * much thinner than the well is deep, so a light band reads as well under 1 mm.
 */
const WELL_SIGMA_MM = 0.18
const DIFFUSION_COEFF = 0.02
/** Mass above which bands start to broaden, and how fast. */
const LOAD_REFERENCE_NG = 100
const LOAD_COEFF = 0.1
/**
 * Two bands merge when their centres are closer than this many (mean)
 * sigmas: the eye cannot split Gaussians that overlap that much.
 */
const MERGE_SIGMAS = 1.6

export interface PlacedSpecies extends DnaSpecies {
  /** Distance from the well, in mm. */
  mm: number
  /** Vertical spread, in mm. */
  sigmaMm: number
}

export interface GelBand {
  /** Mass-weighted centre, in mm from the well. */
  mm: number
  /** Spread of the merged band, in mm. */
  sigmaMm: number
  /** Total mass in the band. */
  ng: number
  /** The molecules that make up the band, largest first. */
  members: PlacedSpecies[]
  /** Heavy enough for the stain to show. */
  visible: boolean
}

export interface LaneLayout {
  laneId: string
  bands: GelBand[]
  /** Species that travelled past the end of the gel. */
  ranOff: PlacedSpecies[]
  warnings: string[]
  totalNg: number
}

export interface GelLayout {
  conditions: GelConditions
  runLengthMm: number
  lanes: LaneLayout[]
  dyeFronts: DyeFront[]
}

export function bandSigmaMm(bp: number, mm: number, ng: number, opts: BandOptions): number {
  const diffusion = DIFFUSION_COEFF * Math.sqrt(Math.max(mm, 0)) * Math.pow(1000 / Math.max(bp, 20), 0.25)
  const load = opts.massThickness ? LOAD_COEFF * Math.log2(1 + Math.max(ng, 0) / LOAD_REFERENCE_NG) : 0
  return Math.sqrt(WELL_SIGMA_MM ** 2 + diffusion ** 2 + load ** 2)
}

export function placeSpecies(s: DnaSpecies, c: GelConditions, opts: BandOptions): PlacedSpecies {
  const mm = migrationMm(s.bp, s.form, c)
  return { ...s, mm, sigmaMm: bandSigmaMm(s.bp, mm, s.ng, opts) }
}

function mergeGroup(group: PlacedSpecies[], opts: BandOptions): GelBand {
  const ng = group.reduce((a, s) => a + s.ng, 0)
  // Weight by mass so a trace species cannot drag the centre; fall back to
  // an even split when every member is massless.
  const w = (s: PlacedSpecies) => (ng > 0 ? s.ng / ng : 1 / group.length)
  const mm = group.reduce((a, s) => a + s.mm * w(s), 0)
  // Law of total variance: members' own spread plus how far apart they sit.
  const variance = group.reduce((a, s) => a + w(s) * (s.sigmaMm ** 2 + (s.mm - mm) ** 2), 0)
  return {
    mm,
    sigmaMm: Math.sqrt(variance),
    ng,
    members: [...group].sort((a, b) => b.bp - a.bp),
    visible: ng >= opts.detectionNg,
  }
}

/** Group placed species into bands, top of the gel first. */
export function groupBands(placed: PlacedSpecies[], opts: BandOptions): GelBand[] {
  const sorted = [...placed].sort((a, b) => a.mm - b.mm)
  const bands: GelBand[] = []
  let group: PlacedSpecies[] = []
  let current: GelBand | null = null
  for (const s of sorted) {
    if (current) {
      const threshold = MERGE_SIGMAS * (current.sigmaMm + s.sigmaMm) / 2
      if (s.mm - current.mm < threshold) {
        group.push(s)
        current = mergeGroup(group, opts)
        continue
      }
      bands.push(current)
    }
    group = [s]
    current = mergeGroup(group, opts)
  }
  if (current) bands.push(current)
  return bands
}

export function layoutGel(
  setup: GelSetup,
  resolve: SourceResolver | GelResolver,
  opts: BandOptions = DEFAULT_BAND_OPTIONS,
): GelLayout {
  const c = setup.conditions
  const lanes = setup.lanes.map((lane): LaneLayout => {
    const sim = simulateLane(lane.sample, resolve)
    const placed = sim.species.filter(s => s.bp > 0).map(s => placeSpecies(s, c, opts))
    const onGel = placed.filter(s => !ranOff(s.mm, c))
    return {
      laneId: lane.id,
      bands: groupBands(onGel, opts),
      ranOff: placed.filter(s => ranOff(s.mm, c)),
      warnings: sim.warnings,
      totalNg: sim.totalNg,
    }
  })
  return { conditions: c, runLengthMm: runLengthMm(c), lanes, dyeFronts: dyeFronts(c) }
}

/** A band's size for display: the member size when it is one species. */
export function bandLabelBp(band: GelBand): number {
  if (band.members.length === 1) return band.members[0].bp
  const ng = band.ng || 1
  return Math.round(band.members.reduce((a, s) => a + s.bp * (s.ng / ng), 0))
}
