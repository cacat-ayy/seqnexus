import { describe, it, expect, beforeEach } from 'vitest'
import { useEditorStore } from './store'
import { toUid } from './explorer/types'
import { digestWorkspace, gelsUsingSequences, newLaneId } from './gel/workspace'

const store = () => useEditorStore.getState()

/**
 * Deleting a sequence takes the gel lanes made from it, since there is
 * nothing left to run in them, and its undo puts them back.
 */
describe('gel lanes of a deleted sequence', () => {
  beforeEach(() => {
    for (const tab of store().tabs) store().closeTab(tab.id)
    useEditorStore.setState({ recentlyDeleted: [], gels: [], activeGelId: null, folders: [] })
  })

  function gelWithPcr(seqId: string, otherId: string) {
    const state = digestWorkspace(seqId, ['EcoRI'])
    state.lanes.push(
      { id: newLaneId(), sample: { kind: 'pcr', templateId: seqId, forwardId: 'f', reverseId: 'r', ng: 100 } },
      { id: newLaneId(), sample: { kind: 'sequence', sourceId: otherId, enzymes: [], ng: 500 } },
    )
    return store().createGel({ state, activate: false, name: 'Digest' })
  }

  it('counts lanes run from the sequence and PCR lanes templated on it', () => {
    const seq = store().openDocument('pA', 'ACGT'.repeat(50), 'circular')
    const other = store().openDocument('pB', 'ACGT'.repeat(50), 'circular')
    const gelId = gelWithPcr(seq, other)
    expect(gelsUsingSequences(store().gels, new Set([seq]))).toEqual([{ id: gelId, name: 'Digest', lanes: 3 }])
    expect(gelsUsingSequences(store().gels, new Set(['nothing']))).toEqual([])
  })

  it('removes those lanes on delete and restores them in place on undo', () => {
    const seq = store().openDocument('pA', 'ACGT'.repeat(50), 'circular')
    const other = store().openDocument('pB', 'ACGT'.repeat(50), 'circular')
    gelWithPcr(seq, other)
    const before = store().gels[0].state.lanes

    store().closeTab(seq)
    const after = store().gels[0].state.lanes
    expect(after.map(l => l.sample.kind)).toEqual(['ladder', 'sequence'])
    expect(after[1].sample).toMatchObject({ sourceId: other })
    // Not a gel edit, so the gel's own undo is untouched.
    expect(store().gels[0].undoStack).toHaveLength(0)

    store().undoDelete()
    expect(store().gels[0].state.lanes).toEqual(before)
  })

  it('leaves gels that do not use the sequence alone', () => {
    const seq = store().openDocument('pA', 'ACGT'.repeat(50), 'circular')
    const other = store().openDocument('pB', 'ACGT'.repeat(50), 'circular')
    store().createGel({ state: digestWorkspace(other, ['EcoRI']), activate: false })
    const untouched = store().gels[0]

    store().closeTab(seq)
    expect(store().gels[0]).toBe(untouched)
    expect(store().recentlyDeleted[store().recentlyDeleted.length - 1]).not.toHaveProperty('gelLanes')
  })

  it('removes them when a folder is deleted with its contents', () => {
    const seq = store().openDocument('pA', 'ACGT'.repeat(50), 'circular')
    const other = store().openDocument('pB', 'ACGT'.repeat(50), 'circular')
    gelWithPcr(seq, other)
    const folderId = store().createFolder('Old')
    store().moveItemToFolder(toUid('sequence', seq), folderId)

    store().deleteFolderWithContents(folderId)
    expect(store().gels[0].state.lanes.map(l => l.sample.kind)).toEqual(['ladder', 'sequence'])
  })
})
