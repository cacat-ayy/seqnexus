/**
 * Reference values are Biopython's own documented outputs for Tm_NN
 * (Bio/SeqUtils/MeltingTemp.py docstring), for the same sequence, tables and
 * conditions. Biopython's dnac1 = dnac2 = 25 nM is a total of 50 nM, which is
 * this module's Ct/4 convention.
 */
import { describe, it, expect } from 'vitest'
import { duplexTm, duplexThermo, complementStrand } from './duplex'

const SEQ = 'CGTTCCAAAGATGTGGGCATGAGCTTAC'
const PERFECT = complementStrand(SEQ)
const base = { oligoConc: 50, mono: 50, mg: 0, dntp: 0 }

describe('duplexTm against Biopython', () => {
  it('SantaLucia 1998 salt correction: 60.32 °C', () => {
    expect(duplexTm(SEQ, PERFECT, base, 'santalucia1998')).toBeCloseTo(60.32, 2)
  })

  it('Owczarzy 2008 with monovalent salt only falls back to the 2004 formula: 59.78 °C', () => {
    expect(duplexTm(SEQ, PERFECT, base)).toBeCloseTo(59.78, 2)
  })

  it('Owczarzy 2008 with Mg²⁺: 66.81 °C, and 66.04 °C once dNTPs bind some of it', () => {
    // Na 50 + Tris 10/2 = 55 mM monovalent.
    expect(duplexTm(SEQ, PERFECT, { ...base, mono: 55, mg: 1.5 })).toBeCloseTo(66.81, 2)
    expect(duplexTm(SEQ, PERFECT, { ...base, mono: 55, mg: 1.5, dntp: 0.6 })).toBeCloseTo(66.04, 2)
  })

  it('one internal mismatch: 55.39 °C against 60.32 °C matched', () => {
    const partner = 'GCAAGGCTTCTACACCCGTACTCGAATG' // C opposite A at position 7
    expect(duplexTm(SEQ, partner, base, 'santalucia1998')).toBeCloseTo(55.39, 2)
  })
})

describe('duplexThermo', () => {
  it('scores a terminal mismatch from its own table rather than dropping it', () => {
    const matched = duplexThermo('ACGTGCAT', complementStrand('ACGTGCAT'))
    // Last column: T opposite T instead of A.
    const tmm = duplexThermo('ACGTGCAT', complementStrand('ACGTGCA') + 'T')
    expect(tmm.approximate).toBe(false)
    expect(tmm.dH).not.toBeCloseTo(matched.dH, 3)
  })

  it('flags neighbours it has no parameters for', () => {
    // Two mismatches side by side.
    expect(duplexThermo('ACGTGCAT', 'TGCTTGTA').approximate).toBe(true)
  })

  it('refuses strands of different lengths', () => {
    expect(() => duplexThermo('ACGT', 'TGC')).toThrow()
  })
})
