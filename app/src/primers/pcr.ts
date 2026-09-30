/**
 * In-silico PCR: what two primers amplify from a template.
 *
 * The product runs from the forward primer's 5' end to the reverse primer's,
 * and a primer's 5' tail is copied into it: that is the point of a tail. So
 * a restriction site or homology arm designed onto a primer appears at the
 * end of the product, ready for the cloning dialog.
 *
 * Features of the template come along, shifted into product coordinates;
 * one the product only partly covers is clipped and marked truncated.
 */

import type { AnnotationData } from '../models/Annotation'
import { reverseComplement } from '../models/complement'
import { findBindingSites, type BindingSite } from './binding'
import type { PrimerData } from './oligo'

export interface PcrTemplate {
  name: string
  bases: string
  topology: 'linear' | 'circular'
  annotations: readonly AnnotationData[]
}

export interface PcrProduct {
  name: string
  bases: string
  annotations: AnnotationData[]
  /** The two primers, which bind the product at its ends. */
  primers: PrimerData[]
  description: string
  /** Other products the pair could also make, by size. */
  alternatives: number[]
}

/** Longest product considered at all; beyond this PCR does not happen. */
const MAX_PRODUCT = 20_000

export function simulatePcr(
  template: PcrTemplate,
  a: PrimerData,
  b: PrimerData,
): PcrProduct | { error: string } {
  const n = template.bases.length
  const circular = template.topology === 'circular'
  const sites = findBindingSites([a, b], template.bases, template.topology)
  const all = [...(sites.get(a.id) ?? []), ...(sites.get(b.id) ?? [])]
  if ((sites.get(a.id) ?? []).length === 0) return { error: `"${a.name}" does not bind this sequence.` }
  if ((sites.get(b.id) ?? []).length === 0) return { error: `"${b.name}" does not bind this sequence.` }

  // Every facing pair: a site reading rightwards, then one reading leftwards
  // downstream of it. Either primer may be the forward one.
  const products: { fwd: BindingSite; rev: BindingSite; size: number; span: number }[] = []
  for (const fwd of all) {
    if (fwd.strand !== 1) continue
    for (const rev of all) {
      if (rev.strand !== -1 || rev.primerId === fwd.primerId && a.id !== b.id) continue
      let span = rev.end - fwd.start
      if (circular) span = ((span % n) + n) % n || n
      if (span <= 0) continue
      const size = span + fwd.tail5.length + rev.tail5.length
      if (size <= MAX_PRODUCT) products.push({ fwd, rev, size, span })
    }
  }
  if (products.length === 0) {
    return { error: 'The primers do not face each other on this sequence, so nothing is amplified.' }
  }
  products.sort((x, y) => x.size - y.size)
  const { fwd, rev, span } = products[0]
  const fwdPrimer = fwd.primerId === a.id ? a : b
  const revPrimer = rev.primerId === a.id ? a : b

  const core = circular && fwd.start + span > n
    ? template.bases.slice(fwd.start) + template.bases.slice(0, fwd.start + span - n)
    : template.bases.slice(fwd.start, fwd.start + span)
  const bases = (fwd.tail5 + core + reverseComplement(rev.tail5)).toUpperCase()

  const shift = fwd.tail5.length
  const annotations = carryFeatures(template.annotations, fwd.start, span, n, circular, shift)

  return {
    name: `${template.name} ${fwdPrimer.name}–${revPrimer.name}`,
    bases,
    annotations,
    primers: [
      { ...fwdPrimer, id: `${fwdPrimer.id}_pcr` },
      { ...revPrimer, id: `${revPrimer.id}_pcr` },
    ].filter((p, i, arr) => arr.findIndex(q => q.sequence === p.sequence) === i),
    description: `PCR product of ${template.name} with ${fwdPrimer.name} and ${revPrimer.name}, ${bases.length} bp`,
    alternatives: products.slice(1).map(p => p.size),
  }
}

/** Template features inside [start, start + span), in product coordinates. */
function carryFeatures(
  annotations: readonly AnnotationData[],
  start: number,
  span: number,
  n: number,
  circular: boolean,
  shift: number,
): AnnotationData[] {
  const out: AnnotationData[] = []
  for (const ann of annotations) {
    const ranges: [number, number][] = ann.start < ann.end || ann.end === 0
      ? [[ann.start, ann.end === 0 ? n : ann.end]]
      : [[ann.start, n], [0, ann.end]]
    const pieces: [number, number][] = []
    for (const [s, e] of ranges) {
      for (const k of circular ? [-n, 0, n] : [0]) {
        const from = Math.max(0, s + k - start)
        const to = Math.min(span, e + k - start)
        if (from < to) pieces.push([from, to])
      }
    }
    if (pieces.length === 0) continue
    pieces.sort((x, y) => x[0] - y[0])
    // Pieces of a feature that wraps the origin inside the product meet end
    // to end; join them.
    const merged: [number, number][] = [pieces[0]]
    for (const p of pieces.slice(1)) {
      const last = merged[merged.length - 1]
      if (p[0] <= last[1]) last[1] = Math.max(last[1], p[1])
      else merged.push(p)
    }
    const length = ranges.reduce((sum, [s, e]) => sum + e - s, 0)
    for (const [from, to] of merged) {
      out.push({
        ...ann,
        id: `${ann.id}_pcr${merged.length > 1 ? `_${from}` : ''}`,
        start: from + shift,
        end: to + shift,
        ...(to - from < length ? { truncated: true } : {}),
      })
    }
  }
  return out
}
