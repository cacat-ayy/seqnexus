/**
 * The verdict on one sample of a whole-plasmid sequencing result, and the
 * record kept of it.
 *
 * The verdict is the clone verification's (assembly/verify.ts), with one
 * change: every difference counts, inside a feature or not. A plate of
 * Sanger reads checks the features a primer walk was aimed at; a whole
 * plasmid is read end to end, and a point mutation in an unannotated stretch
 * of the backbone still makes the prep something other than the construct.
 * The features table still says which features carry differences.
 *
 * - verified: the consensus (or most reads) matches the construct at every
 *   base, and every base is covered (by the consensus; with the reads, by at
 *   least READ_MIN_DEPTH of them);
 * - differences: some position differs;
 * - incomplete: some base has fewer reads than that, or where the consensus
 *   starts on the construct could not be placed with certainty.
 *
 * Two tiers give the evidence. The consensus tier aligns the service's
 * consensus to the construct (compare.ts) and works anywhere, a page opened
 * from disk included. The read tier maps the raw reads with minimap2 and
 * calls variants with the nanopore settings; it replaces the consensus
 * tier's differences when it ran, and adds depth and the allele fractions
 * that show a mixed population.
 */

import type { RefFeature } from '../assembly/variants'
import { describeChange, describeDifference, STATUS_LABEL, verifyCsv, verifyPileup, type VerifyReport, type VerifySettings } from '../assembly/verify'
import { allCoding, codingLabel, effectSeverity } from '../assembly/effects'
import type { ContigDoc } from '../assembly/types'
import { csvCell } from '../utils/csv-cell'
import { consensusDifferences } from './compare'
import type { LowConfidence, MixedSite } from './flags'

/** Reads a base needs, in the read tier, to count as covered. */
export const READ_MIN_DEPTH = 10

export interface PlasmidReads {
  readSetId: string
  /** The NGS mapping the reads were mapped in (an assembly id). */
  mappingId: string
  mapped: number
  meanDepth: number
  minDepth: number
}

export interface PlasmidSample {
  /** The contig of the consensus aligned to the construct. */
  contigId: string
  name: string
  /** The files it was verified from. */
  files: string[]
  construct: { tabId: string | null; name: string; length: number }
  /** Other open sequences the consensus matched almost as well (the choice was close). */
  closeTo: string[]
  rotation: {
    /** The consensus file's base (1-based, on its own strand) at the construct's first base. */
    startInFile: number
    reversed: boolean
    ambiguous: boolean
  }
  consensusLength: number
  /** Matching columns over all columns of the consensus alignment. */
  identity: number
  tier: 'consensus' | 'reads'
  /** Why the reads did not give the verdict, when the sample has reads. */
  readsNote: string | null
  reads: PlasmidReads | null
  report: VerifyReport
  mixed: { flagged: boolean; source: 'reads' | 'trace' | null; sites: MixedSite[] }
  lowConfidence: LowConfidence[]
}

export interface PlasmidUnmatched {
  name: string
  files: string[]
  reason: string
}

/** One drop's verification, kept on the assembly that holds its contigs. */
export interface PlasmidVerification {
  checkedAt: number
  samples: PlasmidSample[]
  /** Samples no open sequence matched. */
  unmatched: PlasmidUnmatched[]
}

/** The clone verdict with every difference counting and an uncertain rotation making it incomplete. */
export function wholePlasmidVerdict(r: VerifyReport, ambiguous: boolean): VerifyReport {
  const verdict = r.differences.length ? 'differences' : ambiguous || r.covered < 1 ? 'incomplete' : 'verified'
  return { ...r, verdict }
}

const WHOLE: VerifySettings = { minDepth: 1, bothStrands: false, featureIds: null }

/** The consensus tier's verdict: the consensus covers every base once. */
export function consensusReport(doc: ContigDoc, refBases: string, features: readonly RefFeature[], ambiguous: boolean): VerifyReport {
  const L = refBases.length
  const differences = consensusDifferences(doc, refBases, features)
  const report = verifyPileup({
    reference: { name: doc.reference?.name ?? '', length: L, circular: true },
    reads: 1,
    depth: new Uint8Array(L).fill(1),
    bothStrands: () => false,
    differences,
    features,
    settings: WHOLE,
  })
  return wholePlasmidVerdict(report, ambiguous)
}

