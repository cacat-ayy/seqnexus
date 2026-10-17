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

/**
 * The stretch of the top strand a boundary's two breaks sit either side of:
 * the bases that end up single-stranded at the junction.
 *
 * On a circle either break may be the one that wrapped past the origin, so
 * the distance between them is read the short way round, the same way
 * `cutEnds` reads the overhang itself. Doing this in plain coordinates
 * instead makes a wrapped cut look as though it spans almost the whole
 * plasmid, which would have every other cut appear to clash with it.
 */
function occupiedBy(b: Boundary, seqLen: number, circular: boolean): { start: number; length: number } {
  let delta = b.revCut - b.fwdCut
  if (circular && seqLen > 0) {
    delta = ((delta % seqLen) + seqLen) % seqLen
    if (delta > seqLen / 2) delta -= seqLen
  }
  const raw = delta >= 0 ? b.fwdCut : b.fwdCut + delta
  const start = circular && seqLen > 0 ? ((raw % seqLen) + seqLen) % seqLen : raw
  return { start, length: Math.abs(delta) }
}

/**
 * The bases of a piece that are double-stranded: its top strand less
 * whatever the top strand lends to a protrusion at either end. Mirrors
 * `coreOf` in ./fragment, without building the fragment first.
 */
function coreLength(top: string, left: End, right: End): number {
  const lent = (left.kind === 'five_prime' ? left.span.length : 0)
    + (right.kind === 'three_prime' ? right.span.length : 0)
  return top.length - lent
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

  // Two cuts that run into each other cannot both happen: whichever enzyme
  // gets there first breaks the strands the other one needs. The same is true
  // of two enzymes breaking the top strand in the same place, even when the
  // stretches they occupy do not overlap, since either break runs through the
  // other's recognition sequence. Keep the first of such a pair and say so.
  //
  // The comparison is done in the order the occupied stretches sit on the
  // molecule, not in cut order, because on a circle a wrapped cut's stretch
  // starts near the end of the sequence while its top-strand break is at the
  // beginning.
  const seqLen = bases.length
  const circular = topology === 'circular'
  const inOrder = boundaries
    .map(b => ({ b, at: occupiedBy(b, seqLen, circular) }))
    .sort((x, y) => x.at.start - y.at.start || x.b.fwdCut - y.b.fwdCut)

  const kept: typeof inOrder = []
  const clashes: string[] = []
  const clashesWith = (prev: typeof inOrder[number], next: typeof inOrder[number]): boolean =>
    prev.at.start + prev.at.length > next.at.start || prev.b.fwdCut === next.b.fwdCut

  for (const entry of inOrder) {
    const prev = kept[kept.length - 1]
    if (prev && clashesWith(prev, entry)) {
      clashes.push(`${prev.b.enzyme} and ${entry.b.enzyme}`)
      continue
    }
    kept.push(entry)
  }
  // On a circle the last stretch can run back into the first one.
  if (circular && kept.length > 1) {
    const last = kept[kept.length - 1]
    const first = kept[0]
    if (last.at.start + last.at.length > first.at.start + seqLen || last.b.fwdCut === first.b.fwdCut) {
      clashes.push(`${first.b.enzyme} and ${last.b.enzyme}`)
      kept.pop()
    }
  }

  if (clashes.length > 0) {
    const named = [...new Set(clashes)].slice(0, 2).join('; ')
    warnings.push(
      `${clashes.length} cut site${clashes.length > 1 ? 's' : ''} cannot both cut, because the cuts run into each other (${named}): the first one was used`,
    )
  }

  // The fragment builders walk the boundaries in top-strand order.
  const ordered = kept.map(k => k.b).sort((a, b) => a.fwdCut - b.fwdCut || a.revCut - b.revCut)
  return { boundaries: ordered, sites, warnings }
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

  const pieces: { top: string; start: number; end: number; left: End; right: End }[] = []
  const push = (_index: number, top: string, start: number, end: number, left: End, right: End) => {
    pieces.push({ top, start, end, left, right })
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

  // A piece with nothing double-stranded left in it is not a fragment: two
  // cuts that close together release the bases between them as a single
  // strand, and the neighbours keep the protrusions. A cut exactly at the end
  // of a linear molecule leaves nothing at all. Either way there is no piece
  // to carry into a ligation, so it is reported rather than offered.
  let released = 0
  for (const piece of pieces) {
    if (coreLength(piece.top, piece.left, piece.right) <= 0) {
      released++
      continue
    }
    const index = fragments.length
    fragments.push({
      id: idOf(index),
      name: `${doc.name} fragment ${index + 1} (${formatSize(piece.top.length)})`,
      topology: 'linear',
      top: piece.top,
      left: piece.left,
      right: piece.right,
      annotations: sliceAnnotations(annData, piece.start, piece.end, seqLen, circular),
      source: source(piece.start, piece.end),
      reversed: false,
    })
  }
  if (released > 0) {
    warnings.push(
      `${released} stretch${released > 1 ? 'es' : ''} between two cuts ${released > 1 ? 'are' : 'is'} shorter than the protrusions either side, so ${released > 1 ? 'they come' : 'it comes'} away as a single strand rather than a fragment`,
    )
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

  const pieces: { top: string; start: number; end: number; left: End; right: End }[] = []
  const push = (_index: number, top: string, start: number, end: number, left: End, right: End) => {
    pieces.push({ top, start, end, left, right })
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

  // As in `digest`: a piece with no base pairs left in it is a released
  // single strand, not a fragment.
  for (const piece of pieces) {
    if (coreLength(piece.top, piece.left, piece.right) <= 0) continue
    const index = out.length
    out.push({
      id: idOf(index),
      name: `${doc.name} fragment ${index + 1} (${formatSize(piece.top.length)})`,
      topology: 'linear',
      top: piece.top,
      left: piece.left,
      right: piece.right,
      annotations: sliceAnnotations(annData, piece.start, piece.end, seqLen, circular),
      source: source(piece.start, piece.end),
      reversed: false,
    })
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
