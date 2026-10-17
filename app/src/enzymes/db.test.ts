import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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

  it('every cut falls near its site', () => {
    // Cuts can lie outside the site (Type IIS past its end, TspRI's bottom
    // strand 2 before its start, Type IIB on both sides), but never far.
    for (const e of ENZYME_DB) {
      const n = e.recognition.length
      for (const c of [e.fwd_cut, e.rev_cut, e.fwd_cut2, e.rev_cut2]) {
        if (c === undefined) continue
        expect(c, e.name).toBeGreaterThanOrEqual(-20)
        expect(c, e.name).toBeLessThanOrEqual(n + 35)
      }
      expect(e.fwd_cut2 === undefined, `${e.name} has both or neither second cut`).toBe(e.rev_cut2 === undefined)
    }
  })

  it('every overhang matches its cut pair', () => {
    for (const e of ENZYME_DB) {
      const expected = e.fwd_cut === e.rev_cut ? 'blunt' : e.fwd_cut < e.rev_cut ? '5prime' : '3prime'
      expect(e.overhang, e.name).toBe(expected)
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

describe('methylation data from REBASE', () => {
  const rebase: Record<string, { dam?: string; dcm?: string }> = JSON.parse(
    readFileSync(join(__dirname, '../../scripts/data/rebase-methylation.json'), 'utf8'),
  ).enzymes

  it('every enzyme with a REBASE verdict carries it', () => {
    for (const [name, verdict] of Object.entries(rebase)) {
      const e = getEnzyme(name)
      if (!e) continue
      for (const kind of ['dam', 'dcm'] as const) {
        if (!verdict[kind]) continue
        // DpnI cuts Dam-methylated DNA, which REBASE files under "cut";
        // the database says it needs the methylation.
        if (name === 'DpnI' && kind === 'dam') { expect(e.dam).toBe('required'); continue }
        expect(e[kind], `${name} ${kind}`).toBe(verdict[kind])
      }
    }
  })

  it('marks the enzymes a cloner trips over', () => {
    expect(getEnzyme('BclI')!.dam).toBe('blocked')
    expect(getEnzyme('TaqI')!.dam).toBe('blocked')
    expect(getEnzyme('NruI')!.dam).toBe('blocked')
    expect(getEnzyme('StuI')!.dcm).toBe('blocked')
    expect(getEnzyme('BsaI')!.dcm).toBe('impaired')
  })
})
