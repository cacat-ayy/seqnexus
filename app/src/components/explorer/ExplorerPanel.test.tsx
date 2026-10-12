/**
 * Panel wiring: that items of every kind reach the tree, that the three row
 * states stay distinct, and that starring round-trips through the store.
 */
import { render, act, cleanup, fireEvent } from '@testing-library/react'
import { Plus } from 'lucide-react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import ExplorerPanel from './ExplorerPanel'
import { useEditorStore } from '../../store'
import { toUid } from '../../explorer/types'
import { digestWorkspace } from '../../gel/workspace'
import type { AlignmentResult } from '../../alignment/types'
import { docFromResult } from '../../msa/model'
import type { Ab1Data } from '../../io/ab1'
import { testContig, testRow } from '../../assembly/testing'

const store = () => useEditorStore.getState()
const noop = vi.fn()

function trace(name: string): Ab1Data {
  return {
    name, bases: 'ATGC'.repeat(50),
    peakLocations: [], qualityScores: new Array(200).fill(36),
    traces: { A: [], C: [], G: [], T: [] }, metadata: {},
  }
}

function result(): AlignmentResult {
  return {
    sequences: [
      { name: 'a', alignedBases: 'ATGC', originalBases: 'ATGC' },
      { name: 'b', alignedBases: 'ATGG', originalBases: 'ATGG' },
    ],
    consensus: 'ATGN', conservation: [1, 1, 1, 0.5], score: 3,
    identity: 0.75, similarity: 0.75, gaps: 0, alignmentLength: 4, algorithm: 'nw',
  }
}

function renderPanel() {
  return render(<ExplorerPanel open onCollapse={noop} onExpand={noop} onImportFiles={noop} />)
}

/** Scoped to the list: the pinned copy of the current heading is a duplicate. */
const groupLabels = () =>
  [...document.querySelectorAll('.ex-viewport .ex-group-title')].map(el => el.textContent)

const rows = () => [...document.querySelectorAll<HTMLElement>('.ex-row')]

