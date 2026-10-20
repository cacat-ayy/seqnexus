import { describe, expect, it } from 'vitest'
import { PUC19_SEQUENCE, demoDocument } from '../demo'
import { refFeatures } from '../assembly/features'
import { reverseComplement } from '../models/complement'
import type { Variant } from '../assembly/variants'
import { consensusEvidence, readReport, sampleRecord, type Construct, type ReadEvidence } from './sample'
import { lowConfidence, methylationAt, readMixedSites, runAt } from './flags'
import { nextStep, plasmidCsv, rotationText, sampleCsv, sanitizePlasmidVerification, type PlasmidVerification } from './result'
import { pileupTrace } from './testing'

const puc = PUC19_SEQUENCE.toUpperCase()
const L = puc.length
const construct: Construct = { tabId: 'tab1', name: 'pUC19', bases: puc, features: refFeatures(demoDocument().annotations.map(a => a.toData())) }
const rotate = (s: string, k: number) => s.slice(k) + s.slice(0, k)
const swap = (b: string) => ({ A: 'G', G: 'A', C: 'T', T: 'C' } as Record<string, string>)[b]

function record(consensus: string, o: { trace?: ReturnType<typeof pileupTrace>; reads?: ReadEvidence } = {}) {
  const ev = consensusEvidence('s1', consensus, construct, o.trace ?? null)!
  return sampleRecord({
    contigId: 'c1', name: 's1', files: ['s1.fasta'], construct, closeTo: [], consensus: ev,
    consensusLength: consensus.length, reads: o.reads ?? null, readsNote: null,
  })
}

