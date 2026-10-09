import { describe, it, expect } from 'vitest'
import { guessAlphabet, invalidCharacters, isValidSequence, unitOf } from './alphabet'
import { Sequence } from './Sequence'
import { snapshot, restore, undoSnapshot, restoreUndo, displayPosition, internalPosition } from './Document'
import { Annotation } from './Annotation'

describe('alphabet', () => {
  it('guesses a protein from letters only a protein has, and DNA from bases', () => {
    expect(guessAlphabet('ATGAAATTTGGGCCC')).toBe('dna')
    expect(guessAlphabet('atgaaatttgggcccatgnnr')).toBe('dna')
    expect(guessAlphabet('MKVLAAGIVGLLLAAQPAMA')).toBe('protein')
    // Only IUPAC letters, but far too few of them are A, C, G, T or N.
    expect(guessAlphabet('ACDGHKMNRSTVWY')).toBe('protein')
    expect(guessAlphabet('')).toBe('dna')
  })

  it('validates against the residue and nucleotide sets', () => {
    expect(isValidSequence('MKV*XBZJUO', 'protein')).toBe(true)
    // M, K and V are IUPAC codes too; L is not.
    expect(isValidSequence('MKV', 'dna')).toBe(true)
    expect(isValidSequence('MKL', 'dna')).toBe(false)
    expect(isValidSequence('ACGTN', 'protein')).toBe(true)
    expect(invalidCharacters('MK#V1', 'protein')).toEqual(['#', '1'])
    expect(unitOf('protein')).toBe('aa')
    expect(unitOf('dna')).toBe('bp')
  })
})

describe('a protein Sequence', () => {
  it('is always linear and keeps its alphabet through edits', () => {
    const s = new Sequence('MKVL', 'circular', 'protein')
    expect(s.topology).toBe('linear')
    expect(s.isProtein).toBe(true)
    expect(s.insert(2, 'AA').alphabet).toBe('protein')
    expect(s.delete(0, 1).alphabet).toBe('protein')
    expect(s.withTopology('linear').alphabet).toBe('protein')
    expect(Sequence.fromPieceTable(s.pieceTable, 'linear', 'protein').isProtein).toBe(true)
  })

  it('defaults to DNA', () => {
    expect(new Sequence('ACGT').alphabet).toBe('dna')
    expect(new Sequence('ACGT').isProtein).toBe(false)
  })
})

describe('a protein document', () => {
  it('round-trips through a snapshot, and a DNA snapshot stays without the field', () => {
    const doc = {
      name: 'GFP',
      sequence: new Sequence('MSKGEELFTGVVPILVELDGDVNGHKFSVSGEGEGDATYGKLTLKFICTTGKLPVPWPTLVTTFSYGVQCFSRYPDHMKQHDFFKSAMPEGYVQERTIFFKDDGNYKTRAEVKFEGDTLVNRIELKGIDFKEDGNILGHKLEYNYNSHNVYIMADKQKNGIKVNFKIRHNIEDGSVQLADHYQQNTPIGDGPVLLPDNHYLSTQSALSKDPNEKRDHMVLLEFVTAAGITHGMDELYK', 'linear', 'protein'),
      annotations: [new Annotation({ id: 'a', name: 'chromophore', type: 'Site', start: 64, end: 67, strand: 1 })],
    }
    const snap = snapshot(doc)
    expect(snap.alphabet).toBe('protein')
    const back = restore(snap)
    expect(back.sequence.isProtein).toBe(true)
    expect(back.sequence.bases).toBe(doc.sequence.bases)
    expect(back.annotations[0].type).toBe('Site')

    const dna = snapshot({ name: 'x', sequence: new Sequence('ACGT'), annotations: [] })
    expect('alphabet' in dna).toBe(false)
  })

  it('keeps its alphabet through an undo restore', () => {
    const doc = { name: 'p', sequence: new Sequence('MKVL', 'linear', 'protein'), annotations: [] }
    const undo = undoSnapshot(doc)
    doc.sequence.insertInPlace(4, 'AA')
    const back = restoreUndo(undo, doc.sequence)
    expect(back.sequence.bases).toBe('MKVL')
    expect(back.sequence.isProtein).toBe(true)
  })

  it('numbers residues from a chosen start through a negative display origin', () => {
    // -24: residue 0 is shown as 25, as for a mature chain after a 24-residue signal peptide.
    expect(displayPosition(0, -24, 300)).toBe(25)
    expect(displayPosition(299, -24, 300)).toBe(324)
    expect(internalPosition(25, -24, 300)).toBe(0)
    expect(internalPosition(324, -24, 300)).toBe(299)
    // A rotated origin on a circular sequence is unchanged.
    expect(displayPosition(0, 10, 100)).toBe(91)
  })
})
