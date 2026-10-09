/**
 * The link between a protein and the DNA it was translated from.
 *
 * A TranslationSource names the coding bases of the DNA (a span, a strand,
 * exons if spliced, the codon offset). Everything in here is coordinate
 * arithmetic over it: a residue range to the codons it was read from, a DNA
 * range to the residues it codes for, and the protein document itself with
 * the features inside the coding region carried over at residue resolution.
 */

import { Annotation, type AnnotationData } from '../models/Annotation'
import type { DocumentState, TranslationSource } from '../models/Document'
import { Sequence } from '../models/Sequence'
import { reverseComplement } from '../models/complement'
import { geneticCode, translateWith, type GeneticCode } from '../codon/genetic-codes'
import { annotationCode, codonStartOffset } from '../utils/annotation-sequence'

/** The exons of a source in forward-strand order, one piece when unspliced. */
function pieces(link: Pick<TranslationSource, 'start' | 'end' | 'segments'>): [number, number][] {
  return link.segments && link.segments.length > 0 ? link.segments : [[link.start, link.end]]
}

/** Total coding bases after the codon offset. */
export function codingLength(link: TranslationSource): number {
  const total = pieces(link).reduce((n, [s, e]) => n + (e - s), 0)
  return Math.max(0, total - link.codonOffset)
}

/**
 * The forward-strand base at coding index `c` (0 is the first base of the
 * first codon). Reading order follows the strand: on the minus strand the
 * first codon sits at the high end of the last piece.
 */
export function codingToGenomic(link: TranslationSource, c: number): number | null {
  const ps = pieces(link)
  let i = c + link.codonOffset
  if (i < 0) return null
  if (link.strand === 1) {
    for (const [s, e] of ps) {
      if (i < e - s) return s + i
      i -= e - s
    }
    return null
  }
  for (let k = ps.length - 1; k >= 0; k--) {
    const [s, e] = ps[k]
    if (i < e - s) return e - 1 - i
    i -= e - s
  }
  return null
}

/** The coding index of a forward-strand base, or null if it is not coding. */
export function genomicToCoding(link: TranslationSource, g: number): number | null {
  const ps = pieces(link)
  let before = 0
  if (link.strand === 1) {
    for (const [s, e] of ps) {
      if (g >= s && g < e) {
        const i = before + (g - s) - link.codonOffset
        return i >= 0 ? i : null
      }
      before += e - s
    }
    return null
  }
  for (let k = ps.length - 1; k >= 0; k--) {
    const [s, e] = ps[k]
    if (g >= s && g < e) {
      const i = before + (e - 1 - g) - link.codonOffset
      return i >= 0 ? i : null
    }
    before += e - s
  }
  return null
}

export interface DnaRange {
  /** Forward-strand span covering every base, [start, end). */
  start: number
  end: number
  strand: 1 | -1
  /** The pieces when the span crosses an intron; absent for one piece. */
  segments?: [number, number][]
}

/**
 * The forward-strand bases that code for residues [resStart, resEnd).
 * Clamped to the coding region; null when nothing of it is coding.
 */
export function residuesToDna(link: TranslationSource, resStart: number, resEnd: number): DnaRange | null {
  const n = codingLength(link)
  const c0 = Math.max(0, resStart * 3)
  const c1 = Math.min(n, resEnd * 3)
  if (c1 <= c0) return null
  // Walk the coding indices piece by piece: every maximal run of consecutive
  // forward-strand positions is one segment.
  const segs: [number, number][] = []
  let runStart = -1
  let prev = -2
  const positions: number[] = []
  for (let c = c0; c < c1; c++) {
    const g = codingToGenomic(link, c)
    if (g !== null) positions.push(g)
  }
  positions.sort((a, b) => a - b)
  for (const g of positions) {
    if (g !== prev + 1) {
      if (runStart >= 0) segs.push([runStart, prev + 1])
      runStart = g
    }
    prev = g
  }
  if (runStart >= 0) segs.push([runStart, prev + 1])
  if (segs.length === 0) return null
  return {
    start: segs[0][0],
    end: segs[segs.length - 1][1],
    strand: link.strand,
    ...(segs.length > 1 ? { segments: segs } : {}),
  }
}

