/**
 * A piece of DNA with two ends, and what you can do to one.
 *
 * `top` is the whole top strand, 5'→3', including the bases the top strand
 * contributes at each end. Which end contributes is fixed by its kind: the
 * top strand protrudes at a `five_prime` left end and at a `three_prime`
 * right end, and is the recessed strand at the other two. So the strictly
 * double-stranded core is `top` minus those protrusions, and the bottom
 * strand follows from the core and the ends.
 *
 * The point of carrying `top` rather than just the core is that joining two
 * fragments is then plain concatenation, whatever their ends: at a junction
 * the annealed bases belong to exactly one of the two tops. Digesting a
 * sequence and concatenating the pieces back in order returns the original.
 */

import { reverseComplement } from '../models/complement'
import type { AnnotationData } from '../models/Annotation'
import type { End } from './ends'
import { bluntEnd } from './ends'

export interface FragmentSource {
  /** Name of the sequence this came from. */
  name: string
  /** Tab or item id, when the source is open in the app. */
  id?: string
  /** Half-open range on the source's top strand that `top` was read from. */
  start: number
  end: number
  circular: boolean
}

export interface Fragment {
  /** Stable within one run; used to name junctions and dedupe assemblies. */
  id: string
  name: string
  topology: 'linear' | 'circular'
  /** Top strand 5'→3'. For a circular fragment, the whole molecule. */
  top: string
  /** Undefined only when `topology` is circular. */
  left?: End
  right?: End
  /** Coordinates relative to `top`. */
  annotations: AnnotationData[]
  source: FragmentSource
  /** True when `top` is the reverse complement of the source's top strand. */
  reversed: boolean
}

/**
 * An annotation without its segment list. A feature's segments are only kept
 * while they agree with its start and end, and moving a feature onto a
 * fragment or a product invalidates them.
 */
function withoutSegments(ann: AnnotationData): AnnotationData {
  const copy = { ...ann }
  delete copy.segments
  return copy
}

/** How many bases of `top` the left end's protrusion takes up. */
function leftOverhangOnTop(f: Fragment): number {
  return f.left?.kind === 'five_prime' ? f.left.span.length : 0
}

/** How many bases of `top` the right end's protrusion takes up. */
function rightOverhangOnTop(f: Fragment): number {
  return f.right?.kind === 'three_prime' ? f.right.span.length : 0
}

/** The strictly double-stranded part of the fragment, read on the top strand. */
export function coreOf(f: Fragment): string {
  if (f.topology === 'circular') return f.top
  return f.top.slice(leftOverhangOnTop(f), f.top.length - rightOverhangOnTop(f))
}

/** The bottom strand, 5'→3'. */
export function bottomStrand(f: Fragment): string {
  if (f.topology === 'circular') return reverseComplement(f.top)
  const head = f.right?.kind === 'five_prime' ? f.right.span : ''
  const tail = f.left?.kind === 'three_prime' ? f.left.span : ''
  return head + reverseComplement(coreOf(f)) + tail
}

/**
 * Total length of the molecule: the core plus both protrusions, whichever
 * strand each sits on. This is the length that decides how far it runs on a
 * gel, and it can exceed `top.length`.
 */
export function extentOf(f: Fragment): number {
  if (f.topology === 'circular') return f.top.length
  return (f.left?.span.length ?? 0) + coreOf(f).length + (f.right?.span.length ?? 0)
}

/**
 * The same molecule held the other way round.
 *
 * The ends themselves are unchanged: each one's span is written along its own
 * protruding strand, which does not care which way you look at the molecule.
 * They only swap sides. The top strand becomes the old bottom strand, and
 * annotations are mirrored into the new frame.
 *
 * Flipping twice returns the original.
 */
export function flip(f: Fragment): Fragment {
  if (f.topology === 'circular') {
    return {
      ...f,
      top: reverseComplement(f.top),
      annotations: mirrorAnnotations(f.annotations, f.top.length, 0, f.top.length, 0),
      reversed: !f.reversed,
    }
  }

  const core = coreOf(f)
  const newTop = bottomStrand(f)
  // Where the old core starts in the old top, and where it lands in the new one.
  const oldCoreStart = leftOverhangOnTop(f)
  const newCoreStart = f.right?.kind === 'five_prime' ? f.right.span.length : 0

  return {
    ...f,
    top: newTop,
    left: f.right,
    right: f.left,
    annotations: mirrorAnnotations(f.annotations, core.length, oldCoreStart, newTop.length, newCoreStart),
    reversed: !f.reversed,
  }
}

/**
 * Mirror annotations from one strand's frame into the other's.
 *
 * Only the double-stranded core exists on both strands, so a feature sitting
 * in a single-stranded protrusion is clipped to the core, or dropped when it
 * lies entirely outside it. Overhangs are a few bases, so this is rare, but
 * silently moving such a feature would be worse than losing it.
 */
function mirrorAnnotations(
  annotations: AnnotationData[],
  coreLen: number,
  oldCoreStart: number,
  _newTopLen: number,
  newCoreStart: number,
): AnnotationData[] {
  const out: AnnotationData[] = []
  const oldCoreEnd = oldCoreStart + coreLen

  for (const ann of annotations) {
    if (ann.start > ann.end) continue // origin-spanning: no meaning on a fragment
    const start = Math.max(ann.start, oldCoreStart)
    const end = Math.min(ann.end, oldCoreEnd)
    if (end <= start) continue
    const clipped = start !== ann.start || end !== ann.end
    // Within the core, counted from its start, then reversed.
    const a = start - oldCoreStart
    const b = end - oldCoreStart
    out.push({
      ...withoutSegments(ann),
      start: newCoreStart + (coreLen - b),
      end: newCoreStart + (coreLen - a),
      strand: ann.strand === 1 ? -1 : ann.strand === -1 ? 1 : ann.strand,
      ...(clipped || ann.truncated ? { truncated: true } : {}),
    })
  }

  return out
}

/**
 * Shift annotations into a product's frame, dropping the segment lists
 * (whose coordinates would no longer agree with start and end).
 */
export { withoutSegments }

export function offsetAnnotations(
  annotations: AnnotationData[],
  offset: number,
  idSuffix: string,
): AnnotationData[] {
  return annotations.map(ann => ({
    ...withoutSegments(ann),
    id: `${ann.id}${idSuffix}`,
    start: ann.start + offset,
    end: ann.end + offset,
  }))
}

/** A linear fragment, with blunt phosphorylated ends unless given others. */
export function linearFragment(
  id: string,
  name: string,
  top: string,
  source: FragmentSource,
  options: { left?: End; right?: End; annotations?: AnnotationData[]; reversed?: boolean } = {},
): Fragment {
  return {
    id,
    name,
    topology: 'linear',
    top,
    left: options.left ?? bluntEnd(),
    right: options.right ?? bluntEnd(),
    annotations: options.annotations ?? [],
    source,
    reversed: options.reversed ?? false,
  }
}

/** Take the phosphates off both 5' termini, as a phosphatase would. */
export function dephosphorylate(f: Fragment): Fragment {
  if (f.topology === 'circular') return f
  return {
    ...f,
    left: f.left ? { ...f.left, phosphate: false } : f.left,
    right: f.right ? { ...f.right, phosphate: false } : f.right,
  }
}
