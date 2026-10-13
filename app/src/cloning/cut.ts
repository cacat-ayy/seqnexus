/**
 * Cutting a sequence into fragments.
 *
 * Fragments tile the source: each one's top strand runs from the top-strand
 * break at its left to the one at its right, so concatenating them in order
 * gives the original back, and the single-stranded bases at a junction belong
 * to exactly one of the two neighbours. The ends carry the rest (see ./ends).
 *
 * Annotations come along, truncated where a cut falls inside them, and a
 * feature that crosses the origin of a circular source is carried too.
 */

import type { RestrictionEnzyme } from '../enzymes/db'
import type { CutSite } from '../enzymes/finder'
import { findCutSites, cuttingSites } from '../enzymes/finder'
import type { AnnotationData } from '../models/Annotation'
import type { DocumentState } from '../models/Document'
import { cutEnds, bluntEnd, type End } from './ends'
import type { Fragment, FragmentSource } from './fragment'
import { clippedFrom5, keepReadingFrame, withoutSegments } from './fragment'
import { findUnblockedSites } from './methylation'

export interface DigestResult {
  fragments: Fragment[]
  warnings: string[]
  /** The sites that actually cut, in top-strand order. */
  sites: CutSite[]
}

/** Where one enzyme breaks the two strands, in top-strand coordinates. */
interface Boundary {
  fwdCut: number
  revCut: number
  enzyme: string
}

export function formatSize(bp: number): string {
  return bp >= 1000 ? `${(bp / 1000).toFixed(1)} kb` : `${bp} bp`
}

export interface DigestOptions {
  /**
   * Prefix for the fragment ids. Fragments from different digests end up in
   * one reaction, so their ids have to be told apart; the default is taken
   * from the document's name, and a caller with something better (a tab or
   * item id) should pass it.
   */
  idPrefix?: string
}

function idsFrom(doc: DocumentState, options: DigestOptions): (index: number) => string {
  const prefix = options.idPrefix ?? doc.name.replace(/\W+/g, '').slice(0, 12).toLowerCase() ?? 'f'
  return index => `${prefix}:${index}`
}

/**
 * Annotations overlapping a window of the source, in fragment coordinates.
 *
 * `end` below `start` means the window wraps the origin. Everything is done
 * in a coordinate space where a wrapped interval simply runs past the end of
 * the sequence, which lets one overlap test cover the wrapped window, the
 * wrapped feature, and both at once.
 */
export function sliceAnnotations(
  annotations: readonly AnnotationData[],
  start: number,
  end: number,
  seqLen: number,
  circular: boolean,
): AnnotationData[] {
  const out: AnnotationData[] = []
  const windowEnd = end > start ? end : end + seqLen
  const shifts = circular ? [-seqLen, 0, seqLen] : [0]

  for (const ann of annotations) {
    const wraps = ann.end <= ann.start
    if (wraps && !circular) continue
    const annEnd = wraps ? ann.end + seqLen : ann.end

    for (const shift of shifts) {
      const s = Math.max(ann.start + shift, start)
      const e = Math.min(annEnd + shift, windowEnd)
      if (e <= s) continue
      const clipped = s !== ann.start + shift || e !== annEnd + shift
      out.push(keepReadingFrame({
        ...withoutSegments(ann),
        start: s - start,
        end: e - start,
        ...(clipped || ann.truncated ? { truncated: true } : {}),
      }, clippedFrom5({ ...ann, start: ann.start + shift, end: annEnd + shift }, s, e)))
    }
  }

  return out
}

/** Cut sites of the given enzymes that are not blocked by methylation. */
function boundariesOf(
  bases: string,
  topology: 'linear' | 'circular',
  enzymes: RestrictionEnzyme[],
  dam: boolean,
  dcm: boolean,
): { boundaries: Boundary[]; sites: CutSite[]; warnings: string[] } {
  const { sites, warnings } = findUnblockedSites(bases, topology, enzymes, dam, dcm)

  const sorted = [...sites].sort((a, b) => a.fwdCut - b.fwdCut || a.revCut - b.revCut)
  const boundaries: Boundary[] = []
  for (const site of sorted) {
    const last = boundaries[boundaries.length - 1]
    // Two enzymes can break the top strand in the same place. They only make
    // the same end if they break the bottom strand there too; when they do,
    // one boundary stands for both.
    if (last && last.fwdCut === site.fwdCut && last.revCut === site.revCut) {
      if (!last.enzyme.includes(site.enzyme.name)) last.enzyme += `/${site.enzyme.name}`
      continue
    }
    boundaries.push({ fwdCut: site.fwdCut, revCut: site.revCut, enzyme: site.enzyme.name })
  }

  // Overlapping cuts would leave fragments whose ends run past each other,
  // which no real digest produces: the first enzyme to cut destroys the
  // other's site. Keep the leftmost of any overlapping pair and say so.
  const kept: Boundary[] = []
  let dropped = 0
  for (const b of boundaries) {
    const prev = kept[kept.length - 1]
    if (prev && Math.max(prev.fwdCut, prev.revCut) > Math.min(b.fwdCut, b.revCut)) {
      dropped++
      continue
    }
    kept.push(b)
  }
  if (dropped > 0) {
    warnings.push(
      `${dropped} cut site${dropped > 1 ? 's' : ''} overlap another and cannot both cut: the first one was used`,
    )
  }

  return { boundaries: kept, sites, warnings }
}

