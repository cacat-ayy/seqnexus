import { describe, it, expect } from 'vitest'
import { PieceTable } from './PieceTable'

describe('PieceTable', () => {
  it('initializes with text', () => {
    const pt = new PieceTable('ATGC')
    expect(pt.length).toBe(4)
    expect(pt.toString()).toBe('ATGC')
  })

  it('initializes empty', () => {
    const pt = new PieceTable()
    expect(pt.length).toBe(0)
    expect(pt.toString()).toBe('')
  })

  // --- insert ---
  it('inserts at start', () => {
    const pt = new PieceTable('ATGC')
    pt.insert(0, 'TTT')
    expect(pt.toString()).toBe('TTTATGC')
  })

  it('inserts at end', () => {
    const pt = new PieceTable('ATGC')
    pt.insert(4, 'GGG')
    expect(pt.toString()).toBe('ATGCGGG')
  })

  it('inserts in middle', () => {
    const pt = new PieceTable('ATGC')
    pt.insert(2, 'XX')
    expect(pt.toString()).toBe('ATXXGC')
  })

  it('insert throws on out-of-bounds', () => {
    const pt = new PieceTable('ATGC')
    expect(() => pt.insert(-1, 'A')).toThrow(RangeError)
    expect(() => pt.insert(5, 'A')).toThrow(RangeError)
  })

  // --- delete ---
  it('deletes from start', () => {
    const pt = new PieceTable('ATGCGA')
    pt.delete(0, 2)
    expect(pt.toString()).toBe('GCGA')
  })

  it('deletes from end', () => {
    const pt = new PieceTable('ATGCGA')
    pt.delete(4, 2)
    expect(pt.toString()).toBe('ATGC')
  })

  it('deletes from middle', () => {
    const pt = new PieceTable('ATGCGA')
    pt.delete(2, 2)
    expect(pt.toString()).toBe('ATGA')
  })

  it('deletes entire content', () => {
    const pt = new PieceTable('ATGC')
    pt.delete(0, 4)
    expect(pt.toString()).toBe('')
    expect(pt.length).toBe(0)
  })

  it('delete throws on out-of-bounds', () => {
    const pt = new PieceTable('ATGC')
    expect(() => pt.delete(-1, 1)).toThrow(RangeError)
    expect(() => pt.delete(3, 2)).toThrow(RangeError)
  })

  // --- charAt ---
  it('returns correct character', () => {
    const pt = new PieceTable('ATGC')
    expect(pt.charAt(0)).toBe('A')
    expect(pt.charAt(1)).toBe('T')
    expect(pt.charAt(2)).toBe('G')
    expect(pt.charAt(3)).toBe('C')
  })

  it('charAt returns empty for out-of-bounds', () => {
    const pt = new PieceTable('ATGC')
    expect(pt.charAt(-1)).toBe('')
    expect(pt.charAt(4)).toBe('')
  })

  // --- substring ---
  it('extracts substring', () => {
    const pt = new PieceTable('ATGCGATCGA')
    expect(pt.substring(2, 6)).toBe('GCGA')
  })

  it('substring handles edge cases', () => {
    const pt = new PieceTable('ATGC')
    expect(pt.substring(0, 4)).toBe('ATGC')
    expect(pt.substring(0, 0)).toBe('')
    expect(pt.substring(4, 4)).toBe('')
  })

  // --- multiple operations ---
  it('handles sequential inserts and deletes', () => {
    const pt = new PieceTable('AAAA')
    pt.insert(2, 'BB')   // AABBAA
    pt.delete(0, 1)      // ABBAA
    pt.insert(5, 'CC')   // ABBAACC
    expect(pt.toString()).toBe('ABBAACC')
    expect(pt.length).toBe(7)
  })

  it('handles many small inserts', () => {
    const pt = new PieceTable('')
    for (let i = 0; i < 100; i++) {
      pt.insert(i, 'A')
    }
    expect(pt.length).toBe(100)
    expect(pt.toString()).toBe('A'.repeat(100))
  })

  // --- snapshot ---
  it('snapshot and restore', () => {
    const pt = new PieceTable('ATGC')
    const snap = pt.snapshot()

    pt.insert(0, 'XXX')
    expect(pt.toString()).toBe('XXXATGC')

    pt.restoreSnapshot(snap)
    expect(pt.toString()).toBe('ATGC')
  })

  it('snapshot is independent of further edits', () => {
    const pt = new PieceTable('ATGC')
    const snap = pt.snapshot()

    pt.delete(0, 4)
    pt.insert(0, 'GGGG')
    expect(pt.toString()).toBe('GGGG')

    pt.restoreSnapshot(snap)
    expect(pt.toString()).toBe('ATGC')
  })

  // --- large sequence ---
  it('handles large sequences efficiently', () => {
    const bases = 'ATGC'.repeat(25000) // 100k bp
    const pt = new PieceTable(bases)
    expect(pt.length).toBe(100000)

    // Insert in middle
    pt.insert(50000, 'NNNN')
    expect(pt.length).toBe(100004)
    expect(pt.charAt(50000)).toBe('N')
    expect(pt.charAt(50003)).toBe('N')
    expect(pt.charAt(50004)).toBe('A') // original base shifted

    // Delete
    pt.delete(50000, 4)
    expect(pt.length).toBe(100000)
    expect(pt.toString()).toBe(bases)
  })

  // --- regression: deleting a whole piece that forces a subtree merge ---
  it('deletes the right bases across several earlier inserts', () => {
    const inserts: [number, string][] = [
      [1, 'a'], [0, 'b'], [2, 'c'], [0, 'd'], [3, 'e'], [1, 'f'], [5, 'g'], [0, 'h'],
    ]
    let ref = 'ABC'
    for (const [pos, ch] of inserts) ref = ref.slice(0, pos) + ch + ref.slice(pos)
    for (let pos = 0; pos < ref.length; pos++) {
      for (let count = 1; pos + count <= ref.length; count++) {
        const pt = new PieceTable('ABC')
        for (const [p, ch] of inserts) pt.insert(p, ch)
        pt.delete(pos, count)
        expect(pt.toString()).toBe(ref.slice(0, pos) + ref.slice(pos + count))
      }
    }
  })

  // --- fuzz: random edits must always match a plain string ---
  it('matches a plain string through random inserts and deletes', () => {
    // Deterministic PRNG so a failure is reproducible
    let seed = 12345
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed % n
    }
    for (let round = 0; round < 300; round++) {
      let ref = 'ACGT'.repeat(1 + rand(4))
      const pt = new PieceTable(ref)
      for (let step = 0; step < 40; step++) {
        if (ref.length === 0 || rand(3) > 0) {
          const pos = rand(ref.length + 1)
          let text = ''
          for (let i = 1 + rand(3); i > 0; i--) text += 'ACGTN'[rand(5)]
          pt.insert(pos, text)
          ref = ref.slice(0, pos) + text + ref.slice(pos)
        } else {
          const pos = rand(ref.length)
          const count = 1 + rand(ref.length - pos)
          pt.delete(pos, count)
          ref = ref.slice(0, pos) + ref.slice(pos + count)
        }
        expect(pt.length).toBe(ref.length)
        expect(pt.toString()).toBe(ref)
      }
    }
  })
})
