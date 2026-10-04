/**
 * The older digest and ligation API, now a thin layer over ./cut and
 * ./assemble so there is only one model of an end in the app.
 *
 * Callers here work with `CloningFragment`, which carries the two ends as
 * `overhang5`/`overhang3` strings. Those are the same spans the `End` model
 * uses — written 5'→3' along whichever strand protrudes — so two ends still
 * meet when one span is the reverse complement of the other.
 *
 * New code should use `digest`, `assemble` and the `Fragment` model directly;
 * this exists for the virtual gel and the cloning dialog until they move over.
 */

import type { RestrictionEnzyme } from '../enzymes/db'
import { reverseComplement } from '../models/complement'
import type { DocumentState } from '../models/Document'
import type { CloningFragment, CloningProduct, OverhangKind } from './types'
import { digest, partialDigest, formatSize } from './cut'
import type { Fragment } from './fragment'
import { bluntEnd, endsAnneal, type End } from './ends'
import { assemble, type AssembleOptions } from './assemble'

export { findUnblockedSites, type MethylationFilterResult } from './methylation'
export { digest, partialDigest, formatSize } from './cut'

export interface Overhang {
  sequence: string
  type: OverhangKind
}

export interface DigestResult {
  fragments: CloningFragment[]
  warnings: string[]
}

export interface PartialDigestResult {
  fragmentSets: CloningFragment[][]
  warnings: string[]
}

/** An `End` as the old pair of fields. */
function toOverhang(end: End | undefined): Overhang {
  if (!end || end.kind === 'blunt') return { sequence: '', type: 'blunt' }
  return { sequence: end.span, type: end.kind }
}

/** The old pair of fields as an `End`. Phosphorylated, as an enzyme leaves it. */
function toEnd(overhang: string, type: OverhangKind): End {
  return type === 'blunt' ? bluntEnd() : { span: overhang, kind: type, phosphate: true }
}

function toCloningFragment(f: Fragment): CloningFragment {
  const oh5 = toOverhang(f.left)
  const oh3 = toOverhang(f.right)
  return {
    name: f.name,
    sequence: f.top,
    overhang5: oh5.sequence,
    overhang3: oh3.sequence,
    overhang5Type: oh5.type,
    overhang3Type: oh3.type,
    annotations: f.annotations,
    sourceName: f.source.name,
    reversed: f.reversed,
  }
}

function toFragment(frag: CloningFragment, index: number): Fragment {
  return {
    id: `l${index}`,
    name: frag.name,
    topology: 'linear',
    top: frag.sequence,
    left: toEnd(frag.overhang5, frag.overhang5Type),
    right: toEnd(frag.overhang3, frag.overhang3Type),
    annotations: frag.annotations,
    source: {
      name: frag.sourceName,
      start: 0,
      end: frag.sequence.length,
      circular: false,
    },
    reversed: frag.reversed,
  }
}

/**
 * The bases of an overhang at a cut, written 5'→3' along the strand that
 * protrudes, as seen from the piece to the right of the cut.
 */
export function extractOverhang(bases: string, fwdCut: number, revCut: number, circular = false): Overhang {
  if (fwdCut === revCut) return { sequence: '', type: 'blunt' }

  const len = bases.length
  const read = (from: number, n: number): string => {
    if (!circular) return bases.slice(from, from + n)
    let out = ''
    for (let i = from; i < from + n; i++) out += bases[((i % len) + len) % len]
    return out
  }

  let delta = revCut - fwdCut
  if (circular) {
    delta = ((delta % len) + len) % len
    if (delta > len / 2) delta -= len
  }

  return delta > 0
    ? { sequence: read(fwdCut, delta), type: 'five_prime' }
    : { sequence: reverseComplement(read(revCut, -delta).toUpperCase()), type: 'three_prime' }
}

/** Whether two ends can base-pair. */
export function areOverhangsCompatible(a: Overhang, b: Overhang): boolean {
  return endsAnneal(toEnd(a.sequence, a.type), toEnd(b.sequence, b.type))
}

export function digestFragments(doc: DocumentState, enzymes: RestrictionEnzyme[]): DigestResult {
  const result = digest(doc, enzymes)
  return { fragments: result.fragments.map(toCloningFragment), warnings: result.warnings }
}

export function partialDigestFragments(doc: DocumentState, enzymes: RestrictionEnzyme[]): PartialDigestResult {
  const result = partialDigest(doc, enzymes)
  return {
    fragmentSets: result.fragmentSets.map(set => set.map(toCloningFragment)),
    warnings: result.warnings,
  }
}

export interface LigationOptions {
  allowSelfLigation?: boolean
  /** Indices into the fragment list whose 5' phosphates have been removed. */
  dephosphorylatedFragments?: ReadonlySet<number>
  /** Try each fragment in both orientations. Default true. */
  allowFlip?: boolean
  recutEnzymes?: RestrictionEnzyme[]
  /**
   * Indices of the fragments the design calls for. Left out, the longest
   * fragment from each source sequence is assumed (see below).
   */
  required?: ReadonlySet<number>
}

/**
 * Which fragments a reaction is meant to use, when the caller has not said.
 *
 * With more than one source sequence, one per source: the longest, which is
 * the band you would cut out of a gel. Without that, a digest's leftovers —
 * the short pieces outside the cloning sites — count towards the intended
 * product, and a circle made of every scrap looks as expected as the real one.
 *
 * Fragments from a single source are all required instead, since cutting one
 * sequence and ligating it is a reassembly: every piece belongs.
 */
function intendedParts(fragments: CloningFragment[]): Set<number> {
  const best = new Map<string, number>()
  fragments.forEach((frag, index) => {
    const held = best.get(frag.sourceName)
    if (held === undefined || frag.sequence.length > fragments[held].sequence.length) {
      best.set(frag.sourceName, index)
    }
  })
  if (best.size < 2) return new Set(fragments.map((_, i) => i))
  return new Set(best.values())
}

/** Every product a set of fragments can ligate into. */
export function ligateFragments(
  fragments: CloningFragment[],
  options: LigationOptions = {},
): CloningProduct[] {
  if (fragments.length === 0) return []

  const assembleOptions: AssembleOptions = {
    allowSelfLigation: options.allowSelfLigation ?? true,
    allowFlip: options.allowFlip ?? true,
    required: options.required ?? intendedParts(fragments),
    ...(options.dephosphorylatedFragments ? { dephosphorylated: options.dephosphorylatedFragments } : {}),
    ...(options.recutEnzymes ? { recutEnzymes: options.recutEnzymes } : {}),
  }

  return assemble(fragments.map(toFragment), assembleOptions).map(a => ({
    name: a.name,
    sequence: a.sequence,
    topology: a.topology,
    annotations: a.annotations,
    size: a.size,
    isExpected: a.usesAll && a.topology === 'circular' && a.recut.length === 0,
    description: a.recut.length > 0
      ? `${a.description} Still cut by ${a.recut.join(', ')}: this product is re-cut in the reaction.`
      : a.nicked
        ? `${a.description} One strand is left nicked at a junction; the cell repairs it.`
        : a.description,
  }))
}

/** Kept for callers that only need a size label. */
export { formatSize as formatFragmentSize }