/**
 * The residues coded for by forward-strand bases [gStart, gEnd), rounded
 * out to whole codons. Null when none of the bases are coding.
 */
export function dnaToResidues(link: TranslationSource, gStart: number, gEnd: number): [number, number] | null {
  let lo = Infinity
  let hi = -Infinity
  // The ends suffice for one piece; a range across an intron is covered by
  // its first and last coding bases too.
  for (const g of [gStart, gEnd - 1]) {
    const c = genomicToCoding(link, g)
    if (c !== null) { lo = Math.min(lo, c); hi = Math.max(hi, c) }
  }
  if (lo === Infinity) {
    // Neither end is coding: maybe the range covers the whole coding region.
    for (const [s, e] of pieces(link)) {
      if (s >= gStart && e <= gEnd) { lo = 0; hi = codingLength(link) - 1; break }
    }
    if (lo === Infinity) return null
  }
  return [Math.floor(lo / 3), Math.floor(hi / 3) + 1]
}

// ---------------------------------------------------------------------------
// Making the protein
// ---------------------------------------------------------------------------

export type TranslationRequest =
  | { annotation: Annotation }
  | { start: number; end: number; reverse: boolean }

/** The source descriptor for a request against a document. */
export function translationSource(
  doc: DocumentState, tabId: string, req: TranslationRequest, defaultCodeId: number,
): TranslationSource {
  if ('annotation' in req) {
    const a = req.annotation
    const code = annotationCode(a)
    return {
      tabId, tabName: doc.name, annotationId: a.id,
      start: a.start, end: a.end, strand: a.strand === -1 ? -1 : 1,
      ...(a.segments && a.segments.length > 1 ? { segments: a.segments } : {}),
      codonOffset: codonStartOffset(a),
      codeId: code?.id ?? defaultCodeId,
    }
  }
  return {
    tabId, tabName: doc.name,
    start: req.start, end: req.end, strand: req.reverse ? -1 : 1,
    codonOffset: 0, codeId: defaultCodeId,
  }
}

/** The coding bases of a source, in reading order. */
export function codingBases(doc: DocumentState, link: TranslationSource): string {
  const bases = pieces(link).map(([s, e]) => doc.sequence.basesIn(s, e)).join('')
  const oriented = link.strand === -1 ? reverseComplement(bases) : bases
  return oriented.slice(link.codonOffset)
}

/**
 * Translate a source into a protein document. A single trailing stop is
 * dropped (it is the end of the chain, not a residue); internal stops are
 * kept so a frameshift or a nonsense mutation shows. Features that lie
 * inside the coding region come along at residue resolution, the CDS
 * itself excepted.
 */
export function translationDocument(doc: DocumentState, link: TranslationSource, req: TranslationRequest): DocumentState {
  const code: GeneticCode = geneticCode(link.codeId)
  let residues = translateWith(code, codingBases(doc, link))
  if (residues.endsWith('*')) residues = residues.slice(0, -1)
  const sourceAnn = 'annotation' in req ? req.annotation : null
  const name = sourceAnn ? sourceAnn.name : `${doc.name} ${link.start + 1}-${link.end}`

  const carried: AnnotationData[] = []
  for (const a of doc.annotations) {
    if (a === sourceAnn) continue
    if (a.start < link.start || a.end > link.end || a.start >= a.end) continue
    const r = dnaToResidues(link, a.start, a.end)
    if (!r) continue
    const [rs, re] = [Math.max(0, r[0]), Math.min(residues.length, r[1])]
    if (re <= rs) continue
    carried.push({
      id: `${a.id}_aa`, name: a.name, type: a.type, start: rs, end: re, strand: 1,
      color: a.color, qualifiers: a.qualifiers,
    })
  }

  return {
    name,
    description: sourceAnn
      ? `Translated from ${doc.name}, ${sourceAnn.name} (${link.start + 1}..${link.end})`
      : `Translated from ${doc.name} ${link.start + 1}..${link.end}${link.strand === -1 ? ', reverse strand' : ''}`,
    sequence: new Sequence(residues, 'linear', 'protein'),
    annotations: carried.map(d => new Annotation(d)),
    metadata: { origin: 'translation', translatedFrom: link },
  }
}
