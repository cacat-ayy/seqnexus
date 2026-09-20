import { describe, it, expect } from 'vitest'
import { calcTm, gcFraction, gcPercent, nnParams, deltaG37 } from './thermodynamics'

describe('gcFraction / gcPercent', () => {
  it('computes GC fraction correctly', () => {
    expect(gcFraction('ATGC')).toBe(0.5)
    expect(gcFraction('AAAA')).toBe(0)
    expect(gcFraction('GGCC')).toBe(1)
    expect(gcFraction('ATGCGC')).toBeCloseTo(0.667, 2)
  })

  it('computes GC percent correctly', () => {
    expect(gcPercent('ATGC')).toBe(50)
    expect(gcPercent('GGCC')).toBe(100)
  })
})

describe('nnParams', () => {
  it('returns enthalpy and entropy for a short sequence', () => {
    const { dH, dS } = nnParams('ATGC')
    // Should include initiation + 3 dinucleotide steps (AT, TG, GC)
    expect(dH).toBeLessThan(0)
    expect(dS).toBeLessThan(0)
  })

  it('is symmetric for reverse complement pairs', () => {
    // AA and TT should give the same NN parameters
    const aa = nnParams('AA')
    const tt = nnParams('TT')
    expect(aa.dH).toBe(tt.dH)
    expect(aa.dS).toBe(tt.dS)
  })
})

describe('calcTm', () => {
  it('returns NaN for sequences shorter than 2 bases', () => {
    expect(calcTm('A')).toBeNaN()
    expect(calcTm('')).toBeNaN()
  })

  it('computes reasonable Tm for a 20-mer', () => {
    // A typical 20-mer with ~50% GC should have Tm around 55-65°C
    const tm = calcTm('ATGCGATCGAATGCGATCGA')
    expect(tm).toBeGreaterThan(45)
    expect(tm).toBeLessThan(75)
  })

  it('GC-rich sequences have higher Tm', () => {
    const tmAT = calcTm('AATTAATTAATTAATTAATT') // AT-rich
    const tmGC = calcTm('GGCCGGCCGGCCGGCCGGCC') // GC-rich
    expect(tmGC).toBeGreaterThan(tmAT)
  })

  it('longer sequences have higher Tm', () => {
    const short = calcTm('ATGCGATCGA')       // 10-mer
    const long = calcTm('ATGCGATCGAATGCGATCGA') // 20-mer
    expect(long).toBeGreaterThan(short)
  })

  it('higher salt concentration increases Tm', () => {
    const seq = 'ATGCGATCGAATGCGATCGA'
    const tmLowSalt = calcTm(seq, 250, 10)
    const tmHighSalt = calcTm(seq, 250, 200)
    expect(tmHighSalt).toBeGreaterThan(tmLowSalt)
  })

  it('higher primer concentration increases Tm', () => {
    const seq = 'ATGCGATCGAATGCGATCGA'
    const tmLowConc = calcTm(seq, 50, 50)
    const tmHighConc = calcTm(seq, 1000, 50)
    expect(tmHighConc).toBeGreaterThan(tmLowConc)
  })

  it('matches expected Tm for well-known sequences', () => {
    // M13 forward primer: TGTAAAACGACGGCCAGT (18-mer, ~50% GC)
    // Expected Tm ~55-58°C at 50mM Na+, 250nM primer
    const tm = calcTm('TGTAAAACGACGGCCAGT', 250, 50)
    expect(tm).toBeGreaterThan(50)
    expect(tm).toBeLessThan(65)
  })
})

describe('deltaG37', () => {
  it('returns negative ΔG for stable duplexes', () => {
    const dg = deltaG37('GCGCG')
    expect(dg).toBeLessThan(0)
  })

  it('GC-rich sequences are more stable (more negative ΔG)', () => {
    const dgAT = deltaG37('AAATT')
    const dgGC = deltaG37('GGGCC')
    expect(dgGC).toBeLessThan(dgAT)
  })
})
