import { describe, it, expect } from 'vitest'
import type { TraceData } from '../io/trace'
import type { BaseEdit } from '../store'
import { buildLayout } from './layout'
import {
  deleteColumns, editedRead, fastqQuality, findInColumns, insertBefore, MANUAL_QUALITY, revertColumns, substitute,
} from './edits'

function read(bases: string): TraceData {
  return {
    name: 'r', bases,
    peakLocations: [...bases].map((_, i) => 10 + i * 10),
    qualityScores: [...bases].map((_, i) => 20 + i),
    traces: { A: [], C: [], G: [], T: [] },
    metadata: {},
  }
}

const apply = (data: TraceData, edits: BaseEdit[]) => buildLayout(data, edits).bases

describe('read edits', () => {
  const data = read('ACGTA')

  it('substitutes a call and drops the edit when set back', () => {
    let e = substitute(data, [], buildLayout(data, []), 1, 'T')
    expect(apply(data, e)).toBe('ATGTA')
    e = substitute(data, e, buildLayout(data, e), 1, 'C')
    expect(e).toEqual([])
  })

  it('inserts before a column, in typing order', () => {
    let e = insertBefore(data, [], buildLayout(data, []), 2, 'T')
    expect(apply(data, e)).toBe('ACTGTA')
    // The caret now sits after the T: the next insert goes before G again.
    e = insertBefore(data, e, buildLayout(data, e), 3, 'C')
    expect(apply(data, e)).toBe('ACTCGTA')
    // Inserting before an existing insert puts the new base first.
    e = insertBefore(data, e, buildLayout(data, e), 2, 'A')
    expect(apply(data, e)).toBe('ACATCGTA')
  })

  it('appends at the end', () => {
    const e = insertBefore(data, [], buildLayout(data, []), 5, 'GG')
    expect(apply(data, e)).toBe('ACGTAGG')
  })

  it('deletes calls but removes inserts', () => {
    let e = insertBefore(data, [], buildLayout(data, []), 1, 'T')
    // Columns: A T* C G T A; delete T* and C.
    e = deleteColumns(data, e, buildLayout(data, e), 1, 3)
    const l = buildLayout(data, e)
    expect(l.bases).toBe('ACGTA')
    expect(e).toEqual([{ type: 'delete', pos: 1, original: 'C' }])
    expect(editedRead(data, e, 0, 5, { layout: l }).bases).toBe('AGTA')
  })

  it('reverts a range of edits', () => {
    let e = substitute(data, [], buildLayout(data, []), 0, 'G')
    e = insertBefore(data, e, buildLayout(data, e), 3, 'C')
    e = deleteColumns(data, e, buildLayout(data, e), 4, 5)
    expect(apply(data, e)).toBe('GCGCTA')
    e = revertColumns(e, buildLayout(data, e), 2, 6)
    expect(apply(data, e)).toBe('GCGTA')
    expect(e).toHaveLength(1)
  })

  it('writes the edited, trimmed read with typed bases at manual quality', () => {
    const e = insertBefore(data, [], buildLayout(data, []), 2, 'T')
    const r = editedRead(data, e, 1, 4)
    expect(r.bases).toBe('CTGT')
    expect(r.quality).toEqual([21, MANUAL_QUALITY, 22, 23])
    const rc = editedRead(data, e, 1, 4, { reversed: true })
    expect(rc.bases).toBe('ACAG')
    expect(rc.quality).toEqual([23, 22, MANUAL_QUALITY, 21])
  })

  it('encodes FASTQ qualities with the Sanger offset', () => {
    expect(fastqQuality([0, 40, 93, 120])).toBe('!I~~')
  })

  it('finds IUPAC motifs, skipping deleted columns', () => {
    const shown = 'ACGXTA'
    const hits = findInColumns(shown, c => c === 3, 'GT')
    expect(hits).toEqual([[2, 5]])
    expect(findInColumns('ACGTAC', () => false, 'AY')).toEqual([[0, 2], [4, 6]])
  })
})
