/**
 * A primer or probe as an object in its own right.
 *
 * What is stored is the oligo you would order: the full 5'→3' sequence,
 * tails and all. Where it binds is never stored. It is recomputed from the
 * sequence and the template (see binding.ts), so an edit to the template can
 * never leave a primer drawn over bases it no longer anneals to, and a tail
 * is simply whatever part of the oligo does not anneal.
 *
 * The same model SnapGene uses: a primer is a sequence, and binding sites
 * are derived. That is also what makes tails survive a .dna round trip.
 */

import { reverseComplement } from '../models/complement'

export type OligoRole = 'primer' | 'probe'

export interface PrimerData {
  id: string
  name: string
  /** Full oligo 5'→3', uppercase, including any non-binding tails. */
  sequence: string
  role: OligoRole
  /** Overrides the strand colour when set. */
  color?: string
  notes?: string
  /** Free-text modifications as ordered, e.g. FAM, BHQ1, Phos. */
  mods?: { five?: string; three?: string }
}

/**
 * An oligo in the session-wide library: the primers you keep, independent
 * of any one sequence. A copy is put on a sequence to use it there; the two
 * are not linked, so editing one leaves the other alone.
 */
export interface LibraryOligo extends PrimerData {
  createdAt: number
}

/** Bases an oligo may contain: DNA plus the IUPAC ambiguity codes. */
const OLIGO_BASES = /^[ACGTRYSWKMBDHVN]+$/

/**
 * Normalize pasted text into an oligo sequence.
 *
 * Strips whitespace, digits and the 5'-/-3' decorations people paste from
 * order sheets, maps U to T, and uppercases. Returns null when anything else
 * is left, so a typo is reported rather than silently dropped.
 */
export function cleanOligo(text: string): string | null {
  const s = text
    .replace(/[\s\d'′’-]/g, '')
    .toUpperCase()
    .replace(/U/g, 'T')
  if (s.length === 0 || !OLIGO_BASES.test(s)) return null
  return s
}

/** Qualifier a `primer_bind` feature carries its full oligo in. The old
 *  primer designer wrote `sequence`; GenBank export writes both. */
export const OLIGO_QUALIFIERS = ['primer_sequence', 'sequence'] as const

/**
 * The oligo a `primer_bind` feature stands for.
 *
 * A recorded sequence wins, because it is the only place a tail survives.
 * Otherwise it is the bases the feature covers, read 5'→3' along its strand.
 */
export function primerOligoFromFeature(
  ann: { start: number; end: number; strand: number; qualifiers: Record<string, string[]> },
  sequence: { length: number; basesIn(start: number, end: number): string },
): string | null {
  for (const key of OLIGO_QUALIFIERS) {
    const recorded = ann.qualifiers[key]?.[0]
    const clean = recorded ? cleanOligo(recorded) : null
    if (clean) return clean
  }
  const span = ann.start <= ann.end
    ? sequence.basesIn(ann.start, ann.end)
    : sequence.basesIn(ann.start, sequence.length) + sequence.basesIn(0, ann.end)
  return cleanOligo(ann.strand === -1 ? reverseComplement(span) : span)
}

let counter = 0

/** Session-unique id for a new primer. */
export function newPrimerId(): string {
  counter += 1
  return `oligo_${Date.now().toString(36)}_${counter}`
}

export const PRIMER_COLORS = {
  forward: '#3b82f6',
  reverse: '#ef4444',
  probe: '#f59e0b',
} as const

/** Colour a primer is drawn in at a site on the given strand. */
export function primerColor(primer: PrimerData, strand: 1 | -1): string {
  if (primer.color) return primer.color
  if (primer.role === 'probe') return PRIMER_COLORS.probe
  return strand === 1 ? PRIMER_COLORS.forward : PRIMER_COLORS.reverse
}
