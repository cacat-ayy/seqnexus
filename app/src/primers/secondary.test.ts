import { describe, it, expect } from 'vitest'
import { hairpinLoopDG, hairpinTm, selfDimerTm, structureGrade } from './secondary'
import { duplexTm, complementStrand } from './thermo/duplex'

const NA50 = { oligoConc: 250, mono: 50, mg: 0, dntp: 0 }

describe('hairpinLoopDG', () => {
  it('reads the SantaLucia & Hicks table and interpolates between entries', () => {
    expect(hairpinLoopDG(3)).toBe(3.5)
    expect(hairpinLoopDG(6)).toBe(4.0)
    expect(hairpinLoopDG(11)).toBeCloseTo(4.8, 6)
    expect(hairpinLoopDG(30)).toBe(6.3)
  })

  it('grows logarithmically past 30 bases', () => {
    expect(hairpinLoopDG(60)).toBeCloseTo(6.3 + 2.44 * 1.987e-3 * 310.15 * Math.log(2), 6)
  })
})

describe('hairpinTm', () => {
  it('matches the model worked by hand for a GC stem around a 4-base loop', () => {
    // GCGCG AAAA CGCGC: 5 bp stem, 4-base loop.
    const h = hairpinTm('GCGCGAAAACGCGC', NA50)!
    expect(h.stem).toBe(5)
    expect(h.loop).toBe(4)
    expect(h.dotBracket).toBe('(((((....)))))')
    expect(h.threePrime).toBe(true)
    // Stem: 2 × GC/CG (−9.8, −24.4) + 2 × CG/GC (−10.6, −27.2);
    // terminal mismatch GA/CA (−8.0, −22.5); loop 3.5 kcal as entropy.
    const dH = 2 * -9.8 + 2 * -10.6 - 8.0
    const dS = 2 * -24.4 + 2 * -27.2 - 22.5 - 3500 / 310.15
    const tm1M = (1000 * dH) / dS
    const lnNa = Math.log(0.05)
    const corr = (4.29 * 1 - 3.95) * 1e-5 * lnNa + 9.4e-6 * lnNa ** 2
    expect(h.tm).toBeCloseTo(1 / (1 / tm1M + corr) - 273.15, 6)
    expect(h.tm).toBeGreaterThan(70)
    expect(h.tm).toBeLessThan(78)
  })

  it('does not depend on oligo concentration: the fold is unimolecular', () => {
    const seq = 'ATGCGCGAAAACGCGCTTA'
    expect(hairpinTm(seq, { ...NA50, oligoConc: 50 })!.tm)
      .toBeCloseTo(hairpinTm(seq, { ...NA50, oligoConc: 1000 })!.tm, 9)
  })

  it('finds nothing in an oligo that cannot fold', () => {
    expect(hairpinTm('AAAAAAAAAAAAAAAAAAAA', NA50)).toBeNull()
  })

  it('ranks a short AT stem far below a GC one', () => {
    const at = hairpinTm('AATAAAAATTAC', NA50)
    const gc = hairpinTm('GCGCGAAAACGCGC', NA50)!
    expect(at === null || at.tm < gc.tm - 30).toBe(true)
  })
})

describe('selfDimerTm', () => {
  it('scores a fully self-complementary oligo as that duplex at K = 1/Ct', () => {
    const seq = 'GGAATTCC'
    const d = selfDimerTm(seq, NA50)!
    expect(d.stretch).toEqual([seq, complementStrand(seq)])
    expect(d.tm).toBeCloseTo(duplexTm(seq, complementStrand(seq), { ...NA50, oligoConc: 1000 }), 9)
  })

  it('rises with oligo concentration: the dimer is bimolecular', () => {
    const seq = 'ACGTGAATTCACGAGT'
    expect(selfDimerTm(seq, { ...NA50, oligoConc: 1000 })!.tm)
      .toBeGreaterThan(selfDimerTm(seq, { ...NA50, oligoConc: 50 })!.tm)
  })

  it('finds nothing when no 3 bp run pairs', () => {
    expect(selfDimerTm('AAAAAAAA', NA50)).toBeNull()
  })
})

describe('structureGrade', () => {
  it('bands the margin below the annealing Tm', () => {
    expect(structureGrade(null, 60, false)).toBe('good')
    expect(structureGrade(40, 60, false)).toBe('good')
    expect(structureGrade(50, 60, false)).toBe('ok')
    expect(structureGrade(57, 60, false)).toBe('poor')
  })

  it('marks a structure that pairs the 3′ end one grade worse', () => {
    expect(structureGrade(40, 60, true)).toBe('ok')
    expect(structureGrade(50, 60, true)).toBe('poor')
  })
})
