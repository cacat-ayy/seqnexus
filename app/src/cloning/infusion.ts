/**
 * In-Fusion, over the same seamless assembly engine as Gibson and HiFi.
 *
 * The kit works at room temperature, so it asks nothing of the overlap's
 * melting temperature — only that it is long enough, and not much longer
 * than it needs to be.
 */

import { gibsonAssemble, type GibsonFragment, type GibsonResult } from './gibson'

export interface InFusionInput {
  fragments: GibsonFragment[]
  minOverlap?: number
  maxOverlap?: number
  /** No longer used: the order always comes out of the overlaps. */
  autoOrder?: boolean
}

export function infusionAssemble(input: InFusionInput): GibsonResult {
  return gibsonAssemble({
    fragments: input.fragments,
    kit: 'infusion',
    ...(input.minOverlap !== undefined ? { minOverlap: input.minOverlap } : {}),
    ...(input.maxOverlap !== undefined ? { maxOverlap: input.maxOverlap } : {}),
  })
}
