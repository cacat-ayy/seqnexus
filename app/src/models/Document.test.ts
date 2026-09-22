import { describe, it, expect } from 'vitest'
import { Sequence } from './Sequence'
import { Annotation } from './Annotation'
import {
  DocumentState,
  snapshot,
  restore,
  insertBases,
  deleteBases,
  replaceBases,
  addAnnotation,
  removeAnnotation,
  updateAnnotation,
} from './Document'

function makeDoc(): DocumentState {
  return {
    name: 'pTest',
    sequence: new Sequence('ATGCGATCGA'),
    annotations: [
      new Annotation({ id: 'f1', name: 'GFP', type: 'CDS', start: 2, end: 8, strand: 1 }),
    ],
  }
}

describe('Document operations', () => {
  it('snapshot and restore round-trip', () => {
    const doc = makeDoc()
    const snap = snapshot(doc)
    const restored = restore(snap)
    expect(restored.name).toBe('pTest')
    expect(restored.sequence.bases).toBe('ATGCGATCGA')
    expect(restored.annotations).toHaveLength(1)
    expect(restored.annotations[0].name).toBe('GFP')
  })

  it('insertBases shifts annotations', () => {
    const doc = makeDoc()
    const result = insertBases(doc, 0, 'TTT')
    expect(result.sequence.bases).toBe('TTTATGCGATCGA')
    expect(result.annotations[0].start).toBe(5)
    expect(result.annotations[0].end).toBe(11)
  })

  it('deleteBases adjusts annotations', () => {
    const doc = makeDoc()
    // delete [0, 2) - before annotation
    const result = deleteBases(doc, 0, 2)
    expect(result.sequence.bases).toBe('GCGATCGA')
    expect(result.annotations[0].start).toBe(0)
    expect(result.annotations[0].end).toBe(6)
  })

  it('deleteBases removes annotation if fully deleted', () => {
    const doc = makeDoc()
    // delete [0, 10) - entire sequence
    const result = deleteBases(doc, 0, 10)
    expect(result.sequence.bases).toBe('')
    expect(result.annotations).toHaveLength(0)
  })

  it('replaceBases adjusts annotations', () => {
    const doc = makeDoc()
    // replace [0, 2) with 'CCCC' - net +2 before annotation
    const result = replaceBases(doc, 0, 2, 'CCCC')
    expect(result.sequence.bases).toBe('CCCCGCGATCGA')
    expect(result.annotations[0].start).toBe(4)
    expect(result.annotations[0].end).toBe(10)
  })

  it('addAnnotation appends', () => {
    const doc = makeDoc()
    const result = addAnnotation(doc, {
      id: 'f2', name: 'Kan', type: 'gene', start: 0, end: 3, strand: -1,
    })
    expect(result.annotations).toHaveLength(2)
    expect(result.annotations[1].name).toBe('Kan')
  })

  it('removeAnnotation by id', () => {
    const doc = makeDoc()
    const result = removeAnnotation(doc, 'f1')
    expect(result.annotations).toHaveLength(0)
  })

  it('updateAnnotation patches fields', () => {
    const doc = makeDoc()
    const result = updateAnnotation(doc, 'f1', { name: 'mCherry', color: '#ff0000' })
    expect(result.annotations[0].name).toBe('mCherry')
    expect(result.annotations[0].color).toBe('#ff0000')
    expect(result.annotations[0].start).toBe(2) // unchanged
  })
})

describe('Document - circular topology with origin-spanning annotations', () => {
  function makeCircularDoc(): DocumentState {
    // 20bp circular sequence with an origin-spanning annotation [18, 4)
    return {
      name: 'pCirc',
      sequence: new Sequence('ATGCGATCGAATGCGATCGA', 'circular'),
      annotations: [
        new Annotation({ id: 'c1', name: 'OriSpan', type: 'CDS', start: 18, end: 4, strand: 1 }),
      ],
    }
  }

  it('insertBases in gap adjusts origin-spanning annotation correctly', () => {
    const doc = makeCircularDoc()
    // Insert 3 bases at pos 10 (in the gap between end=4 and start=18)
    const result = insertBases(doc, 10, 'TTT')
    expect(result.sequence.length).toBe(23)
    expect(result.annotations[0].start).toBe(21) // 18 + 3
    expect(result.annotations[0].end).toBe(4)    // unchanged
  })

  it('deleteBases consuming the tail collapses to head only', () => {
    const doc = makeCircularDoc()
    // Delete [18, 20) - the entire tail of the origin-spanning annotation
    const result = deleteBases(doc, 18, 20)
    expect(result.sequence.length).toBe(18)
    expect(result.annotations[0].start).toBe(0)
    expect(result.annotations[0].end).toBe(4)
    expect(result.annotations[0].spansOrigin()).toBe(false)
  })

  it('deleteBases consuming the head collapses to tail only', () => {
    const doc = makeCircularDoc()
    // Delete [0, 4) - the entire head of the origin-spanning annotation
    const result = deleteBases(doc, 0, 4)
    expect(result.sequence.length).toBe(16)
    expect(result.annotations[0].start).toBe(14) // 18 - 4
    expect(result.annotations[0].end).toBe(16)   // tail end shifted
    expect(result.annotations[0].spansOrigin()).toBe(false)
  })
})

