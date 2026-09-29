import { describe, it, expect, beforeEach } from 'vitest'
import { useEditorStore, MAX_RECENTLY_CLOSED } from './store'
import type { AlignmentResult } from './alignment/types'
import type { Ab1Data } from './io/ab1'

const store = () => useEditorStore.getState()

function trace(name: string): Ab1Data {
  return {
    name,
    bases: 'ATGC',
    peakLocations: [1, 2, 3, 4],
    qualityScores: [30, 30, 30, 30],
    traces: { A: [], C: [], G: [], T: [] },
    metadata: {},
  }
}

function result(): AlignmentResult {
  return {
    sequences: [{ name: 'a', alignedBases: 'ATGC', originalBases: 'ATGC' }],
    consensus: 'ATGC', conservation: [1, 1, 1, 1], score: 4,
    identity: 1, similarity: 1, gaps: 0, alignmentLength: 4, algorithm: 'nw',
  }
}

/**
 * Only sequences used to be recoverable. Every other kind got a confirmation
 * dialog and nothing else, which is backwards: a contig costs far more to
 * rebuild than a sequence costs to reopen.
 */
describe('undoing a delete', () => {
  beforeEach(() => {
    for (const t of store().tabs) store().closeTab(t.id)
    useEditorStore.setState({
      recentlyDeleted: [], sequencingReads: [], activeSequencingReadIds: [],
      alignments: [], readAlignments: [], contigs: [],
      activeAlignmentId: null, activeReadAlignmentId: null, activeContigId: null,
    })
  })

  it('restores a sequencing read at its original position', () => {
    const a = store().addSequencingRead(trace('a'))
    const b = store().addSequencingRead(trace('b'))
    const c = store().addSequencingRead(trace('c'))

    store().removeSequencingRead(b)
    expect(store().sequencingReads.map(r => r.id)).toEqual([a, c])

    store().undoDelete()
    expect(store().sequencingReads.map(r => r.id)).toEqual([a, b, c])
  })

  it('restores an alignment and opens it', () => {
    const id = store().addAlignment(result(), 'dna', 'nw')
    store().removeAlignment(id)
    expect(store().alignments).toHaveLength(0)

    store().undoDelete()
    expect(store().alignments.map(a => a.id)).toEqual([id])
    expect(store().activeAlignmentId).toBe(id)
  })

  it('restores a contig', () => {
    const tabId = store().openDocument('ref', 'ATGC')
    const readId = store().addSequencingRead(trace('r'))
    const raId = store().addReadAlignment(readId, tabId, result())
    const contigId = store().addContig(tabId, [raId])

    store().removeContig(contigId)
    expect(store().contigs).toHaveLength(0)

    store().undoDelete()
    expect(store().contigs.map(c => c.id)).toEqual([contigId])
  })

  // Removing a read alignment rewrites the contigs holding it and deletes any
  // that empty out, so the whole contig list is snapshotted: restoring only
  // the read alignment would leave the contig gone.
  it('restores the contig that emptying it removed', () => {
    const tabId = store().openDocument('ref', 'ATGC')
    const readId = store().addSequencingRead(trace('r'))
    const raId = store().addReadAlignment(readId, tabId, result())
    const contigId = store().addContig(tabId, [raId])

    store().removeReadAlignment(raId)
    expect(store().contigs).toHaveLength(0)
    expect(store().readAlignments).toHaveLength(0)

    store().undoDelete()
    expect(store().readAlignments.map(r => r.id)).toEqual([raId])
    expect(store().contigs.map(c => c.id)).toEqual([contigId])
  })

  it('undoes deletes of different kinds in reverse order', () => {
    const tabId = store().openDocument('seq', 'ATGC')
    const readId = store().addSequencingRead(trace('r'))

    store().closeTab(tabId)
    store().removeSequencingRead(readId)

    store().undoDelete()
    expect(store().sequencingReads).toHaveLength(1)
    expect(store().tabs).toHaveLength(0)

    store().undoDelete()
    expect(store().tabs).toHaveLength(1)
  })

  it('caps the buffer across kinds', () => {
    for (let i = 0; i < MAX_RECENTLY_CLOSED + 2; i++) {
      store().removeSequencingRead(store().addSequencingRead(trace(`r${i}`)))
    }
    expect(store().recentlyDeleted).toHaveLength(MAX_RECENTLY_CLOSED)
  })

  it('ignores a delete of something that is not there', () => {
    store().removeAlignment('nope')
    expect(store().recentlyDeleted).toHaveLength(0)
  })

  it('does nothing when there is nothing to undo', () => {
    store().undoDelete()
    expect(store().recentlyDeleted).toHaveLength(0)
  })
})
