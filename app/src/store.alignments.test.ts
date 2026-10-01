import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { useEditorStore } from './store'
import { makeDoc, type AlnDoc } from './msa/model'
import { insertGaps, overwrite, renameRow, deleteColumnRange } from './msa/edit'

const store = () => useEditorStore.getState()
const aln = (id: string) => store().alignments.find(a => a.id === id)!
const seqs = (d: AlnDoc) => d.rows.map(r => r.seq)

function sample(): AlnDoc {
  return makeDoc([
    { name: 'a', seq: 'ACGTACGT' },
    { name: 'b', seq: 'ACGTTCGT' },
  ], { method: 'mafft', at: 1 })
}

describe('alignment items', () => {
  beforeEach(() => {
    useEditorStore.setState({ alignments: [], activeAlignmentId: null, recentlyDeleted: [] })
  })
  afterEach(() => vi.useRealTimers())

  it('adds and opens an alignment, naming it from its rows', () => {
    const id = store().addAlignment(sample())
    expect(store().activeAlignmentId).toBe(id)
    expect(aln(id).name).toBe('a vs b')
    const quiet = store().addAlignment(sample(), { name: 'Kept', activate: false })
    expect(store().activeAlignmentId).toBe(id)
    expect(aln(quiet).name).toBe('Kept')
  })

  it('records named undo steps and walks them both ways', () => {
    const id = store().addAlignment(sample())
    const start = aln(id).doc
    const rowA = start.rows[0].id
    store().updateAlignment(id, d => insertGaps(d, [rowA], 2, 1), 'Insert gap')
    store().updateAlignment(id, d => renameRow(d, rowA, 'alpha'), 'Rename row')
    expect(aln(id).undoStack.map(s => s.label)).toEqual(['Insert gap', 'Rename row'])

    expect(store().undoAlignment(id)).toBe('Rename row')
    expect(aln(id).doc.rows[0].name).toBe('a')
    expect(store().undoAlignment(id)).toBe('Insert gap')
    expect(aln(id).doc).toBe(start)
    expect(store().undoAlignment(id)).toBeNull()

    expect(store().redoAlignment(id)).toBe('Insert gap')
    expect(seqs(aln(id).doc)[0]).toBe('AC-GTACGT')
    expect(store().redoAlignment(id)).toBe('Rename row')
    expect(store().redoAlignment(id)).toBeNull()
  })

  it('records nothing for an edit that changes nothing', () => {
    const id = store().addAlignment(sample())
    store().updateAlignment(id, d => d, 'Nothing')
    expect(aln(id).undoStack).toHaveLength(0)
  })

  it('a new edit clears the redo stack', () => {
    const id = store().addAlignment(sample())
    const rowA = aln(id).doc.rows[0].id
    store().updateAlignment(id, d => insertGaps(d, [rowA], 0, 1), 'Insert gap')
    store().undoAlignment(id)
    store().updateAlignment(id, d => renameRow(d, rowA, 'x'), 'Rename row')
    expect(aln(id).redoStack).toHaveLength(0)
  })

  it('folds quick edits with the same key into one step', () => {
    vi.useFakeTimers()
    const id = store().addAlignment(sample())
    const start = aln(id).doc
    const rowB = start.rows[1].id
    store().updateAlignment(id, d => overwrite(d, rowB, 0, 'T'), 'Type', 'type:b')
    vi.advanceTimersByTime(300)
    store().updateAlignment(id, d => overwrite(d, rowB, 1, 'T'), 'Type', 'type:b')
    vi.advanceTimersByTime(300)
    store().updateAlignment(id, d => overwrite(d, rowB, 2, 'T'), 'Type', 'type:b')
    expect(aln(id).undoStack).toHaveLength(1)
    expect(seqs(aln(id).doc)[1]).toBe('TTTTTCGT')
    store().undoAlignment(id)
    expect(aln(id).doc).toBe(start)

    // A pause starts a new step.
    store().updateAlignment(id, d => overwrite(d, rowB, 0, 'G'), 'Type', 'type:b')
    vi.advanceTimersByTime(2000)
    store().updateAlignment(id, d => overwrite(d, rowB, 1, 'G'), 'Type', 'type:b')
    expect(aln(id).undoStack).toHaveLength(2)
  })

  it('charges a step only for the rows it replaced', () => {
    const id = store().addAlignment(sample())
    const rowA = aln(id).doc.rows[0].id
    store().updateAlignment(id, d => overwrite(d, rowA, 0, 'T'), 'Type')
    expect(aln(id).undoStack[0].cost).toBe(8)
    store().updateAlignment(id, d => deleteColumnRange(d, 0, 2), 'Delete columns')
    expect(aln(id).undoStack[1].cost).toBe(16)
  })

  it('duplicates without history, next to the original', () => {
    const id = store().addAlignment(sample())
    store().addAlignment(sample(), { name: 'other', activate: false })
    const rowA = aln(id).doc.rows[0].id
    store().updateAlignment(id, d => insertGaps(d, [rowA], 0, 1), 'Insert gap')
    const copy = store().duplicateAlignment(id)!
    expect(store().alignments.map(a => a.name)).toEqual(['a vs b', 'a vs b copy', 'other'])
    expect(aln(copy).doc).toBe(aln(id).doc)
    expect(aln(copy).undoStack).toHaveLength(0)
    expect(store().activeAlignmentId).toBe(copy)
  })
})
