/**
 * Undo entries hold a PieceTable tree that points into the tab's text buffers.
 * Changing topology and moving the origin used to swap in a brand-new
 * Sequence, so undoing past either restored trees against the wrong buffers
 * and silently produced the wrong bases.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useEditorStore } from './store'

const store = () => useEditorStore.getState()
const tab = () => store().tabs.find(t => t.id === store().activeTabId)!
const bases = () => tab().doc.sequence.bases
const topology = () => tab().doc.sequence.topology

const ORIGINAL = 'AAAACCCCGGGGTTTT'

beforeEach(() => {
  for (const t of store().tabs) store().closeTab(t.id)
  store().openDocument('pTest', ORIGINAL, 'linear')
})

describe('undo across a topology change', () => {
  it('restores the bases and the topology', () => {
    store().insert(4, 'XX')
    store().updateDocumentProperties({ topology: 'circular' })
    expect(topology()).toBe('circular')

    store().undo()
    expect(topology()).toBe('linear')
    expect(bases()).toBe('AAAAXXCCCCGGGGTTTT')

    store().undo()
    expect(bases()).toBe(ORIGINAL)
  })

  it('redoes both steps', () => {
    store().insert(4, 'XX')
    store().updateDocumentProperties({ topology: 'circular' })
    store().undo()
    store().undo()
    store().redo()
    expect(bases()).toBe('AAAAXXCCCCGGGGTTTT')
    expect(topology()).toBe('linear')
    store().redo()
    expect(topology()).toBe('circular')
  })

  it('keeps the tab on the same piece table', () => {
    const pt = tab().doc.sequence.pieceTable
    store().updateDocumentProperties({ topology: 'circular' })
    expect(tab().doc.sequence.pieceTable).toBe(pt)
  })
})

describe('undo across "Move origin"', () => {
  beforeEach(() => {
    store().updateDocumentProperties({ topology: 'circular' })
  })

  it('restores the bases', () => {
    store().insert(0, 'X')
    store().rotateOrigin(5)
    expect(bases()).toBe('CCCCGGGGTTTTXAAAA')

    store().undo()
    expect(bases()).toBe('XAAAACCCCGGGGTTTT')
    store().undo()
    expect(bases()).toBe(ORIGINAL)
    store().undo()
    expect(bases()).toBe(ORIGINAL)
    expect(topology()).toBe('linear')
  })

  it('moves features with the bases and brings them back on undo', () => {
    store().addAnnotation({ id: 'f', name: 'f', type: 'misc_feature', start: 4, end: 8, strand: 1 })
    store().rotateOrigin(6)
    expect(bases()).toBe('CCGGGGTTTTAAAACC')
    const moved = tab().doc.annotations[0]
    expect([moved.start, moved.end]).toEqual([14, 2])
    expect(bases().slice(moved.start) + bases().slice(0, moved.end)).toBe('CCCC')
    store().undo()
    expect(tab().doc.annotations[0]).toMatchObject({ start: 4, end: 8 })
    expect(bases()).toBe(ORIGINAL)
  })

  it('survives a long run of edits, rotations and topology flips undone to the start', () => {
    let seed = 7
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed % n
    }
    // Every operation below pushes exactly one undo entry, so undo k must
    // land on the state recorded k operations back.
    const history: { bases: string; topology: string }[] = []
    for (let i = 0; i < 60; i++) {
      history.push({ bases: bases(), topology: topology() })
      const len = bases().length
      const op = rand(5)
      if (op === 0 && topology() === 'circular' && len > 1) store().rotateOrigin(1 + rand(len - 1))
      else if (op === 1) store().updateDocumentProperties({ topology: topology() === 'circular' ? 'linear' : 'circular' })
      else if (op === 2 && len > 2) {
        const s = rand(len - 1)
        store().delete(s, s + 1 + rand(Math.min(4, len - s - 1)))
      } else store().insert(rand(len + 1), 'ACGT'.slice(0, 1 + rand(4)))
    }
    for (let k = history.length - 1; k >= 0; k--) {
      store().undo()
      expect({ bases: bases(), topology: topology() }).toEqual(history[k])
    }
  })
})
