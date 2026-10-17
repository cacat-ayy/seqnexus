/**
 * A pair of oligos is what a short insert really is, so the ends it offers
 * have to come out of the two strands rather than be stated.
 */
import { describe, it, expect } from 'vitest'
import { annealOligos, duplexFragment, duplexLines } from './duplex'
import { endsAnneal } from './ends'
import { bottomStrand, coreOf, extentOf } from './fragment'
import { reverseComplement } from '../models/complement'

// The standard lentiCRISPRv2 guide pair, ordered as the protocol writes it:
// CACCG ahead of the guide on the top oligo, AAAC ahead of its complement on
// the bottom one, with a trailing C. The G and that C pair with each other,
// so the duplex is 21 bp with CACC and AAAC as its 4-base overhangs, which
// is what BsmBI leaves in the vector.
const GUIDE = 'GTCAGCATGCATCGAGTTAC'
const TOP = `CACCG${GUIDE}`
const BOTTOM = `AAAC${reverseComplement(GUIDE)}C`
const CORE = `G${GUIDE}`

describe('annealing two oligos', () => {
  it('reads the overhangs a guide pair leaves', () => {
    const d = annealOligos({ top: TOP, bottom: BOTTOM })
    expect(d.warnings).toEqual([])
    expect(d.mismatches).toBe(0)
    // Both ends are 5' overhangs, as a pair of oligos annealed in the middle
    // must be, and each is written along the strand that protrudes.
    expect(d.left).toMatchObject({ kind: 'five_prime', span: 'CACC', phosphate: false })
    expect(d.right).toMatchObject({ kind: 'five_prime', span: 'AAAC', phosphate: false })
    expect(d.core).toBe(CORE.length)
  })

  it('leaves ends that fit the vector the guide goes into', () => {
    const { left, right } = annealOligos({ top: TOP, bottom: BOTTOM })
    // The vector offers the complements of those overhangs.
    const vectorLeft = { span: reverseComplement('CACC'), kind: 'five_prime' as const, phosphate: true }
    const vectorRight = { span: reverseComplement('AAAC'), kind: 'five_prime' as const, phosphate: true }
    expect(endsAnneal(left, vectorLeft)).toBe(true)
    expect(endsAnneal(right, vectorRight)).toBe(true)
  })

  it('gives a blunt duplex when the two strands are exact complements', () => {
    const d = annealOligos({ top: GUIDE, bottom: reverseComplement(GUIDE) })
    expect(d.left.kind).toBe('blunt')
    expect(d.right.kind).toBe('blunt')
    expect(d.core).toBe(GUIDE.length)
    expect(d.warnings).toEqual([])
  })

  it('reads a 3’ overhang when one strand reaches past the other', () => {
    // The top strand is longer at both ends, so both protrusions are its own:
    // its 5' end on the left, its 3' end on the right.
    const d = annealOligos({ top: `TT${GUIDE}AAA`, bottom: reverseComplement(GUIDE) })
    expect(d.left).toMatchObject({ kind: 'five_prime', span: 'TT' })
    expect(d.right).toMatchObject({ kind: 'three_prime', span: 'AAA' })
  })

  it('says so when the oligos do not anneal at all', () => {
    // The bottom strand given in the same sense as the top one, a standing
    // mistake, pairs with nothing.
    const d = annealOligos({ top: GUIDE, bottom: GUIDE })
    expect(d.warnings.join(' ')).toContain('do not anneal')
  })

  it('reports a mismatch rather than hiding it', () => {
    const wrong = reverseComplement(GUIDE).replace(/^./, 'A')
    const d = annealOligos({ top: GUIDE, bottom: wrong })
    expect(d.mismatches).toBeGreaterThan(0)
    expect(d.warnings.join(' ')).toContain('mismatch')
  })

  it('carries a phosphate only when the oligos were ordered with one', () => {
    expect(annealOligos({ top: TOP, bottom: BOTTOM }).left.phosphate).toBe(false)
    expect(annealOligos({ top: TOP, bottom: BOTTOM, phosphate: true }).left.phosphate).toBe(true)
  })

  it('needs both strands', () => {
    expect(annealOligos({ top: TOP, bottom: '' }).warnings.join(' ')).toContain('both oligos')
  })

  it('ignores spacing and case in what was pasted in', () => {
    const d = annealOligos({ top: 'cacc g gtcagc', bottom: ' GCTGAC c' })
    expect(d.top).toBe('CACCGGTCAGC')
    expect(d.mismatches).toBe(0)
  })
})

describe('writing the pair out', () => {
  it('lines the two strands up with the overhangs sticking out', () => {
    const { top, bottom } = duplexLines({ top: TOP, bottom: BOTTOM })
    // The top strand is flush left, since it is the one that reaches further
    // left; the bottom strand starts under the fifth base.
    expect(top).toBe(TOP)
    expect(bottom.startsWith('    ')).toBe(true)
    expect(bottom.trimStart()).toBe('C' + [...GUIDE].map(b => ({ A: 'T', T: 'A', G: 'C', C: 'G' })[b]).join('') + 'CAAA')
    // Paired bases sit above each other, and the duplex is as wide as the
    // molecule: 4 + 21 + 4.
    expect(Math.max(top.length, bottom.length)).toBe(29)
  })

  it('indents the top strand when the other one reaches further left', () => {
    const { top, bottom } = duplexLines({ top: GUIDE, bottom: `${reverseComplement(GUIDE)}TT` })
    expect(top.startsWith('  ')).toBe(true)
    expect(bottom.startsWith(' ')).toBe(false)
  })
})

describe('a duplex as a fragment', () => {
  it('rebuilds both oligos from the fragment it becomes', () => {
    const { fragment } = duplexFragment({ top: TOP, bottom: BOTTOM }, { id: 'p1', name: 'guide' })
    // The fragment model writes the top strand whole and derives the bottom.
    expect(fragment.top).toBe(TOP)
    expect(bottomStrand(fragment)).toBe(BOTTOM)
    expect(coreOf(fragment)).toBe(CORE)
    // The molecule is longer than either oligo: both overhangs stick out.
    expect(extentOf(fragment)).toBe(CORE.length + 'CACC'.length + 'AAAC'.length)
  })

  it('is named like the first piece of a digest, so it tracks to its part', () => {
    const { fragment } = duplexFragment({ top: TOP, bottom: BOTTOM }, { id: 'p1', name: 'guide' })
    expect(fragment.id.startsWith('p1:')).toBe(true)
    expect(fragment.topology).toBe('linear')
  })

  it('passes the annealing complaint on under the part name', () => {
    const { warnings } = duplexFragment({ top: GUIDE, bottom: GUIDE }, { id: 'p1', name: 'guide' })
    expect(warnings[0].startsWith('guide: ')).toBe(true)
  })
})
