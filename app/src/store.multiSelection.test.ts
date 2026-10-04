/**
 * Several ranges selected at once (Ctrl+drag, Ctrl+click on a feature).
 * Ranges that meet merge into the active one; the others are kept beside it
 * until anything edits the sequence, switches tab or sets the selection
 * some other way.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  useEditorStore, mergeSelections, joinedSegments, extraSelectionsOf, allSelectionsOf, orderSelections,
  type Selection,
} from './store'

const r = (anchor: number, caret: number, reverse?: boolean): Selection =>
  reverse === undefined ? { anchor, caret } : { anchor, caret, reverse }

describe('mergeSelections', () => {
  it('keeps ranges apart when they do not meet', () => {
    const m = mergeSelections(r(10, 20), [r(40, 50), r(0, 5)], 'linear', 100)
    expect(m.active).toEqual(r(10, 20))
    expect(m.others).toEqual([r(0, 5), r(40, 50)])
  })

  it('merges ranges that overlap or touch, in a chain', () => {
    // 10-20 overlaps 18-30, which then touches 30-35: all one range.
    const m = mergeSelections(r(10, 20, true), [r(30, 35), r(18, 30), r(60, 70)], 'linear', 100)
    expect(m.active).toEqual(r(10, 35, true))
    expect(m.others).toEqual([r(60, 70)])
  })

  it('swallows a range inside the active one', () => {
    const m = mergeSelections(r(10, 50), [r(20, 30)], 'linear', 100)
    expect(m.active).toEqual(r(10, 50, false))
    expect(m.others).toEqual([])
  })

  it('merges across the origin of a circular sequence', () => {
    // 90-100 and 0-5 meet at the origin: one range spanning it.
    const m = mergeSelections(r(90, 100), [r(0, 5)], 'circular', 100)
    expect(m.active).toEqual(r(90, 5, false))
    expect(m.others).toEqual([])
    // On a linear sequence the two ends do not meet.
    expect(mergeSelections(r(90, 100), [r(0, 5)], 'linear', 100).others).toEqual([r(0, 5)])
  })

  it('merges into a range that already spans the origin', () => {
    const m = mergeSelections(r(95, 3), [r(3, 8), r(80, 95)], 'circular', 100)
    expect(m.active).toEqual(r(80, 8, false))
  })

  it('lets a caret sit among ranges without merging, and drops empty ones', () => {
    const m = mergeSelections(r(15, 15), [r(10, 20), r(30, 30)], 'linear', 100)
    expect(m.active).toEqual(r(15, 15))
    expect(m.others).toEqual([r(10, 20)])
  })
})

describe('reading order', () => {
  it('reads ranges left to right, each 5 to 3', () => {
    expect(joinedSegments([r(40, 50), r(10, 20)], 'linear', 100)).toEqual([[10, 20], [40, 50]])
  })

  it('reads a range across the origin first, as a GenBank join does', () => {
    const ranges = [r(10, 20), r(95, 3)]
    expect(orderSelections(ranges, 'circular')).toEqual([r(95, 3), r(10, 20)])
    expect(joinedSegments(ranges, 'circular', 100)).toEqual([[95, 100], [0, 3], [10, 20]])
  })
})

describe('several ranges in the store', () => {
  beforeEach(() => {
    for (const tab of useEditorStore.getState().tabs) useEditorStore.getState().closeTab(tab.id)
    useEditorStore.getState().openDocument('pTest', 'AAAAACCCCCGGGGGTTTTT')
  })

  const extras = () => extraSelectionsOf(useEditorStore.getState())

  it('keeps the active range and the others', () => {
    useEditorStore.getState().setSelections(r(10, 15), [r(0, 5)])
    expect(useEditorStore.getState().selection).toEqual(r(10, 15))
    expect(extras()).toEqual([r(0, 5)])
    expect(allSelectionsOf(useEditorStore.getState())).toEqual([r(0, 5), r(10, 15)])
  })

  it('merges a dragged range into one it reaches, and parts again when dragged back', () => {
    const others = [r(0, 5)]
    useEditorStore.getState().setSelections(r(8, 12), others)
    expect(extras()).toEqual([r(0, 5)])
    // Dragged left onto the first range: one range.
    useEditorStore.getState().setSelections(r(4, 12, true), others)
    expect(useEditorStore.getState().selection).toEqual(r(0, 12, true))
    expect(extras()).toEqual([])
    // Back out again, still within the same drag: two ranges.
    useEditorStore.getState().setSelections(r(8, 12, true), others)
    expect(extras()).toEqual([r(0, 5)])
  })

  it('drops the other ranges when the selection is set any other way', () => {
    useEditorStore.getState().setSelections(r(10, 15), [r(0, 5)])
    useEditorStore.getState().setSelection(r(2, 3))
    expect(extras()).toEqual([])
    useEditorStore.getState().setSelections(r(10, 15), [r(0, 5)])
    useEditorStore.getState().setCaret(7)
    expect(extras()).toEqual([])
  })

  it('drops the other ranges when the bases change, and does not bring them back on undo', () => {
    useEditorStore.getState().setSelections(r(10, 15), [r(0, 5)])
    useEditorStore.getState().insert(20, 'A')
    expect(extras()).toEqual([])
    useEditorStore.getState().undo()
    expect(extras()).toEqual([])
  })

  it('belongs to its tab', () => {
    const first = useEditorStore.getState().activeTabId!
    useEditorStore.getState().setSelections(r(10, 15), [r(0, 5)])
    useEditorStore.getState().openDocument('other', 'ACGTACGTACGTACGTACGT')
    expect(extras()).toEqual([])
    useEditorStore.getState().setActiveTab(first)
    expect(extras()).toEqual([r(0, 5)])
  })

  it('deletes several spans in one undo entry', () => {
    useEditorStore.getState().deleteSegments([[0, 5], [10, 15]])
    expect(useEditorStore.getState().doc.sequence.bases).toBe('CCCCCTTTTT')
    useEditorStore.getState().undo()
    expect(useEditorStore.getState().doc.sequence.bases).toBe('AAAAACCCCCGGGGGTTTTT')
  })
})
