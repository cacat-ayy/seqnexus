import { describe, it, expect } from 'vitest'
import { ENZYME_DB, ENZYME_GROUPS, getEnzyme, recognitionToRegex } from './db'

describe('Enzyme database', () => {
  it('has at least 250 enzymes after REBASE merge', () => {
    expect(ENZYME_DB.length).toBeGreaterThanOrEqual(250)
  })

  it('has no duplicate enzyme names', () => {
    const names = ENZYME_DB.map(e => e.name.toLowerCase())
    const unique = new Set(names)
    expect(unique.size).toBe(names.length)
  })

  it('all enzymes have valid recognition sequences (IUPAC)', () => {
    for (const e of ENZYME_DB) {
      expect(e.recognition).toMatch(/^[ACGTRYSWKMBDHVN]+$/i)
    }
  })

  it('all enzymes have non-negative cut positions', () => {
    for (const e of ENZYME_DB) {
      expect(e.fwd_cut).toBeGreaterThanOrEqual(0)
      expect(e.rev_cut).toBeGreaterThanOrEqual(0)
    }
  })

  it('all enzymes have at least one supplier', () => {
    for (const e of ENZYME_DB) {
      expect(e.suppliers.length).toBeGreaterThanOrEqual(1)
    }
  })

  it('hand-curated enzymes retain methylation data', () => {
    const ecoRI = getEnzyme('EcoRI')!
    expect(ecoRI).toBeDefined()
    expect(ecoRI.dam).toBe('insensitive')
    expect(ecoRI.temperature).toBe(37)
    expect(ecoRI.heatInactivation).toBe(65)
  })

  it('REBASE enzymes are present', () => {
    // AatII is in REBASE but not in the original curated list
    const aatII = getEnzyme('AatII')
    expect(aatII).toBeDefined()
    expect(aatII!.recognition).toBe('GACGTC')
  })

  it('all enzyme groups reference valid enzyme names', () => {
    const allNames = new Set(ENZYME_DB.map(e => e.name))
    for (const [group, names] of Object.entries(ENZYME_GROUPS)) {
      for (const name of names) {
        expect(allNames.has(name), `${name} in group "${group}" not found in ENZYME_DB`).toBe(true)
      }
    }
  })

  it('recognitionToRegex produces valid patterns', () => {
    for (const e of ENZYME_DB) {
      const pattern = recognitionToRegex(e.recognition)
      expect(() => new RegExp(pattern)).not.toThrow()
    }
  })
})

describe('methylation data', () => {
  // A flag only means something if the motif can put a methylated base inside
  // the recognition site. Offsets are the methylated bases on the top strand.
  const MOTIFS = { dam: { motif: 'GATC', methylated: [1, 2] }, dcm: { motif: 'CCWGG', methylated: [1, 3] } }
  const IUPAC_SETS: Record<string, string> = {
    A: 'A', C: 'C', G: 'G', T: 'T', R: 'AG', Y: 'CT', S: 'GC', W: 'AT',
    K: 'GT', M: 'AC', B: 'CGT', D: 'AGT', H: 'ACT', V: 'ACG', N: 'ACGT',
  }
  const compatible = (a: string, b: string) => [...IUPAC_SETS[a]].some(x => IUPAC_SETS[b].includes(x))

  function motifCanReachSite(site: string, motif: string, methylated: number[]): boolean {
    for (let m = -motif.length + 1; m < site.length; m++) {
      if (!methylated.some(o => m + o >= 0 && m + o < site.length)) continue
      let ok = true
      for (let i = 0; i < motif.length && ok; i++) {
        const p = m + i
        if (p >= 0 && p < site.length) ok = compatible(motif[i], site[p].toUpperCase())
      }
      if (ok) return true
    }
    return false
  }

  it('only flags enzymes whose site a methylation motif can overlap', () => {
    for (const e of ENZYME_DB) {
      for (const kind of ['dam', 'dcm'] as const) {
        const flag = e[kind]
        if (flag !== 'blocked' && flag !== 'impaired') continue
        const { motif, methylated } = MOTIFS[kind]
        expect(motifCanReachSite(e.recognition, motif, methylated), `${e.name} ${kind}: ${flag}`).toBe(true)
      }
    }
  })

  it('does not mark BamHI or BglII as dam-sensitive', () => {
    expect(getEnzyme('BamHI')!.dam).toBe('insensitive')
    expect(getEnzyme('BglII')!.dam).toBe('insensitive')
  })
})
