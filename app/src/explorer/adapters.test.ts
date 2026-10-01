import { describe, it, expect, beforeEach } from 'vitest'
import { useEditorStore, type SequencingRead, type SavedAlignment, type ReadAlignment, type Contig } from '../store'
import type { AlignmentResult } from '../alignment/types'
import { makeDoc } from '../msa/model'
import { DEFAULT_VIEW } from '../msa/view'
import type { Ab1Data } from '../io/ab1'
import {
  sequenceToItem, readToItem, alignmentToItem, readAlignmentToItem, contigToItem,
  type AdapterContext,
} from './adapters'

const store = () => useEditorStore.getState()

const ctx = (over: Partial<AdapterContext> = {}): AdapterContext => ({
  open: { kind: 'sequence', id: null },
  includedReadIds: [],
  tabNameById: new Map([['tab_ref', 'pUC19']]),
  ...over,
})

function makeRead(over: Partial<SequencingRead> = {}): SequencingRead {
  const data: Ab1Data = {
    name: 'M13F_A01',
    bases: 'ATGC'.repeat(100),
    peakLocations: [],
    qualityScores: new Array(400).fill(38),
    traces: { A: [], C: [], G: [], T: [] },
    metadata: {},
  }
  return { id: 'r1', data, createdAt: 0, trimStart: 0, trimEnd: data.bases.length, edits: [], undoStack: [], redoStack: [], ...over }
}

function makeResult(over: Partial<AlignmentResult> = {}): AlignmentResult {
  return {
    sequences: [
      { name: 'a', alignedBases: 'ATGC', originalBases: 'ATGC' },
      { name: 'b', alignedBases: 'ATGG', originalBases: 'ATGG' },
    ],
    consensus: 'ATGN',
    conservation: [1, 1, 1, 0.5],
    score: 3,
    identity: 0.75,
    similarity: 0.75,
    gaps: 0,
    alignmentLength: 4,
    algorithm: 'nw',
    ...over,
  }
}

describe('sequence adapter', () => {
  beforeEach(() => {
    for (const t of store().tabs) store().closeTab(t.id)
  })

  it('reports length, topology and feature count', () => {
    const id = store().openDocument('pTest', 'ATGC'.repeat(1000), 'circular')
    const tab = store().tabs.find(t => t.id === id)!
    const item = sequenceToItem(tab, ctx())

    expect(item.uid).toBe(`sequence:${id}`)
    expect(item.kind).toBe('sequence')
    expect(item.stats).toEqual(['4.0 kb', 'circular', '0 features'])
    expect(item.isCircular).toBe(true)
    expect(item.canDuplicate).toBe(true)
  })

  it('marks the open document, and only that one', () => {
    const a = store().openDocument('a', 'ATGC')
    const b = store().openDocument('b', 'GGCC')
    const tabs = store().tabs
    const context = ctx({ open: { kind: 'sequence', id: a } })

    expect(sequenceToItem(tabs.find(t => t.id === a)!, context).isOpen).toBe(true)
    expect(sequenceToItem(tabs.find(t => t.id === b)!, context).isOpen).toBe(false)
  })

  // A read is "open" only when the centre panel is showing reads at all,
  // which is what stops five rows across five kinds all reading as open.
  it('is not open when another kind holds the centre panel', () => {
    const a = store().openDocument('a', 'ATGC')
    const tab = store().tabs.find(t => t.id === a)!
    expect(sequenceToItem(tab, ctx({ open: { kind: 'contig', id: 'contig_1' } })).isOpen).toBe(false)
  })

  it('badges a read-only document', () => {
    const id = store().openDocument('locked', 'ATGC')
    store().setActiveTab(id)
    store().toggleReadOnly()
    const tab = store().tabs.find(t => t.id === id)!
    expect(sequenceToItem(tab, ctx()).badges.map(b => b.key)).toContain('read-only')
  })
})

