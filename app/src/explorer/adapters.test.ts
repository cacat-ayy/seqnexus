import { describe, it, expect, beforeEach } from 'vitest'
import { useEditorStore, type SequencingRead, type SavedAlignment, type Contig } from '../store'
import { testContig, testRow } from '../assembly/testing'
import { DEFAULT_CONTIG_VIEW } from '../assembly/view'
import { makeDoc } from '../msa/model'
import { DEFAULT_VIEW } from '../msa/view'
import type { Ab1Data } from '../io/ab1'
import {
  sequenceToItem, readToItem, alignmentToItem, contigToItem,
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
  })

  it('flags a failed read from its QC', () => {
    const read = makeRead()
    read.data.qualityScores = new Array(400).fill(12)
    const badges = readToItem(read, ctx()).badges
    expect(badges.map(b => b.key)).toEqual(['qc-fail'])
    expect(badges[0].tone).toBe('danger')
  })

  it('asks for a look at a short but usable read', () => {
    const read = makeRead()
    read.data.qualityScores = read.data.qualityScores.map((_, i) => (i < 250 ? 40 : 5))
    expect(readToItem(read, ctx()).badges.map(b => b.key)).toEqual(['qc-check'])
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

describe('contig adapter', () => {
  const make = (over: Partial<Contig> = {}): Contig => ({
    id: 'contig_1', name: 'Assembly',
    doc: testContig([testRow('a', 0, 'ACGT', { readId: 'r1' }), testRow('b', 2, 'GTAC', { readId: 'r2' })], 'ACGTAC', 'pUC19', 'tab_ref'),
    createdAt: 9, modifiedAt: 9, view: DEFAULT_CONTIG_VIEW, undoStack: [], redoStack: [],
    ...over,
  })

  it('reports read count, reference and width', () => {
    const item = contigToItem(make(), ctx())
    expect(item.stats).toEqual(['2 reads', 'vs pUC19', '6 bp'])
    expect(item.derivedFrom).toEqual(['sequence:tab_ref', 'read:r1', 'read:r2'])
  })

  it('says de novo when there is no reference', () => {
    const item = contigToItem(make({ doc: testContig([testRow('a', 0, 'ACGT')]) }), ctx())
    expect(item.stats).toEqual(['1 read', 'de novo', '4 bp'])
    expect(item.derivedFrom).toEqual([])
  })
})
