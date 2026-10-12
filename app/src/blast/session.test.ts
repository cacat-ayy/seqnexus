import { describe, it, expect, beforeEach } from 'vitest'
import { useEditorStore } from '../store'
import { importNcbiResult, useBlastStore } from './session'
import { placementOf } from './query'

/** A result file as NCBI's site downloads it (Single-file JSON). */
const ncbiFile = (queryLen: number, program = 'blastn') => JSON.stringify({
  BlastOutput2: [{
    report: {
      program,
      search_target: { db: 'core_nt' },
      results: {
        search: {
          query_len: queryLen,
          hits: [{
            description: [{ accession: 'L09137.2', title: 'pUC19 cloning vector', sciname: 'synthetic construct' }],
            len: 2686,
            hsps: [{ bit_score: 50, evalue: 1e-10, identity: 20, align_len: 20, query_from: 1, query_to: 20, hit_from: 1, hit_to: 20, qseq: 'A'.repeat(20), hseq: 'A'.repeat(20), midline: '|'.repeat(20) }],
          }],
        },
      },
    },
  }],
})

function open(bases: string) {
  useEditorStore.getState().openDocument('pTest', bases)
  return useEditorStore.getState().activeTabId!
}

describe('importNcbiResult', () => {
  beforeEach(() => useBlastStore.setState({ handoffs: {}, shown: {} }))

  it('matches a file whose query is the whole sequence, and shows it', () => {
    const tabId = open('ACGT'.repeat(25))
    const s = importNcbiResult(tabId, ncbiFile(100))
    expect(s.service).toBe('ncbi')
    expect(s.query.label).toBe('Whole sequence')
    expect(placementOf(s.query, useEditorStore.getState().doc.sequence).ok).toBe(true)
    expect(useEditorStore.getState().tabs.find(t => t.id === tabId)?.blastSearches[0].rid).toBe(s.rid)
    expect(useBlastStore.getState().shown[tabId]).toBe(s.rid)
  })

  it('prefers the search handed to NCBI with the same query length', () => {
    const tabId = open('ACGT'.repeat(25))
    const query = { label: 'Selection 11..40', segments: [[10, 40]] as [number, number][], seqLength: 100, fingerprint: 'x' }
    useBlastStore.setState({ handoffs: { [tabId]: [{ queryName: 'pTest', query, length: 30, settings: { ...useBlastStore.getState().draft, database: 'core_nt' } }] } })
    const s = importNcbiResult(tabId, ncbiFile(30))
    expect(s.query.label).toBe('Selection 11..40')
  })

  it('keeps a file it cannot match, without placing its hits', () => {
    const tabId = open('ACGT'.repeat(25))
    const s = importNcbiResult(tabId, ncbiFile(37))
    expect(s.query.segments).toEqual([])
    expect(placementOf(s.query, useEditorStore.getState().doc.sequence).ok).toBe(false)
    expect(s.result.hits[0].accession).toBe('L09137.2')
  })

  it('refuses a file that is not JSON, saying which file to download', () => {
    const tabId = open('ACGT'.repeat(25))
    expect(() => importNcbiResult(tabId, '<html>')).toThrow(/Single-file JSON/)
  })
})