describe('read adapter', () => {
  it('reports length and mean quality', () => {
    const item = readToItem(makeRead(), ctx())
    expect(item.uid).toBe('read:r1')
    expect(item.stats).toEqual(['400 bp', 'Q38'])
    expect(item.badges).toHaveLength(0)
    expect(item.canDuplicate).toBe(false)
  })

  // `trimEnd` is an absolute index, not a count back from the end: a read is
  // imported with trimEnd === bases.length and trimming pulls it inwards.
  it('shows the trimmed window against the total', () => {
    const item = readToItem(makeRead({ trimStart: 20, trimEnd: 370 }), ctx())
    expect(item.stats[0]).toBe('350 bp of 400 bp')
  })

  it('reports the full length for an untrimmed read', () => {
    expect(readToItem(makeRead(), ctx()).stats[0]).toBe('400 bp')
  })

  // The untrimmed tails are the low-quality part, so a whole-read mean would
  // fire the badge on reads that are fine once trimmed.
  it('averages quality over the kept window only', () => {
    const read = makeRead({ trimStart: 100, trimEnd: 300 })
    read.data.qualityScores = read.data.qualityScores.map((_, i) => (i >= 100 && i < 300 ? 40 : 2))
    const item = readToItem(read, ctx())
    expect(item.stats[1]).toBe('Q40')
    expect(item.badges).toHaveLength(0)
  })

  it('warns on a low mean quality', () => {
    const read = makeRead()
    read.data.qualityScores = new Array(400).fill(12)
    expect(readToItem(read, ctx()).badges.map(b => b.key)).toEqual(['low-quality'])
  })

  it('drops the quality stat when there is no quality track', () => {
    const read = makeRead()
    read.data.qualityScores = []
    expect(readToItem(read, ctx()).stats).toEqual(['400 bp'])
  })

  // The open read is in the multi-trace list too, so without this it would
  // carry both the open treatment and the included pip.
  it('marks other reads as included but not the open one', () => {
    const context = ctx({ open: { kind: 'read', id: 'r1' }, includedReadIds: ['r1', 'r2'] })
    expect(readToItem(makeRead({ id: 'r1' }), context).isIncluded).toBe(false)
    expect(readToItem(makeRead({ id: 'r2' }), context).isIncluded).toBe(true)
  })
})

describe('alignment adapter', () => {
  it('reports sequence count, identity and algorithm', () => {
    const align: SavedAlignment = {
      id: 'align_1', name: 'MSA 1',
      doc: makeDoc([{ name: 'a', seq: 'ATGC' }, { name: 'b', seq: 'ATGG' }], { method: 'mafft', at: 5 }),
      createdAt: 5, modifiedAt: 5, view: DEFAULT_VIEW, undoStack: [], redoStack: [],
    }
    const item = alignmentToItem(align, ctx())
    expect(item.uid).toBe('alignment:align_1')
    expect(item.stats).toEqual(['2 sequences', '75% identity', 'MAFFT'])
    expect(item.createdAt).toBe(5)
  })
})

describe('read alignment adapter', () => {
  const ra: ReadAlignment = {
    id: 'readalign_1', name: 'M13F vs pUC19', readId: 'r1', tabId: 'tab_ref',
    result: makeResult({ identity: 0.991 }), createdAt: 7, zoomLevel: 0,
    showChromatogram: false, resolvedCols: [],
  }

  it('names the reference and reports identity', () => {
    expect(readAlignmentToItem(ra, ctx()).stats).toEqual(['vs pUC19', '99% identity'])
  })

  it('omits the reference when the tab is gone', () => {
    const item = readAlignmentToItem(ra, ctx({ tabNameById: new Map() }))
    expect(item.stats).toEqual(['99% identity'])
  })

  it('counts resolved columns when there are any', () => {
    expect(readAlignmentToItem({ ...ra, resolvedCols: [3, 9] }, ctx()).stats).toContain('2 resolved')
  })

  it('records where it came from', () => {
    expect(readAlignmentToItem(ra, ctx()).derivedFrom).toEqual(['read:r1', 'sequence:tab_ref'])
  })
})

describe('contig adapter', () => {
  it('reports read count and reference', () => {
    const contig: Contig = {
      id: 'contig_1', name: 'Assembly', tabId: 'tab_ref',
      readAlignmentIds: ['readalign_1', 'readalign_2'],
      createdAt: 9, zoomLevel: 0, expandedReadId: null,
    }
    const item = contigToItem(contig, ctx())
    expect(item.stats).toEqual(['2 reads', 'vs pUC19'])
    expect(item.derivedFrom).toEqual([
      'sequence:tab_ref', 'read-alignment:readalign_1', 'read-alignment:readalign_2',
    ])
  })
})
