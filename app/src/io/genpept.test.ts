/**
 * GenPept: a protein record in GenBank's flat file format, read and written
 * by the same code as DNA.
 */
import { describe, it, expect } from 'vitest'
import { parseGenBank, parseGenBankMulti, writeGenBank } from './genbank'
import { Sequence } from '../models/Sequence'
import { Annotation } from '../models/Annotation'

const SAMPLE_GP = `LOCUS       P69905                   142 aa            linear   PRI 01-JAN-2000
DEFINITION  Hemoglobin subunit alpha.
ACCESSION   P69905
FEATURES             Location/Qualifiers
     Region          2..142
                     /region_name="Globin"
                     /note="globin domain"
     Site            59
                     /site_type="binding"
                     /note="Heme"
ORIGIN
        1 mvlspadktn vkaawgkvga hageygaeal ermflsfptt ktyfphfdls hgsaqvkghg
       61 kkvadaltna vahvddmpna lsalsdlhah klrvdpvnfk llshcllvtl aahlpaeftp
      121 avhasldkfl asvstvltsk yr
//
`

describe('GenPept', () => {
  it('reads a protein record as a protein document, with its features', () => {
    const doc = parseGenBank(SAMPLE_GP)
    expect(doc.sequence.isProtein).toBe(true)
    expect(doc.sequence.topology).toBe('linear')
    expect(doc.sequence.length).toBe(142)
    expect(doc.sequence.bases.slice(0, 10)).toBe('MVLSPADKTN')
    expect(doc.name).toBe('P69905')
    expect(doc.description).toBe('Hemoglobin subunit alpha')
    expect(doc.annotations.map(a => [a.type, a.name, a.start, a.end])).toEqual([
      ['Region', 'Globin', 1, 142],
      ['Site', 'Heme', 58, 59],
    ])
    // Strandedness is a DNA property; a protein does not carry one.
    expect(doc.metadata?.strandedness).toBeUndefined()
  })

  it('writes a protein as a GenPept record that reads back the same', () => {
    const doc = {
      name: 'Ubiquitin',
      sequence: new Sequence('MQIFVKTLTGKTITLEVEPSDTIENVKAKIQDKEGIPPDQQRLIFAGKQLEDGRTLSDYNIQKESTLHLVLRLRGG', 'linear', 'protein'),
      annotations: [new Annotation({ id: 'a', name: 'K48', type: 'Site', start: 47, end: 48, strand: 1 })],
    }
    const text = writeGenBank(doc)
    // The same columns as a GenPept record from NCBI.
    expect(text).toMatch(/^LOCUS {7}Ubiquitin {17}76 aa {12}linear {3}SYN /)
    expect(text).not.toContain('DNA')
    expect(text).toContain('     Site            48..48\n')
    const back = parseGenBankMulti(text)[0]
    expect(back.sequence.isProtein).toBe(true)
    expect(back.sequence.bases).toBe(doc.sequence.bases)
    expect(back.annotations[0].name).toBe('K48')
    expect(back.annotations[0].start).toBe(47)
  })

  it('still writes DNA with its molecule type', () => {
    const text = writeGenBank({ name: 'p', sequence: new Sequence('ACGT', 'circular'), annotations: [] })
    expect(text).toMatch(/4 bp ds-DNA {5}circular SYN /)
  })
})