/**
 * Cut a document with one or more enzymes.
 *
 * An uncut circular sequence stays circular: it has no ends, so nothing can
 * ligate to it, which is the truth about an intact plasmid.
 */
export function digest(
  doc: DocumentState,
  enzymes: RestrictionEnzyme[],
  options: DigestOptions = {},
): DigestResult {
  const bases = doc.sequence.bases
  const seqLen = bases.length
  const topology = doc.sequence.topology
  const circular = topology === 'circular'
  const annData = doc.annotations.map(a => a.toData())
  const dam = doc.metadata?.damMethylated ?? false
  const dcm = doc.metadata?.dcmMethylated ?? false

  const { boundaries, sites, warnings } = boundariesOf(bases, topology, enzymes, dam, dcm)
  const idOf = idsFrom(doc, options)
  const source = (start: number, end: number): FragmentSource => ({
    name: doc.name,
    start,
    end,
    circular,
  })

  if (boundaries.length === 0) {
    return {
      fragments: [{
        id: idOf(0),
        name: circular ? doc.name : `${doc.name} (uncut)`,
        topology,
        top: bases,
        ...(circular ? {} : { left: bluntEnd(), right: bluntEnd() }),
        annotations: annData.map(a => ({ ...a })),
        source: source(0, seqLen),
        reversed: false,
      }],
      warnings,
      sites,
    }
  }

  const fragments: Fragment[] = []
  const n = boundaries.length

  const endsAt = (b: Boundary) => cutEnds(bases, b.fwdCut, b.revCut, b.enzyme, circular)
  const bodyBetween = (from: number, to: number): string =>
    to > from ? bases.slice(from, to) : bases.slice(from) + bases.slice(0, to)

  const push = (index: number, top: string, start: number, end: number, left: End, right: End) => {
    fragments.push({
      id: idOf(index),
      name: `${doc.name} fragment ${index + 1} (${formatSize(top.length)})`,
      topology: 'linear',
      top,
      left,
      right,
      annotations: sliceAnnotations(annData, start, end, seqLen, circular),
      source: source(start, end),
      reversed: false,
    })
  }

  if (circular) {
    // n cuts around a circle leave n fragments, the last one wrapping the origin.
    for (let i = 0; i < n; i++) {
      const left = boundaries[i]
      const right = boundaries[(i + 1) % n]
      push(
        i,
        bodyBetween(left.fwdCut, right.fwdCut),
        left.fwdCut,
        right.fwdCut,
        endsAt(left).right,
        endsAt(right).left,
      )
    }
  } else {
    // n cuts along a strand leave n+1 pieces, the outer two with the
    // molecule's own ends. A cut at position 0 leaves an empty first piece;
    // it is kept so fragment numbers line up with the cuts.
    push(0, bases.slice(0, boundaries[0].fwdCut), 0, boundaries[0].fwdCut, bluntEnd(), endsAt(boundaries[0]).left)
    for (let i = 0; i < n - 1; i++) {
      const left = boundaries[i]
      const right = boundaries[i + 1]
      push(
        i + 1,
        bases.slice(left.fwdCut, right.fwdCut),
        left.fwdCut,
        right.fwdCut,
        endsAt(left).right,
        endsAt(right).left,
      )
    }
    const last = boundaries[n - 1]
    push(n, bases.slice(last.fwdCut), last.fwdCut, seqLen, endsAt(last).right, bluntEnd())
  }

  return { fragments, warnings, sites }
}

/** Beyond this many sites a partial digest has too many outcomes to enumerate. */
const MAX_PARTIAL_SITES = 10

export interface PartialDigestResult {
  /** One entry per distinct outcome, including the uncut and complete digests. */
  fragmentSets: Fragment[][]
  warnings: string[]
  /** True when there were too many sites and only the complete digest is here. */
  truncated: boolean
}

