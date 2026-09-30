/**
 * The primer library: session-wide oligos, listed in the explorer, deleted
 * through the same undo buffer as everything else, and offered to any
 * sequence they bind.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useEditorStore } from './store'
import { toUid } from './explorer/types'
import { libraryMatches } from './primers/library'
import { remapSessionIds } from './persistence'

const store = () => useEditorStore.getState()

function template(n: number, seed = 21): string {
  let x = seed
  let s = ''
  for (let i = 0; i < n; i++) {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5
    s += 'ACGT'[(x >>> 7) & 3]
  }
  return s
}
const T = template(1500)

describe('primer library', () => {
  beforeEach(() => {
    for (const tab of store().tabs) store().closeTab(tab.id)
    useEditorStore.setState({ oligos: [], folders: [], itemMeta: {}, recentlyDeleted: [] })
  })

  it('adds oligos and skips exact duplicates', () => {
    const ids = store().addLibraryOligos([
      { name: 'F', sequence: T.slice(100, 120), role: 'primer' },
      { name: 'F', sequence: T.slice(100, 120), role: 'primer' },
    ])
    expect(ids).toHaveLength(1)
    expect(store().addLibraryOligos([{ name: 'F', sequence: T.slice(100, 120), role: 'primer' }])).toEqual([])
    expect(store().oligos).toHaveLength(1)
  })

  it('renames, and deletes through the undo buffer back into its folder', () => {
    const [id] = store().addLibraryOligos([{ name: 'F', sequence: T.slice(100, 120), role: 'primer' }])
    store().updateLibraryOligo(id, { name: 'Fwd' })
    const folder = store().createFolder('Primers')
    store().moveItemToFolder(toUid('oligo', id), folder)

    store().removeLibraryOligo(id)
    expect(store().oligos).toEqual([])
    store().undoDelete()
    expect(store().oligos.map(o => o.name)).toEqual(['Fwd'])
    expect(store().folders[0].itemUids).toContain(toUid('oligo', id))
  })

  it('goes with its folder when the folder is deleted with its contents', () => {
    const [id] = store().addLibraryOligos([{ name: 'F', sequence: T.slice(100, 120), role: 'primer' }])
    const folder = store().createFolder('Primers')
    store().moveItemToFolder(toUid('oligo', id), folder)
    store().deleteFolderWithContents(folder)
    expect(store().oligos).toEqual([])
  })

  it('keeps an oligo’s star and note when metadata is pruned', () => {
    const [id] = store().addLibraryOligos([{ name: 'F', sequence: T.slice(100, 120), role: 'primer' }])
    store().toggleItemStar(toUid('oligo', id))
    store().pruneItemMeta()
    expect(store().itemMeta[toUid('oligo', id)]?.starred).toBe(true)
  })

  it('offers library oligos that bind a sequence and are not on it yet', () => {
    store().addLibraryOligos([
      { name: 'binds', sequence: T.slice(200, 222), role: 'primer' },
      { name: 'elsewhere', sequence: template(22, 99), role: 'primer' },
      { name: 'already', sequence: T.slice(400, 422), role: 'primer' },
    ])
    store().openDocument('pLib', T)
    store().addPrimers([{ id: 'p1', name: 'already here', sequence: T.slice(400, 422), role: 'primer' }])
    expect(libraryMatches(store().oligos, store().doc).map(m => m.oligo.name)).toEqual(['binds'])
  })

  it('records which tab the user opened, for the "library primers bind this" notice', () => {
    const id = store().openDocument('pNew', T)
    expect(store().lastOpenedTabId).toBe(id)
  })

  it('remaps oligo ids and their metadata when a session is merged', () => {
    const session = {
      tabs: [], activeTabId: null, folders: [], theme: 'light',
      itemMeta: { 'oligo:libo_1': { starred: true } },
      tagColors: {},
      sequencingReads: [], activeSequencingReadIds: [],
      alignments: [], readAlignments: [], contigs: [], gels: [],
      oligos: [{ id: 'libo_1', name: 'F', sequence: 'ACGTACGTACGTACGTAC', role: 'primer' as const, createdAt: 1 }],
    }
    const remapped = remapSessionIds(session)
    const newId = remapped.oligos[0].id
    expect(newId).not.toBe('libo_1')
    expect(remapped.itemMeta[toUid('oligo', newId)]).toEqual({ starred: true })
  })
})
