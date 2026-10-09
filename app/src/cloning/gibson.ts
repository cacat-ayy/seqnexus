/**
 * Gibson Assembly, In-Fusion and NEBuilder HiFi, over the one seamless
 * assembly engine in ./homology.
 *
 * This file is the older API the cloning dialog still calls. The engine
 * behind it finds the order and the orientation itself and will open a
 * circular vector where the arms land, so `autoOrder` no longer means
 * anything: the assembly order is always worked out.
 */

import type { DocumentState } from '../models/Document'
import type { CloningProduct } from './types'
import type { Assembly } from './product'
import {
  findHomology,
  homologyAssemble,
  partFromDocument,
  type HomologyPart,
} from './homology'
import { KITS, type KitId } from './kits'

export interface GibsonFragment {
  doc: DocumentState
  /** Optional sub-region [start, end). If omitted, uses the whole sequence. */
  regionStart?: number
  regionEnd?: number
}

export interface GibsonInput {
  fragments: GibsonFragment[]
  minOverlap?: number
  maxOverlap?: number
  /** No longer used: the order always comes out of the overlaps. */
  autoOrder?: boolean
  /** Which kit's expectations to apply. Defaults to classic Gibson. */
  kit?: KitId
}

export interface OverlapInfo {
  leftIdx: number
  rightIdx: number
  length: number
  sequence: string
  tm: number
}

export interface GibsonResult {
  products: CloningProduct[]
  warnings: string[]
  overlaps: OverlapInfo[]
}

function toParts(fragments: GibsonFragment[]): HomologyPart[] {
  return fragments.map((fragment, index) =>
    partFromDocument(fragment.doc, {
      id: `g${index}`,
      ...(fragment.regionStart !== undefined && fragment.regionEnd !== undefined
        ? { region: { start: fragment.regionStart, end: fragment.regionEnd } }
        : {}),
    }),
  )
}

function toProduct(assembly: Assembly): CloningProduct {
  const description = assembly.warnings.length > 0
    ? `${assembly.description} ${assembly.warnings.join(' ')}`
    : assembly.description
  return {
    name: assembly.name,
    sequence: assembly.sequence,
    topology: assembly.topology,
    annotations: assembly.annotations,
    size: assembly.size,
    isExpected: assembly.usesAll && assembly.topology === 'circular',
    description,
  }
}

function run(input: GibsonInput, kit: KitId): GibsonResult {
  const parts = toParts(input.fragments)
  if (parts.length === 0) {
    return { products: [], warnings: ['No fragments provided'], overlaps: [] }
  }

  const result = homologyAssemble(parts, {
    kit,
    ...(input.minOverlap !== undefined ? { minOverlap: input.minOverlap } : {}),
    ...(input.maxOverlap !== undefined ? { maxOverlap: input.maxOverlap } : {}),
  })

  // The old shape reported one overlap per adjacent pair of the product that
  // was built, so report the junctions of the best one and fall back to
  // everything that was found when nothing assembled.
  const best = result.products.find(p => p.usesAll && p.topology === 'circular') ?? result.products[0]
  const overlaps: OverlapInfo[] = best
    ? best.junctions.map(junction => ({
        leftIdx: junction.leftPart,
        rightIdx: junction.rightPart,
        length: junction.overlap?.length ?? 0,
        sequence: junction.overlap?.sequence ?? '',
        tm: junction.overlap?.tm ?? 0,
      }))
    : result.overlaps.map(find => ({
        leftIdx: find.left,
        rightIdx: find.right,
        length: find.overlap.length,
        sequence: find.overlap.sequence,
        tm: find.overlap.tm,
      }))

  const warnings = [...result.warnings]
  if (best) warnings.push(...best.warnings)
  if (result.products.length === 0 && warnings.length === 0) {
    warnings.push(`Nothing could be assembled with ${KITS[kit].name}`)
  }

  return { products: result.products.map(toProduct), warnings: [...new Set(warnings)], overlaps }
}

/** Gibson Assembly: the overlap has to melt above the assembly temperature. */
export function gibsonAssemble(input: GibsonInput): GibsonResult {
  return run(input, input.kit ?? 'gibson')
}


/**
 * The longest shared stretch between the end of `seqA` and the start of
 * `seqB`, or 0 when there is none that long. Kept for callers that only want
 * a length.
 */
export function findOverlap(seqA: string, seqB: string, minLen: number, maxLen: number): number {
  const [hit] = findHomology(
    { seq: seqA, circular: false },
    { seq: seqB, circular: false },
    minLen,
    maxLen,
  )
  return hit?.overlap.length ?? 0
}
