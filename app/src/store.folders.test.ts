import { describe, it, expect, beforeEach } from 'vitest'
import { useEditorStore, folderSubtree, type ExplorerFolder } from './store'
import { migrateFolders } from './persistence'
import { toUid } from './explorer/types'

const store = () => useEditorStore.getState()

function folder(over: Partial<ExplorerFolder> & { id: string }): ExplorerFolder {
  return { name: over.id, itemUids: [], parentId: null, collapsed: false, ...over }
}

/**
 * Folders hold uids of any kind now, and nest. The migration matters most:
 * every existing session on disk still has the old `tabIds` shape.
 */
describe('folders', () => {
  beforeEach(() => {
    for (const t of store().tabs) store().closeTab(t.id)
    useEditorStore.setState({
      folders: [], recentlyDeleted: [], itemMeta: {},
      sequencingReads: [], alignments: [], contigs: [],
    })
  })

  it('files an item of any kind', () => {
    const f = store().createFolder('Run 3')
    store().moveItemToFolder(toUid('read', 'r1'), f)
    store().moveItemToFolder(toUid('contig', 'c1'), f)
    expect(store().folders[0].itemUids).toEqual(['read:r1', 'contig:c1'])
  })

  // An item has one home, so filing it again has to move it, not copy it.
  it('moves rather than copies between folders', () => {
    const a = store().createFolder('A')
    const b = store().createFolder('B')
    store().moveItemToFolder('read:r1', a)
    store().moveItemToFolder('read:r1', b)

    expect(store().folders.find(f => f.id === a)!.itemUids).toEqual([])
    expect(store().folders.find(f => f.id === b)!.itemUids).toEqual(['read:r1'])
  })

  it('moves an item back to the top level with null', () => {
    const a = store().createFolder('A')
    store().moveItemToFolder('read:r1', a)
    store().moveItemToFolder('read:r1', null)
    expect(store().folders[0].itemUids).toEqual([])
  })

  it('nests a folder under another', () => {
    const parent = store().createFolder('Parent')
    const child = store().createFolder('Child')
    store().setFolderParent(child, parent)
    expect(store().folders.find(f => f.id === child)!.parentId).toBe(parent)
  })

  // Dropping a folder into its own descendant would detach that subtree from
  // the root and make it unreachable, so it is refused rather than repaired.
  it('refuses a re-parent that would make a cycle', () => {
    const parent = store().createFolder('Parent')
    const child = store().createFolder('Child')
    store().setFolderParent(child, parent)
    store().setFolderParent(parent, child)
    expect(store().folders.find(f => f.id === parent)!.parentId).toBeNull()
  })

  it('refuses to make a folder its own parent', () => {
    const f = store().createFolder('F')
    store().setFolderParent(f, f)
    expect(store().folders[0].parentId).toBeNull()
  })

  // "Delete folder, keep contents" has to mean the whole subtree survives.
  it('promotes child folders when a parent is deleted', () => {
    const parent = store().createFolder('Parent')
    const child = store().createFolder('Child')
    store().setFolderParent(child, parent)
    store().deleteFolder(parent)

    expect(store().folders.map(f => f.id)).toEqual([child])
    expect(store().folders[0].parentId).toBeNull()
  })

  it('deletes items of every kind in a subtree with the folder', () => {
    const tabId = store().openDocument('filed', 'ATGC')
    const parent = store().createFolder('Parent')
    const child = store().createFolder('Child')
    store().setFolderParent(child, parent)
    store().moveTabToFolder(tabId, child)

    store().deleteFolderWithContents(parent)
    expect(store().tabs).toHaveLength(0)
    expect(store().folders).toHaveLength(0)
  })

  it('restores folder membership when a delete is undone', () => {
    const tabId = store().openDocument('filed', 'ATGC')
    const f = store().createFolder('Run')
    store().moveTabToFolder(tabId, f)

    store().closeTab(tabId)
    expect(store().folders[0].itemUids).toEqual([])

    store().undoDelete()
    expect(store().folders[0].itemUids).toEqual([toUid('sequence', tabId)])
  })
})

describe('folderSubtree', () => {
  it('collects a folder and everything under it', () => {
    const folders = [
      folder({ id: 'a' }),
      folder({ id: 'b', parentId: 'a' }),
      folder({ id: 'c', parentId: 'b' }),
      folder({ id: 'd' }),
    ]
    expect([...folderSubtree(folders, 'a')].sort()).toEqual(['a', 'b', 'c'])
  })

  it('terminates on a cycle', () => {
    const folders = [folder({ id: 'a', parentId: 'b' }), folder({ id: 'b', parentId: 'a' })]
    expect([...folderSubtree(folders, 'a')].sort()).toEqual(['a', 'b'])
  })
})

describe('migrateFolders', () => {
  // Every session written before folders became kind-agnostic looks like this.
  it('turns legacy tabIds into sequence uids', () => {
    const migrated = migrateFolders([
      { id: 'f1', name: 'Cloning', tabIds: ['tab_1', 'tab_2'], collapsed: true },
    ])
    expect(migrated).toEqual([{
      id: 'f1', name: 'Cloning',
      itemUids: ['sequence:tab_1', 'sequence:tab_2'],
      parentId: null, color: undefined, collapsed: true,
    }])
  })

  it('leaves the new shape alone', () => {
    const migrated = migrateFolders([
      { id: 'f1', name: 'Run', itemUids: ['read:r1'], parentId: 'p', color: '#abc', collapsed: false },
    ])
    expect(migrated[0].itemUids).toEqual(['read:r1'])
    expect(migrated[0].parentId).toBe('p')
    expect(migrated[0].color).toBe('#abc')
  })

  it('survives junk', () => {
    expect(migrateFolders(undefined)).toEqual([])
    expect(migrateFolders('nonsense')).toEqual([])
    expect(migrateFolders([{ nope: true }, null])).toEqual([])
  })
})
