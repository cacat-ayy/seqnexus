/**
 * What a cloning reaction produces, however the pieces were joined.
 *
 * Both engines report the same thing: ligation joins fragments by their ends
 * (./assemble), seamless assembly joins them by a shared stretch of sequence
 * (./homology). A junction records whichever of the two it was, so the UI can
 * show a product without caring which reaction made it.
 */

import { recognitionToRegex, type RestrictionEnzyme } from '../enzymes/db'
import { reverseComplement } from '../models/complement'
import type { AnnotationData } from '../models/Annotation'
import type { End } from './ends'

export interface AssemblyPart {
  fragmentId: string
  name: string
  sourceName: string
  reversed: boolean
  /** Where this part's contribution sits in the product. */
  start: number
  end: number
}

/** The shared stretch two parts were joined on in a seamless assembly. */
export interface Overlap {
  length: number
  sequence: string
  /** Melting temperature of the shared stretch, °C. */
  tm: number
  mismatches: number
}

export interface Junction {
  /** Index into `parts` of the fragment on each side. */
  leftPart: number
  rightPart: number
  /** Position in the product where the right part's contribution begins. */
  at: number
  /** The ends that met, when the parts were ligated. */
  end?: End
  /** How many of the junction's two nicks ligase could seal. */
  sealed?: 0 | 1 | 2
  /** The homology the parts were joined on, when they were not ligated. */
  overlap?: Overlap
  enzyme?: string
}

export interface Assembly {
  name: string
  description: string
  sequence: string
  topology: 'linear' | 'circular'
  size: number
  annotations: AnnotationData[]
  parts: AssemblyPart[]
  junctions: Junction[]
  /** Ends of a linear product left by a digest. Absent when circular. */
  left?: End
  right?: End
  /**
   * True when the parts that were meant to go in are all here, exactly once.
   * Unless the caller says which those are, that means every part given.
   */
  usesAll: boolean
  /** True when some junction could only be sealed on one strand. */
  nicked: boolean
  /**
   * Recognition sites of the assembly enzymes still present. A circular
   * product that keeps one is cut open again in a one-pot reaction, so it
   * never accumulates: this is what makes Type IIS assembly specific.
   */
  recut: string[]
  /** Anything questionable about this particular product. */
  warnings: string[]
}

/**
 * Recognition sites of the given enzymes left in a circular product. The
 * sequence is searched across the origin, since a site can straddle it.
 */
export function remainingSites(sequence: string, enzymes: RestrictionEnzyme[]): string[] {
  if (enzymes.length === 0 || sequence.length === 0) return []
  const found = new Set<string>()
  for (const enzyme of enzymes) {
    const recognition = enzyme.recognition.toUpperCase()
    const wrap = sequence + sequence.slice(0, Math.max(0, recognition.length - 1))
    for (const pattern of patternsFor(recognition)) {
      if (new RegExp(pattern, 'i').test(wrap)) {
        found.add(enzyme.name)
        break
      }
    }
  }
  return [...found]
}

function patternsFor(recognition: string): string[] {
  const forward = recognitionToRegex(recognition)
  const rc = reverseComplement(recognition)
  return rc === recognition ? [forward] : [forward, recognitionToRegex(rc)]
}

/**
 * `vector::insert` naming: the longest part is taken for the backbone and the
 * rest for inserts, which is right whenever there is a backbone at all.
 */
export function assemblyName(
  parts: readonly { sourceName: string; length: number }[],
  circular: boolean,
): string {
  if (parts.length === 0) return 'Assembly'
  if (parts.length === 1) return circular ? `${parts[0].sourceName} (circular)` : parts[0].sourceName

  let backbone = 0
  for (let i = 1; i < parts.length; i++) {
    if (parts[i].length > parts[backbone].length) backbone = i
  }
  const inserts = [...new Set(parts.filter((_, i) => i !== backbone).map(p => p.sourceName))]
  return inserts.length === 0 ? parts[backbone].sourceName : `${parts[backbone].sourceName}::${inserts.join('-')}`
}

/**
 * Expected products first: a complete circle that the reaction would keep
 * beats anything partial, linear, or destined to be cut open again.
 */
export function rankAssemblies(a: Assembly, b: Assembly): number {
  const score = (x: Assembly) =>
    (x.usesAll && x.topology === 'circular' && x.recut.length === 0 ? 2 : 0) +
    (x.topology === 'circular' ? 1 : 0)
  const d = score(b) - score(a)
  return d !== 0 ? d : b.size - a.size
}

/**
 * A key that is the same for every way of writing the same molecule: any
 * rotation of a circle, and either strand of both circles and linear pieces.
 */
export function canonical(sequence: string, circular: boolean): string {
  const s = sequence.toUpperCase()
  const rc = reverseComplement(s)
  if (!circular) return s < rc ? s : rc
  const a = leastRotation(s)
  const b = leastRotation(rc)
  return a < b ? a : b
}

/** Lexicographically smallest rotation, by Booth's algorithm. */
function leastRotation(s: string): string {
  const n = s.length
  if (n === 0) return s
  const ss = s + s
  const f = new Array<number>(2 * n).fill(-1)
  let k = 0
  for (let j = 1; j < 2 * n; j++) {
    let i = f[j - 1 - k]
    while (i !== -1 && ss[j] !== ss[k + i + 1]) {
      if (ss[j] < ss[k + i + 1]) k = j - i - 1
      i = f[i]
    }
    if (i === -1 && ss[j] !== ss[k + i + 1]) {
      if (ss[j] < ss[k + i + 1]) k = j
      f[j - k] = -1
    } else {
      f[j - k] = i + 1
    }
  }
  return ss.slice(k, k + n)
}

/**
 * The same circular product written from another starting base: what was at
 * `offset` is at 0 afterwards. Features, parts and junctions move with their
 * bases; one that now runs across the origin ends below its start, which is
 * how the rest of the app writes that.
 */
export function rotateAssembly(product: Assembly, offset: number): Assembly {
  const n = product.size
  const k = ((offset % n) + n) % n
  if (product.topology !== 'circular' || n === 0 || k === 0) return product
  const at = (pos: number) => (((pos - k) % n) + n) % n
  // An end is a boundary, so one landing on the new origin is the far end.
  const until = (pos: number) => at(pos) || n
  return {
    ...product,
    sequence: product.sequence.slice(k) + product.sequence.slice(0, k),
    annotations: product.annotations.map(a => {
      const moved = { ...a, start: at(a.start), end: until(a.end) }
      delete moved.segments
      return moved
    }),
    parts: product.parts.map(p => ({ ...p, start: at(p.start), end: until(p.end) })),
    junctions: product.junctions.map(j => ({ ...j, at: at(j.at) })),
  }
}
