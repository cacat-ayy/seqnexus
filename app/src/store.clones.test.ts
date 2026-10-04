/**
 * A cloning design is an item the user owns: it is created, edited with undo,
 * renamed, duplicated, deleted and brought back, and opening it puts away
 * whatever else was on screen.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useEditorStore } from './store'
import { Sequence } from './models/Sequence'
import { emptyDesign, partFromDoc } from './cloning/design'

const reset = () => {
  useEditorStore.setState({
    tabs: [], activeTabId: null, clones: [], activeCloneId: null, cloneReturnTabId: null,
    gels: [], activeGelId: null, folders: [], recentlyDeleted: [],
  })
}

const openSequence = (name: string, bases: string, topology: 'linear' | 'circular') => {
  const s = useEditorStore.getState()
  s.openDocumentState({ name, sequence: new Sequence(bases, topology), annotations: [] })
  return useEditorStore.getState().activeTabId!
}

describe('creating a design', () => {
  beforeEach(reset)

  it('starts from the sequence in view, as the vector when it is circular', () => {
    openSequence('pUC', 'ACGT'.repeat(100), 'circular')
    const id = useEditorStore.getState().createClone()
    const design = useEditorStore.getState().clones.find(c => c.id === id)!.design
    expect(design.parts).toHaveLength(1)
    expect(design.parts[0].role).toBe('vector')
    expect(design.parts[0].name).toBe('pUC')
  })

  it('takes a linear sequence as the insert instead', () => {
    openSequence('pcr', 'ACGT'.repeat(50), 'linear')
    const id = useEditorStore.getState().createClone()
    expect(useEditorStore.getState().clones.find(c => c.id === id)!.design.parts[0].role).toBe('insert')
  })

  it('names itself after the sequence it started from', () => {
    openSequence('pUC', 'ACGT'.repeat(100), 'circular')
    const id = useEditorStore.getState().createClone()
    expect(useEditorStore.getState().clones.find(c => c.id === id)!.name).toBe('pUC cloning')
  })

  it('remembers which sequence a part came from', () => {
    const tabId = openSequence('pUC', 'ACGT'.repeat(100), 'circular')
    const id = useEditorStore.getState().createClone()
    expect(useEditorStore.getState().clones.find(c => c.id === id)!.design.parts[0].source?.id).toBe(tabId)
  })

  it('starts empty when nothing is open', () => {
    const id = useEditorStore.getState().createClone()
    const clone = useEditorStore.getState().clones.find(c => c.id === id)!
    expect(clone.design.parts).toEqual([])
    expect(clone.name).toBe('Cloning 1')
  })

  it('opens it and puts away the sequence that was on screen', () => {
    const tabId = openSequence('pUC', 'ACGT'.repeat(100), 'circular')
    const id = useEditorStore.getState().createClone()
    const s = useEditorStore.getState()
    expect(s.activeCloneId).toBe(id)
    expect(s.activeTabId).toBeNull()
    expect(s.cloneReturnTabId).toBe(tabId)
  })

  it('goes back to that sequence when closed', () => {
    const tabId = openSequence('pUC', 'ACGT'.repeat(100), 'circular')
    useEditorStore.getState().createClone()
    useEditorStore.getState().setActiveClone(null)
    expect(useEditorStore.getState().activeTabId).toBe(tabId)
  })

  it('can be made without opening it', () => {
    openSequence('pUC', 'ACGT'.repeat(100), 'circular')
    const id = useEditorStore.getState().createClone({ activate: false })
    expect(useEditorStore.getState().activeCloneId).toBeNull()
    expect(useEditorStore.getState().clones.some(c => c.id === id)).toBe(true)
  })
})

describe('editing a design', () => {
  beforeEach(reset)

  const start = () => useEditorStore.getState().createClone({ design: emptyDesign('restriction') })

  it('records an undo step per change', () => {
    const id = start()
    const s = useEditorStore.getState()
    s.updateClone(id, d => ({ ...d, enzymes: ['EcoRI'] }))
    s.updateClone(id, d => ({ ...d, enzymes: ['EcoRI', 'BamHI'] }))
    expect(useEditorStore.getState().clones.find(c => c.id === id)!.design.enzymes).toHaveLength(2)

    useEditorStore.getState().undoClone(id)
    expect(useEditorStore.getState().clones.find(c => c.id === id)!.design.enzymes).toEqual(['EcoRI'])
    useEditorStore.getState().undoClone(id)
    expect(useEditorStore.getState().clones.find(c => c.id === id)!.design.enzymes).toEqual([])
    useEditorStore.getState().redoClone(id)
    expect(useEditorStore.getState().clones.find(c => c.id === id)!.design.enzymes).toEqual(['EcoRI'])
  })

  it('merges changes that share a key into one step', () => {
    const id = start()
    const s = useEditorStore.getState()
    s.updateClone(id, d => ({ ...d, minOverlap: 2 }), 'overlap')
    s.updateClone(id, d => ({ ...d, minOverlap: 20 }), 'overlap')
    s.updateClone(id, d => ({ ...d, minOverlap: 25 }), 'overlap')
    useEditorStore.getState().undoClone(id)
    expect(useEditorStore.getState().clones.find(c => c.id === id)!.design.minOverlap).toBeUndefined()
  })

  it('does nothing when the change returns the same design', () => {
    const id = start()
    useEditorStore.getState().updateClone(id, d => d)
    expect(useEditorStore.getState().clones.find(c => c.id === id)!.undoStack).toHaveLength(0)
  })

  it('bumps the modified time', () => {
    const id = start()
    const before = useEditorStore.getState().clones.find(c => c.id === id)!.modifiedAt
    useEditorStore.getState().updateClone(id, d => ({ ...d, purify: false }))
    expect(useEditorStore.getState().clones.find(c => c.id === id)!.modifiedAt).toBeGreaterThanOrEqual(before)
  })
})

describe('managing designs', () => {
  beforeEach(reset)

  it('renames one', () => {
    const id = useEditorStore.getState().createClone()
    useEditorStore.getState().renameClone(id, 'My construct')
    expect(useEditorStore.getState().clones.find(c => c.id === id)!.name).toBe('My construct')
  })

  it('duplicates one, without its history, and opens the copy', () => {
    const id = useEditorStore.getState().createClone({ design: emptyDesign('golden-gate') })
    useEditorStore.getState().updateClone(id, d => ({ ...d, typeIIS: 'BsmBI' }))
    const copyId = useEditorStore.getState().duplicateClone(id)!

    const copy = useEditorStore.getState().clones.find(c => c.id === copyId)!
    expect(copy.name).toBe('Cloning 1 copy')
    expect(copy.design.typeIIS).toBe('BsmBI')
    expect(copy.undoStack).toEqual([])
    expect(useEditorStore.getState().activeCloneId).toBe(copyId)
  })

  it('deletes one and brings it back with undo', () => {
    const id = useEditorStore.getState().createClone({ design: emptyDesign('topo') })
    useEditorStore.getState().removeClone(id)
    expect(useEditorStore.getState().clones).toHaveLength(0)
    expect(useEditorStore.getState().activeCloneId).toBeNull()

    useEditorStore.getState().undoDelete()
    const back = useEditorStore.getState().clones
    expect(back).toHaveLength(1)
    expect(back[0].design.method).toBe('topo')
    expect(useEditorStore.getState().activeCloneId).toBe(id)
  })

  it('keeps designs apart from one another', () => {
    const a = useEditorStore.getState().createClone({ name: 'A' })
    const b = useEditorStore.getState().createClone({ name: 'B' })
    useEditorStore.getState().updateClone(a, d => ({ ...d, purify: false }))
    expect(useEditorStore.getState().clones.find(c => c.id === b)!.design.purify).toBe(true)
  })
})

describe('designs and the rest of the workspace', () => {
  beforeEach(reset)

  it('closes an open gel when a design is opened', () => {
    openSequence('pUC', 'ACGT'.repeat(100), 'circular')
    const gelId = useEditorStore.getState().createGel()
    expect(useEditorStore.getState().activeGelId).toBe(gelId)

    useEditorStore.getState().createClone()
    expect(useEditorStore.getState().activeGelId).toBeNull()
  })

  it('is closed when a sequence is opened instead', () => {
    openSequence('pUC', 'ACGT'.repeat(100), 'circular')
    useEditorStore.getState().createClone()
    const tabId = openSequence('other', 'ACGT'.repeat(30), 'linear')
    expect(useEditorStore.getState().activeTabId).toBe(tabId)
    expect(useEditorStore.getState().activeCloneId).toBeNull()
  })

  it('takes a part from a sequence without a tab of its own', () => {
    const design = emptyDesign('homology')
    const part = partFromDoc(
      { name: 'synthetic', sequence: new Sequence('ACGT'.repeat(40), 'linear'), annotations: [] },
    )
    const id = useEditorStore.getState().createClone({ design: { ...design, parts: [part] } })
    const saved = useEditorStore.getState().clones.find(c => c.id === id)!
    expect(saved.design.parts[0].source).toBeUndefined()
    expect(saved.design.parts[0].bases).toHaveLength(160)
  })
})
