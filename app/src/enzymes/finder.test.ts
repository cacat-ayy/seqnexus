/**
 * The site finder against independent answers: cut positions computed with
 * Biopython's Bio.Restriction (REBASE data), the lambda HindIII marker, and
 * properties every enzyme must keep. Random sequences come from a seeded
 * generator, so a failure is reproducible.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ENZYME_DB, getEnzyme } from './db'
import {
  computeFragments, cuttingSites, cutPairs, findAllSites, findCutSites, scanEnzymes, splitCuts, type CutSite,
} from './finder'
import { reverseComplement } from '../models/complement'

function randomDna(n: number, seed: number): string {
  let s = seed >>> 0
  const out: string[] = []
  for (let i = 0; i < n; i++) {
    s = (s * 1664525 + 1013904223) >>> 0
    out.push('ACGT'[Math.floor((s / 2 ** 32) * 4)])
  }
  return out.join('')
}
const mod = (a: number, n: number) => ((a % n) + n) % n
const topCuts = (sites: CutSite[]) => cuttingSites(sites).flatMap(s => cutPairs(s).map(p => p.fwdCut)).sort((a, b) => a - b)

describe('lambda HindIII', () => {
  const record = readFileSync(join(__dirname, '../../testdata/enzymes/lambda_NC_001416.fa'), 'utf8')
    .split(/\r?\n/).filter(l => !l.startsWith('>')).join('').trim()
  const HindIII = getEnzyme('HindIII')!

  it('NC_001416 has six HindIII sites: the record reads AAGCTC at 37584', () => {
    expect(record.length).toBe(48502)
    expect(topCuts(findCutSites(record, HindIII, 'linear'))).toEqual([23130, 25157, 27479, 36895, 37459, 44141])
  })

  it('with the seventh site of NEB lambda (cI857ind1 Sam7) gives the marker: 23130 down to 125 bp', () => {
    const lambda = record.slice(0, 37588) + 'T' + record.slice(37589)
    const sites = findCutSites(lambda, HindIII, 'linear')
    expect(computeFragments(lambda.length, sites, 'linear')).toEqual([23130, 9416, 6557, 4361, 2322, 2027, 564, 125])
  })
})

describe('enzymes the REBASE build used to drop', () => {
  it('BsmI (written GAATGC(1/-1)) cuts after GAATGCN on top and before the last base of its site below', () => {
    const BsmI = getEnzyme('BsmI')!
    expect([BsmI.recognition, BsmI.fwd_cut, BsmI.rev_cut, BsmI.overhang]).toEqual(['GAATGC', 7, 5, '3prime'])
    const seq = 'A'.repeat(20) + 'GAATGCAA' + 'A'.repeat(20)
    expect(findCutSites(seq, BsmI).map(s => [s.fwdCut, s.revCut])).toEqual([[27, 25]])
  })

  it('SfiI and XcmI, with sites longer than 12 bp', () => {
    expect(getEnzyme('SfiI')).toMatchObject({ recognition: 'GGCCNNNNNGGCC', fwd_cut: 8, rev_cut: 5 })
    expect(getEnzyme('XcmI')).toMatchObject({ recognition: 'CCANNNNNNNNNTGG', fwd_cut: 8, rev_cut: 7 })
  })

  it('AciI, BbvCI and BseYI, cut inside a non-palindromic site', () => {
    expect(getEnzyme('AciI')).toMatchObject({ recognition: 'CCGC', fwd_cut: 1, rev_cut: 3 })
    expect(getEnzyme('BbvCI')).toMatchObject({ recognition: 'CCTCAGC', fwd_cut: 2, rev_cut: 5 })
    expect(getEnzyme('BseYI')).toMatchObject({ recognition: 'CCCAGC', fwd_cut: 1, rev_cut: 5 })
  })
})

describe('TspRI', () => {
  it('reads CASTG and cuts 7 after it on top and 2 before it below: one site, a 9-base 3\' overhang', () => {
    const TspRI = getEnzyme('TspRI')!
    expect([TspRI.recognition, TspRI.fwd_cut, TspRI.rev_cut]).toEqual(['CASTG', 7, -2])
    const sites = findCutSites('A'.repeat(20) + 'CACTGAA' + 'A'.repeat(20), TspRI, 'linear')
    expect(sites.map(s => [s.fwdCut, s.revCut])).toEqual([[27, 18]])
  })
})

describe('Type IIB enzymes cut on both sides of their site', () => {
  // Expected cuts from Biopython: BaeI.search() and BcgI.search() on these sequences.
  const BAEI_FWD = 'GGATCACAGTCTACACTGCTCACTCCAACCCCGGCCCCTGACGATCGTACCAGTCCGAGGAGAGGGTGCTTCAGAGTATGTATACCACTGG'
  const BAEI_REV = 'GTAGGATACGGCGGAGGGCACGTCAATACGGTTCAATGCCGATACGATCGTCTACTGCATGCTCTTGTGGTTCATCTGCATGGAGAGGGTG'
  const BCGI_REV = 'GGCATGGGTGGGGGTGCTGGCCCGTGATCTGGACCTCCCAGCATACGTTTCGTCCACAGCTCATTGTACCGAGTGTAGAGAGGGGCTTGTCC'
  const BCGI_ORIGIN = 'TGCTTCCAGATAGCGTTTCTGTTTCGGTGTAGGTGCTAATCGACTATGCTACTGCGGTTAACGGGGATGGCAAGTACATTTTTCGAAACGTA'
  const BaeI = getEnzyme('BaeI')!
  const BcgI = getEnzyme('BcgI')!

  it('BaeI is (10/15)ACNNNNGTAYC(12/7)', () => {
    expect(BaeI).toMatchObject({ recognition: 'ACNNNNGTAYC', fwd_cut: 23, rev_cut: 18, fwd_cut2: -10, rev_cut2: -15 })
  })

  it('finds one site and both of its breaks, on either strand', () => {
    const fwd = findCutSites(BAEI_FWD, BaeI, 'linear')
    expect(fwd).toHaveLength(1)
    expect(topCuts(fwd)).toEqual([30, 63])
    expect(topCuts(findCutSites(BAEI_REV, BaeI, 'linear'))).toEqual([33, 66])
    expect(topCuts(findCutSites(BCGI_REV, BcgI, 'linear'))).toEqual([30, 64])
  })

  it('excises a short fragment: three pieces from a linear sequence, two from a circle', () => {
    expect(computeFragments(BAEI_FWD.length, findCutSites(BAEI_FWD, BaeI, 'linear'), 'linear')).toEqual([33, 30, 28])
    expect(computeFragments(BAEI_FWD.length, findCutSites(BAEI_FWD, BaeI, 'circular'), 'circular')).toEqual([58, 33])
    expect(computeFragments(BCGI_REV.length, findCutSites(BCGI_REV, BcgI, 'linear'), 'linear')).toEqual([34, 30, 28])
  })

  it('places both breaks of a site across the origin of a circle', () => {
    const sites = findCutSites(BCGI_ORIGIN, BcgI, 'circular')
    expect(sites).toHaveLength(1)
    expect(topCuts(sites)).toEqual([15, 73])
    expect(computeFragments(BCGI_ORIGIN.length, sites, 'circular')).toEqual([58, 34])
  })

  it('splitCuts turns each break into an entry of its own, for digests', () => {
    const split = splitCuts(findCutSites(BAEI_FWD, BaeI, 'linear'))
    expect(split.map(s => s.fwdCut).sort((a, b) => a - b)).toEqual([30, 63])
    expect(split.every(s => s.cut2 === undefined)).toBe(true)
  })

  it('cuts nothing when a break would fall past the end of a linear sequence', () => {
    const near = BAEI_FWD.slice(0, 60)
    expect(cuttingSites(findCutSites(near, BaeI, 'linear'))).toEqual([])
  })
})

describe('a non-palindromic site that reads the same on both strands', () => {
  it('MspJI on CAAG is a site on each strand, cutting 13 and 17 bases away on each side', () => {
    // CNNR matches CAAG on the top strand and its reverse complement YNNG
    // matches it too, so MspJI binds both ways round. (Biopython reports
    // only the top-strand site.)
    const MspJI = getEnzyme('MspJI')!
    const sites = findCutSites('A'.repeat(30) + 'CAAG' + 'A'.repeat(30), MspJI, 'linear')
    expect(sites.map(s => [s.strand, s.fwdCut, s.revCut]).sort()).toEqual([[-1, 17, 21], [1, 43, 47]])
  })
})

describe('scale', () => {
  it('finds every enzyme\'s sites on a 4.6 Mb sequence without overflowing the stack', () => {
    const genome = randomDna(4_600_000, 7)
    expect(() => findAllSites(genome, ENZYME_DB, 'linear')).not.toThrow()
  }, 180_000)

  it('counts, and does not list, the sites of an enzyme past the limit', () => {
    const seq = randomDna(20_000, 11)
    const AluI = getEnzyme('AluI')!
    const EcoRI = getEnzyme('EcoRI')!
    const all = findCutSites(seq, AluI, 'linear').length
    const scan = scanEnzymes(seq, [AluI, EcoRI], 'linear', 20)
    expect(all).toBeGreaterThan(20)
    expect(scan.tooMany.get('AluI')).toBe(all)
    expect(scan.sites.every(s => s.enzyme.name === 'EcoRI')).toBe(true)
  })
})

describe('properties, over every enzyme', () => {
  const seqs = [randomDna(3000, 1), randomDna(5000, 2), randomDna(777, 3)]
  const pairsOf = (sites: CutSite[]) => sites.flatMap(s => cutPairs(s).map(p => `${p.fwdCut},${p.revCut}`)).sort()
  const enzymes = ENZYME_DB

  it('reverse-complementing the sequence mirrors every cut pair', () => {
    for (const topology of ['linear', 'circular'] as const) {
      for (const seq of seqs) {
        const L = seq.length
        const rc = reverseComplement(seq)
        for (const e of enzymes) {
          const expected = findCutSites(seq, e, topology).flatMap(s => cutPairs(s).map(p => topology === 'circular'
            ? `${mod(L - p.revCut, L)},${mod(L - p.fwdCut, L)}`
            : `${L - p.revCut},${L - p.fwdCut}`)).sort()
          expect(pairsOf(findCutSites(rc, e, topology)), `${e.name} ${topology}`).toEqual(expected)
        }
      }
    }
  })

  it('rotating a circular sequence rotates its cuts', () => {
    for (const seq of seqs) {
      const L = seq.length
      const k = 1234 % L
      const rotated = seq.slice(k) + seq.slice(0, k)
      for (const e of enzymes) {
        const expected = findCutSites(seq, e, 'circular')
          .flatMap(s => cutPairs(s).map(p => `${mod(p.fwdCut - k, L)},${mod(p.revCut - k, L)}`)).sort()
        expect(pairsOf(findCutSites(rotated, e, 'circular')), e.name).toEqual(expected)
      }
    }
  })

  it('fragments sum to the length and number the cuts (circular) or cuts + 1 (linear)', () => {
    for (const topology of ['linear', 'circular'] as const) {
      for (const seq of seqs) {
        const L = seq.length
        for (const e of ENZYME_DB) {
          const sites = findCutSites(seq, e, topology)
          const frags = computeFragments(L, sites, topology)
          expect(frags.reduce((a, b) => a + b, 0), `${e.name} ${topology} sum`).toBe(L)
          const cuts = new Set(topCuts(sites).filter(c => topology === 'circular' || (c > 0 && c < L)))
          const expected = cuts.size === 0 ? 1 : topology === 'circular' ? cuts.size : cuts.size + 1
          expect(frags.length, `${e.name} ${topology} count`).toBe(expected)
        }
      }
    }
  })

  it('reports a site once per position and strand', () => {
    for (const seq of seqs) {
      for (const e of ENZYME_DB) {
        const keys = findCutSites(seq, e, 'circular').map(s => `${s.position}/${s.strand}`)
        expect(new Set(keys).size, e.name).toBe(keys.length)
      }
    }
  })
})