describe('ExplorerPanel', () => {
  beforeEach(() => {
    for (const t of store().tabs) store().closeTab(t.id)
    useEditorStore.setState({
      itemMeta: {}, recentlyDeleted: [], folders: [],
      sequencingReads: [], activeSequencingReadIds: [],
      alignments: [], contigs: [], assemblies: [],
      activeAlignmentId: null, activeContigId: null, activeAssemblyId: null,
    })
    localStorage.removeItem('seqnexus:explorer-settings')
  })
  afterEach(cleanup)

  it('imports files dropped on a folder into it, and offers New Sequence and Import Here on its menu', async () => {
    const id = store().openDocument('pIn', 'ATGC')
    const folderId = store().createFolder('Plasmids')
    store().moveTabToFolder(id, folderId)
    const onImportFiles = vi.fn()
    const onImportInto = vi.fn()
    const onNewSequenceIn = vi.fn()
    render(<ExplorerPanel open onCollapse={noop} onExpand={noop} onImportFiles={onImportFiles}
      onImportInto={onImportInto} onNewSequenceIn={onNewSequenceIn} />)
    const folder = [...document.querySelectorAll<HTMLElement>('.ex-folder')].find(el => el.textContent?.includes('Plasmids'))!

    const dropped = new File(['>a\nACGT'], 'a.fasta')
    fireEvent.drop(folder, { dataTransfer: { types: ['Files'], files: [dropped] } })
    await vi.waitFor(() => expect(onImportFiles).toHaveBeenCalledWith([dropped], { paths: expect.any(Map), into: folderId }))
    // Once: the panel saw the drop was handled and did not import it again at the top level.
    expect(onImportFiles).toHaveBeenCalledTimes(1)

    fireEvent.contextMenu(folder)
    fireEvent.click([...document.querySelectorAll<HTMLElement>('.ctx-menu-item')].find(el => el.textContent?.includes('New Sequence Here'))!)
    expect(onNewSequenceIn).toHaveBeenCalledWith(folderId)
    fireEvent.contextMenu(folder)
    fireEvent.click([...document.querySelectorAll<HTMLElement>('.ctx-menu-item')].find(el => el.textContent?.includes('Import Files Here'))!)
    expect(onImportInto).toHaveBeenCalledWith(folderId)
  })

  it('shows only Sequences when there is nothing but sequences', () => {
    store().openDocument('pTest', 'ATGC')
    renderPanel()
    expect(groupLabels()).toEqual(['Sequences'])
  })

  it('adds a group per kind as items of that kind appear', () => {
    store().openDocument('ref', 'ATGC')
    store().addSequencingRead(trace('M13F'))
    store().addAlignment(docFromResult(result(), 'dna'))
    store().addAssembly({ name: 'Assembly', contigs: [{ name: 'Assembly', doc: testContig([testRow('a', 0, 'ATGC')]) }] })

    renderPanel()
    expect(groupLabels()).toEqual([
      'Sequences', 'Sequencing', 'Alignments', 'Assemblies',
    ])
  })

  it('draws the metadata line next to the name', () => {
    store().openDocument('pTest', 'ATGC'.repeat(1000), 'circular')
    renderPanel()
    const stats = document.querySelector('.ex-stats-inline')
    expect(stats?.textContent).toBe('4.0 kb · circular · 0 features')
  })

  // The hover card is the row's tooltip. A title attribute as well put a
  // plain-text tooltip on screen next to it.
  it('leaves the row tooltip to the hover card', () => {
    store().openDocument('pTest', 'ATGC')
    renderPanel()
    expect(rows()).toHaveLength(1)
    expect(rows()[0].hasAttribute('title')).toBe(false)
  })

  // Five independent active ids in the store, but only one centre panel.
  it('marks exactly one row as open', () => {
    store().openDocument('a', 'ATGC')
    const b = store().openDocument('b', 'GGCC')
    renderPanel()

    const open = rows().filter(r => r.className.includes('open'))
    expect(open).toHaveLength(1)
    expect(open[0].dataset.uid).toBe(toUid('sequence', b))
  })

  it('opens a contig rather than the document when both have an active id', () => {
    store().openDocument('ref', 'ATGC')
    store().addSequencingRead(trace('M13F'))
    const made = store().addAssembly({ name: 'Assembly', contigs: [{ name: 'Assembly', doc: testContig([testRow('a', 0, 'ATGC')]) }] })!
    act(() => { store().setActiveContig(made.contigIds[0]) })

    renderPanel()
    const open = rows().filter(r => r.className.includes('open'))
    expect(open).toHaveLength(1)
    // A single contig is its assembly's row.
    expect(open[0].dataset.uid).toBe(toUid('assembly', made.assemblyId))
  })

  it('draws the contigs of an assembly with several under it', () => {
    const made = store().addAssembly({
      name: 'COI',
      contigs: [
        { name: 'Contig 1', doc: testContig([testRow('a', 0, 'ATGC')]) },
        { name: 'Contig 2', doc: testContig([testRow('b', 0, 'GGCC')]) },
      ],
    })!
    renderPanel()
    expect(rows().map(r => r.dataset.uid)).toEqual([
      toUid('assembly', made.assemblyId),
      toUid('contig', made.contigIds[0]),
      toUid('contig', made.contigIds[1]),
    ])
    // It opened on the overview, so the assembly row is the open one.
    expect(rows().filter(r => r.className.includes('open')).map(r => r.dataset.uid)).toEqual([toUid('assembly', made.assemblyId)])
  })

  it('stars an item and pins it to a favorites group', () => {
    const id = store().openDocument('pStar', 'ATGC')
    renderPanel()
    expect(groupLabels()).not.toContain('Favorites')

    const star = rows()[0].querySelector<HTMLButtonElement>('.ex-abtn')!
    act(() => { star.click() })

    expect(store().itemMeta[toUid('sequence', id)]?.starred).toBe(true)
    expect(groupLabels()[0]).toBe('Favorites')
    // Listed under Favorites and still in place under Sequences.
    expect(rows().filter(r => r.dataset.uid === toUid('sequence', id))).toHaveLength(2)
  })

  it('filters by name, and says so when nothing matches', () => {
    store().openDocument('alpha', 'ATGC')
    store().openDocument('beta', 'GGCC')
    renderPanel()

    const search = document.querySelector<HTMLInputElement>('.ex-search')!
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(search, 'alpha')
      search.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(rows().map(r => r.textContent)).toHaveLength(1)

    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(search, 'zzz')
      search.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(document.querySelector('.ex-no-matches')).toBeTruthy()
  })

  it('points to the + menu when the explorer is empty, and the menu draws the shared groups', () => {
    const run = vi.fn()
    render(<ExplorerPanel open onCollapse={noop} onExpand={noop} onImportFiles={noop} addMenu={[
      { label: 'New', actions: [{ id: 'a', label: 'Sequence…', icon: Plus, run }] },
      { label: 'Import', actions: [{ id: 'b', label: 'Files…', icon: Plus, shortcut: 'Ctrl+O', run: noop }] },
    ]} />)
    expect(document.querySelector('.ex-blank')?.textContent).toMatch(/use \+ above/)
    fireEvent.click(document.querySelector('[title="New or import"]')!)
    const labels = [...document.querySelectorAll('.menu-group-label')].map(el => el.textContent)
    expect(labels).toEqual(['New', 'Import'])
    fireEvent.click([...document.querySelectorAll('.ctx-menu-item')].find(el => el.textContent === 'Sequence…')!)
    expect(run).toHaveBeenCalled()
    expect(document.querySelector('.menu-group-label')).toBeNull()
  })
})

