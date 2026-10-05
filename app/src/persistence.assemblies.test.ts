import { describe, it, expect, beforeEach } from 'vitest'
import { exportSessionToJson, importSessionFromJson, remapSessionIds } from './persistence'
import { useEditorStore } from './store'
import { testContig, testRow } from './assembly/testing'

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

describe('assemblies in a session', () => {
  beforeEach(() => {
    for (const t of store().tabs) store().closeTab(t.id)
    useEditorStore.setState({
      itemMeta: {}, recentlyDeleted: [], folders: [], contigs: [], assemblies: [],
      activeContigId: null, activeAssemblyId: null,
    })
  })

  it('wraps each contig of a session from before assemblies in one, moving its folder and star', () => {
    const doc = testContig([testRow('a', 0, 'ACGT', { readId: 'r1' })], 'ACGT', 'pUC19', 't9')
    const json = JSON.stringify({
      format: 'seqnexus-session', version: 1,
      session: {
        version: 2, tabs: [], activeTabId: null, theme: 'light',
        folders: [{ id: 'f1', name: 'Clones', itemUids: ['contig:c1'], parentId: null, collapsed: false }],
        itemMeta: { 'contig:c1': { starred: true } },
        contigs: [{ id: 'c1', name: 'Clone 7', createdAt: 3 }],
      },
      sequences: [],
      alignmentData: [{ alignId: 'c1', data: doc }],
    })
    const session = importSessionFromJson(json)
    expect(session.assemblies).toHaveLength(1)
    const a = session.assemblies[0]
    expect(a).toMatchObject({ name: 'Clone 7', contigIds: ['c1'], method: 'reference', settings: null })
    expect(a.inputs).toEqual({ readIds: ['r1'], reference: { tabId: 't9', name: 'pUC19' } })
    expect(session.contigs[0].assemblyId).toBe(a.id)
    expect(session.folders[0].itemUids).toEqual([`assembly:${a.id}`])
    expect(session.itemMeta).toEqual({ [`assembly:${a.id}`]: { starred: true } })
  })

  it('keeps an assembly, its settings and the reads it left out through an export', async () => {
    const made = store().addAssembly({
      name: 'COI',
      method: 'de-novo',
      settings: { minIdentity: 0.9, minOverlap: 30, k: 12 },
      inputs: { readIds: [], reference: null },
      unplaced: [{ name: 'H09', readId: null, reason: 'Overlaps no other read' }],
      contigs: [
        { name: 'Contig 1', doc: testContig([testRow('a', 0, 'ACGT')]) },
        { name: 'Contig 2', doc: testContig([testRow('b', 0, 'GGCC')]) },
      ],
    })!
    const blob = exportSessionToJson('light', { includeReads: false, includeAlignments: false, includeContigs: true })
    const session = importSessionFromJson(await blobText(blob))
    expect(session.assemblies).toHaveLength(1)
    expect(session.assemblies[0]).toMatchObject({
      id: made.assemblyId, name: 'COI', contigIds: made.contigIds,
      settings: { minIdentity: 0.9, minOverlap: 30, k: 12 },
      unplaced: [{ name: 'H09', readId: null, reason: 'Overlaps no other read' }],
    })
    expect(session.activeAssemblyId).toBe(made.assemblyId)

    // A merge gives everything new ids and keeps the links between them.
    const merged = remapSessionIds(session)
    const a = merged.assemblies[0]
    expect(a.id).not.toBe(made.assemblyId)
    expect(merged.contigs.map(c => c.assemblyId)).toEqual([a.id, a.id])
    expect(a.contigIds).toEqual(merged.contigs.map(c => c.id))
    expect(merged.activeAssemblyId).toBe(a.id)
  })

  it('leaves assemblies out with the contigs', async () => {
    store().addAssembly({ name: 'X', contigs: [{ name: 'X', doc: testContig([testRow('a', 0, 'ACGT')]) }] })
    const blob = exportSessionToJson('light', { includeReads: false, includeAlignments: false, includeContigs: false })
    const session = importSessionFromJson(await blobText(blob))
    expect(session.assemblies).toEqual([])
    expect(session.contigs).toEqual([])
  })
})
