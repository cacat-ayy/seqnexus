import { describe, it, expect } from 'vitest'
import { makeDoc } from './model'
import { addToAlignment, alignSequenceToProfile, profileCost } from './profile'

const origin = { method: 'manual' as const, at: 0 }
const seqs = (d: ReturnType<typeof makeDoc>) => d.rows.map(r => r.seq)

describe('adding sequences to an alignment', () => {
  it('places an identical sequence on its own columns without changing the alignment', () => {
    const d = makeDoc([{ name: 'a', seq: 'ACGT-ACGTAC' }, { name: 'b', seq: 'ACGTTACGTAC' }], origin)
    const r = addToAlignment(d, [{ name: 'new', seq: 'ACGTTACGTAC' }])
    expect(seqs(r.doc)).toEqual(['ACGT-ACGTAC', 'ACGTTACGTAC', 'ACGTTACGTAC'])
    expect(r.doc.rows[0]).toBe(d.rows[0]) // untouched rows keep their identity
    expect(r.ids).toHaveLength(1)
  })

  it('lets a fragment sit where it matches, with free end gaps', () => {
    const d = makeDoc([{ name: 'a', seq: 'TTTTTGGCCAATTGCAAAAA' }, { name: 'b', seq: 'TTTTTGGCCAATTGCAAAAA' }], origin)
    const r = addToAlignment(d, [{ name: 'frag', seq: 'GGCCAATTGC' }])
    expect(seqs(r.doc)[2]).toBe('-----GGCCAATTGC-----')
    expect(seqs(r.doc)[0]).toBe('TTTTTGGCCAATTGCAAAAA')
  })

  it('opens gap columns for an insertion, keeping the existing columns', () => {
    const d = makeDoc([{ name: 'a', seq: 'ATGGCCAAGCTTGCATGC' }, { name: 'b', seq: 'ATGGCCAAGCTTGCATGC' }], origin)
    const r = addToAlignment(d, [{ name: 'ins', seq: 'ATGGCCAAGGGGGCTTGCATGC' }])
    const [a, , ins] = seqs(r.doc)
    expect(a.replace(/-/g, '')).toBe('ATGGCCAAGCTTGCATGC')
    expect(ins.replace(/-/g, '')).toBe('ATGGCCAAGGGGGCTTGCATGC')
    expect(a.length).toBe(22)
    // The four extra bases sit opposite gaps in the old rows.
    expect([...a].filter((c, i) => c === '-' && ins[i] !== '-')).toHaveLength(4)
  })

  it('adds several sequences, keeping their given order', () => {
    const d = makeDoc([{ name: 'a', seq: 'MKLVFFAEDVGS' }, { name: 'b', seq: 'MKLVFFAEDVGS' }], origin, 'protein')
    const r = addToAlignment(d, [{ name: 'short', seq: 'LVFFAE' }, { name: 'long', seq: 'MKLVYFAEDVGSK' }])
    expect(r.doc.rows.map(x => x.name)).toEqual(['a', 'b', 'short', 'long'])
    for (const row of r.doc.rows) expect(row.seq.length).toBe(r.doc.rows[0].seq.length)
    expect(seqs(r.doc)[2].replace(/-/g, '')).toBe('LVFFAE')
    expect(seqs(r.doc)[2].indexOf('L')).toBe(seqs(r.doc)[0].indexOf('L'))
  })

  it('handles empty input and reports cost', () => {
    const d = makeDoc([{ name: 'a', seq: 'ACGT' }], origin)
    expect(alignSequenceToProfile(['ACGT'], '', 'dna').prof).toEqual(Int32Array.from([0, 1, 2, 3]))
    expect(profileCost(d, ['ACG'])).toBe((4 + 3) * 3)
  })
})
