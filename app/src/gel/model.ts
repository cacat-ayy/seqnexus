/**
 * Data model for the virtual gel.
 *
 * A gel is a set of running conditions plus an ordered row of lanes. Each
 * lane holds one sample: a ladder, a sequence (cut with zero or more enzymes;
 * zero means uncut), or nothing, the way a real comb leaves wells empty.
 *
 * Everything downstream is derived: `simulate` turns a sample into the DNA
 * species it contains, `migration` places each species on the gel, `bands`
 * groups them into what the eye sees. None of it touches React or the store.
 */

import { formatBp } from '../utils/format'

export type GelBuffer = 'TAE' | 'TBE'

/** Physical gel size, which sets how far the DNA can travel. */
export type GelFormat = 'mini' | 'midi' | 'large'

/**
 * An agarose gel separates DNA by length; an SDS-PAGE gel separates
 * proteins by mass. The lanes, the ladders, the migration model and the
 * unit on every label follow the kind. Absent means agarose.
 */
export type GelKind = 'agarose' | 'sds-page'

export interface GelConditions {
  kind?: GelKind
  /** Agarose concentration in % (w/v), 0.5-3. */
  agarosePct: number
  /** SDS-PAGE only: acrylamide %T of the resolving gel. */
  acrylamidePct?: number
  buffer: GelBuffer
  format: GelFormat
  /**
   * How far the bromophenol blue front has travelled, as a fraction of the
   * run length. This is how the run is timed at the bench ("run until the dye
   * is three quarters down"), so it stands in for voltage × time.
   */
  dyeFront: number
}

export const DEFAULT_CONDITIONS: GelConditions = {
  agarosePct: 1,
  buffer: 'TAE',
  format: 'mini',
  dyeFront: 0.75,
}

/**
 * The shapes a DNA molecule can take. They share a length but not a mobility:
 * supercoiled plasmid is compact and runs ahead of its linear form, nicked
 * (open circular) plasmid is floppy and lags behind it.
 */
export type DnaForm = 'linear' | 'supercoiled' | 'nicked'

/** How an uncut circular sample splits between forms. Fractions sum to 1. */
export interface FormMix {
  supercoiled: number
  nicked: number
  linear: number
}

/** A clean miniprep: mostly supercoiled, some nicked, a trace of linear. */
export const DEFAULT_PLASMID_FORMS: FormMix = { supercoiled: 0.8, nicked: 0.17, linear: 0.03 }

/** A typical diagnostic digest load. */
export const DEFAULT_SAMPLE_NG = 500
/** A few µl of a PCR. */
export const DEFAULT_PCR_NG = 100
/** Per band, for typed-in sizes. */
export const DEFAULT_SIZES_NG = 50

export type LaneSample =
  | { kind: 'empty' }
  | {
      kind: 'ladder'
      ladderId: string
      /** Total DNA loaded. Defaults to the ladder's nominal load. */
      ng?: number
    }
  | {
      kind: 'sequence'
      /** Id of the source sequence; the caller resolves it. */
      sourceId: string
      /** Enzyme names. Empty means the sample runs uncut. */
      enzymes: string[]
      /** Total DNA loaded. */
      ng: number
      /** Form split for uncut circular DNA. Defaults to DEFAULT_PLASMID_FORMS. */
      forms?: FormMix
    }
  | {
      kind: 'pcr'
      /** Template sequence id; the caller resolves it. */
      templateId: string
      /** Library oligo ids of the two primers. */
      forwardId: string
      reverseId: string
      /** Product loaded, typically a few µl of the reaction. */
      ng: number
    }
  | {
      kind: 'sizes'
      /** Band sizes in bp (Da on an SDS-PAGE gel), typed in: to compare against a real gel. */
      sizes: number[]
      /** Mass per band. */
      ng: number
    }
  | {
      kind: 'protein'
      /** Id of the source protein document; the caller resolves it. */
      sourceId: string
      /** Protein loaded, in ng (a Coomassie lane takes a microgram or two). */
      ng: number
      /** Protease ids the sample was digested with; empty runs it intact. */
      proteases: string[]
      /** Missed cleavages allowed in the digest. */
      missedCleavages?: number
    }

export interface GelLane {
  id: string
  /** Shown above the well. Falls back to a generated label. */
  label?: string
  sample: LaneSample
}

export interface GelSetup {
  conditions: GelConditions
  lanes: GelLane[]
}

/** Where a digest fragment came from on its source sequence. */
export interface FragmentOrigin {
  /** 0-based index in cut order, matching `digestFragments`. */
  index: number
  /** Start on the source (0-based, inclusive). */
  start: number
  /**
   * End on the source (exclusive). Smaller than `start` when the fragment
   * spans the origin of a circular source.
   */
  end: number
  /** Enzyme cutting the left end, or null for a sequence end. */
  leftEnzyme: string | null
  /** Enzyme cutting the right end, or null for a sequence end. */
  rightEnzyme: string | null
}

/** One population of identical molecules in a lane. */
export interface DnaSpecies {
  /**
   * Size in the gel's unit: base pairs of DNA on an agarose gel, daltons of
   * protein on an SDS-PAGE gel. One field so the band, label and layout code
   * is written once; `formatGelSize` prints it with the right unit.
   */
  bp: number
  form: DnaForm
  /** Mass loaded, which is what the stain sees. */
  ng: number
  /** Digest fragments only. */
  fragment?: FragmentOrigin
  /** Ladder bands made brighter on purpose, to orient by. */
  reference?: boolean
  /** PCR lanes: the intended product, as opposed to a side product. */
  pcr?: 'product' | 'side'
}

export function isProteinGel(c: Pick<GelConditions, 'kind'>): boolean {
  return c.kind === 'sds-page'
}

/** "13.7 kDa" on a protein gel, "1.2 kb" on a DNA gel. */
export function formatGelSize(size: number, c: Pick<GelConditions, 'kind'>): string {
  if (!isProteinGel(c)) return formatBp(size)
  if (size >= 100_000) return `${Math.round(size / 1000)} kDa`
  if (size >= 1000) return `${(size / 1000).toFixed(1)} kDa`
  return `${Math.round(size)} Da`
}
