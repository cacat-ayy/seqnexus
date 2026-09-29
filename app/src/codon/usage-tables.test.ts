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
  bestCodons, deriveFromCds, unusableResidues, DEFAULT_USAGE_TABLE_ID,
} from './usage-tables'
import { geneticCode, synonymsFor } from './genetic-codes'
import { Sequence } from '../models/Sequence'
import { Annotation } from '../models/Annotation'

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

describe('deriveFromCds', () => {
  /** ATG GGT GGT TAA on the plus strand at 0..12. */
  const bases = 'ATGGGTGGTTAA' + 'CCCCCC'
  const seq = () => new Sequence(bases, 'linear')

  const cds = (over: Partial<{ start: number; end: number; strand: 1 | -1; qualifiers: Record<string, string[]> }> = {}) =>
    new Annotation({
      id: 'a1', name: 'test', type: 'CDS', start: 0, end: 12, strand: 1, ...over,
    })

  it('counts codons off the coding strand', () => {
    const derived = deriveFromCds([cds()], seq(), standard)!
    expect(derived.codonsCounted).toBe(4)
    expect(derived.featuresUsed).toBe(1)
    // Glycine seen only as GGT.
    expect(derived.table.fractions.GGT).toBe(1)
    expect(derived.table.fractions.GGC).toBe(0)
  })

  it('reads a minus-strand feature in its own orientation', () => {
    // Reverse complement of ATGGGTGGTTAA is TTAACCACCCAT, so a minus-strand
    // feature over those bases codes for the same protein.
    const rc = new Sequence('TTAACCACCCAT', 'linear')
    const derived = deriveFromCds(
      [new Annotation({ id: 'a', name: 'r', type: 'CDS', start: 0, end: 12, strand: -1 })],
      rc, standard,
    )!
    expect(derived.table.fractions.GGT).toBe(1)
  })

  it('honours /codon_start', () => {
    const shifted = new Sequence('CATGGGTGGTTAA', 'linear')
    const derived = deriveFromCds(
      [new Annotation({
        id: 'a', name: 'c', type: 'CDS', start: 0, end: 13, strand: 1,
        qualifiers: { codon_start: ['2'] },
      })],
      shifted, standard,
    )!
    expect(derived.table.fractions.GGT).toBe(1)
  })

  it('spreads families it never saw rather than zeroing them', () => {
    const derived = deriveFromCds([cds()], seq(), standard)!
    // No leucine in the input: all six codons share the family evenly.
    expect(derived.table.fractions.CTG).toBeCloseTo(1 / 6, 6)
  })

  it('ignores overlay annotations and returns null with nothing to count', () => {
    const orf = new Annotation({ id: '_orf_1:0:12:1', name: 'ORF', type: 'CDS', start: 0, end: 12, strand: 1 })
    expect(deriveFromCds([orf], seq(), standard)).toBeNull()
    expect(deriveFromCds([], seq(), standard)).toBeNull()
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
