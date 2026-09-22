/**
 * In-Fusion Assembly simulation.
 *
 * Thin wrapper around the Gibson Assembly engine with In-Fusion-specific
 * defaults: 15–25 bp overlaps, no Tm requirement (enzyme mix works at
 * room temperature).
 */

import { gibsonAssemble, type GibsonFragment, type GibsonResult } from './gibson'

export interface InFusionInput {
  /** Ordered fragments. Adjacent fragments must share 15–25 bp terminal homology. */
  fragments: GibsonFragment[]
  /** Minimum overlap length in bp (default: 15). */
  minOverlap?: number
  /** Maximum overlap length to search (default: 25). */
  maxOverlap?: number
  /** Try all permutations to find a valid assembly order (≤ 6 fragments). */
  autoOrder?: boolean
}

/**
 * Simulate In-Fusion Assembly.
 *
 * Delegates to gibsonAssemble with In-Fusion defaults, then filters out
 * Tm-related warnings (In-Fusion has no Tm requirement) and adds
 * In-Fusion-specific overlap range warnings.
 */
export function infusionAssemble(input: InFusionInput): GibsonResult {
  const minOverlap = input.minOverlap ?? 15
  const maxOverlap = input.maxOverlap ?? 25

  const result = gibsonAssemble({
    fragments: input.fragments,
    minOverlap,
    maxOverlap,
    autoOrder: input.autoOrder,
  })

  // Filter out Tm warnings – In-Fusion doesn't require high Tm overlaps
  const warnings = result.warnings.filter(w => !w.includes('Tm') && !w.includes('°C'))

  // Add In-Fusion-specific overlap range warnings
  for (const ov of result.overlaps) {
    if (ov.length > 0 && ov.length < 15) {
      warnings.push(
        `Overlap between fragments ${ov.leftIdx + 1} and ${ov.rightIdx + 1} is ${ov.length} bp (In-Fusion requires ≥ 15 bp)`
      )
    }
    if (ov.length > 25) {
      warnings.push(
        `Overlap between fragments ${ov.leftIdx + 1} and ${ov.rightIdx + 1} is ${ov.length} bp (In-Fusion optimal range is 15–25 bp)`
      )
    }
  }

  // Rename descriptions from "Gibson" to "In-Fusion"
  const products = result.products.map(p => ({
    ...p,
    description: p.description.replace(/Gibson/g, 'In-Fusion'),
  }))

  return { products, warnings, overlaps: result.overlaps }
}
