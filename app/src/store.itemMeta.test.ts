import { describe, it, expect, beforeEach } from 'vitest'
import { useEditorStore } from './store'
import { toUid } from './explorer/types'

const store = () => useEditorStore.getState()

/**
 * Favourites and notes live in one uid-keyed map rather than as fields on
 * five item types, because favourites have to span kinds to be useful.
 */
describe('item metadata', () => {
  beforeEach(() => {
    for (const t of store().tabs) store().closeTab(t.id)
    useEditorStore.setState({ itemMeta: {}, recentlyDeleted: [] })
  })

  it('stars and unstars an item', () => {
    const uid = toUid('sequence', 'tab_x')
    store().toggleItemStar(uid)
    expect(store().itemMeta[uid]?.starred).toBe(true)

    store().toggleItemStar(uid)
    // Unstarring drops the entry entirely rather than leaving
    // `{ starred: false }` behind, so the persisted map stays small.
    expect(store().itemMeta[uid]).toBeUndefined()
  })

  it('keeps a note when the star is removed', () => {
    const uid = toUid('read', 'r1')
    store().toggleItemStar(uid)
    store().setItemNote(uid, 'bad peak at 340')
    store().toggleItemStar(uid)

    expect(store().itemMeta[uid]).toEqual({ note: 'bad peak at 340' })
  })

  it('trims a note and treats an empty one as no note', () => {
    const uid = toUid('contig', 'c1')
    store().setItemNote(uid, '  spaced  ')
    expect(store().itemMeta[uid]?.note).toBe('spaced')

    store().setItemNote(uid, '   ')
    expect(store().itemMeta[uid]).toBeUndefined()
  })

  it('stars items of different kinds independently', () => {
    store().toggleItemStar(toUid('sequence', 'a'))
    store().toggleItemStar(toUid('read', 'a'))
    expect(Object.keys(store().itemMeta)).toEqual(['sequence:a', 'read:a'])
  })

  it('prunes metadata for items that no longer exist', () => {
    const id = store().openDocument('pTest', 'ATGC')
    store().toggleItemStar(toUid('sequence', id))
    store().toggleItemStar(toUid('sequence', 'never-existed'))

    store().pruneItemMeta()
    expect(Object.keys(store().itemMeta)).toEqual([toUid('sequence', id)])
  })
})
