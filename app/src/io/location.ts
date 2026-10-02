/**
 * Feature locations: reading INSDC (GenBank/EMBL) location strings, turning a
 * list of parts into an annotation's span, and writing one back out.
 *
 * Shared by the GenBank reader (main thread and the large-file worker), the
 * GenBank writer, and SnapGene's segment lists, so every format agrees on
 * what a multi-part or origin-spanning feature means.
 */

import type { Strand } from '../models/Annotation'

/** One contiguous piece of a feature: 0-based, half-open. start > end only for a range written across the origin ("901..50"). */
export interface LocationPart {
  start: number
  end: number
  strand: Strand
}

export interface ParsedLocation {
  /** Local parts, in biological (5'→3') order of the feature. */
  parts: LocationPart[]
  /** Parts dropped because they lie on another record ("J00194.1:100..202"). */
  remote: number
}

/**
 * Parse an INSDC location string.
 *
 * Handles ranges, single bases, between-base sites (a^b), partial markers
 * (<, >), the old "(a.b)" uncertain-base form, complement at any depth,
 * join/order (and bond/one-of, treated the same), and remote references,
 * which are counted and skipped. Whitespace is ignored, so a location that
 * wrapped onto several lines can be passed joined.
 *
 * Returns null for anything it can't read, never NaN coordinates.
 */
