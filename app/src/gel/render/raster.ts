/**
 * Rasterise a gel scene into pixels, the way a camera would see it.
 *
 * 1. Every species adds a Gaussian to a floating-point field of stain
 *    density (ng of DNA per mm of run), spread flat across its lane with soft
 *    edges. Density, not mass: a fat overloaded band spreads its DNA thinner.
 *    Species too close to separate simply add up, so merged bands need no
 *    special case.
 * 2. Density goes through a saturating exposure curve, 1 − e^(−d/ref), which
 *    is how film and camera sensors clip. Faint bands stay faint; overloaded
 *    ones burn out to white.
 * 3. The bare gel's own glow is added, plus the optional effects, and the
 *    result is coloured through the look's ramp.
 *
 * Works on plain typed arrays so it runs, and is tested, without a canvas.
 */

import type { GelBand } from '../bands'
import { rampTable, type GelLook } from './looks'
import type { GelScene } from './scene'

export interface GelEffects {
  /** Sensor noise. */
  grain: boolean
  /** Uneven staining and illumination: brighter centre, patchy background. */
  uneven: boolean
  /** Bands curving at the lane edges ("smiling"), from uneven heating. */
  smile: boolean
}

export const NO_EFFECTS: GelEffects = { grain: false, uneven: false, smile: false }

/**
 * Density that maps to 1 − 1/e ≈ 63% brightness at exposure 0. Chosen so a
 * typical 50 ng ladder band sits near two thirds, a few hundred ng saturate
 * the way an overloaded band does, and a 2 ng band is only just visible.
 */
const REFERENCE_DENSITY = 80
const SQRT_2PI = Math.sqrt(2 * Math.PI)
/** Gaussians are cut off beyond this many sigmas. */
const CUTOFF_SIGMAS = 4
/** Fraction of lane width over which band edges fade. */
const EDGE_FRACTION = 0.1
/** How far lane centres sag relative to edges with smile on, per mm run. */
const SMILE_PER_PX = 0.009

/** Brightness 0..1 of a stain density (ng/mm) at `exposure` stops. */
export function toneMap(density: number, exposure: number): number {
  if (density <= 0) return 0
  return 1 - Math.exp(-density * Math.pow(2, exposure) / REFERENCE_DENSITY)
}

/** Peak stain density of a merged band, in ng/mm. */
export function bandPeakDensity(band: GelBand): number {
  let d = 0
  for (const m of band.members) {
    const off = m.mm - band.mm
    d += (m.ng / (m.sigmaMm * SQRT_2PI)) * Math.exp(-0.5 * (off / m.sigmaMm) ** 2)
  }
  return d
}

export interface RasterOptions {
  /** Device pixels per CSS pixel. */
  scale: number
  exposure: number
  effects: GelEffects
}

export interface Raster {
  width: number
  height: number
  /** RGBA, row-major, covering the slab only. */
  data: Uint8ClampedArray
}

/** Deterministic per-pixel noise in [0, 1): the same gel always looks the same. */
function hash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** Smooth, low-frequency variation in [-1, 1] for uneven staining. */
function patchiness(u: number, v: number): number {
  return 0.5 * Math.sin(u * 5.1 + 1.3) * Math.cos(v * 3.7 + 0.4) + 0.5 * Math.sin((u + v) * 2.3 + 2.1)
}

export function renderRaster(scene: GelScene, look: GelLook, opts: RasterOptions): Raster {
  const s = opts.scale
  const W = Math.max(1, Math.round(scene.slab.w * s))
  const H = Math.max(1, Math.round(scene.slab.h * s))
  const field = new Float32Array(W * H)
  const ox = scene.slab.x
  const oy = scene.slab.y
  const originDev = (scene.originY - oy) * s

  // Precompute each lane's horizontal profile: flat, with soft edges.
  const laneProfiles = scene.lanes.map(lane => {
    const x0 = (lane.x - ox) * s
    const x1 = x0 + lane.w * s
    const edge = Math.max(1, lane.w * s * EDGE_FRACTION)
    const c0 = Math.max(0, Math.floor(x0))
    const c1 = Math.min(W - 1, Math.ceil(x1))
    const weights = new Float32Array(Math.max(0, c1 - c0 + 1))
    const shape = new Float32Array(weights.length)
    for (let c = c0; c <= c1; c++) {
      const px = c + 0.5
      const a = Math.min(1, Math.max(0, (px - x0) / edge))
      const b = Math.min(1, Math.max(0, (x1 - px) / edge))
      weights[c - c0] = a * a * (3 - 2 * a) * b * b * (3 - 2 * b)
      // -1 at one edge, 0 at the centre, 1 at the other: for the smile.
      const u = ((px - x0) / (x1 - x0)) * 2 - 1
      shape[c - c0] = 1 - u * u
    }
    return { c0, weights, shape }
  })

  for (const sp of scene.species) {
    const lane = laneProfiles[sp.laneIdx]
    if (!lane || sp.sigmaPx <= 0 || sp.ng <= 0) continue
    const amp = sp.ng / (sp.sigmaMm * SQRT_2PI)
    const sigma = sp.sigmaPx * s
    const yc = (sp.y - oy) * s
    const smile = opts.effects.smile ? SMILE_PER_PX * Math.max(0, yc - originDev) : 0
    const reach = CUTOFF_SIGMAS * sigma
    const inv = 1 / (2 * sigma * sigma)
    for (let k = 0; k < lane.weights.length; k++) {
      const w = lane.weights[k]
      if (w <= 0) continue
      const col = lane.c0 + k
      const centre = yc + smile * lane.shape[k]
      const r0 = Math.max(0, Math.floor(centre - reach))
      const r1 = Math.min(H - 1, Math.ceil(centre + reach))
      for (let r = r0; r <= r1; r++) {
        const d = r + 0.5 - centre
        field[r * W + col] += amp * w * Math.exp(-d * d * inv)
      }
    }
  }

  const lut = rampTable(look)
  const data = new Uint8ClampedArray(W * H * 4)
  const gain = Math.pow(2, opts.exposure) / REFERENCE_DENSITY
  const { grain, uneven } = opts.effects
  for (let r = 0; r < H; r++) {
    const v = r / H
    for (let c = 0; c < W; c++) {
      const i = r * W + c
      let bg = look.background
      if (uneven) {
        const u = c / W
        // Brighter towards the middle of the transilluminator, patchy stain.
        const vignette = 1 - 0.5 * ((u - 0.5) ** 2 + (v - 0.5) ** 2)
        bg = bg * (0.55 + 0.9 * vignette) * (1 + 0.35 * patchiness(u, v))
      }
      let value = bg + (1 - bg) * (1 - Math.exp(-field[i] * gain))
      if (grain) value += (hash(c, r) - 0.5) * 0.045
      const idx = Math.round(Math.min(1, Math.max(0, value)) * 255) * 3
      const o = i * 4
      data[o] = lut[idx]
      data[o + 1] = lut[idx + 1]
      data[o + 2] = lut[idx + 2]
      data[o + 3] = 255
    }
  }
  return { width: W, height: H, data }
}
