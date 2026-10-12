import { describe, it, expect } from 'vitest'
import { canAlignWithQuery, hitsCsv, hitsFasta, searchFileName } from './actions'
import { entrezQuery } from './params'
import { DEFAULT_SETTINGS } from './params'
import type { BlastHit, BlastSearch } from './types'

const hit = (acc: string, extra: Partial<BlastHit> = {}): BlastHit => ({
  accession: acc,
  description: `Plasmid ${acc}, complete "sequence"`,
  sciName: 'Escherichia coli',
  length: 5000,
  topScore: 200, topEvalue: 1e-50, topIdentity: 0.98, queryCoverage: 0.5,
  hsps: [{
    bitScore: 200, evalue: 1e-50, identity: 0.98, positives: 0.98, gaps: 1, alignLen: 6,
    queryFrom: 1, queryTo: 5, hitFrom: 90, hitTo: 85, queryStrand: 1, hitStrand: -1,
    queryFrame: 0, hitFrame: 0, qseq: 'ACGTA-', hseq: 'ACG-AC', midline: '||| | ',
  }],
  ...extra,
})

const search = (program: BlastSearch['settings']['program'], translation = false): BlastSearch => ({
  rid: 'R1', service: 'ebi', createdAt: 0, queryName: 'pUC19/test',
  settings: { ...DEFAULT_SETTINGS, program },
  query: { label: 'Whole sequence', segments: [[0, 100]], seqLength: 100, fingerprint: '', ...(translation ? { translation: { strand: 1 as const, protein: 'MKV' } } : {}) },
  result: { program: program === 'megablast' ? 'blastn' : program, database: 'core_nt', queryLen: 100, hits: [hit('A1.1'), hit('B2.1')] },
})

describe('entrezQuery', () => {
  it('is empty with no limits', () => {
    expect(entrezQuery({ organism: '', excludeSynthetic: false })).toBe('')
  })

  it('leaves out synthetic constructs from everything', () => {
    expect(entrezQuery({ organism: '', excludeSynthetic: true })).toBe('all[filter] NOT txid32630[Organism]')
  })

  it('reads a bare number or a "(taxid:N)" as a taxid and anything else as a name', () => {
    expect(entrezQuery({ organism: '562', excludeSynthetic: false })).toBe('txid562[Organism]')
    expect(entrezQuery({ organism: 'Escherichia coli (taxid:562)', excludeSynthetic: false })).toBe('txid562[Organism]')
    expect(entrezQuery({ organism: 'Homo "sapiens"', excludeSynthetic: true })).toBe('"Homo sapiens"[Organism] NOT txid32630[Organism]')
  })
})

describe('exports', () => {
  it('writes the aligned stretch of each hit as FASTA, gaps removed', () => {
    expect(hitsFasta([hit('A1.1')])).toBe('>A1.1:90-85 Plasmid A1.1, complete "sequence" [Escherichia coli]\nACGAC\n')
  })

  it('writes one CSV row per hit, quoting what needs it', () => {
    const lines = hitsCsv(search('megablast')).trim().split('\n')
    expect(lines).toHaveLength(3)
    expect(lines[0]).toMatch(/^Accession,Description,Organism,Max score/)
    expect(lines[1]).toBe('A1.1,"Plasmid A1.1, complete ""sequence""",Escherichia coli,200,1.0e-50,98.0,50,6,1,5,90,85,Minus,5000,1')
  })

  it('names files after the sequence and the program, without characters a file system refuses', () => {
    expect(searchFileName(search('blastn'), 'csv')).toBe('pUC19_test BLAST blastn.csv')
  })
})

describe('canAlignWithQuery', () => {
  it('aligns searches whose query and hits are the same kind of sequence', () => {
    expect(canAlignWithQuery(search('megablast'))).toBe(true)
    expect(canAlignWithQuery(search('blastp'))).toBe(true)
    expect(canAlignWithQuery(search('blastp', true))).toBe(true)
  })

  it('does not align a translated search', () => {
    expect(canAlignWithQuery(search('blastx'))).toBe(false)
    expect(canAlignWithQuery(search('tblastn'))).toBe(false)
    expect(canAlignWithQuery(search('tblastx'))).toBe(false)
  })
})