export function parseGenBankLocation(text: string): ParsedLocation | null {
  const s = text.replace(/\s+/g, '')
  let i = 0
  let remote = 0

  const fail = (): never => { throw new SyntaxError(`Bad location: ${text}`) }
  const expect = (ch: string) => { if (s[i] !== ch) fail(); i++ }
  const digits = (): number => {
    const m = /^\d+/.exec(s.slice(i))
    if (!m) fail()
    i += m![0].length
    return parseInt(m![0], 10)
  }
  const point = (): number => {
    if (s[i] === '<' || s[i] === '>') i++
    if (s[i] === '(') {
      // "(102.110)": one base somewhere in that range. Take the first.
      i++
      const a = digits()
      expect('.')
      digits()
      expect(')')
      return a
    }
    return digits()
  }
  const simple = (): LocationPart => {
    const a = point()
    if (s[i] === '^') {
      // Between two bases: a zero-length site after base a.
      i++
      point()
      return { start: a, end: a, strand: 1 }
    }
    if (s.startsWith('..', i)) {
      i += 2
      const b = point()
      return { start: a - 1, end: b, strand: 1 }
    }
    return { start: a - 1, end: a, strand: 1 }
  }
  const loc = (): LocationPart[] => {
    if (s.startsWith('complement(', i)) {
      i += 'complement('.length
      const inner = loc()
      expect(')')
      // The reverse strand reads the parts in the opposite order.
      return inner.reverse().map(p => ({ ...p, strand: (p.strand === -1 ? 1 : -1) as Strand }))
    }
    const op = /^(join|order|bond|one-of)\(/.exec(s.slice(i))
    if (op) {
      i += op[0].length
      const out = [...loc()]
      while (s[i] === ',') {
        i++
        out.push(...loc())
      }
      expect(')')
      return out
    }
    const ref = /^[A-Za-z][A-Za-z0-9_]*(\.\d+)?:/.exec(s.slice(i))
    if (ref) {
      i += ref[0].length
      simple()
      remote++
      return []
    }
    return [simple()]
  }

  try {
    if (s.length === 0) return null
    const parts = loc()
    if (i !== s.length) return null
    return { parts, remote }
  } catch {
    return null
  }
}

export interface ResolvedLocation {
  start: number
  end: number
  strand: Strand
  /** Present only when the parts leave gaps (exons and introns). See AnnotationData.segments. */
  segments?: [number, number][]
}

/**
 * The span of a feature made of `parts`, given in biological order.
 *
 * Parts that run on past the end of a circular sequence and continue from
 * the start ("join(901..1000,1..50)") give the wrapped form start > end
 * rather than a span over the whole plasmid. Parts with gaps between them
 * are kept as segments. Anything that doesn't read in one direction (a
 * linear record listing parts out of order, trans-splicing) falls back to
 * the overall span without segments.
 *
 * `seqLen` 0 means the length is unknown: nothing is wrapped.
 */
export function resolveLocation(parts: readonly LocationPart[], seqLen: number, circular: boolean): ResolvedLocation | null {
  if (parts.length === 0) return null
  // Mixed strands only happen with trans-splicing; the first part decides.
  const strand = parts[0].strand
  const forward = strand === -1 ? [...parts].reverse() : [...parts]
  return resolveForward(forward.map(p => [p.start, p.end] as [number, number]), strand, seqLen, circular)
}

/** As resolveLocation, for pieces already in top-strand order (SnapGene lists them that way). */
export function resolveForward(pieces: readonly [number, number][], strand: Strand, seqLen: number, circular: boolean): ResolvedLocation | null {
  let list: [number, number][] = []
  for (const [a, b] of pieces) {
    const s = Math.max(0, a)
    const e = Math.max(0, b)
    if (s > e) {
      // One range written across the origin.
      if (circular && seqLen > 0) {
        list.push([s, seqLen], [0, e])
      } else {
        list.push([e, s])
      }
    } else {
      list.push([s, e])
    }
  }
  if (list.length === 0) return null

  // A lone zero-length part is a between-bases site; inside a join it means nothing.
  if (list.length > 1) list = list.filter(([s, e]) => e > s)
  if (list.length === 0) return null
  if (list.length === 1) return { start: list[0][0], end: list[0][1], strand }

  // Merge pieces that touch.
  const merged: [number, number][] = [list[0]]
  for (const [s, e] of list.slice(1)) {
    const last = merged[merged.length - 1]
    if (s === last[1]) last[1] = e
    else merged.push([s, e])
  }

  let descents = 0
  let gaps = 0
  for (let k = 1; k < merged.length; k++) {
    const [s] = merged[k]
    const prevEnd = merged[k - 1][1]
    if (s < prevEnd) descents++
    const acrossOrigin = circular && prevEnd === seqLen && s === 0
    if (!acrossOrigin) gaps++
  }

  const start = merged[0][0]
  const end = merged[merged.length - 1][1]
  const wraps = descents === 1 && circular && start > end
  if (descents === 0 || wraps) {
    return gaps > 0 ? { start, end, strand, segments: merged } : { start, end, strand }
  }
  // Doesn't read in one direction: keep the overall span only.
  return {
    start: Math.min(...merged.map(p => p[0])),
    end: Math.max(...merged.map(p => p[1])),
    strand,
  }
}

/**
 * Write an annotation's location in INSDC form. 0-based half-open in,
 * 1-based inclusive out.
 */
export function formatGenBankLocation(
  ann: { start: number; end: number; strand: Strand; segments?: readonly (readonly [number, number])[] },
  seqLen: number,
  circular: boolean,
): string {
  const range = (s: number, e: number) => `${s + 1}..${e}`
  let loc: string
  if (ann.segments && ann.segments.length > 1) {
    loc = `join(${ann.segments.map(([s, e]) => range(s, e)).join(',')})`
  } else if (ann.start === ann.end && ann.start > 0) {
    // Zero-length site between two bases.
    loc = `${ann.start}^${ann.start + 1}`
  } else if (ann.start === ann.end && circular && seqLen > 0) {
    loc = `${seqLen}^1`
  } else if (ann.start > ann.end && ann.end > 0) {
    loc = `join(${range(ann.start, seqLen)},1..${ann.end})`
  } else if (ann.start > ann.end) {
    // Ends exactly at the origin.
    loc = range(ann.start, seqLen)
  } else {
    loc = range(ann.start, ann.end)
  }
  return ann.strand === -1 ? `complement(${loc})` : loc
}
