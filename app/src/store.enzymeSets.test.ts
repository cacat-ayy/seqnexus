import { describe, it, expect, beforeEach } from 'vitest'
import { useEditorStore } from './store'
import { exportSessionToJson, importSessionFromJson, savedStateChanged } from './persistence'
import { DEFAULT_SUBSET, setKey } from './enzymes/sets'

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

describe('saved enzyme sets', () => {
  beforeEach(() => {
    useEditorStore.setState({ enzymeSets: [], enzymeSubset: DEFAULT_SUBSET })
  })

  it('saves a set under a name no other set has, without duplicate enzymes', () => {
    store().addEnzymeSet('BioBrick', ['EcoRI', 'XbaI'])
    const id = store().addEnzymeSet('BioBrick', ['EcoRI', 'EcoRI', 'PstI'])
    const added = store().enzymeSets.find(s => s.id === id)!
    expect(added.name).toBe('BioBrick 2')
    expect(added.enzymes).toEqual(['EcoRI', 'PstI'])
  })

  it('renames and edits a set', () => {
    const id = store().addEnzymeSet('Mine', ['EcoRI'])
    store().renameEnzymeSet(id, 'Cloning sites')
    store().setEnzymeSetEnzymes(id, ['BamHI', 'HindIII'])
    expect(store().enzymeSets[0]).toMatchObject({ name: 'Cloning sites', enzymes: ['BamHI', 'HindIII'] })
  })

  it('goes back to the default subset when the set the panel shows is deleted', () => {
    const id = store().addEnzymeSet('Mine', ['EcoRI'])
    store().setEnzymeParams({ enzymeSubset: setKey(id) })
    store().removeEnzymeSet(id)
    expect(store().enzymeSets).toEqual([])
    expect(store().enzymeSubset).toBe(DEFAULT_SUBSET)
  })

  it('merges sets from another session, skipping ones already saved', () => {
    store().addEnzymeSet('BioBrick', ['EcoRI', 'XbaI'])
    store().mergeEnzymeSets([
      { id: 'enzset_1', name: 'BioBrick', enzymes: ['EcoRI', 'XbaI'], createdAt: 0 },
      { id: 'enzset_2', name: 'BioBrick', enzymes: ['PstI'], createdAt: 0 },
    ])
    expect(store().enzymeSets.map(s => [s.name, s.enzymes])).toEqual([
      ['BioBrick', ['EcoRI', 'XbaI']],
      ['BioBrick 2', ['PstI']],
    ])
    expect(new Set(store().enzymeSets.map(s => s.id)).size).toBe(2)
  })

  it('gives new sets ids past those of a restored session', () => {
    store().restoreEnzymeSets([{ id: 'enzset_40', name: 'Old', enzymes: ['EcoRI'], createdAt: 0 }])
    const id = store().addEnzymeSet('New', ['BamHI'])
    expect(id).not.toBe('enzset_40')
    expect(Number(id.split('_')[1])).toBeGreaterThan(40)
  })

  it('travels in a session file', async () => {
    store().addEnzymeSet('BioBrick', ['EcoRI', 'XbaI', 'SpeI', 'PstI'])
    const blob = exportSessionToJson('light', { includeReads: false, includeAlignments: false, includeContigs: false })
    const session = importSessionFromJson(await blobText(blob))
    expect(session.enzymeSets?.map(s => [s.name, s.enzymes])).toEqual([['BioBrick', ['EcoRI', 'XbaI', 'SpeI', 'PstI']]])
  })

  it('is saved when it changes, as the guide library is', () => {
    const before = store()
    store().addEnzymeSet('Mine', ['EcoRI'])
    expect(savedStateChanged(store(), before)).toBe(true)
    const beforeGuides = store()
    useEditorStore.setState({ guideLibrary: [...store().guideLibrary] })
    expect(savedStateChanged(store(), beforeGuides)).toBe(true)
  })
})
