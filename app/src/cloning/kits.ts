/**
 * Seamless-assembly kits.
 *
 * NEBuilder HiFi, Gibson, In-Fusion and SLIC all do the same thing: chew back
 * one strand at each end, let the single strands anneal over a shared stretch,
 * fill in and seal. So one engine (./homology) runs all of them, and a kit is
 * only a set of expectations about that shared stretch.
 *
 * The numbers are the suppliers' own guidance, which is where the differences
 * come from: HiFi's polymerase and ligase tolerate a mismatch or two and it
 * wants a longer overlap for more than a couple of fragments, while classic
 * Gibson leans on the overlap melting above the 50 °C assembly temperature.
 */

export type KitId = 'hifi' | 'gibson' | 'infusion' | 'slic'

export interface Kit {
  id: KitId
  name: string
  /** Shorter than this and the single strands will not hold. */
  minOverlap: number
  /** The length the kit is happiest with. */
  idealOverlap: number
  /** Beyond this an overlap is worth a second look, though it may be fine. */
  warnAbove: number
  /**
   * How far to keep searching for a shared stretch. Not a limit on what the
   * kit accepts: a longer overlap than this simply will not be looked for.
   */
  maxOverlap: number
  /**
   * Overlap melting temperature the kit needs, or null when it does not care
   * because the reaction is not run near the annealing limit.
   */
  minTm: number | null
  /** Mismatches the kit's enzymes will repair rather than fail on. */
  mismatchTolerance: number
  /** Overlap to aim for with this many fragments or more. */
  longOverlapFrom?: { fragments: number; overlap: number }
  note: string
}

export const KITS: Record<KitId, Kit> = {
  hifi: {
    id: 'hifi',
    name: 'NEBuilder HiFi',
    minOverlap: 15,
    idealOverlap: 25,
    warnAbove: 40,
    maxOverlap: 60,
    minTm: null,
    mismatchTolerance: 2,
    longOverlapFrom: { fragments: 5, overlap: 30 },
    note: 'Tolerates a mismatch or two in the overlap. Use 20–30 bp for a few fragments and 30 bp or more beyond four.',
  },
  gibson: {
    id: 'gibson',
    name: 'Gibson Assembly',
    minOverlap: 15,
    idealOverlap: 25,
    warnAbove: 40,
    maxOverlap: 60,
    minTm: 48,
    mismatchTolerance: 0,
    note: 'The overlap has to melt above the 50 °C assembly temperature, so aim for a Tm of at least 48 °C.',
  },
  infusion: {
    id: 'infusion',
    name: 'In-Fusion',
    minOverlap: 15,
    idealOverlap: 15,
    warnAbove: 25,
    maxOverlap: 40,
    minTm: null,
    mismatchTolerance: 0,
    note: 'Works at room temperature, so the overlap only has to be long enough: 15 bp is the usual choice.',
  },
  slic: {
    id: 'slic',
    name: 'SLIC / CPEC',
    minOverlap: 20,
    idealOverlap: 30,
    warnAbove: 80,
    maxOverlap: 100,
    minTm: 50,
    mismatchTolerance: 0,
    note: 'Annealing is done without an exonuclease mix, so give it a long, strongly melting overlap.',
  },
}

export const KIT_LIST: Kit[] = [KITS.hifi, KITS.gibson, KITS.infusion, KITS.slic]

/** The overlap length to design for, given how many fragments are going in. */
export function targetOverlap(kit: Kit, fragments: number): number {
  const long = kit.longOverlapFrom
  return long && fragments >= long.fragments ? long.overlap : kit.idealOverlap
}