/**
 * Every outcome of a digest in which each site may or may not have been cut.
 *
 * Real partial digests are how a fragment with one cut end is made, so the
 * outcomes matter for cloning, not just for reading a gel.
 */
export function partialDigest(
  doc: DocumentState,
  enzymes: RestrictionEnzyme[],
  options: DigestOptions = {},
): PartialDigestResult {
  const bases = doc.sequence.bases
  const topology = doc.sequence.topology
  const dam = doc.metadata?.damMethylated ?? false
  const dcm = doc.metadata?.dcmMethylated ?? false
  const { boundaries, warnings } = boundariesOf(bases, topology, enzymes, dam, dcm)

  const complete = digest(doc, enzymes, options)
  if (boundaries.length === 0) {
    return { fragmentSets: [complete.fragments], warnings, truncated: false }
  }
  if (boundaries.length > MAX_PARTIAL_SITES) {
    return {
      fragmentSets: [complete.fragments],
      warnings: [
        ...warnings,
        `${boundaries.length} cut sites is too many to enumerate every partial digest: showing the complete digest only`,
      ],
      truncated: true,
    }
  }

  // Each subset of the sites is one outcome. Re-cutting with a subset means
  // asking the enzymes that made those sites, which is what `digest` does
  // when handed a document, so the work is done by re-slicing here instead.
  const sets: Fragment[][] = []
  const total = 1 << boundaries.length
  for (let mask = 0; mask < total; mask++) {
    const active = boundaries.filter((_, i) => (mask >> i) & 1)
    sets.push(fragmentsFromBoundaries(doc, active, options))
  }

  return { fragmentSets: sets, warnings, truncated: false }
}

/**
 * The fragments a given set of breaks leaves. The complete digest is the case
 * where every site is in the set.
 */
function fragmentsFromBoundaries(
  doc: DocumentState,
  boundaries: Boundary[],
  options: DigestOptions = {},
): Fragment[] {
  const bases = doc.sequence.bases
  const seqLen = bases.length
  const circular = doc.sequence.topology === 'circular'
  const annData = doc.annotations.map(a => a.toData())
  const source = (start: number, end: number): FragmentSource => ({ name: doc.name, start, end, circular })
  const idOf = idsFrom(doc, options)

  if (boundaries.length === 0) {
    return [{
      id: idOf(0),
      name: circular ? doc.name : `${doc.name} (uncut)`,
      topology: doc.sequence.topology,
      top: bases,
      ...(circular ? {} : { left: bluntEnd(), right: bluntEnd() }),
      annotations: annData.map(a => ({ ...a })),
      source: source(0, seqLen),
      reversed: false,
    }]
  }

  const endsAt = (b: Boundary) => cutEnds(bases, b.fwdCut, b.revCut, b.enzyme, circular)
  const out: Fragment[] = []
  const n = boundaries.length

  const push = (index: number, top: string, start: number, end: number, left: End, right: End) => {
    out.push({
      id: idOf(index),
      name: `${doc.name} fragment ${index + 1} (${formatSize(top.length)})`,
      topology: 'linear',
      top,
      left,
      right,
      annotations: sliceAnnotations(annData, start, end, seqLen, circular),
      source: source(start, end),
      reversed: false,
    })
  }

  if (circular) {
    for (let i = 0; i < n; i++) {
      const left = boundaries[i]
      const right = boundaries[(i + 1) % n]
      const top = right.fwdCut > left.fwdCut
        ? bases.slice(left.fwdCut, right.fwdCut)
        : bases.slice(left.fwdCut) + bases.slice(0, right.fwdCut)
      push(i, top, left.fwdCut, right.fwdCut, endsAt(left).right, endsAt(right).left)
    }
  } else {
    push(0, bases.slice(0, boundaries[0].fwdCut), 0, boundaries[0].fwdCut, bluntEnd(), endsAt(boundaries[0]).left)
    for (let i = 0; i < n - 1; i++) {
      const left = boundaries[i]
      const right = boundaries[i + 1]
      push(i + 1, bases.slice(left.fwdCut, right.fwdCut), left.fwdCut, right.fwdCut, endsAt(left).right, endsAt(right).left)
    }
    const last = boundaries[n - 1]
    push(n, bases.slice(last.fwdCut), last.fwdCut, seqLen, endsAt(last).right, bluntEnd())
  }

  return out
}

/** Every place the enzymes cut, for callers that only need the positions. */
export function cutPositions(
  bases: string,
  topology: 'linear' | 'circular',
  enzymes: RestrictionEnzyme[],
): CutSite[] {
  return enzymes.flatMap(e => cuttingSites(findCutSites(bases, e, topology)))
}
