import { describe, it, expect, beforeEach } from 'vitest'
import { exportSessionToJson, importSessionFromJson, remapSessionIds } from './persistence'
import { useEditorStore } from './store'
import { toUid } from './explorer/types'

const store = () => useEditorStore.getState()

/** jsdom's Blob has no `.text()`, so read it the long way. */
function blobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(blob)
  })
}

async function exportedSession() {
  const blob = exportSessionToJson('light', {
    includeReads: false, includeAlignments: false, includeReadAlignments: false,
  })
  return importSessionFromJson(await blobText(blob))
}

/**
 * Favourites and notes travel with the session. The remap is the part worth
 * covering: metadata is keyed by `${kind}:${id}`, and a merge-import rewrites
 * every id, so without following the key through the maps an imported
 * favourite would reattach to whichever existing item held the old id.
 */
describe('item metadata in a session', () => {
  beforeEach(() => {
    for (const t of store().tabs) store().closeTab(t.id)
    useEditorStore.setState({ itemMeta: {}, recentlyDeleted: [], folders: [] })
  })

  it('survives an export and import round trip', async () => {
    const id = store().openDocument('pStar', 'ATGC')
    store().toggleItemStar(toUid('sequence', id))
    store().setItemNote(toUid('sequence', id), 'the good one')

    const session = await exportedSession()
    expect(session.itemMeta[toUid('sequence', id)]).toEqual({
      starred: true, note: 'the good one',
    })
  })

  it('leaves metadata out entirely when nothing is starred or noted', async () => {
    store().openDocument('plain', 'ATGC')
    expect(await exportedSession()).toHaveProperty('itemMeta', {})
  })

  it('drops metadata for items that were deleted but are still undoable', async () => {
    const id = store().openDocument('doomed', 'ATGC')
    store().toggleItemStar(toUid('sequence', id))
    store().closeTab(id)

    // The tab is still in the delete buffer, so its metadata is still in the
    // store; it just must not be written out as if the item existed.
    expect(store().itemMeta[toUid('sequence', id)]).toBeDefined()
    expect(await exportedSession()).toHaveProperty('itemMeta', {})
  })

  it('follows its item through an id remap', async () => {
    const id = store().openDocument('pStar', 'ATGC')
    store().toggleItemStar(toUid('sequence', id))

    const session = await exportedSession()
    const remapped = remapSessionIds(session)
    const newId = remapped.tabs[0].id

    expect(newId).not.toBe(id)
    expect(remapped.itemMeta[toUid('sequence', newId)]).toEqual({ starred: true })
    expect(remapped.itemMeta[toUid('sequence', id)]).toBeUndefined()
  })

  it('drops metadata whose item did not come along', () => {
    const session = {
      tabs: [], activeTabId: null, folders: [], theme: 'light',
      itemMeta: { 'read:gone': { starred: true }, 'nonsense': { starred: true } },
      tagColors: {},
      sequencingReads: [], activeSequencingReadIds: [],
      alignments: [], readAlignments: [], contigs: [],
    }
    expect(remapSessionIds(session).itemMeta).toEqual({})
  })
})
