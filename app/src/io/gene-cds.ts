/**
 * A gene feature that only repeats its CDS.
 *
 * NCBI records give each coding region twice: a `gene` and a `CDS` over the
 * same bases, the gene carrying the locus tag and gene database link, the
 * CDS everything about the protein. On a map that is two arrows for one
 * gene. Every reader passes its features through here, so such a gene is
 * folded into its CDS: dropped, with its qualifiers added to the CDS's, the
 * way SnapGene reads GenBank. A gene that differs from every CDS in span or
 * strand (one with UTRs, a gene with no CDS, an RNA gene) is kept.
 */

import type { AnnotationData } from '../models/Annotation'

/** The identifiers that say a gene and a CDS are the same gene. */
const IDENTIFIERS = ['gene', 'locus_tag'] as const

function sameGene(gene: AnnotationData, cds: AnnotationData): boolean {
  for (const key of IDENTIFIERS) {
    const g = gene.qualifiers?.[key]?.[0]
    const c = cds.qualifiers?.[key]?.[0]
    if (g !== undefined && c !== undefined) return g === c
  }
  return gene.name === cds.name
}

/** `annotations` without the genes that only repeat a CDS, their qualifiers moved onto it. */
export function mergeGenesIntoCds<T extends AnnotationData>(annotations: readonly T[]): T[] {
  const cdsBySpan = new Map<string, T[]>()
  const spanKey = (a: AnnotationData) => `${a.start}:${a.end}:${a.strand}`
  for (const a of annotations) {
    if (a.type === 'CDS') cdsBySpan.set(spanKey(a), [...(cdsBySpan.get(spanKey(a)) ?? []), a])
  }
  if (cdsBySpan.size === 0) return [...annotations]

  const merged = new Map<T, Record<string, string[]>>()
  const dropped = new Set<T>()
  for (const a of annotations) {
    if (a.type !== 'gene' || a.segments) continue
    const cds = cdsBySpan.get(spanKey(a))?.find(c => sameGene(a, c))
    if (!cds) continue
    dropped.add(a)
    const quals = merged.get(cds) ?? Object.fromEntries(Object.entries(cds.qualifiers ?? {}).map(([k, v]) => [k, [...v]]))
    for (const [key, values] of Object.entries(a.qualifiers ?? {})) {
      const have = (quals[key] ??= [])
      for (const v of values) if (!have.includes(v)) have.push(v)
    }
    merged.set(cds, quals)
  }
  if (dropped.size === 0) return [...annotations]
  return annotations
    .filter(a => !dropped.has(a))
    .map(a => (merged.has(a) ? { ...a, qualifiers: merged.get(a)! } : a))
}
