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