describe('inline rename', () => {
  beforeEach(() => {
    act(() => {
      useEditorStore.setState({
        tabs: [], activeTabId: null, sequencingReads: [], alignments: [],
        contigs: [], oligos: [], gels: [], activeGelId: null, folders: [], itemMeta: {},
      })
    })
  })
  afterEach(cleanup)

  it('keeps focus in the rename field when the tree re-renders', () => {
    act(() => { store().openDocument('pX', 'ACGT'.repeat(100), 'circular') })
    let gelId = ''
    act(() => { gelId = store().createGel({ activate: false, name: 'Old name' }) })
    const { container } = renderPanel()
    const tree = container.querySelector<HTMLElement>('[role="tree"]')!
    // Keyboard rename, so the tree has a focused row to pull focus back to:
    // the gel is the last row.
    act(() => { tree.focus() })
    act(() => { fireEvent.keyDown(tree, { key: 'End' }) })
    expect(document.activeElement).toBe(container.querySelector(`[data-uid="${toUid('gel', gelId)}"]`))
    act(() => { fireEvent.keyDown(document.activeElement!, { key: 'F2' }) })
    const input = container.querySelector<HTMLInputElement>('.ex-rename-input')!
    expect(document.activeElement).toBe(input)
    // Any store change re-renders the tree mid-rename.
    act(() => { store().toggleItemStar(toUid('sequence', 'nothing')) })
    expect(document.activeElement).toBe(container.querySelector('.ex-rename-input'))
    fireEvent.change(container.querySelector('.ex-rename-input')!, { target: { value: 'New name' } })
    fireEvent.keyDown(container.querySelector('.ex-rename-input')!, { key: 'Enter' })
    expect(store().gels[0].name).toBe('New name')
  })
})