describe('consensus tier', () => {
  it('verifies an exact consensus, whatever its strand and origin', () => {
    const s = record(reverseComplement(rotate(puc, 1500)))
    expect(s.report.verdict).toBe('verified')
    expect(s.rotation.reversed).toBe(true)
    expect(s.mixed.flagged).toBe(false)
    expect(nextStep(s)).toMatch(/keep this prep/)
    expect(rotationText(s)).toMatch(/is pUC19 base 1, on the reverse strand/)
  })

  it('counts a difference outside every feature', () => {
    // 1500 is between ori and AmpR.
    const m = puc.split('')
    m[1499] = swap(m[1499])
    const s = record(rotate(m.join(''), 10))
    expect(s.report.verdict).toBe('differences')
    expect(s.report.differences.map(d => d.position)).toEqual([1500])
    expect(nextStep(s)).toMatch(/none changing a protein/)
  })

  it('says what a missense change in AmpR does', () => {
    const m = puc.split('')
    m[1999] = swap(m[1999])
    const s = record(m.join(''))
    expect(s.report.differences[0].coding?.feature).toBe('AmpR')
    expect(nextStep(s)).toMatch(/changes a protein \(AmpR/)
  })

  it('flags a mixed position in the chromatogram, and only that one', () => {
    const minor = new Map([[1200, swap(puc[1200])]])
    const s = record(puc, { trace: pileupTrace(puc, minor, 0.3) })
    expect(s.mixed.source).toBe('trace')
    expect(s.mixed.flagged).toBe(true)
    expect(s.mixed.sites.map(x => x.position)).toEqual([1201])
    expect(s.mixed.sites[0].atDifference).toBe(false)
    expect(s.mixed.sites[0].fraction).toBeGreaterThan(0.2)
    expect(nextStep(s)).toMatch(/tube looks mixed/)
  })

  it('reads a reverse-strand chromatogram onto the construct', () => {
    const rc = reverseComplement(puc)
    // pUC19 position 801 (0-based 800) is rc index L - 1 - 800.
    const i = L - 1 - 800
    const s = record(rc, { trace: pileupTrace(rc, new Map([[i, swap(rc[i])]]), 0.4) })
    expect(s.mixed.sites.map(x => x.position)).toEqual([801])
    expect(s.mixed.sites[0].change).toBe(`${puc[800]}/${swap(puc[800])}`)
  })

  it('does not take a weak second peak for a mixture', () => {
    const s = record(puc, { trace: pileupTrace(puc, new Map([[1200, swap(puc[1200])]]), 0.1) })
    expect(s.mixed.flagged).toBe(false)
  })
})

describe('read tier', () => {
  const variant = (o: Partial<Variant>): Variant => ({
    c0: 0, c1: 1, type: 'SNP', position: 900, ref: 'A', alt: 'G', coverage: 200, count: 60, frequency: 0.3, pValue: 1e-30,
    strandBiasP: 1, forward: { ref: 70, alt: 30 }, reverse: { ref: 70, alt: 30 }, meanQuality: 30, features: [], coding: null,
    otherCoding: [], repeat: null, homopolymer: null, againstConsensus: false, ...o,
  })
  const evidence = (candidates: Variant[], depth = 200): ReadEvidence => ({
    readSetId: 'rset_1', mappingId: 'asm_2', mapped: 900, coverage: new Uint32Array(L).fill(depth), levels: [], candidates,
  })

  it('takes the differences most reads carry and flags a minor allele as mixed', () => {
    const snp = variant({ position: 700, frequency: 0.97, count: 194 })
    const minor = variant({ position: 1900, frequency: 0.3 })
    const s = record(puc, { reads: evidence([snp, minor]) })
    expect(s.tier).toBe('reads')
    expect(s.report.differences.map(d => d.position)).toEqual([700])
    expect(s.mixed.source).toBe('reads')
    expect(s.mixed.sites.map(m => [m.position, Math.round(m.fraction * 100)])).toEqual([[1900, 30]])
    expect(s.reads).toMatchObject({ meanDepth: 200, minDepth: 200 })
  })

  it('leaves out minor alleles below 20 reads of depth or in homopolymer indels', () => {
    const shallow = variant({ position: 1900, coverage: 15, count: 5, frequency: 0.33 })
    const hp = variant({ type: 'Deletion', ref: 'A', alt: '', position: 1000, homopolymer: 6, frequency: 0.3 })
    expect(readMixedSites([shallow, hp], [])).toEqual([])
  })

  it('is incomplete where fewer than ten reads cover', () => {
    const cov = new Uint32Array(L).fill(80)
    cov.fill(4, 100, 200)
    const r = readReport(construct, { ...evidence([]), coverage: cov }, false)
    expect(r.verdict).toBe('incomplete')
    expect(r.uncovered).toEqual([{ from: 101, to: 200 }])
  })
})

describe('flags', () => {
  it('measures runs and finds methylation sites on the circle', () => {
    expect(runAt('AAAACGTAAA', 0)).toBe(7)
    expect(methylationAt('TTTTGATCTTTT', 5)?.name).toBe('Dam')
    expect(methylationAt('TTTTCCAGGTTT', 6)?.name).toBe('Dcm')
    expect(methylationAt('TTTTTTTTTTTT', 6)).toBeNull()
  })

  it('marks a difference in a run of more than nine bases as low confidence', () => {
    const ref = 'ACGT'.repeat(10) + 'A'.repeat(11) + 'CGTC'.repeat(10)
    const d = { type: 'Deletion', position: 45, ref: 'A', alt: '', homopolymer: 11 } as Variant
    const low = lowConfidence([d], ref)
    expect(low).toHaveLength(1)
    expect(low[0].reason).toMatch(/run of 11 A/)
    const s = { type: 'SNP', position: 20, ref: 'C', alt: 'T', homopolymer: null } as unknown as Variant
    expect(lowConfidence([s], ref)).toEqual([])
  })
})

describe('the record', () => {
  it('writes a CSV per sample and per drop, and reads back what it stored', () => {
    const m = puc.split('')
    m[699] = swap(m[699])
    const s = record(rotate(m.join(''), 400))
    const v: PlasmidVerification = { checkedAt: 1, samples: [s], unmatched: [{ name: 's2', files: ['s2.fasta'], reason: 'No open sequence matches' }] }
    const csv = plasmidCsv(v)
    expect(csv.split('\n')[1]).toMatch(/^s1,pUC19,Differences found,consensus/)
    expect(csv).toMatch(/s2,,No construct matched/)
    expect(csv).toMatch(/\ns1,700,SNP,/)
    expect(sampleCsv(s)).toMatch(/^Sample,s1\nConstruct,pUC19/)
    const back = sanitizePlasmidVerification(JSON.parse(JSON.stringify(v)))!
    expect(back.samples[0].report.differences[0].position).toBe(700)
    expect(back.samples[0].rotation).toEqual(s.rotation)
    expect(back.unmatched).toEqual(v.unmatched)
    expect(sanitizePlasmidVerification({ samples: [{ name: 'x' }] })).toBeNull()
  })
})

describe('read tier depth', () => {
  it('counts the bases of a deletion most reads carry as read', () => {
    const cov = new Uint32Array(L).fill(120)
    cov.fill(2, 1808, 1811)
    const del = {
      c0: 0, c1: 1, type: 'Deletion', position: 1809, ref: 'GCC', alt: '', coverage: 140, count: 136, frequency: 0.97, pValue: 1e-40,
      strandBiasP: 1, forward: { ref: 2, alt: 70 }, reverse: { ref: 2, alt: 66 }, meanQuality: 20, features: ['AmpR'], coding: null,
      otherCoding: [], repeat: null, homopolymer: null, againstConsensus: false,
    } as Variant
    const s = record(puc, { reads: { readSetId: 'r', mappingId: 'm', mapped: 150, coverage: cov, levels: [], candidates: [del] } })
    expect(s.report.verdict).toBe('differences')
    expect(s.report.uncovered).toEqual([])
    expect(s.reads?.minDepth).toBe(120)
  })
})
