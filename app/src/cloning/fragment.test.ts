/**
 * A fragment has to survive being turned round, and a digest has to tile its
 * source: concatenating the pieces back must return what was cut.
 */
import { describe, it, expect } from 'vitest'
import { Sequence } from '../models/Sequence'
import { Annotation } from '../models/Annotation'
import type { DocumentState } from '../models/Document'
import { getEnzyme } from '../enzymes/db'
import { reverseComplement } from '../models/complement'
import { digest } from './cut'
import { bottomStrand, coreOf, extentOf, flip, linearFragment } from './fragment'
import type { End } from './ends'

const five = (span: string): End => ({ span, kind: 'five_prime', phosphate: true })
const three = (span: string): End => ({ span, kind: 'three_prime', phosphate: true })

const source = { name: 's', start: 0, end: 0, circular: false }
const pad = (n: number) => 'AT'.repeat(Math.ceil(n / 2)).slice(0, n)

const doc = (name: string, bases: string, topology: 'linear' | 'circular' = 'linear'): DocumentState =>
  ({ name, sequence: new Sequence(bases, topology), annotations: [] })

describe('the two strands of a fragment', () => {
  it('reads the bottom strand of a fragment with two 5-prime ends', () => {
    // AATT ... GATC overhangs, as an EcoRI–BamHI piece has.
    const f = linearFragment('f', 'f', 'AATTCGGGG', source, { left: five('AATT'), right: five('GATC') })
    expect(coreOf(f)).toBe('CGGGG')
    expect(bottomStrand(f)).toBe('GATC' + reverseComplement('CGGGG'))
    expect(extentOf(f)).toBe(4 + 5 + 4)
  })

  it('reads the bottom strand of a fragment with two 3-prime ends', () => {
    const f = linearFragment('f', 'f', 'CCCCTGCA', source, { left: three('ACGT'), right: three('TGCA') })
    // The top strand protrudes on the right, the bottom strand on the left.
    expect(coreOf(f)).toBe('CCCC')
    expect(bottomStrand(f)).toBe(reverseComplement('CCCC') + 'ACGT')
  })

  it('counts a blunt fragment the same on both strands', () => {
    const f = linearFragment('f', 'f', 'ACGTACGT', source)
    expect(coreOf(f)).toBe('ACGTACGT')
    expect(bottomStrand(f)).toBe(reverseComplement('ACGTACGT'))
    expect(extentOf(f)).toBe(8)
  })
})

describe('flip', () => {
  it('swaps the ends and leaves each one reading the same', () => {
    const f = linearFragment('f', 'f', 'AATTCGGGG', source, { left: five('AATT'), right: five('GATC') })
    const back = flip(f)
    expect(back.left).toEqual(f.right)
    expect(back.right).toEqual(f.left)
    expect(back.reversed).toBe(true)
  })

  it('makes the new top strand the old bottom strand', () => {
    const f = linearFragment('f', 'f', 'AATTCGGGG', source, { left: five('AATT'), right: five('GATC') })
    expect(flip(f).top).toBe(bottomStrand(f))
  })

  it('returns the original when done twice', () => {
    for (const ends of [
      { left: five('AATT'), right: five('GATC') },
      { left: three('ACGT'), right: three('TGCA') },
      { left: five('AATT'), right: three('TGCA') },
      {},
    ]) {
      const f = linearFragment('f', 'f', 'AATTCGGGGTGCA', source, ends)
      const twice = flip(flip(f))
      expect(twice.top).toBe(f.top)
      expect(twice.left).toEqual(f.left)
      expect(twice.right).toEqual(f.right)
      expect(twice.reversed).toBe(false)
    }
  })

  it('mirrors annotations and turns them round', () => {
    const f = linearFragment('f', 'f', 'ACGTACGTAC', source, {
      annotations: [{ id: 'a', name: 'gene', type: 'CDS', start: 2, end: 6, strand: 1 }],
    })
    const [ann] = flip(f).annotations
    expect([ann.start, ann.end]).toEqual([4, 8])
    expect(ann.strand).toBe(-1)
  })

  it('clips an annotation that reaches into a single-stranded overhang', () => {
    const f = linearFragment('f', 'f', 'AATTCGGGG', source, {
      left: five('AATT'),
      right: five('GATC'),
      annotations: [{ id: 'a', name: 'x', type: 'misc_feature', start: 0, end: 6, strand: 1 }],
    })
    const [ann] = flip(f).annotations
    expect(ann.truncated).toBe(true)
  })
})

describe('a digest tiles its source', () => {
  const EcoRI = getEnzyme('EcoRI')!
  const BamHI = getEnzyme('BamHI')!

  it('puts a linear sequence back together', () => {
    const bases = pad(40) + 'GAATTC' + pad(30) + 'GGATCC' + pad(40)
    const { fragments } = digest(doc('lin', bases), [EcoRI, BamHI])
    expect(fragments).toHaveLength(3)
    expect(fragments.map(f => f.top).join('')).toBe(bases)
  })

  it('puts a circular sequence back together, starting from the first cut', () => {
    const bases = pad(40) + 'GAATTC' + pad(30) + 'GGATCC' + pad(40)
    const { fragments, sites } = digest(doc('circ', bases, 'circular'), [EcoRI, BamHI])
    expect(fragments).toHaveLength(2)
    const first = Math.min(...sites.map(s => s.fwdCut))
    expect(fragments.map(f => f.top).join('')).toBe(bases.slice(first) + bases.slice(0, first))
  })

  it('leaves an uncut circle circular, with no ends', () => {
    const { fragments } = digest(doc('circ', pad(200), 'circular'), [EcoRI])
    expect(fragments).toHaveLength(1)
    expect(fragments[0].topology).toBe('circular')
    expect(fragments[0].left).toBeUndefined()
  })

  it('carries a feature that crosses the origin', () => {
    const bases = pad(40) + 'GAATTC' + pad(154)
    const state = doc('circ', bases, 'circular')
    // Runs from 190 past the origin to 10.
    state.annotations = [new Annotation({ id: 'w', name: 'wrapped', type: 'gene', start: 190, end: 10, strand: 1 })]
    const { fragments } = digest(state, [EcoRI])
    const carried = fragments.flatMap(f => f.annotations).filter(a => a.id === 'w')
    expect(carried).toHaveLength(1)
    expect(carried[0].end - carried[0].start).toBe(20)
  })
})
