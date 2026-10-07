/**
 * Clone verification of a de novo contig against the expected construct.
 *
 * The contig is what most reads say (the assembler's consensus), so a
 * difference between it and the design is a difference the clone has. Each
 * is described as the variant caller describes variants (what it does to a
 * protein, whether it sits in a repeat), and the verdict comes from the same
 * check as for mapped reads (assembly/verify.ts): a feature is verified when
 * every base of it is in the contig, covered by at least `minDepth` reads
 * there, and has no difference. Depth is the reads' depth on the contig,
 * carried to the expected coordinates through the alignment.
 */

import { describeVariant, type RefFeature, type Variant } from '../../assembly/variants'
import { verifyPileup, type VerifyReport, type VerifySettings } from '../../assembly/verify'
import type { Comparison } from './compare'

export function verifyContig(o: {
  cmp: Comparison
  expected: { name: string; bases: string; circular: boolean }
  features: readonly RefFeature[]
  /** Read depth at each contig position (of the turned contig), or null when unknown. */
  depth: ArrayLike<number> | null
  reads: number
  settings: VerifySettings
}): VerifyReport {
  const { cmp } = o
  const L = o.expected.bases.length
  const refSeq = o.expected.bases.toUpperCase()
  const depthAt = (c: number) => (c < 0 ? 0 : o.depth ? o.depth[c] ?? 0 : o.settings.minDepth)
  const differences: Variant[] = cmp.differences.map(d => {
    // Depth where the contig differs: at the contig base for a substitution or insertion, on either side for a deletion.
    const before = d.pos >= 0 ? cmp.toContig[d.pos] : -1
    const c = d.type === 'Deletion' ? Math.max(cmp.toContig[(d.pos + L - 1) % L], cmp.toContig[(d.pos + d.ref.length) % L]) : before
    const coverage = depthAt(c)
    return describeVariant({
      c0: Math.max(0, d.pos), c1: Math.max(0, d.pos) + Math.max(1, d.ref.length),
      type: d.type, pos: d.pos, ref: d.ref, alt: d.alt,
      coverage, count: coverage, pValue: 0,
      forward: { ref: 0, alt: 0 }, reverse: { ref: 0, alt: 0 }, meanQuality: -1,
    }, { refSeq, features: o.features, againstConsensus: false })
  })
  const depth = new Uint32Array(L)
  for (let e = 0; e < L; e++) depth[e] = depthAt(cmp.toContig[e])
  return verifyPileup({
    reference: { name: o.expected.name, length: L, circular: o.expected.circular },
    reads: o.reads,
    depth,
    // Strand is not kept per base here; the setting is not offered.
    bothStrands: p => depth[p] > 0,
    differences,
    features: o.features,
    settings: { ...o.settings, bothStrands: false },
  })
}
