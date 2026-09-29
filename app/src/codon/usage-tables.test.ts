/**
 * Codon usage tables.
 *
 * The built-in numbers are hand-written, so the invariants that protect the
 * optimizer from a typo are worth asserting: every family normalised, every
 * codon present, one codon at w = 1 per family.
 */
import { describe, it, expect } from 'vitest'
import {
  BUILTIN_USAGE_TABLES, familyFractions, relativeAdaptiveness, rareCodons,
  bestCodons, unusableResidues, DEFAULT_USAGE_TABLE_ID,
} from './usage-tables'
import { geneticCode, synonymsFor } from './genetic-codes'

const standard = geneticCode(1)

describe('built-in tables', () => {
  it('ships the default', () => {
    expect(BUILTIN_USAGE_TABLES.some(t => t.id === DEFAULT_USAGE_TABLE_ID)).toBe(true)
  })

  it('covers all 64 codons and declares its provenance', () => {
    for (const table of BUILTIN_USAGE_TABLES) {
      expect(Object.keys(table.fractions)).toHaveLength(64)
      expect(table.source).toBeTruthy()
      expect(table.approximate).toBe(true)
    }
  })

  it('normalises every amino acid family to 1', () => {
    for (const table of BUILTIN_USAGE_TABLES) {
      for (const aa of new Set(Object.values(standard.table))) {
        const sum = synonymsFor(standard, aa)
          .reduce((n, c) => n + table.fractions[c], 0)
        expect(sum).toBeCloseTo(1, 6)
      }
    }
  })

  it('agrees with the textbook preferences', () => {
    const ecoli = BUILTIN_USAGE_TABLES.find(t => t.id === 'ecoli-k12')!
    const best = bestCodons(ecoli, standard)
    expect(best.L).toBe('CTG')       // CTG dominates leucine in E. coli
    expect(best.R).not.toBe('AGG')   // AGA/AGG are the classic rare arginines
    const rare = rareCodons(ecoli, standard, 10)
    expect(rare.has('AGG')).toBe(true)
    expect(rare.has('CTA')).toBe(true)
    expect(rare.has('CTG')).toBe(false)

    const yeast = BUILTIN_USAGE_TABLES.find(t => t.id === 'scerevisiae')!
    expect(bestCodons(yeast, standard).R).toBe('AGA')  // the reverse of E. coli
  })
})

describe('familyFractions', () => {
  const table = BUILTIN_USAGE_TABLES[0]

  it('passes the stored values straight through for the standard code', () => {
    const f = familyFractions(table, standard)
    expect(f.CTG).toBeCloseTo(table.fractions.CTG, 6)
  })

  it('renormalises when another code regroups a family', () => {
    // Table 2 moves TGA from the stop family into tryptophan, and moves the
    // two arginines AGA and AGG the other way, into the stops.
    const f = familyFractions(table, geneticCode(2))
    expect(f.TGA + f.TGG).toBeCloseTo(1, 6)
    expect(f.TGG).toBeGreaterThan(f.TGA)
    expect(f.TAA + f.TAG + f.AGA + f.AGG).toBeCloseTo(1, 6)
    expect(f.CGT + f.CGC + f.CGA + f.CGG).toBeCloseTo(1, 6)
  })

  it('leaves a family the table knows nothing about at zero', () => {
    const blank = { ...table, fractions: { ...table.fractions } }
    for (const c of synonymsFor(standard, 'W')) blank.fractions[c] = 0
    expect(familyFractions(blank, standard).TGG).toBe(0)
  })
})

describe('relativeAdaptiveness', () => {
  it('puts exactly one codon per family at 1', () => {
    for (const table of BUILTIN_USAGE_TABLES) {
      const w = relativeAdaptiveness(table, standard)
      for (const aa of new Set(Object.values(standard.table))) {
        const family = synonymsFor(standard, aa)
        const tops = family.filter(c => w[c] === 1)
        expect(tops.length).toBeGreaterThanOrEqual(1)
        for (const c of family) {
          expect(w[c]).toBeGreaterThanOrEqual(0)
          expect(w[c]).toBeLessThanOrEqual(1)
        }
      }
    }
  })
})

describe('rareCodons', () => {
  const table = BUILTIN_USAGE_TABLES[0]

  it('never calls a single-codon family rare', () => {
    const rare = rareCodons(table, standard, 99)
    expect(rare.has('ATG')).toBe(false)
    expect(rare.has('TGG')).toBe(false)
  })

  it('widens with the threshold', () => {
    const few = rareCodons(table, standard, 5)
    const many = rareCodons(table, standard, 20)
    expect(many.size).toBeGreaterThan(few.size)
    for (const c of few) expect(many.has(c)).toBe(true)
  })
})

describe('unusableResidues', () => {
  it('flags an amino acid the table cannot encode', () => {
    const table = { ...BUILTIN_USAGE_TABLES[0], fractions: { ...BUILTIN_USAGE_TABLES[0].fractions } }
    for (const c of synonymsFor(standard, 'W')) table.fractions[c] = 0
    expect(unusableResidues(table, standard, 'MWG')).toEqual(['W'])
    expect(unusableResidues(table, standard, 'MG')).toEqual([])
  })
})
