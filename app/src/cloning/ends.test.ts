/**
 * Ends read along the strand that protrudes, which is what makes annealing
 * the ordinary base-pairing test. Writing both ends of a cut as top-strand
 * bases instead and keeping that test is what used to restrict ligation to
 * palindromic overhangs, so most of these cases are about non-palindromic
 * ones.
 */
import { describe, it, expect } from 'vitest'
import { getEnzyme } from '../enzymes/db'
import { findCutSites } from '../enzymes/finder'
import {
  bluntEnd,
  complementaryEnd,
  cutEnds,
  endLabel,
  endsAnneal,
  sealedNicks,
  type End,
} from './ends'

const five = (span: string): End => ({ span, kind: 'five_prime', phosphate: true })
const three = (span: string): End => ({ span, kind: 'three_prime', phosphate: true })

describe('cutEnds', () => {
  it('gives the two pieces of a 5-prime cut ends that read as complements', () => {
    // GAATC cut by HinfI (G^ANT_C) leaves a 3-base 5' overhang: AAT on the
    // right piece's top strand, ATT on the left piece's bottom strand.
    const { left, right } = cutEnds('TTGAATCTT', 3, 6, 'HinfI')
    expect(right).toMatchObject({ span: 'AAT', kind: 'five_prime' })
    expect(left).toMatchObject({ span: 'ATT', kind: 'five_prime' })
    expect(endsAnneal(left, right)).toBe(true)
  })

  it('gives the two pieces of a 3-prime cut ends that read as complements', () => {
    const { left, right } = cutEnds('TTGCATGCTT', 6, 2)
    expect(left.kind).toBe('three_prime')
    expect(right.kind).toBe('three_prime')
    // The top strand protrudes on the left piece and the bottom strand on
    // the right one, so the two spans read as complements.
    expect(left.span).toBe('GCAT')
    expect(right.span).toBe('ATGC')
    expect(endsAnneal(left, right)).toBe(true)
  })

  it('reads an overhang that straddles the origin the short way round', () => {
    // Cuts at 198 and 2 on a 200-mer: a 4-base overhang across the origin,
    // not a 196-base one the other way.
    const bases = 'AT'.repeat(98) + 'ACGG' + ''
    const ends = cutEnds(bases.slice(0, 200), 198, 2, 'BsaI', true)
    expect(ends.right.span).toHaveLength(4)
    expect(ends.right.kind).toBe('five_prime')
  })

  it('marks a cut with both strands broken in one place as blunt', () => {
    const { left, right } = cutEnds('TTGATATCTT', 5, 5, 'EcoRV')
    expect(left.kind).toBe('blunt')
    expect(right.kind).toBe('blunt')
    expect(left.span).toBe('')
  })

  it('agrees with the cut positions the enzyme finder reports', () => {
    const EcoRI = getEnzyme('EcoRI')!
    const bases = 'TTTT' + 'GAATTC' + 'TTTT'
    const [site] = findCutSites(bases, EcoRI, 'linear')
    const { left, right } = cutEnds(bases, site.fwdCut, site.revCut, EcoRI.name)
    expect(right.span).toBe('AATT')
    expect(endsAnneal(left, right)).toBe(true)
  })
})

describe('endsAnneal', () => {
  it('joins non-palindromic overhangs that are complements', () => {
    // The case the old rule got wrong: a 4-base Type IIS overhang.
    expect(endsAnneal(five('AATG'), five('CATT'))).toBe(true)
    expect(endsAnneal(five('GCTT'), five('AAGC'))).toBe(true)
  })

  it('refuses non-palindromic overhangs that are merely equal', () => {
    expect(endsAnneal(five('AATG'), five('AATG'))).toBe(false)
  })

  it('joins a palindromic overhang to itself', () => {
    expect(endsAnneal(five('AATT'), five('AATT'))).toBe(true)
    expect(endsAnneal(five('GATC'), five('GATC'))).toBe(true)
  })

  it('keeps 5-prime and 3-prime ends apart', () => {
    expect(endsAnneal(five('AATG'), three('CATT'))).toBe(false)
  })

  it('joins blunt to blunt only', () => {
    expect(endsAnneal(bluntEnd(), bluntEnd())).toBe(true)
    expect(endsAnneal(bluntEnd(), five('AATT'))).toBe(false)
  })

  it('refuses overhangs of different length', () => {
    expect(endsAnneal(five('AAT'), five('CATT'))).toBe(false)
  })

  it('refuses an overhang with an ambiguous base, which might not pair', () => {
    expect(endsAnneal(five('AANG'), five('CNTT'))).toBe(false)
  })
})

describe('sealedNicks', () => {
  it('seals both strands when both ends carry a phosphate', () => {
    expect(sealedNicks(five('AATG'), five('CATT'))).toBe(2)
  })

  it('seals one strand when only one end does', () => {
    expect(sealedNicks({ ...five('AATG'), phosphate: false }, five('CATT'))).toBe(1)
  })

  it('seals neither when both have been dephosphorylated', () => {
    expect(sealedNicks(
      { ...five('AATG'), phosphate: false },
      { ...five('CATT'), phosphate: false },
    )).toBe(0)
  })
})

describe('reading ends', () => {
  it('names an end by its protruding strand', () => {
    expect(endLabel(five('AATT'))).toBe("5'-AATT")
    expect(endLabel(three('TGCA'))).toBe("3'-TGCA")
    expect(endLabel(bluntEnd())).toBe('blunt')
  })

  it('turns an end into the one it pairs with, and back', () => {
    const end = five('AATG')
    const partner = complementaryEnd(end)
    expect(partner.span).toBe('CATT')
    expect(endsAnneal(end, partner)).toBe(true)
    expect(complementaryEnd(partner).span).toBe('AATG')
  })
})
