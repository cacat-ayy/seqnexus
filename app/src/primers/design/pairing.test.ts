import { describe, it, expect } from 'vitest'
import { evaluatePair, crossDimerScore } from './pairing'
import { reverseComplement } from '../scoring'

const ctx = { minProductSize: 100, maxProductSize: 500 }
const oligo = (sequence: string, tm = 60) => ({ sequence, tm, penalty: 1 })

describe('evaluatePair', () => {
  it('adds the pair terms to both primers\' own penalties', () => {
    const e = evaluatePair(oligo('ACGTACGTTGCAAGCTAGCA', 60), oligo('TTGACCGATGCATCGGATCA', 61), 300, ctx)
    const pairTerms = e.terms.reduce((s, t) => s + t.penalty, 0)
    expect(e.penalty).toBeCloseTo(2 + pairTerms, 6)
    expect(e.tmDiff).toBeCloseTo(1, 6)
  })

  it('warns about a Tm gap and a product outside the range', () => {
    const e = evaluatePair(oligo('ACGTACGTTGCAAGCTAGCA', 55), oligo('TTGACCGATGCATCGGATCA', 63), 900, ctx)
    expect(e.warnings.some(w => /Tms differ/.test(w))).toBe(true)
    expect(e.warnings.some(w => /outside 100–500/.test(w))).toBe(true)
  })
})

describe('crossDimerScore', () => {
  // The old finder looked at the reverse primer's 5' end when it meant its
  // 3' end, so this dimer went unpenalised.
  it('catches a dimer on the second primer\'s 3′ end', () => {
    const a = 'GATCCTAGGTCAAGTCCATG'
    // b ends (3') with the reverse complement of a's first 6 bases, so b's
    // 3' end pairs with the middle-to-5' part of a, away from a's 3' end.
    const b = 'TTTTTTTTTTTTTT' + reverseComplement(a.slice(0, 6))
    expect(crossDimerScore(a, b).endRun).toBeGreaterThanOrEqual(3)
  })

  it('does not flag two unrelated primers', () => {
    const r = crossDimerScore('ACACACACACACACACACAC', 'ACACACACACACACACACAC')
    expect(r.endRun).toBeLessThan(3)
  })
})
