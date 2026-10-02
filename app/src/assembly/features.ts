/**
 * The reference's features in a contig: read from the open sequence the
 * contig was mapped to, placed in contig columns for drawing, and the
 * contig's findings (variants, tandem repeats) written back as features.
 */

import type { AnnotationData } from '../models/Annotation'
import { defaultColorForType } from '../models/Annotation'
import type { ContigDoc } from './types'
import type { RefFeature, Variant } from './variants'
import type { TandemRepeat } from './repeats'

/** Features of a sequence, as the variant caller and verification want them. */
export function refFeatures(annotations: readonly AnnotationData[]): RefFeature[] {
  return annotations.map(a => ({
    id: a.id, name: a.name, type: a.type, start: a.start, end: a.end,
    strand: a.strand, color: a.color ?? defaultColorForType(a.type),
  }))
}

export interface ColumnFeature {
  name: string
  color: string
  c0: number
  c1: number
  strand: 1 | -1 | 0
}

/**
 * Features in contig columns. A circular reference extended past its end
 * gets its features drawn again over the extension.
 */
export function featuresInColumns(doc: ContigDoc, features: readonly RefFeature[]): ColumnFeature[] {
  if (!doc.reference) return []
  const refCols: number[] = []
  for (let c = 0; c < doc.width; c++) if (doc.reference.seq[c] !== '-') refCols.push(c)
  const L = doc.reference.length
  const out: ColumnFeature[] = []
  const span = (f: RefFeature, a: number, b: number) => {
    // [a, b) in reference index space, possibly repeated past L.
    for (let off = 0; off + a < refCols.length; off += L) {
      const s = a + off
      const e = Math.min(refCols.length, b + off)
      if (e <= s) continue
      out.push({ name: f.name, color: f.color ?? defaultColorForType(f.type), c0: refCols[s], c1: refCols[e - 1] + 1, strand: f.strand })
    }
  }
  for (const f of features) {
    if (f.type === 'source') continue
    if (f.start <= f.end) span(f, f.start, f.end)
    else { span(f, f.start, L); span(f, 0, f.end) }
  }
  return out
}

let seq = 0
const nextId = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${++seq}`

/** A "variation" feature for each variant, in reference coordinates. */
export function variantAnnotations(vs: readonly Variant[], refLength: number): AnnotationData[] {
  return vs.filter(v => v.position > 0 || v.type === 'Insertion').map(v => {
    const p = v.position - 1
    // An insertion sits between two bases: the feature covers both.
    const start = v.type === 'Insertion' ? Math.max(0, p) : p
    const end = Math.min(refLength, v.type === 'Insertion' ? p + 2 : p + Math.max(1, v.ref.length))
    const label = v.coding?.protein ?? (v.type === 'SNP' ? `${v.ref}${v.position}${v.alt}` : v.type === 'Insertion' ? `ins${v.alt}` : `del${v.ref}`)
    const note = [
      `${v.type} ${v.ref || '-'}>${v.alt || '-'}`,
      `${Math.round(v.frequency * 100)}% of ${v.coverage} reads`,
      `P-value ${v.pValue.toExponential(1)}`,
      ...(v.coding ? [`${v.coding.cdna} ${v.coding.protein} (${v.coding.effect})`] : []),
      ...(v.repeat ? [`in tandem repeat ${v.repeat}`] : []),
    ]
    return {
      id: nextId('variant'),
      name: label,
      type: 'variation',
      start, end, strand: 0 as const,
      qualifiers: {
        note,
        replace: [v.type === 'Deletion' ? '' : v.alt.toLowerCase()],
        frequency: [v.frequency.toFixed(3)],
      },
    }
  })
}

/** A "repeat_region" feature for each tandem repeat. */
export function repeatAnnotations(rs: readonly TandemRepeat[]): AnnotationData[] {
  return rs.map(r => ({
    id: nextId('repeat'),
    name: `(${r.unit})${r.copies}`,
    type: 'repeat_region',
    start: r.start, end: r.end, strand: 0 as const,
    qualifiers: { rpt_type: ['tandem'], rpt_unit_seq: [r.unit.toLowerCase()] },
  }))
}
