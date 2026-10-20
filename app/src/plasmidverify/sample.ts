/**
 * One sample of a whole-plasmid result, verified: the consensus tier always,
 * the read tier when its evidence is given, and the record that is kept.
 * Pure: reading files and running the read jobs is the dialog's part
 * (components/plasmidverify/VerifyPlasmidsDialog.tsx).
 */

import type { TraceData } from '../io/trace'
import type { ContigDoc } from '../assembly/types'
import type { RefFeature, Variant } from '../assembly/variants'
import type { VerifyReport } from '../assembly/verify'
import type { CoverageLevel } from '../ngs/alignments'
import { verifySample } from '../ngs/samples'
import { compareCircular, comparisonContig, type CircularComparison } from './compare'
import { lowConfidence, readMixedSites, traceMixedSites, type MixedSite } from './flags'
import { consensusReport, depthSummary, READ_MIN_DEPTH, wholePlasmidVerdict, type PlasmidSample } from './result'

export interface Construct {
  tabId: string | null
  name: string
  bases: string
  features: RefFeature[]
}

export interface ConsensusEvidence {
  cmp: CircularComparison
  /** The consensus aligned to the construct, as a contig of one row. */
  doc: ContigDoc
  report: VerifyReport
  /** Mixed positions in the service's chromatogram; null without one, or when it could not be lined up. */
  traceSites: MixedSite[] | null
}

/** The consensus tier. Null when the consensus cannot be lined up with the construct. */
export function consensusEvidence(name: string, consensus: string, construct: Construct, trace: TraceData | null): ConsensusEvidence | null {
  const cmp = compareCircular(construct.bases, consensus)
  if (!cmp) return null
  const L = construct.bases.length
  const doc = comparisonContig(cmp, { name: construct.name, tabId: construct.tabId, length: L, features: construct.features }, name)
  const report = consensusReport(doc, construct.bases.toUpperCase(), construct.features, cmp.ambiguous)
  let traceSites: MixedSite[] | null = null
  if (trace && trace.bases.length > 0) {
    const tc = compareCircular(construct.bases, trace.bases)
    if (tc) traceSites = traceMixedSites(trace, tc, construct.bases, report.differences)
  }
  return { cmp, doc, report, traceSites }
}

/** What the read tier hands over: the mapping it made and what it found. */
export interface ReadEvidence {
  readSetId: string
  mappingId: string
  mapped: number
  coverage: ArrayLike<number>
  levels: readonly CoverageLevel[]
  /** Every candidate variant on the construct (ngs/calls.ts siteVariants). */
  candidates: readonly Variant[]
}

/**
 * Depth along the construct with the bases of a deletion most reads carry
 * counted as read: the mapping's coverage, like `samtools depth`, does not
 * count a deleted base, so a clean deletion would otherwise read as a
 * stretch nobody sequenced.
 */
export function depthWithDeletions(ev: Pick<ReadEvidence, 'coverage' | 'candidates'>, length: number): Uint32Array {
  const depth = Uint32Array.from({ length }, (_, p) => ev.coverage[p] ?? 0)
  for (const v of ev.candidates) {
    if (v.type !== 'Deletion' || v.frequency < 0.5) continue
    for (let k = 0; k < v.ref.length; k++) {
      const p = (v.position - 1 + k) % length
      depth[p] = Math.max(depth[p], v.coverage)
    }
  }
  return depth
}

/** The read tier's verdict: covered means READ_MIN_DEPTH reads, differences are what most reads carry. */
export function readReport(construct: Construct, ev: ReadEvidence, ambiguous: boolean): VerifyReport {
  const r = verifySample({
    reference: { name: construct.name, length: construct.bases.length, circular: true },
    reads: ev.mapped,
    coverage: depthWithDeletions(ev, construct.bases.length),
    levels: ev.levels,
    variants: ev.candidates,
    features: construct.features,
    settings: { minDepth: READ_MIN_DEPTH, bothStrands: false, featureIds: null },
  })
  return wholePlasmidVerdict(r, ambiguous)
}

/** The record of one sample, from its evidence. */
export function sampleRecord(o: {
  contigId: string
  name: string
  files: string[]
  construct: Construct
  closeTo: string[]
  consensus: ConsensusEvidence
  consensusLength: number
  reads: ReadEvidence | null
  readsNote: string | null
}): PlasmidSample {
  const { cmp } = o.consensus
  const L = o.construct.bases.length
  const report = o.reads ? readReport(o.construct, o.reads, cmp.ambiguous) : o.consensus.report
  const readSites = o.reads ? readMixedSites(o.reads.candidates, report.differences) : null
  const sites = readSites ?? o.consensus.traceSites ?? []
  const depth = o.reads ? depthSummary(depthWithDeletions(o.reads, L), L) : null
  return {
    contigId: o.contigId,
    name: o.name,
    files: o.files,
    construct: { tabId: o.construct.tabId, name: o.construct.name, length: L },
    closeTo: o.closeTo,
    rotation: { startInFile: cmp.startInFile, reversed: cmp.reversed, ambiguous: cmp.ambiguous },
    consensusLength: o.consensusLength,
    identity: cmp.identity,
    tier: o.reads ? 'reads' : 'consensus',
    readsNote: o.readsNote,
    reads: o.reads && depth ? { readSetId: o.reads.readSetId, mappingId: o.reads.mappingId, mapped: o.reads.mapped, meanDepth: depth.mean, minDepth: depth.min } : null,
    report,
    mixed: { flagged: sites.length > 0, source: readSites ? 'reads' : o.consensus.traceSites ? 'trace' : null, sites },
    lowConfidence: lowConfidence(report.differences, o.construct.bases),
  }
}
