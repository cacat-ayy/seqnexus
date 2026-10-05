import { describe, it, expect, beforeEach } from 'vitest'
import { useEditorStore, type ReadSet } from './store'
import { StatsAccumulator } from './ngs/stats'
import { exportSessionToJson, importSessionFromJson } from './persistence'
import { sanitizeReadSet } from './ngs/record'

const store = () => useEditorStore.getState()

function readSet(name: string): ReadSet {
  const s = new StatsAccumulator(false, 2)
  s.add('ACGT', 'IIII', 0)
  s.add('ACGT', 'IIII', 1)
  return {
    id: store().newReadSetId(), name, createdAt: 1, modifiedAt: 1,
    technology: 'illumina', paired: true, files: [{ name: `${name}_R1.fq.gz`, bytes: 10 }],
    stats: s.finish(), chunks: 1, storedBytes: 100,
  }
}

function blobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(blob)
  })
}

describe('read sets in the store', () => {
  beforeEach(() => {
    for (const t of store().tabs) store().closeTab(t.id)
    useEditorStore.setState({ readSets: [], activeReadSetId: null, recentlyDeleted: [], folders: [], itemMeta: {} })
  })

  it('opens a new read set over whatever was open', () => {
    store().openDocument('pUC19', 'ACGT')
    const r = readSet('S1')
    store().addReadSet(r)
    expect(store().activeReadSetId).toBe(r.id)
    expect(store().activeTabId).toBeNull()
    store().setActiveTab(store().tabs[0].id)
    expect(store().activeReadSetId).toBeNull()
  })

  it('deletes into Recently deleted and comes back in its folder', () => {
    const r = readSet('S1')
    store().addReadSet(r, false)
    const folderId = store().createFolder('Run 12')
    store().moveItemToFolder(`readset:${r.id}`, folderId)
    store().removeReadSet(r.id)
    expect(store().readSets).toHaveLength(0)
    store().undoDelete()
    expect(store().readSets.map(x => x.id)).toEqual([r.id])
    expect(store().folders[0].itemUids).toEqual([`readset:${r.id}`])
  })

  it('stays out of session files', async () => {
    store().openDocument('pUC19', 'ACGT')
    const r = readSet('S1')
    store().addReadSet(r, false)
    store().toggleItemStar(`readset:${r.id}`)
    const blob = exportSessionToJson('light', { includeReads: true, includeAlignments: true, includeContigs: true })
    const text = await blobText(blob)
    expect(text).not.toContain('S1_R1')
    const session = importSessionFromJson(text)
    expect(session.readSets).toEqual([])
    expect(session.itemMeta[`readset:${r.id}`]).toBeUndefined()
  })
})

describe('sanitizeReadSet', () => {
  it('rejects a damaged record and repairs the rest', () => {
    expect(sanitizeReadSet({ id: 'x' })).toBeNull()
    expect(sanitizeReadSet(null)).toBeNull()
    const r = sanitizeReadSet({ id: 'rset_1', chunks: 2, stats: { reads: 4 }, technology: 'bogus', name: '' })
    expect(r).toMatchObject({ id: 'rset_1', name: 'Reads', technology: 'other', paired: false, files: [] })
  })
})
