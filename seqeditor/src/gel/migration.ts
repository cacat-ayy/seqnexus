/**
 * Gel electrophoresis migration model.
 *
 * Maps fragment size (bp) to a vertical Y position on the gel canvas.
 * Uses a log-scale model adjusted by agarose gel percentage to approximate
 * real separation behavior:
 *   - Lower % gels resolve large fragments better (wider spacing at top).
 *   - Higher % gels resolve small fragments better (wider spacing at bottom).
 *
 * The model defines an effective resolution window [minBp, maxBp] per gel
 * percentage, then maps log10(bp) linearly within that window to the gel
 * height. Fragments outside the window are clamped to the edges.
 */

/** Effective resolution range per gel percentage. */
const RESOLUTION_RANGES: Record<number, [number, number]> = {
  0.5: [500, 50000],
  0.8: [200, 25000],
  1.0: [100, 15000],
  1.5: [50, 8000],
  2.0: [25, 5000],
  3.0: [10, 3000],
}

/**
 * Convert a fragment size to a Y coordinate on the gel.
 *
 * @param bp       Fragment size in base pairs.
 * @param gelPct   Agarose gel percentage (0.5–3.0).
 * @param gelTop   Y coordinate of the top of the gel (below wells).
 * @param gelBottom Y coordinate of the bottom of the gel.
 * @returns Y position (larger fragments closer to gelTop, smaller closer to gelBottom).
 */
export function sizeToY(
  bp: number,
  gelPct: number,
  gelTop: number,
  gelBottom: number,
): number {
  const range = RESOLUTION_RANGES[gelPct] ?? RESOLUTION_RANGES[1.0]
  const [minBp, maxBp] = range
  const logMin = Math.log10(minBp)
  const logMax = Math.log10(maxBp)
  const logBp = Math.log10(Math.max(bp, 1))

  // Fraction: 1 = at top (large), 0 = at bottom (small)
  const frac = Math.max(0, Math.min(1, (logBp - logMin) / (logMax - logMin)))
  return gelBottom - frac * (gelBottom - gelTop)
}

export const GEL_PERCENTAGES = [0.5, 0.8, 1.0, 1.5, 2.0, 3.0] as const
export type GelPercentage = (typeof GEL_PERCENTAGES)[number]
export const DEFAULT_GEL_PCT: GelPercentage = 1.0
