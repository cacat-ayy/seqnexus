import { describe, it, expect } from 'vitest'
import { Sequence } from './Sequence'

describe('Sequence', () => {
  const seq = new Sequence('ATGCGATCGA')

  it('reports length', () => {
    expect(seq.length).toBe(10)
  })

  it('preserves topology default', () => {
    expect(seq.topology).toBe('linear')
  })

  // --- insert ---
  it('inserts at start', () => {
    expect(seq.insert(0, 'TTT').bases).toBe('TTTATGCGATCGA')
  })

  it('inserts at end', () => {
    expect(seq.insert(10, 'GGG').bases).toBe('ATGCGATCGAGGG')
  })

  it('inserts in middle', () => {
    expect(seq.insert(3, 'AA').bases).toBe('ATGAACGATCGA')
  })

  it('insert does not mutate original', () => {
    seq.insert(0, 'TTT')
    expect(seq.bases).toBe('ATGCGATCGA')
  })

  it('insert throws on out-of-bounds', () => {
    expect(() => seq.insert(-1, 'A')).toThrow(RangeError)
    expect(() => seq.insert(11, 'A')).toThrow(RangeError)
  })

  // --- delete ---
  it('deletes a range', () => {
    // ATGCGATCGA → delete [2,5) removes 'GCG' → 'ATATCGA'
    expect(seq.delete(2, 5).bases).toBe('ATATCGA')
  })

  it('delete throws on invalid range', () => {
    expect(() => seq.delete(5, 3)).toThrow(RangeError)
    expect(() => seq.delete(-1, 3)).toThrow(RangeError)
    expect(() => seq.delete(0, 11)).toThrow(RangeError)
  })

  // --- replace ---
  it('replaces a range', () => {
    expect(seq.replace(0, 3, 'CCC').bases).toBe('CCCCGATCGA')
  })

  it('replaces with different length', () => {
    expect(seq.replace(0, 3, 'C').bases).toBe('CCGATCGA')
  })

  // --- subseq ---
  it('extracts subsequence', () => {
    expect(seq.subseq(2, 6)).toBe('GCGA')
  })

  it('circular subseq wraps around', () => {
    const circ = new Sequence('ATGCGA', 'circular')
    // ATGCGA → [4,8) wraps: bases[4..5] + bases[0..1] = 'GA' + 'AT' = 'GAAT'
    expect(circ.subseq(4, 8)).toBe('GAAT')
  })

  // --- complement ---
  it('computes complement', () => {
    const s = new Sequence('ATGC')
    expect(s.complement().bases).toBe('TACG')
  })

  it('computes reverse complement', () => {
    const s = new Sequence('ATGC')
    expect(s.reverseComplement().bases).toBe('GCAT')
  })

  it('handles ambiguous bases', () => {
    const s = new Sequence('RYSWKMBVDHN')
    expect(s.complement().bases).toBe('YRSWMKVBHDN')
  })

  it('handles RNA complement', () => {
    const s = new Sequence('AUGC')
    expect(s.complement().bases).toBe('TACG')
  })

  it('preserves case in complement', () => {
    const s = new Sequence('atgc')
    expect(s.complement().bases).toBe('tacg')
  })

  // --- gcContent ---
  it('computes GC content', () => {
    expect(new Sequence('GGCC').gcContent()).toBe(1)
    expect(new Sequence('AATT').gcContent()).toBe(0)
    expect(new Sequence('ATGC').gcContent()).toBe(0.5)
  })

  it('GC content of empty sequence is 0', () => {
    expect(new Sequence('').gcContent()).toBe(0)
  })

  // --- withTopology ---
  it('changes topology', () => {
    const circ = seq.withTopology('circular')
    expect(circ.topology).toBe('circular')
    expect(circ.bases).toBe(seq.bases)
  })
})