/** Mean and lowest depth along a construct. */
export function depthSummary(coverage: ArrayLike<number>, length: number): { mean: number; min: number } {
  let sum = 0
  let min = Infinity
  for (let p = 0; p < length; p++) {
    const d = coverage[p] ?? 0
    sum += d
    if (d < min) min = d
  }
  return { mean: length ? sum / length : 0, min: Number.isFinite(min) ? min : 0 }
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`

/** One sentence: what to do with this sample. */
export function nextStep(s: PlasmidSample): string {
  const r = s.report
  const mixed = s.mixed.flagged
  if (r.verdict === 'verified') {
    return mixed
      ? 'The consensus is the construct, but the tube looks mixed: streak for single colonies and sequence one again before using this prep.'
      : 'The sample is the construct: keep this prep and file this report with it.'
  }
  if (r.verdict === 'incomplete') {
    if (s.rotation.ambiguous) return `Where the consensus starts on ${s.construct.name} is not certain: check that this is the construct the sample was meant to be.`
    return `Part of the construct has fewer than ${READ_MIN_DEPTH} reads: confirm those stretches by Sanger sequencing or sequence the prep again.`
  }
  const low = new Set(s.lowConfidence.map(x => x.key))
  const diffs = r.differences
  const doubtful = diffs.filter(d => low.has(`${d.type}:${d.position}:${d.ref}:${d.alt}`))
  if (doubtful.length === diffs.length) {
    return `The only ${diffs.length === 1 ? 'difference is' : 'differences are'} where nanopore reads are known to err: confirm ${diffs.length === 1 ? 'it' : 'them'} with a Sanger read across ${diffs.map(d => d.position.toLocaleString('en-US')).join(', ')} before discarding the clone.`
  }
  if (mixed) return 'The tube looks mixed and differs from the construct: streak for single colonies and sequence several.'
  const severe = diffs.filter(d => allCoding(d).some(c => effectSeverity(c.effect) !== 'mild'))
  if (severe.length) {
    const c = allCoding(severe[0]).find(x => effectSeverity(x.effect) !== 'mild')!
    return `${plural(severe.length, 'difference')} ${severe.length === 1 ? 'changes' : 'change'} a protein (${c.feature} ${codingLabel(c)}): pick another clone, unless the change was meant.`
  }
  return `${plural(diffs.length, 'difference')}, none changing a protein: decide whether ${diffs.length === 1 ? 'it matters' : 'they matter'} for what the plasmid is for.`
}

const pct = (x: number) => `${(x * 100).toFixed(x === 1 || x === 0 ? 0 : 1)}%`

/** The drop as CSV: a row per sample, then a row per difference. */
export function plasmidCsv(v: PlasmidVerification): string {
  const q = csvCell
  const lines = [
    'Sample,Construct,Verdict,Evidence,Identity,Mean depth,Lowest depth,Mixed population,Rotation,Differences,Next step',
    ...v.samples.map(s => [
      s.name, s.construct.name, STATUS_LABEL[s.report.verdict], s.tier === 'reads' ? 'reads' : 'consensus',
      pct(s.identity), s.reads ? s.reads.meanDepth.toFixed(0) : '', s.reads ? String(s.reads.minDepth) : '',
      s.mixed.flagged ? 'yes' : 'no', rotationText(s),
      s.report.differences.map(d => describeDifference(d)).join('; '), nextStep(s),
    ].map(q).join(',')),
    ...v.unmatched.map(u => [u.name, '', 'No construct matched', '', '', '', '', '', '', '', u.reason].map(q).join(',')),
  ]
  const diffs = v.samples.flatMap(s => s.report.differences.map(d => ({ s, d })))
  if (diffs.length) {
    lines.push('', 'Sample,Position,Type,Change,Reads,Features,Protein change,Effect,Low confidence')
    const low = new Map(v.samples.flatMap(s => s.lowConfidence.map(x => [`${s.name}|${x.key}`, x.reason] as const)))
    for (const { s, d } of diffs) {
      lines.push([
        s.name, String(d.position), d.type, describeChange(d),
        s.tier === 'reads' ? `${Math.round(d.frequency * 100)}% of ${d.coverage}` : 'consensus',
        d.features.join('; '), d.coding?.protein ?? '', d.coding?.effect ?? '',
        low.get(`${s.name}|${d.type}:${d.position}:${d.ref}:${d.alt}`) ?? '',
      ].map(q).join(','))
    }
  }
  return lines.join('\n') + '\n'
}

/** One sample as CSV: the clone verification's, with what whole-plasmid sequencing adds. */
export function sampleCsv(s: PlasmidSample): string {
  const q = csvCell
  const head = [
    `Sample,${q(s.name)}`,
    `Construct,${q(s.construct.name)}`,
    `Evidence,${s.tier === 'reads' ? 'reads mapped to the construct' : 'the consensus aligned to the construct'}`,
    `Rotation,${q(rotationText(s))}`,
    `Identity,${pct(s.identity)}`,
    ...(s.reads ? [`Mean depth,${s.reads.meanDepth.toFixed(0)}`, `Lowest depth,${s.reads.minDepth}`] : []),
    `Mixed population,${s.mixed.flagged ? q(`yes: ${s.mixed.sites.map(m => `${m.position} ${m.change} ${Math.round(m.fraction * 100)}%`).join('; ')}`) : 'no'}`,
    ...s.lowConfidence.map(x => `Low confidence,${x.position},${q(x.reason)}`),
    `Next step,${q(nextStep(s))}`,
    '',
  ]
  return head.join('\n') + '\n' + verifyCsv(s.report)
}

/** "Consensus base 1,234 is base 1; reverse strand". */
export function rotationText(s: Pick<PlasmidSample, 'rotation' | 'construct'>): string {
  const r = s.rotation
  return `consensus base ${r.startInFile.toLocaleString('en-US')} is ${s.construct.name} base 1${r.reversed ? ', on the reverse strand' : ''}${r.ambiguous ? ' (not certain)' : ''}`
}

// ---------------------------------------------------------------------------
// Read back
// ---------------------------------------------------------------------------

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object'
const isStr = (x: unknown): x is string => typeof x === 'string'
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)

function sanitizeSample(raw: unknown): PlasmidSample | null {
  if (!isObj(raw)) return null
  const c = raw.construct
  const rot = raw.rotation
  const report = raw.report as VerifyReport | undefined
  if (!isStr(raw.contigId) || !isStr(raw.name) || !isObj(c) || !isStr(c.name) || !isNum(c.length) || !isObj(rot) || !isNum(rot.startInFile)) return null
  if (!isObj(report) || !Array.isArray(report.differences) || !Array.isArray(report.features) || !isStr(report.verdict)) return null
  const reads = isObj(raw.reads) && isStr(raw.reads.readSetId) && isStr(raw.reads.mappingId) ? raw.reads as unknown as PlasmidReads : null
  const mixed = isObj(raw.mixed) && Array.isArray(raw.mixed.sites) ? raw.mixed as PlasmidSample['mixed'] : { flagged: false, source: null, sites: [] }
  return {
    contigId: raw.contigId,
    name: raw.name,
    files: Array.isArray(raw.files) ? raw.files.filter(isStr) : [],
    construct: { tabId: isStr(c.tabId) ? c.tabId : null, name: c.name, length: c.length },
    closeTo: Array.isArray(raw.closeTo) ? raw.closeTo.filter(isStr) : [],
    rotation: { startInFile: rot.startInFile, reversed: rot.reversed === true, ambiguous: rot.ambiguous === true },
    consensusLength: isNum(raw.consensusLength) ? raw.consensusLength : 0,
    identity: isNum(raw.identity) ? raw.identity : 0,
    tier: raw.tier === 'reads' ? 'reads' : 'consensus',
    readsNote: isStr(raw.readsNote) ? raw.readsNote : null,
    reads,
    report,
    mixed,
    lowConfidence: Array.isArray(raw.lowConfidence) ? raw.lowConfidence.filter((x): x is LowConfidence => isObj(x) && isStr(x.key) && isStr(x.reason)) : [],
  }
}

/** A stored verification read back, or null when it is not one. */
export function sanitizePlasmidVerification(raw: unknown): PlasmidVerification | null {
  if (!isObj(raw) || !Array.isArray(raw.samples)) return null
  const samples = raw.samples.map(sanitizeSample).filter((s): s is PlasmidSample => !!s)
  const unmatched = Array.isArray(raw.unmatched)
    ? raw.unmatched.filter((u): u is PlasmidUnmatched => isObj(u) && isStr(u.name) && isStr(u.reason)).map(u => ({ name: u.name, reason: u.reason, files: Array.isArray(u.files) ? u.files.filter(isStr) : [] }))
    : []
  if (samples.length === 0 && unmatched.length === 0) return null
  return { checkedAt: isNum(raw.checkedAt) ? raw.checkedAt : 0, samples, unmatched }
}

/** Best verdict among the samples verified against one construct: what its badge says. */
export function constructStatus(samples: readonly PlasmidSample[]): VerifyReport['verdict'] {
  if (samples.some(s => s.report.verdict === 'verified')) return 'verified'
  return samples.some(s => s.report.verdict === 'differences') ? 'differences' : 'incomplete'
}
