/**
 * Database of common molecular biology features with DNA sequences.
 *
 * RNA parts are written in DNA letters so they are found in the plasmid
 * that encodes them; protein-only parts are in the protein library
 * (protein-features.ts). Where several sequences share a name, each distinct
 * version is kept under a qualified name with the shared name as its group,
 * and versions the main entry already finds are dropped.
 * Used for auto-annotation: scan a loaded sequence to find matches.
 *
 * Sequences are stored 2-bit packed (ACGT -> 00,01,10,11) and base64
 * encoded in packed-features-data.ts, decoded lazily on first access.
 */

import { PACKED_DATA, type PackedFeature } from './packed-features-data'

export interface CommonFeature {
  name: string
  type: string
  color: string
  category: string
  sequence: string
  /** The entry this one is a version of, for the scan to treat them as one. */
  group?: string
}

export const FEATURE_CATEGORIES = [
  'Resistance',
  'Selection Marker',
  'Reporter',
  'Promoter',
  'Terminator',
  'Origin of Replication',
  'Regulatory',
  'Recombination',
  'Tag / Fusion',
  'Primer',
  'Other',
] as const

export type FeatureCategory = typeof FEATURE_CATEGORIES[number]

const DECODE_MAP = 'ACGT'

/** Decode a 2-bit packed base64 sequence back to DNA. */
function unpackSequence(packed: PackedFeature): string {
  const bytes = atob(packed.s)
  const result: string[] = []
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes.charCodeAt(i)
    result.push(DECODE_MAP[(b >> 6) & 3])
    result.push(DECODE_MAP[(b >> 4) & 3])
    result.push(DECODE_MAP[(b >> 2) & 3])
    result.push(DECODE_MAP[b & 3])
  }
  // Trim to actual length
  result.length = packed.l
  // Apply IUPAC exceptions
  if (packed.x) {
    for (const [pos, ch] of Object.entries(packed.x)) {
      result[Number(pos)] = ch
    }
  }
  return result.join('')
}

let _cache: CommonFeature[] | null = null

/** Lazily decoded feature list. Decodes on first access, cached thereafter. */
export function getCommonFeatures(): CommonFeature[] {
  if (_cache) return _cache
  _cache = PACKED_DATA.map(p => ({
    name: p.n,
    type: p.t,
    color: p.c,
    category: p.g,
    sequence: unpackSequence(p),
    group: p.v,
  }))
  return _cache
}


