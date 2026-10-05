import { describe, it, expect, beforeEach } from 'vitest'
import { useEditorStore, MAX_RECENTLY_CLOSED } from './store'
import { testContig, testRow } from './assembly/testing'
import type { AlignmentResult } from './alignment/types'
import { docFromResult } from './msa/model'
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
      alignments: [], contigs: [], assemblies: [],
      activeAlignmentId: null, activeContigId: null, activeAssemblyId: null,
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
    const id = store().addAlignment(docFromResult(result(), 'dna'))
    store().removeAlignment(id)
    expect(store().alignments).toHaveLength(0)

    store().undoDelete()
    expect(store().alignments.map(a => a.id)).toEqual([id])
    expect(store().activeAlignmentId).toBe(id)
  })

  const two = () => store().addAssembly({
    name: 'COI',
    contigs: [
      { name: 'Contig 1', doc: testContig([testRow('a', 0, 'ATGC')]) },
      { name: 'Contig 2', doc: testContig([testRow('b', 0, 'GGCC')]) },
    ],
  })!

  it('deleting the last contig deletes its assembly, and undo brings both back', () => {
    const made = store().addAssembly({ name: 'Assembly', contigs: [{ name: 'x', doc: testContig([testRow('a', 0, 'ATGC')]) }] })!
    expect(store().contigs[0].name).toBe('Assembly')

    store().removeContig(made.contigIds[0])
    expect(store().contigs).toHaveLength(0)
    expect(store().assemblies).toHaveLength(0)

    store().undoDelete()
    expect(store().contigs.map(c => c.id)).toEqual(made.contigIds)
    expect(store().assemblies.map(a => a.id)).toEqual([made.assemblyId])
    expect(store().activeContigId).toBe(made.contigIds[0])
  })

  it('takes one contig out of an assembly with several and puts it back in its place', () => {
    const made = two()
    store().setActiveContig(made.contigIds[0])
    store().removeContig(made.contigIds[0])
    expect(store().assemblies[0].contigIds).toEqual([made.contigIds[1]])
    // The rest of the assembly is shown instead.
    expect(store().activeContigId).toBe(made.contigIds[1])

    store().undoDelete()
    expect(store().assemblies[0].contigIds).toEqual(made.contigIds)
  })

  it('restores a deleted contig as an assembly of its own once its assembly is gone', () => {
    const made = two()
    const folderId = store().createFolder('Runs')
    store().moveItemToFolder(`assembly:${made.assemblyId}`, folderId)
    store().removeContig(made.contigIds[0])
    // Deleting a folder with its contents is not kept for undo.
    store().deleteFolderWithContents(folderId)
    expect(store().assemblies).toHaveLength(0)
    expect(store().contigs).toHaveLength(0)

    store().undoDelete()
    expect(store().assemblies).toHaveLength(1)
    const own = store().assemblies[0]
    expect(own.contigIds).toEqual([made.contigIds[0]])
    expect(own.id).not.toBe(made.assemblyId)
    expect(store().contigs.find(c => c.id === made.contigIds[0])!.assemblyId).toBe(own.id)
  })

  it('opens an assembly with several contigs on its overview', () => {
    const made = two()
    expect(store().activeAssemblyId).toBe(made.assemblyId)
    expect(store().activeContigId).toBeNull()
  })

  it('moves a contig into an assembly of its own, filed beside the first', () => {
    const made = two()
    const folderId = store().createFolder('Runs')
    store().moveItemToFolder(`contig:${made.contigIds[1]}`, folderId)
    // Filing a contig files its assembly.
    expect(store().folders.find(f => f.id === folderId)!.itemUids).toEqual([`assembly:${made.assemblyId}`])

    const id = store().extractContig(made.contigIds[1])!
    expect(store().assemblies.map(a => a.contigIds)).toEqual([[made.contigIds[0]], [made.contigIds[1]]])
    expect(store().contigs.find(c => c.id === made.contigIds[1])!.assemblyId).toBe(id)
    expect(store().folders.find(f => f.id === folderId)!.itemUids).toEqual([`assembly:${made.assemblyId}`, `assembly:${id}`])
  })

  it('replaces the contigs on a re-run, and the returned undo puts them back', () => {
    const made = two()
    const run = { method: 'de-novo' as const, settings: { minIdentity: 0.95, minOverlap: 40, k: 12 }, inputs: { readIds: [], reference: null }, unplaced: [] }
    const undo = store().replaceAssemblyRun(made.assemblyId, run, [{ name: 'Contig 1', doc: testContig([testRow('a', 0, 'ATGCATGC')]) }])!
    const after = store().assemblies[0]
    expect(after.settings?.minIdentity).toBe(0.95)
    expect(after.contigIds).toHaveLength(1)
    expect(store().contigs).toHaveLength(1)
    // One contig now: the assembly opens straight onto it, under the assembly's name.
    expect(store().activeContigId).toBe(after.contigIds[0])
    expect(store().contigs[0].name).toBe('COI')

    undo()
    expect(store().assemblies[0].contigIds).toEqual(made.contigIds)
    expect(store().contigs.map(c => c.id)).toEqual(made.contigIds)
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
