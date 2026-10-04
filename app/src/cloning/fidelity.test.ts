/**
 * The fidelity model has to agree with what the ligase fidelity work found,
 * at least in its ordering: wobble mispairs are the dangerous ones, mismatches
 * in the middle of an overhang are fatal, and a palindromic overhang is always
 * a mistake. The chooser then has to produce a set with no such problems.
 */
import { describe, it, expect } from 'vitest'
import { reverseComplement } from '../models/complement'
import {
  chooseOverhangSet,
  crossReactivity,
  fidelityWarnings,
  isPalindromic,
  setFidelity,
} from './fidelity'

describe('crossReactivity', () => {
  it('scores the intended pair as a perfect match', () => {
    expect(crossReactivity('AATG', reverseComplement('AATG'))).toBe(1)
  })

  it('ranks a wobble mispair above the other mismatches', () => {
    // Both put one mismatch at the same inner position of AGTG: against CATT
    // the G sits opposite a T, which is the wobble; against CAGT it sits
    // opposite another G.
    expect(crossReactivity('AGTG', 'CATT')).toBeGreaterThan(crossReactivity('AGTG', 'CAGT'))
  })

  it('tolerates a mismatch at the end far better than in the middle', () => {
    // The same G:T wobble, once at the outer position and once inside.
    const atEnd = crossReactivity('AGTG', 'TACT')
    const inMiddle = crossReactivity('AGTG', 'CATT')
    expect(atEnd).toBeGreaterThan(inMiddle)
  })

  it('refuses a pair that disagrees almost everywhere', () => {
    expect(crossReactivity('AAAA', reverseComplement('CGCG'))).toBe(0)
  })

  it('refuses overhangs of different lengths', () => {
    expect(crossReactivity('AAT', 'CATT')).toBe(0)
  })
})

describe('isPalindromic', () => {
  it('spots an overhang that pairs with itself', () => {
    expect(isPalindromic('AATT')).toBe(true)
    expect(isPalindromic('GATC')).toBe(true)
  })

  it('leaves a normal overhang alone', () => {
    expect(isPalindromic('AATG')).toBe(false)
  })
})

describe('setFidelity', () => {
  it('gives a clean set a high score', () => {
    // Four overhangs chosen to differ throughout.
    const set = chooseOverhangSet(4)
    expect(setFidelity(set).fidelity).toBeGreaterThan(0.95)
  })

  it('marks down a set holding an overhang close to another\'s partner', () => {
    // AATG is meant to meet CATT. TATT presents AATA, which differs from AATG
    // only by a wobble at the outer position, so the two will cross-react.
    const risky = setFidelity(['AATG', 'TATT'])
    const clean = setFidelity(chooseOverhangSet(2))
    expect(risky.fidelity).toBeLessThan(clean.fidelity)
    expect(risky.risks.length).toBeGreaterThan(0)
  })

  it('reports a palindromic overhang and a repeated one', () => {
    const result = setFidelity(['AATT', 'AATG', 'AATG'])
    expect(result.palindromic).toContain('AATT')
    expect(result.duplicated).toContain('AATG')
  })

  it('names the pair that will cross-react', () => {
    const result = setFidelity(['AATG', 'TATT'])
    expect(result.risks[0].propensity).toBeGreaterThan(0.1)
    expect([result.risks[0].from, result.risks[0].to].sort()).toEqual(['AATG', 'TATT'])
  })
})

describe('fidelityWarnings', () => {
  it('says nothing about a well-chosen set', () => {
    expect(fidelityWarnings(chooseOverhangSet(5))).toEqual([])
  })

  it('explains a palindromic overhang in plain words', () => {
    expect(fidelityWarnings(['AATT', 'CGAA']).join(' ')).toContain('ligates to itself')
  })

  it('explains a repeated overhang', () => {
    expect(fidelityWarnings(['AATG', 'AATG']).join(' ')).toContain('more than once')
  })
})

describe('chooseOverhangSet', () => {
  it('produces as many overhangs as asked for', () => {
    expect(chooseOverhangSet(6)).toHaveLength(6)
  })

  it('never includes a palindrome or a repeat', () => {
    const set = chooseOverhangSet(8)
    expect(set.filter(isPalindromic)).toEqual([])
    expect(new Set(set).size).toBe(set.length)
  })

  it('never hands out an overhang and its own partner', () => {
    const set = chooseOverhangSet(8)
    for (const seq of set) {
      expect(set).not.toContain(reverseComplement(seq))
    }
  })

  it('keeps overhangs the design already fixes', () => {
    const set = chooseOverhangSet(5, { include: ['AATG', 'GCTT'] })
    expect(set.slice(0, 2)).toEqual(['AATG', 'GCTT'])
    expect(set).toHaveLength(5)
    expect(setFidelity(set).fidelity).toBeGreaterThan(0.9)
  })

  it('stays away from overhangs it is told to avoid', () => {
    const set = chooseOverhangSet(6, { exclude: ['AATG', 'GCTT', 'TACT'] })
    expect(set).not.toContain('AATG')
    expect(set).not.toContain('GCTT')
  })

  it('holds its score as the set grows', () => {
    // A bigger set has more chances to go wrong, but should stay usable.
    expect(setFidelity(chooseOverhangSet(10)).fidelity).toBeGreaterThan(0.9)
  })

  it('agrees that the MoClo fusion sites are a reasonable set', () => {
    // The standard overhangs used across MoClo level 0 parts.
    const moclo = ['AATG', 'GCTT', 'TTCG', 'CCAT', 'AGGT']
    const result = setFidelity(moclo)
    expect(result.palindromic).toEqual([])
    expect(result.fidelity).toBeGreaterThan(0.9)
  })
})