describe('deleting a sequence a gel uses', () => {
  beforeEach(() => {
    act(() => {
      useEditorStore.setState({
        tabs: [], activeTabId: null, sequencingReads: [], alignments: [], recentlyDeleted: [],
        contigs: [], oligos: [], gels: [], activeGelId: null, folders: [], itemMeta: {},
      })
    })
  })
  afterEach(cleanup)

  function pressDeleteOnFirstRow(container: HTMLElement) {
    const tree = container.querySelector<HTMLElement>('[role="tree"]')!
    act(() => { tree.focus() })
    // Home lands on the Sequences heading; the sequence is the row below it.
    act(() => { fireEvent.keyDown(tree, { key: 'Home' }) })
    act(() => { fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' }) })
    expect(document.activeElement?.getAttribute('data-uid')).toBe(toUid('sequence', store().tabs[0].id))
    act(() => { fireEvent.keyDown(document.activeElement!, { key: 'Delete' }) })
  }

  it('warns that the lanes go too, and keeps everything on Cancel', () => {
    let seq = ''
    act(() => {
      seq = store().openDocument('pX', 'ACGT'.repeat(100), 'circular')
      store().createGel({ state: digestWorkspace(seq, ['EcoRI']), activate: false, name: 'Check digest' })
    })
    const { container } = renderPanel()
    pressDeleteOnFirstRow(container)

    const message = document.querySelector('.confirm-message')?.textContent
    expect(message).toBe('"pX" is used in 2 lanes on "Check digest". Deleting it also deletes those lanes.')
    act(() => { fireEvent.click([...document.querySelectorAll('button')].find(b => b.textContent === 'Cancel')!) })
    expect(store().tabs.map(t => t.id)).toEqual([seq])
    expect(store().gels[0].state.lanes).toHaveLength(3)
  })

  it('deletes the sequence and its lanes on Delete', () => {
    act(() => {
      const seq = store().openDocument('pX', 'ACGT'.repeat(100), 'circular')
      store().createGel({ state: digestWorkspace(seq, ['EcoRI']), activate: false })
    })
    const { container } = renderPanel()
    pressDeleteOnFirstRow(container)
    act(() => { fireEvent.click(document.querySelector('.confirm-dialog .btn-danger')!) })
    expect(store().tabs).toHaveLength(0)
    expect(store().gels[0].state.lanes.map(l => l.sample.kind)).toEqual(['ladder'])
  })

  it('deletes without asking when no gel uses it', () => {
    act(() => { store().openDocument('pX', 'ACGT'.repeat(100), 'circular') })
    const { container } = renderPanel()
    pressDeleteOnFirstRow(container)
    expect(document.querySelector('.confirm-dialog')).toBeNull()
    expect(store().tabs).toHaveLength(0)
  })
})

describe('a cloning design in the explorer', () => {
  beforeEach(() => {
    act(() => {
      useEditorStore.setState({
        tabs: [], activeTabId: null, sequencingReads: [], alignments: [], recentlyDeleted: [],
        contigs: [], oligos: [], gels: [], activeGelId: null, folders: [], itemMeta: {},
        clones: [], activeCloneId: null,
      })
    })
  })
  afterEach(cleanup)

  it('opens its menu and deletes from it', () => {
    let id = ''
    act(() => { id = store().createClone({ name: 'My design', activate: false }) })
    const { container } = renderPanel()
    const row = container.querySelector<HTMLElement>(`[data-uid="${toUid('clone', id)}"]`)!
    act(() => { fireEvent.click(row.querySelector('button[title="More actions"]')!) })
    const items = [...document.querySelectorAll<HTMLElement>('.ctx-menu-item')]
    expect(items.map(b => b.textContent?.trim())).toContain('Delete')
    act(() => { fireEvent.click(items.find(b => b.textContent?.trim() === 'Delete')!) })
    expect(store().clones).toHaveLength(0)
  })

  it('deletes with the Delete key', () => {
    let id = ''
    act(() => { id = store().createClone({ name: 'My design', activate: false }) })
    const { container } = renderPanel()
    const tree = container.querySelector<HTMLElement>('[role="tree"]')!
    act(() => { tree.focus() })
    // The design is the last row.
    act(() => { fireEvent.keyDown(tree, { key: 'End' }) })
    expect(document.activeElement?.getAttribute('data-uid')).toBe(toUid('clone', id))
    act(() => { fireEvent.keyDown(document.activeElement!, { key: 'Delete' }) })
    expect(store().clones).toHaveLength(0)
  })

  it('deletes the row that was clicked', () => {
    let keep = ''
    let gone = ''
    act(() => {
      keep = store().createClone({ name: 'Keep me', activate: false })
      gone = store().createClone({ name: 'Delete me', activate: false })
    })
    const { container } = renderPanel()
    const row = container.querySelector<HTMLElement>(`[data-uid="${toUid('clone', gone)}"]`)!
    // A click focuses the row before its click handler runs, as in a browser.
    act(() => { row.focus(); fireEvent.click(row) })
    act(() => { fireEvent.keyDown(document.activeElement!, { key: 'Delete' }) })
    expect(store().clones.map(c => c.id)).toEqual([keep])
  })

  it('deletes the whole selection with the Delete key', () => {
    act(() => {
      store().createClone({ name: 'First', activate: false })
      store().createClone({ name: 'Second', activate: false })
    })
    const { container } = renderPanel()
    const [a, b] = store().clones.map(c => container.querySelector<HTMLElement>(`[data-uid="${toUid('clone', c.id)}"]`)!)
    act(() => { a.focus(); fireEvent.click(a) })
    act(() => { b.focus(); fireEvent.click(b, { ctrlKey: true }) })
    act(() => { fireEvent.keyDown(document.activeElement!, { key: 'Delete' }) })
    expect(document.querySelector('.confirm-message')?.textContent).toContain('2 selected items')
    act(() => { fireEvent.click(document.querySelector('.confirm-dialog .btn-danger')!) })
    expect(store().clones).toHaveLength(0)
  })
})

describe('ExplorerPanel reveals what was just created', () => {
  const rowNames = () => rows().map(r => r.textContent ?? '')
  beforeEach(() => {
    for (const t of store().tabs) store().closeTab(t.id)
    useEditorStore.setState({ itemMeta: {}, folders: [], gels: [], activeGelId: null })
    localStorage.setItem('seqnexus:explorer-settings', JSON.stringify({ collapsedGroups: ['gel'] }))
  })
  afterEach(() => {
    cleanup()
    localStorage.removeItem('seqnexus:explorer-settings')
  })

  it('opens the collapsed group a new gel lands in', () => {
    act(() => { store().createGel({ name: 'Old gel', activate: false }) })
    renderPanel()
    expect(rowNames().some(n => n.includes('Old gel'))).toBe(false)
    act(() => { store().createGel({ name: 'New gel' }) })
    expect(rowNames().some(n => n.includes('New gel'))).toBe(true)
  })

  it('leaves the group collapsed when an existing gel is opened', () => {
    let id = ''
    act(() => { id = store().createGel({ name: 'Old gel', activate: false }) })
    renderPanel()
    act(() => { store().setActiveGel(id) })
    expect(rowNames().some(n => n.includes('Old gel'))).toBe(false)
  })

  it('leaves the group collapsed for a gel made but not opened', () => {
    renderPanel()
    act(() => { store().createGel({ name: 'Quiet gel', activate: false }) })
    expect(rowNames().some(n => n.includes('Quiet gel'))).toBe(false)
  })
})
