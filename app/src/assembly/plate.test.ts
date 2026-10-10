import { describe, it, expect } from 'vitest'
import { computeConsensus, consensusSequence } from './consensus'
import {
  checkableTypes, DEFAULT_PLATE_VERIFY, failedFeatures, lowestDepth, plateCounts, plateCsv, plateFasta, sanitizePlateVerify,
  verifyPlateContig, type CloneResult,
} from './plate'
import { testContig, testRow } from './testing'
import type { RefFeature } from './variants'

function dna(n: number, seed = 1): string {
  let x = seed
  let s = ''
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff
    s += 'ACGT'[(x >> 16) & 3]
  }
  return s
}

const REF = dna(300, 5)
const feats: RefFeature[] = [
  { id: 'cds', name: 'gfp', type: 'CDS', start: 60, end: 240, strand: 1 },
  { id: 'pb', name: 'M13F', type: 'primer_bind', start: 0, end: 20, strand: 1 },
  { id: 'v', name: 'old', type: 'variation', start: 100, end: 101, strand: 0 },
]

function clone(name: string, rows: ReturnType<typeof testRow>[]): CloneResult {
  const doc = testContig(rows, REF, 'pGFP')
  const cons = computeConsensus(doc, { method: 'quality', ambiguity: 0 })
  return { contigId: name, name, reference: 'pGFP', reads: rows.length, report: verifyPlateContig(doc, cons.bases, feats, DEFAULT_PLATE_VERIFY), consensus: consensusSequence(cons) }
}

describe('verifying a plate', () => {
  const full = clone('A01', [testRow('f', 40, REF.slice(40, 260)), testRow('r', 50, REF.slice(50, 280), { reversed: true })])
  const mutated = clone('A02', [testRow('f', 40, REF.slice(40, 150) + (REF[150] === 'A' ? 'C' : 'A') + REF.slice(151, 260))])
  const short = clone('A03', [testRow('f', 40, REF.slice(40, 120))])

  it('gives each clone its verdict, checking the CDS but not the primer site', () => {
    expect([full, mutated, short].map(c => c.report?.verdict)).toEqual(['verified', 'differences', 'incomplete'])
    expect(full.report!.features.map(f => f.feature.name)).toEqual(['gfp'])
    expect(lowestDepth(full.report!)).toBe(2)
    expect(failedFeatures(short.report!)).toBe('gfp (not fully covered)')
    expect(plateCounts([full, mutated, short])).toEqual({ all: 3, verified: 1, differences: 1, incomplete: 1 })
  })

  it('checks a construct whole when every feature type is left out', () => {
    const doc = testContig([testRow('f', 40, REF.slice(40, 260))], REF)
    const cons = computeConsensus(doc, { method: 'quality', ambiguity: 0 })
    const r = verifyPlateContig(doc, cons.bases, feats, { ...DEFAULT_PLATE_VERIFY, skipTypes: ['CDS', 'primer_bind'] })!
    expect(r.features).toEqual([])
    expect(r.verdict).toBe('incomplete')
    expect(lowestDepth(r)).toBeNull()
  })

  it('needs both strands when asked', () => {
    const doc = testContig([testRow('f', 40, REF.slice(40, 260))], REF)
    const cons = computeConsensus(doc, { method: 'quality', ambiguity: 0 })
    expect(verifyPlateContig(doc, cons.bases, feats, DEFAULT_PLATE_VERIFY)!.verdict).toBe('verified')
    expect(verifyPlateContig(doc, cons.bases, feats, { ...DEFAULT_PLATE_VERIFY, bothStrands: true })!.verdict).toBe('incomplete')
  })

  it('lists the feature types that can be checked', () => {
    expect(checkableTypes([feats, [{ id: 'p', name: 'lac', type: 'promoter', start: 0, end: 5, strand: 1 }]])).toEqual(['CDS', 'primer_bind', 'promoter'])
  })

  it('writes a CSV row per clone and FASTA of the consensus', () => {
    const csv = plateCsv([full, mutated], DEFAULT_PLATE_VERIFY).trim().split('\n')
    expect(csv[0]).toBe('Covered means,at least 1 read')
    expect(csv[1]).toBe('Not checked,primer_bind; misc_feature')
    expect(csv[3]).toMatch(/^Clone,Reference,Verdict/)
    // Bases 41 to 280 of 300 covered; 51 to 260 by both reads.
    expect(csv[4]).toBe('A01,pGFP,Verified,2,80.0%,70.0%,2,,')
    expect(csv[5]).toBe('A02,pGFP,Differences found,1,73.3%,0%,1,gfp (differences found),151 G>A: A31T (missense)')
    const fasta = plateFasta([full])
    expect(fasta.split('\n')[0]).toBe('>A01 mapped to pGFP, verified')
    expect(fasta.replace(/^>.*\n/, '').replace(/\n/g, '')).toBe(REF.slice(40, 280))
  })

  it('reads stored settings back', () => {
    expect(sanitizePlateVerify({ minDepth: 2, bothStrands: true, skipTypes: ['primer_bind', 3] })).toEqual({ minDepth: 2, bothStrands: true, skipTypes: ['primer_bind'] })
    expect(sanitizePlateVerify({ minDepth: 0 })).toBeNull()
    expect(sanitizePlateVerify('x')).toBeNull()
  })
})
