import { describe, it, expect } from 'vitest'
import { PROTEASES, protease, cleavageSites, digest, coverage } from './proteolysis'

const P = (id: string) => protease(id)!

describe('cleavageSites', () => {
  it('trypsin cuts after K and R but not before P', () => {
    expect(cleavageSites('AKAPRAKPA', P('trypsin'))).toEqual([2, 5])
  })

  it('never cuts at the ends', () => {
    expect(cleavageSites('KAAK', P('trypsin'))).toEqual([1])
    expect(cleavageSites('K', P('trypsin'))).toEqual([])
  })

  it('Asp-N cuts before Asp', () => {
    expect(cleavageSites('AADAD', P('asp-n'))).toEqual([2, 4])
  })

  it('pepsin at pH 1.3 refuses a Pro at P2 or P1 prime', () => {
    expect(cleavageSites('AFAA', P('pepsin'))).toEqual([2])
    expect(cleavageSites('PFAA', P('pepsin'))).toEqual([])
    expect(cleavageSites('AFPA', P('pepsin'))).toEqual([])
  })

  it('TEV cuts after ENLYFQ before G or S only', () => {
    expect(cleavageSites('MENLYFQGAA', P('tev'))).toEqual([7])
    expect(cleavageSites('MENLYFQAAA', P('tev'))).toEqual([])
  })

  it('Factor Xa takes IEGR and IDGR', () => {
    expect(cleavageSites('AIEGRAIDGRA', P('factor-xa'))).toEqual([5, 10])
  })

  it('every protease is defined by a rule or a site', () => {
    for (const p of PROTEASES) expect(!!p.p1 || !!p.before || !!p.site, p.id).toBe(true)
  })
})

describe('digest', () => {
  it('splits at the sites and keeps the order', () => {
    const peps = digest('MKAAARGGGK', [P('trypsin')])
    expect(peps.map(p => p.sequence)).toEqual(['MK', 'AAAR', 'GGGK'])
    expect(peps.map(p => [p.start, p.end])).toEqual([[0, 2], [2, 6], [6, 10]])
    expect(peps.every(p => p.missed === 0)).toBe(true)
  })

  it('adds the partials of missed cleavages', () => {
    const peps = digest('MKAAARGGGK', [P('trypsin')], { missedCleavages: 1 })
    expect(peps.map(p => p.sequence)).toEqual(['MK', 'MKAAAR', 'AAAR', 'AAARGGGK', 'GGGK'])
    expect(peps.filter(p => p.missed === 1).map(p => p.sequence)).toEqual(['MKAAAR', 'AAARGGGK'])
  })

  it('pools the sites of several proteases', () => {
    const peps = digest('MKADAR', [P('trypsin'), P('asp-n')])
    expect(peps.map(p => p.sequence)).toEqual(['MK', 'A', 'DAR'])
  })

  it('computes masses and m/z from the monoisotopic mass', () => {
    const [pep] = digest('GGGGK', [P('trypsin')])
    // Gly 57.02146 x4 + Lys 128.09496 + water 18.01056
    expect(pep.mono).toBeCloseTo(374.19, 1)
    expect(pep.mz[0]).toBeCloseTo(375.2, 1)
    expect(pep.mz[1]).toBeCloseTo((pep.mono + 2 * 1.007276) / 2, 4)
    expect(pep.pI).not.toBeNull()
  })

  it('an uncut protein is one peptide, and an empty one none', () => {
    expect(digest('AAAA', [P('trypsin')])).toHaveLength(1)
    expect(digest('', [P('trypsin')])).toEqual([])
  })
})

describe('coverage', () => {
  it('is the fraction of residues inside a peptide', () => {
    expect(coverage([{ start: 0, end: 5 } as never, { start: 3, end: 8 } as never], 10)).toBe(0.8)
    expect(coverage([], 10)).toBe(0)
  })
})
