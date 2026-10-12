import { describe, it, expect, beforeEach } from 'vitest'
import { useEditorStore, mergeFolderTrees, type ExplorerFolder } from './store'
import { remapSessionIds, type RestoredSession } from './persistence'
import { makeDoc } from './msa/model'

const store = () => useEditorStore.getState()

const folder = (over: Partial<ExplorerFolder> & { id: string; name: string }): ExplorerFolder =>
  ({ itemUids: [], parentId: null, collapsed: false, ...over }) as ExplorerFolder

function emptySession(over: Partial<RestoredSession> = {}): RestoredSession {
  return {
    tabs: [], activeTabId: null, folders: [], theme: 'light', itemMeta: {}, tagColors: {},
    sequencingReads: [], activeSequencingReadIds: [], alignments: [], contigs: [], assemblies: [],
    readSets: [], oligos: [], gels: [], clones: [],
    ...over,
  } as RestoredSession
}

describe('opening a new sequence', () => {
  beforeEach(() => {
    for (const t of store().tabs) store().closeTab(t.id)
    useEditorStore.setState({ alignments: [], activeAlignmentId: null, recentlyDeleted: [] })
  })

  it('shows it in place of an open alignment, which used to stay on screen in front of it', () => {
    store().openDocument('first', 'ACGT')
    store().addAlignment(makeDoc([{ name: 'a', seq: 'ACGT' }, { name: 'b', seq: 'ACGA' }], { method: 'mafft', at: 1 }))
    expect(store().activeAlignmentId).not.toBeNull()

    const id = store().openDocument('new', 'GGGG')
    expect(store().activeTabId).toBe(id)
    expect(store().activeAlignmentId).toBeNull()
    expect(store().doc.name).toBe('new')
    expect(store().lastOpenedTabId).toBe(id)
  })

  it('keeps the outgoing tab its analysis results', () => {
    const first = store().openDocument('first', 'ACGTACGT')
    useEditorStore.setState({ enzymeNames: ['EcoRI'] })
    store().openDocument('second', 'GGGG')
    expect(store().enzymeNames).toEqual([])
    expect(store().tabs.find(t => t.id === first)!.enzymeNames).toEqual(['EcoRI'])
  })
})

describe('mergeFolderTrees', () => {
  it('keeps the subfolders of a folder that merged into one of the same name', () => {
    const existing = [folder({ id: 'p', name: 'Plasmids', itemUids: ['sequence:a'] })]
    const imported = [
      // Child first, to show the order of the file does not matter.
      folder({ id: 'c2', name: 'Old', parentId: 'p2', itemUids: ['sequence:c'] }),
      folder({ id: 'p2', name: 'Plasmids', itemUids: ['sequence:b'] }),
    ]
    const out = mergeFolderTrees(existing, imported)
    expect(out.find(f => f.id === 'p')!.itemUids).toEqual(['sequence:a', 'sequence:b'])
    expect(out.some(f => f.id === 'p2')).toBe(false)
    // The child follows its parent into the folder it merged with.
    expect(out.find(f => f.id === 'c2')!.parentId).toBe('p')
  })

  it('merges only folders under the same parent', () => {
    const existing = [
      folder({ id: 'p', name: 'Project' }),
      folder({ id: 'n', name: 'Notes', parentId: 'p' }),
    ]
    const out = mergeFolderTrees(existing, [folder({ id: 'n2', name: 'Notes' })])
    expect(out.find(f => f.id === 'n2')!.parentId).toBeNull()
  })

  it('never changes the existing folders in place', () => {
    const before = folder({ id: 'p', name: 'Plasmids', itemUids: ['sequence:a'] })
    const out = mergeFolderTrees([before], [folder({ id: 'p2', name: 'Plasmids', itemUids: ['sequence:b'] })])
    expect(before.itemUids).toEqual(['sequence:a'])
    expect(out[0]).not.toBe(before)
  })

  it('drops a parent that is not in the import, and survives a cycle', () => {
    const out = mergeFolderTrees([], [
      folder({ id: 'x', name: 'Orphan', parentId: 'missing' }),
      folder({ id: 'a', name: 'A', parentId: 'b' }),
      folder({ id: 'b', name: 'B', parentId: 'a' }),
    ])
    expect(out.find(f => f.id === 'x')!.parentId).toBeNull()
    expect(out).toHaveLength(3)
  })
})

describe('merging a session', () => {
  beforeEach(() => {
    useEditorStore.setState({ guideLibrary: [], enzymeSets: [], folders: [] })
  })

  it('carries the guide library and enzyme sets through the id remap', () => {
    const guide = { id: 'guide_1', name: 'g1', nucleaseId: 'spcas9', spacer: 'ACGTACGTACGTACGTACGT', pam: 'AGG', createdAt: 1, origin: { documentId: 'tab_1', start: 0, end: 20 } }
    const session = emptySession({
      tabs: [{ id: 'tab_1', doc: { name: 'x' } } as never],
      guides: [guide] as never,
      enzymeSets: [{ name: 'Mine', enzymes: ['EcoRI'] }] as never,
    })
    const remapped = remapSessionIds(session)
    expect(remapped.enzymeSets).toEqual([{ name: 'Mine', enzymes: ['EcoRI'] }])
    expect(remapped.guides).toHaveLength(1)
    expect(remapped.guides![0].origin!.documentId).toBe(remapped.tabs[0].id)
  })

  it('adds merged guides to the library under fresh ids', () => {
    const [kept] = store().addGuides([{ name: 'g1', nucleaseId: 'spcas9', spacer: 'A'.repeat(20), pam: 'AGG' }] as never)
    const incoming = { ...store().guideLibrary[0] }
    store().mergeSession([], [], [], [], [], {}, {}, [], [incoming])
    const lib = store().guideLibrary
    expect(lib).toHaveLength(2)
    expect(new Set(lib.map(g => g.id)).size).toBe(2)
    expect(lib[0].id).toBe(kept)
    expect(lib[1].name).not.toBe(lib[0].name)
  })
})
