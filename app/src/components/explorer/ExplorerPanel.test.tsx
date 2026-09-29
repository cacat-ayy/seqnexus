/**
 * Panel wiring: that items of every kind reach the tree, that the three row
 * states stay distinct, and that starring round-trips through the store.
 */
import { render, act, cleanup } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import ExplorerPanel from './ExplorerPanel'
import { useEditorStore } from '../../store'
import { toUid } from '../../explorer/types'
import type { AlignmentResult } from '../../alignment/types'
import type { Ab1Data } from '../../io/ab1'

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
  return render(<ExplorerPanel open onCollapse={noop} onExpand={noop} onImportFile={noop} />)
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
      alignments: [], readAlignments: [], contigs: [],
      activeAlignmentId: null, activeReadAlignmentId: null, activeContigId: null,
    })
    localStorage.removeItem('seqnexus:explorer-settings')
  })
  afterEach(cleanup)

  it('shows the always-on groups when there is nothing but sequences', () => {
    store().openDocument('pTest', 'ATGC')
    renderPanel()
    expect(groupLabels()).toEqual(['Sequences', 'Sequencing'])
  })

  it('adds a group per kind as items of that kind appear', () => {
    const tabId = store().openDocument('ref', 'ATGC')
    const readId = store().addSequencingRead(trace('M13F'))
    store().addAlignment(result(), 'dna', 'nw')
    const raId = store().addReadAlignment(readId, tabId, result())
    store().addContig(tabId, [raId])

    renderPanel()
    expect(groupLabels()).toEqual([
      'Sequences', 'Sequencing', 'Alignments', 'Contigs',
    ])
  })

  // A read alignment inside a contig is listed in the contig, not alongside
  // it, or a twelve-read contig would spill twelve extra rows into the tree.
  it('hides read alignments that a contig owns', () => {
    const tabId = store().openDocument('ref', 'ATGC')
    const readId = store().addSequencingRead(trace('M13F'))
    const raId = store().addReadAlignment(readId, tabId, result())

    const { rerender } = renderPanel()
    expect(groupLabels()).toContain('Read alignments')

    act(() => { store().addContig(tabId, [raId]) })
    rerender(<ExplorerPanel open onCollapse={noop} onExpand={noop} onImportFile={noop} />)
    expect(groupLabels()).not.toContain('Read alignments')
  })

  it('draws the metadata line next to the name', () => {
    store().openDocument('pTest', 'ATGC'.repeat(1000), 'circular')
    renderPanel()
    const stats = document.querySelector('.ex-stats-inline')
    expect(stats?.textContent).toBe('4.0 kb · circular · 0 features')
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
    const tabId = store().openDocument('ref', 'ATGC')
    const readId = store().addSequencingRead(trace('M13F'))
    const raId = store().addReadAlignment(readId, tabId, result())
    const contigId = store().addContig(tabId, [raId])
    act(() => { store().setActiveContig(contigId) })

    renderPanel()
    const open = rows().filter(r => r.className.includes('open'))
    expect(open).toHaveLength(1)
    expect(open[0].dataset.uid).toBe(toUid('contig', contigId))
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

  it('offers a way in when the explorer is empty', () => {
    renderPanel()
    expect(document.querySelector('.ex-blank')).toBeTruthy()
    expect(document.querySelectorAll('.ex-blank-btn')).toHaveLength(3)
  })
})
