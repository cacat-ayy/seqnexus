/**
 * Tests for the annotation list matcher, through the module the worker runs.
 */

import { describe, it, expect } from 'vitest'
import { scanForReferences, type ReferenceAnnotation } from '../features/annotate-scan'
import { reverseComplement } from '../models/complement'

const ref = (sequence: string, name = 'test'): ReferenceAnnotation => ({ name, type: 'misc_feature', sequence })
const scan = (doc: string, refs: ReferenceAnnotation[], minSimilarity: number, bestMatchOnly = false) =>
  scanForReferences({ documentBases: doc, references: refs, minSimilarity, bestMatchOnly })

describe('scanForReferences', () => {
  it('finds an exact match on the forward strand', () => {
    const matches = scan('AAAAAATGCGATCGAAAAA', [ref('ATGCGATCGA')], 100)
    expect(matches).toEqual([expect.objectContaining({ refName: 'test', start: 5, end: 15, strand: 1, similarity: 100 })])
  })

  it('finds an exact match on the reverse strand', () => {
    const fwd = 'ATGCGATCGA'
    const matches = scan('AAAAA' + reverseComplement(fwd) + 'AAAAA', [ref(fwd)], 100)
    expect(matches).toEqual([expect.objectContaining({ start: 5, end: 15, strand: -1, similarity: 100 })])
  })

  it('finds approximate matches above the threshold, and not below it', () => {
    // One mismatch in 20 bases: 95%.
    const doc = 'CCCCC' + 'ATGCGATCGATTAGCCGTAC' + 'CCCCC'
    const near = 'ATGCGATCGANTAGCCGTAC'
    expect(scan(doc, [ref(near)], 90)).toEqual([expect.objectContaining({ start: 5, end: 25, strand: 1, similarity: 95 })])
    expect(scan(doc, [ref(near)], 96)).toEqual([])
  })

  it('finds nothing for an empty reference or one longer than the document', () => {
    expect(scan('ATGCGATCGA', [ref('')], 80)).toEqual([])
    expect(scan('ATGC', [ref('ATGCGATCGA')], 80)).toEqual([])
  })

  it('reports every copy of a repeated reference, sorted by position', () => {
    const matches = scan('ATGCGATCGA' + 'TTTTTTTTTT' + 'ATGCGATCGA', [ref('ATGCGATCGA')], 100)
    expect(matches.map(m => m.start)).toEqual([0, 20])
  })

  it('keeps one match per stretch when asked for the best', () => {
    // AGGT, whose reverse complement (ACCT) the repeat does not contain, so only the forward strand matches.
    const doc = 'AGGT'.repeat(8)
    const all = scan(doc, [ref('AGGT'.repeat(4))], 100)
    expect(all.map(m => m.start)).toEqual([0, 4, 8, 12, 16])
    const best = scan(doc, [ref('AGGT'.repeat(4))], 100, true)
    expect(best.map(m => m.start)).toEqual([0, 8, 16])
  })

  it('carries the reference name, type and colour into the match', () => {
    const [m] = scan('GGGGATGCGATCGAGGGG', [{ name: 'ori', type: 'rep_origin', sequence: 'ATGCGATCGA', color: '#123456' }], 100)
    expect(m).toMatchObject({ refName: 'ori', refType: 'rep_origin', color: '#123456' })
  })
})
