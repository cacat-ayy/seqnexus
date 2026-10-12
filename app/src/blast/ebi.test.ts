import { describe, it, expect } from 'vitest'
import { ebiErrorMessage, ebiRunForm } from './ebi'
import { parseEbiXml } from './ebi-parser'
import { DEFAULT_SETTINGS } from './params'

describe('ebiRunForm', () => {
  const base = { ...DEFAULT_SETTINGS, query: 'ACGT'.repeat(10) }

  it('names megablast as blastn with the megablast task, and sends the contact address', () => {
    const f = ebiRunForm(base, null)
    expect(f.get('program')).toBe('blastn')
    expect(f.get('task')).toBe('megablast')
    expect(f.get('stype')).toBe('dna')
    expect(f.get('email')).toBe('contact@seqnexus.app')
    expect(f.get('database')).toBe('em_std')
    expect(f.get('exp')).toBe('10')
    expect(f.get('alignments')).toBe('50')
    expect(f.has('taxids') || f.has('negative_taxids') || f.has('filter') || f.has('matrix')).toBe(false)
  })

  it('sends a protein query as protein, with its matrix, and no task', () => {
    const f = ebiRunForm({ ...base, program: 'blastp', database: 'uniprotkb_swissprot', matrix: 'BLOSUM80' }, null)
    expect(f.get('program')).toBe('blastp')
    expect(f.get('stype')).toBe('protein')
    expect(f.get('matrix')).toBe('BLOSUM80')
    expect(f.has('task')).toBe(false)
  })

  it('limits by taxid, leaves out synthetic constructs, and forces the filter when asked', () => {
    const f = ebiRunForm({ ...base, excludeSynthetic: true, lowComplexity: 'off' }, '562')
    expect(f.get('taxids')).toBe('562')
    expect(f.get('negative_taxids')).toBe('32630')
    expect(f.get('filter')).toBe('F')
  })
})

describe('ebiErrorMessage', () => {
  it('reads the reason out of an error answer', () => {
    expect(ebiErrorMessage("<?xml version='1.0'?>\n<error>\n <description>Please enter a valid email address</description>\n</error>"))
      .toBe('Please enter a valid email address')
    expect(ebiErrorMessage('ncbiblast-R2026-1')).toBeNull()
  })
})

// The shape of EMBL-EBI's XML result (the EBI ApplicationResult schema).
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<EBIApplicationResult xmlns="http://www.ebi.ac.uk/schema">
  <Header>
    <program name="BLASTN" version="2.16.0+"/>
    <parameters>
      <sequences total="1"><sequence number="1" name="Sequence" type="n" length="60"/></sequences>
      <databases total="1"><database number="1" name="em_std" type="n"/></databases>
    </parameters>
  </Header>
  <SequenceSimilaritySearchResult>
    <hits total="2">
      <hit number="1" database="EM_STD" id="L09137" ac="L09137" length="2686" description="pUC19 cloning vector">
        <alignments total="2">
          <alignment number="1">
            <score>100</score><bits>111.0</bits><expectation>2e-20</expectation>
            <identity>98</identity><gaps>1</gaps><strand>plus/minus</strand>
            <querySeq start="1" end="10">ACGTACGTAC</querySeq>
            <pattern>||||| ||||</pattern>
            <matchSeq start="500" end="491">ACGTAGGTAC</matchSeq>
          </alignment>
          <alignment number="2">
            <score>40</score><bits>45.0</bits><expectation>0.001</expectation>
            <identity>100</identity><gaps>0</gaps><strand>plus/plus</strand>
            <querySeq start="41" end="50">GGGGCCCCAA</querySeq>
            <pattern>||||||||||</pattern>
            <matchSeq start="10" end="19">GGGGCCCCAA</matchSeq>
          </alignment>
        </alignments>
      </hit>
      <hit number="2" database="SP" id="BLAT_ECOLX" ac="P62593" length="286" description="Beta-lactamase TEM OS=Escherichia coli OX=562 GN=bla PE=1 SV=1">
        <alignments total="1">
          <alignment number="1">
            <score>200</score><bits>250.0</bits><expectation>0</expectation>
            <identity>100</identity><gaps>0</gaps>
            <querySeq start="1" end="6">ACGTAC</querySeq>
            <pattern>||||||</pattern>
            <matchSeq start="1" end="6">ACGTAC</matchSeq>
          </alignment>
        </alignments>
      </hit>
    </hits>
  </SequenceSimilaritySearchResult>
</EBIApplicationResult>`

describe('parseEbiXml', () => {
  const r = parseEbiXml(XML, 'megablast', 'em_std')

  it('reads the query length, program and database', () => {
    expect(r.queryLen).toBe(60)
    expect(r.program).toBe('blastn')
    expect(r.database).toBe('em_std')
  })

  it('orders hits by E-value and HSPs by score, and takes every row number from the best HSP', () => {
    expect(r.hits.map(h => h.accession)).toEqual(['P62593', 'L09137'])
    const puc = r.hits[1]
    expect(puc.hsps.map(h => h.bitScore)).toEqual([111, 45])
    expect(puc.topScore).toBe(111)
    expect(puc.queryCoverage).toBeCloseTo(20 / 60)
  })

  it('counts identity from the aligned letters, and reads a minus-strand subject with ordered coordinates', () => {
    const hsp = r.hits[1].hsps[0]
    expect(hsp.identity).toBeCloseTo(0.9)
    expect([hsp.hitFrom, hsp.hitTo, hsp.hitStrand, hsp.queryStrand]).toEqual([491, 500, -1, 1])
    expect(hsp.midline).toBe('||||| ||||')
  })

  it('splits the organism out of a UniProt title', () => {
    expect(r.hits[0].description).toBe('Beta-lactamase TEM')
    expect(r.hits[0].sciName).toBe('Escherichia coli')
    expect(r.hits[1].sciName).toBe('')
  })

  it('refuses anything that is not a result', () => {
    expect(() => parseEbiXml('<error><description>x</description></error>', 'blastn', 'em_std')).toThrow()
    expect(() => parseEbiXml('not xml', 'blastn', 'em_std')).toThrow()
  })
})
