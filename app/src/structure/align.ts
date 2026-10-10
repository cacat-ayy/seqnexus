/**
 * Lining a protein up with a structure's chain.
 *
 * Residue numbers in a structure rarely match a sequence's positions: the
 * construct has a tag the crystal lost, the structure starts at the mature
 * chain, loops are disordered and missing, or the depositors numbered from
 * the native protein. So the two sequences are aligned (Needleman-Wunsch,
 * BLOSUM62, gap open -10 and extend -0.5, the alignment dialog's protein
 * defaults) and the alignment gives the residue-to-residue map. Only
 * aligned pairs are mapped; a residue opposite a gap has no partner.
 */

import { needlemanWunsch } from '../alignment/nw'
import { scoreProtein } from '../alignment/matrices'
import type { StructureChain } from './model'

const GAP_OPEN = -10
const GAP_EXTEND = -0.5

export interface ChainMapping {
  chain: string
  /** For each protein residue, the index of its partner in the chain's residues, or -1. */
  toChain: Int32Array
  /** For each chain residue, the index of its partner in the protein, or -1. */
  toProtein: Int32Array
  /** Aligned pairs that are the same residue. */
  identical: number
  /** Aligned pairs. */
  aligned: number
}

export function mapToChain(protein: string, chain: StructureChain): ChainMapping {
  const a = protein.toUpperCase()
  const b = chain.sequence
  const toChain = new Int32Array(a.length).fill(-1)
  const toProtein = new Int32Array(b.length).fill(-1)
  const { alignedA, alignedB } = needlemanWunsch(a, b, scoreProtein, GAP_OPEN, GAP_EXTEND)
  let i = 0
  let j = 0
  let identical = 0
  let aligned = 0
  for (let k = 0; k < alignedA.length; k++) {
    const ca = alignedA[k]
    const cb = alignedB[k]
    if (ca !== '-' && cb !== '-') {
      toChain[i] = j
      toProtein[j] = i
      aligned++
      if (ca === cb) identical++
    }
    if (ca !== '-') i++
    if (cb !== '-') j++
  }
  return { chain: chain.id, toChain, toProtein, identical, aligned }
}

/** Fraction of aligned pairs that are identical. */
export function identity(m: ChainMapping): number {
  return m.aligned > 0 ? m.identical / m.aligned : 0
}

/**
 * The chain that matches the protein best: most identical residues, so a
 * long chain of the right protein beats a short one and any chain of
 * another protein. Chains with the same sequence are aligned once.
 */
export function bestChain(protein: string, chains: readonly StructureChain[]): ChainMapping | null {
  let best: ChainMapping | null = null
  const seen = new Map<string, ChainMapping>()
  for (const c of chains) {
    const prior = seen.get(c.sequence)
    const m = prior ? { ...prior, chain: c.id } : mapToChain(protein, c)
    seen.set(c.sequence, m)
    if (!best || m.identical > best.identical) best = m
  }
  return best
}
