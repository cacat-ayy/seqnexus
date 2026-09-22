/**
 * Shared types for the in-silico cloning engine.
 */

import type { AnnotationData } from '../models/Annotation'
import type { DocumentState } from '../models/Document'

export type OverhangKind = 'five_prime' | 'three_prime' | 'blunt'

/** A DNA fragment produced by restriction digest, with tracked overhangs and source annotations. */
export interface CloningFragment {
  name: string
  /** Double-stranded body sequence (between cuts, not including overhang bases). */
  sequence: string
  /** 5' overhang on the top strand. Empty string = blunt. */
  overhang5: string
  /** 3' overhang on the top strand. Empty string = blunt. */
  overhang3: string
  overhang5Type: OverhangKind
  overhang3Type: OverhangKind
  /** Annotations from the source, coordinates adjusted to fragment-local [0, sequence.length). */
  annotations: AnnotationData[]
  /** Source document name for provenance. */
  sourceName: string
  /** Whether the fragment was reverse-complemented relative to its source. */
  reversed: boolean
}

/** A fully assembled cloning product. */
export interface CloningProduct {
  name: string
  sequence: string
  topology: 'linear' | 'circular'
  annotations: AnnotationData[]
  size: number
  /** True if this is the intended product; false for off-target / partial assemblies. */
  isExpected: boolean
  /** Human-readable description of how this product formed. */
  description: string
}

/** Input sequence source - either an open tab or pasted/imported sequence. */
export interface SequenceSource {
  type: 'tab' | 'pasted'
  tabId?: string
  doc: DocumentState
}
