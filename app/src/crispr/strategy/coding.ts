/**
 * Coding coordinates, shared by the strategies that care where in a gene
 * something lands.
 *
 * A CDS is not simply a span: it has a direction, and it may be spliced, so
 * "how far through the protein is this cut" is a walk along its exons in
 * translation order rather than a subtraction. Everything here works from a
 * CodingTarget, which is what a CDS feature becomes once its segments are in
 * translation order.
 */

import { geneticCode, translateCodonWith } from '../../codon/genetic-codes'
import { reverseComplement } from '../../models/complement'

export interface CodingTarget {
  name: string
  /** Exons in translation order; for a reverse CDS the spans run backwards. */
  exons: readonly [number, number][]
  strand: 1 | -1
  /** Total coding bases. */
  length: number
  /** Genetic code table id, from the feature's transl_table when it had one. */
  codeId: number
}

export interface FeatureLike {
  name: string
  type: string
  start: number
  end: number
  strand: 1 | -1 | 0
  segments?: [number, number][]
  qualifiers?: Record<string, string[]>
}

/** Build a coding target from a CDS feature, or null if it cannot be one. */
export function codingTarget(feature: FeatureLike, seqLen: number): CodingTarget | null {
  if (feature.start === feature.end) return null
  const strand: 1 | -1 = feature.strand === -1 ? -1 : 1
  // A wrapped feature on a circular molecule is two pieces in top-strand order.
  const pieces: [number, number][] = feature.segments && feature.segments.length > 0
    ? feature.segments.map(([s, e]) => [s, e])
    : feature.start < feature.end
      ? [[feature.start, feature.end]]
      : [[feature.start, seqLen], [0, feature.end]]
  const exons = strand === 1 ? pieces : [...pieces].reverse()
  const length = exons.reduce((n, [s, e]) => n + (e - s), 0)
  if (length < 3) return null
  const table = feature.qualifiers?.transl_table?.[0]
  const codeId = table && Number.isFinite(Number(table)) ? Number(table) : 1
  return { name: feature.name, exons, strand, length, codeId }
}

/**
 * Where a genomic position falls along the coding sequence, counting from
 * the start codon, or null when it is outside the gene. A cut sits between
 * bases, so pass the base to its right; the result is the coding index of
 * that base.
 */
export function codingIndex(target: CodingTarget, genomic: number): number | null {
  let seen = 0
  for (const [s, e] of target.exons) {
    if (genomic >= s && genomic < e) {
      return target.strand === 1 ? seen + (genomic - s) : seen + (e - 1 - genomic)
    }
    seen += e - s
  }
  return null
}

/** The genomic position of a coding index, or null when it is past the end. */
export function genomicIndex(target: CodingTarget, coding: number): number | null {
  if (coding < 0) return null
  let seen = 0
  for (const [s, e] of target.exons) {
    const span = e - s
    if (coding < seen + span) {
      const offset = coding - seen
      return target.strand === 1 ? s + offset : e - 1 - offset
    }
    seen += span
  }
  return null
}

/** The coding sequence itself, 5' to 3' in translation order. */
export function codingBases(target: CodingTarget, bases: string): string {
  let out = ''
  for (const [s, e] of target.exons) {
    const piece = bases.slice(s, e)
    out += target.strand === 1 ? piece : reverseComplement(piece)
  }
  return out.toUpperCase()
}

/** Codon number (1-based) holding a coding index, and the index within it. */
export function codonAt(coding: number): { codon: number; offset: number } {
  return { codon: Math.floor(coding / 3) + 1, offset: coding % 3 }
}

export interface CodonChange {
  codon: number
  from: string
  to: string
  fromAa: string
  toAa: string
  kind: 'silent' | 'missense' | 'nonsense' | 'start-lost'
}

/**
 * What changing one coding base does to its codon.
 *
 * `to` is given on the coding strand, so a caller working in genomic
 * coordinates on a reverse gene complements it first.
 */
export function codonChange(
  target: CodingTarget,
  cds: string,
  coding: number,
  to: string,
): CodonChange | null {
  const { codon, offset } = codonAt(coding)
  const start = (codon - 1) * 3
  if (start + 3 > cds.length) return null
  const from = cds.slice(start, start + 3)
  const next = from.slice(0, offset) + to.toUpperCase() + from.slice(offset + 1)
  const code = geneticCode(target.codeId)
  const fromAa = translateCodonWith(code, from)
  const toAa = translateCodonWith(code, next)
  const kind: CodonChange['kind'] = fromAa === toAa
    ? 'silent'
    : toAa === '*'
      ? 'nonsense'
      : codon === 1 ? 'start-lost' : 'missense'
  return { codon, from, to: next, fromAa, toAa, kind }
}

/**
 * Features after an edit that removes `[start, end)` and puts `insert` in its
 * place. A feature inside the cut goes; one that straddles it is kept and
 * marked truncated, which is how the rest of the app handles a feature that
 * lost part of itself.
 */
export function shiftFeatures<T extends { start: number; end: number }>(
  features: readonly T[],
  start: number,
  end: number,
  insertLength: number,
): { kept: (T & { truncated?: true })[]; removed: T[] } {
  const delta = insertLength - (end - start)
  const kept: (T & { truncated?: true })[] = []
  const removed: T[] = []
  const move = (p: number) => (p <= start ? p : p >= end ? p + delta : start)
  for (const f of features) {
    if (f.start >= start && f.end <= end) { removed.push(f); continue }
    const s = move(f.start)
    const e = move(f.end)
    if (e <= s) { removed.push(f); continue }
    const clipped = (f.start < end && f.end > start)
    kept.push(clipped ? { ...f, start: s, end: e, truncated: true } : { ...f, start: s, end: e })
  }
  return { kept, removed }
}
