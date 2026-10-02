/**
 * The demo is the first thing anyone sees. It used to be a garbled pUC19
 * (2,773 bp, the multiple cloning site in twice), so every MCS enzyme cut it
 * twice and restriction analysis found no single cutters.
 */
import { describe, it, expect } from 'vitest'
import { demoDocument, PUC19_SEQUENCE } from './demo'
import { reverseComplement } from './models/complement'
import { ENZYME_DB, ENZYME_GROUPS } from './enzymes/db'
import { cuttingSites, findCutSites } from './enzymes/finder'

const STOPS = new Set(['TAA', 'TAG', 'TGA'])

/** The coding bases of a feature, read 5'→3' on its own strand. */
function coding(start: number, end: number, strand: number): string {
  const s = PUC19_SEQUENCE.slice(start, end)
  return strand === -1 ? reverseComplement(s) : s
}

describe('the pUC19 demo', () => {
  const doc = demoDocument()
  const feature = (name: string) => doc.annotations.find(a => a.name === name)!

  it('is the real 2,686 bp circular pUC19', () => {
    expect(PUC19_SEQUENCE).toHaveLength(2686)
    expect(PUC19_SEQUENCE).toMatch(/^[ACGT]+$/)
    expect(doc.sequence.topology).toBe('circular')
  })

  it('has open reading frames for AmpR and lacZ-alpha, start to stop', () => {
    for (const [name, aa] of [['AmpR', 286], ['lacZ-alpha', 107]] as const) {
      const f = feature(name)
      const cds = coding(f.start, f.end, f.strand)
      expect(cds.length, name).toBe((aa + 1) * 3)
      expect(cds.slice(0, 3), name).toBe('ATG')
      const codons = cds.match(/.../g)!
      expect(codons.slice(0, -1).filter(c => STOPS.has(c)), name).toEqual([])
      expect(STOPS.has(codons[codons.length - 1]), name).toBe(true)
    }
  })

  it('has an MCS from the EcoRI site to the HindIII site, each cutting once', () => {
    const mcs = feature('MCS')
    const bases = PUC19_SEQUENCE.slice(mcs.start, mcs.end)
    expect(bases.startsWith('GAATTC')).toBe(true)
    expect(bases.endsWith('AAGCTT')).toBe(true)
    for (const name of ['EcoRI', 'HindIII', 'BamHI', 'PstI', 'SalI', 'XbaI', 'KpnI', 'SacI', 'SmaI', 'SphI']) {
      const enzyme = ENZYME_DB.find(e => e.name === name)!
      const sites = cuttingSites(findCutSites(PUC19_SEQUENCE, enzyme, 'circular'))
      expect(sites.length, name).toBe(1)
      expect(sites[0].position >= mcs.start && sites[0].end <= mcs.end, name).toBe(true)
    }
  })

  it('gives restriction analysis single cutters among the common 6-cutters', () => {
    const single = ENZYME_GROUPS['Common (6-cutters)'].filter(name => {
      const enzyme = ENZYME_DB.find(e => e.name === name)!
      return cuttingSites(findCutSites(PUC19_SEQUENCE, enzyme, 'circular')).length === 1
    })
    expect(single.length).toBeGreaterThanOrEqual(10)
  })

  it('has the 589 bp origin', () => {
    const ori = feature('ori')
    expect(ori.end - ori.start).toBe(589)
  })
})
