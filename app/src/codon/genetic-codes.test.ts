/**
 * Genetic code tables.
 *
 * The reassignments are the whole point of the module, and a wrong one is
 * invisible until someone's mitochondrial gene comes back truncated, so each
 * table's differences from the standard code are checked explicitly.
 */
import { describe, it, expect } from 'vitest'
import {
  GENETIC_CODES, geneticCode, translateWith, translateCodonWith, synonymsFor,
} from './genetic-codes'
import { CODON_TABLE } from '../utils/codon'

const BASES = 'ACGT'
const ALL_CODONS: string[] = []
for (const a of BASES) for (const b of BASES) for (const c of BASES) ALL_CODONS.push(a + b + c)

describe('tables', () => {
  it('covers all 64 codons in every code', () => {
    for (const code of GENETIC_CODES) {
      expect(Object.keys(code.table)).toHaveLength(64)
      for (const codon of ALL_CODONS) expect(code.table[codon]).toBeTruthy()
    }
  })

  it('is the source of the app-wide standard table', () => {
    expect(geneticCode(1).table).toEqual(CODON_TABLE)
  })

  it('falls back to the standard code for an unknown id', () => {
    expect(geneticCode(999).id).toBe(1)
  })

  it('leaves the bacterial code identical to the standard one', () => {
    // Table 11 differs only in its initiation codons.
    expect(geneticCode(11).table).toEqual(geneticCode(1).table)
    expect(geneticCode(11).starts).toContain('GTG')
  })
})

describe('reassignments', () => {
  const aa = (id: number, codon: string) => geneticCode(id).table[codon]

  it('reads TGA as tryptophan in the mitochondrial codes', () => {
    for (const id of [2, 3, 4, 5, 9, 13, 14, 21, 24]) expect(aa(id, 'TGA')).toBe('W')
    expect(aa(1, 'TGA')).toBe('*')
  })

  it('stops at AGA and AGG in the vertebrate mitochondrial code', () => {
    expect(aa(2, 'AGA')).toBe('*')
    expect(aa(2, 'AGG')).toBe('*')
    expect(aa(2, 'ATA')).toBe('M')
  })

  it('reads AGA and AGG as serine in the invertebrate mitochondrial code', () => {
    expect(aa(5, 'AGA')).toBe('S')
    expect(aa(5, 'AGG')).toBe('S')
  })

  it('reads the leucine CTN box as threonine in the yeast mitochondrial code', () => {
    for (const codon of ['CTT', 'CTC', 'CTA', 'CTG']) expect(aa(3, codon)).toBe('T')
  })

  it('reads the ochre and amber stops as glutamine in ciliates', () => {
    expect(aa(6, 'TAA')).toBe('Q')
    expect(aa(6, 'TAG')).toBe('Q')
    expect(aa(6, 'TGA')).toBe('*')
  })

  it('reassigns CTG per alternative nuclear code', () => {
    expect(aa(12, 'CTG')).toBe('S')
    expect(aa(26, 'CTG')).toBe('A')
  })

  it('handles the odd single-codon codes', () => {
    expect(aa(10, 'TGA')).toBe('C')
    expect(aa(16, 'TAG')).toBe('L')
    expect(aa(22, 'TCA')).toBe('*')
    expect(aa(23, 'TTA')).toBe('*')
    expect(aa(25, 'TGA')).toBe('G')
    expect(aa(24, 'AGG')).toBe('K')
  })
})

describe('translation', () => {
  it('translates and drops a trailing partial codon', () => {
    expect(translateWith(geneticCode(1), 'ATGTGGTGA')).toBe('MW*')
    expect(translateWith(geneticCode(1), 'ATGTGGTG')).toBe('MW')
  })

  it('follows the selected code', () => {
    expect(translateWith(geneticCode(2), 'ATGTGAAGA')).toBe('MW*')
  })

  it('is case insensitive and marks anything unknown', () => {
    expect(translateCodonWith(geneticCode(1), 'atg')).toBe('M')
    expect(translateCodonWith(geneticCode(1), 'ANG')).toBe('?')
  })
})

describe('synonymsFor', () => {
  it('lists every codon for an amino acid under that code', () => {
    expect(synonymsFor(geneticCode(1), 'L').sort())
      .toEqual(['CTA', 'CTC', 'CTG', 'CTT', 'TTA', 'TTG'])
    // Tryptophan gains TGA in the mitochondrial codes.
    expect(synonymsFor(geneticCode(1), 'W')).toEqual(['TGG'])
    expect(synonymsFor(geneticCode(2), 'W').sort()).toEqual(['TGA', 'TGG'])
  })

  it('returns nothing for an amino acid the code cannot make', () => {
    expect(synonymsFor(geneticCode(1), 'X')).toEqual([])
  })

  it('accounts for every codon across all amino acids', () => {
    for (const code of GENETIC_CODES) {
      const residues = new Set(Object.values(code.table))
      const total = [...residues].reduce((n, r) => n + synonymsFor(code, r).length, 0)
      expect(total).toBe(64)
    }
  })
})
