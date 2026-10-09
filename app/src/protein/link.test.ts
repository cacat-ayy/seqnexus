import { describe, it, expect } from 'vitest'
import { Annotation } from '../models/Annotation'
import { Sequence } from '../models/Sequence'
import type { DocumentState, TranslationSource } from '../models/Document'
import {
  codingLength, codingToGenomic, genomicToCoding, residuesToDna, dnaToResidues,
  translationSource, translationDocument,
} from './link'

const link = (over: Partial<TranslationSource> = {}): TranslationSource => ({
  tabId: 't', tabName: 'p', start: 10, end: 22, strand: 1, codonOffset: 0, codeId: 1, ...over,
})

describe('coding coordinates', () => {
  it('maps residues to codons on the forward strand', () => {
    const l = link()
    expect(codingLength(l)).toBe(12)
    expect(codingToGenomic(l, 0)).toBe(10)
    expect(codingToGenomic(l, 11)).toBe(21)
    expect(codingToGenomic(l, 12)).toBeNull()
    expect(residuesToDna(l, 1, 3)).toEqual({ start: 13, end: 19, strand: 1 })
    expect(genomicToCoding(l, 15)).toBe(5)
    expect(dnaToResidues(l, 14, 17)).toEqual([1, 3])
  })

  it('reads the minus strand from its high end', () => {
    const l = link({ strand: -1 })
    expect(codingToGenomic(l, 0)).toBe(21)
    expect(residuesToDna(l, 0, 1)).toEqual({ start: 19, end: 22, strand: -1 })
    expect(genomicToCoding(l, 21)).toBe(0)
    expect(dnaToResidues(l, 10, 13)).toEqual([3, 4])
  })

  it('honours the codon offset', () => {
    const l = link({ codonOffset: 1 })
    expect(codingLength(l)).toBe(11)
    expect(codingToGenomic(l, 0)).toBe(11)
    expect(genomicToCoding(l, 10)).toBeNull()
  })

  it('walks exons and reports a range across an intron in pieces', () => {
    const l = link({ start: 0, end: 20, segments: [[0, 6], [14, 20]] })
    expect(codingLength(l)).toBe(12)
    expect(codingToGenomic(l, 6)).toBe(14)
    expect(residuesToDna(l, 1, 3)).toEqual({ start: 3, end: 17, strand: 1, segments: [[3, 6], [14, 17]] })
    // Bases 15..17 are coding indices 7..9: residues 2 and 3.
    expect(dnaToResidues(l, 15, 18)).toEqual([2, 4])
    expect(dnaToResidues(l, 8, 12)).toBeNull()
  })
})

describe('translation document', () => {
  const dna = 'CCC' + 'ATGAAACGTTAA' + 'GGG' // M K R * at 3..15
  const doc: DocumentState = {
    name: 'plasmid',
    sequence: new Sequence(dna),
    annotations: [
      new Annotation({ id: 'cds', name: 'gene', type: 'CDS', start: 3, end: 15, strand: 1 }),
      new Annotation({ id: 'site', name: 'site', type: 'misc_feature', start: 6, end: 9, strand: 1, color: '#123456' }),
      new Annotation({ id: 'out', name: 'outside', type: 'misc_feature', start: 0, end: 2, strand: 1 }),
    ],
  }

  it('translates a feature, drops the trailing stop and carries inner features', () => {
    const req = { annotation: doc.annotations[0] }
    const src = translationSource(doc, 'tab1', req, 1)
    expect(src.annotationId).toBe('cds')
    const p = translationDocument(doc, src, req)
    expect(p.sequence.isProtein).toBe(true)
    expect(p.sequence.bases).toBe('MKR')
    expect(p.name).toBe('gene')
    expect(p.metadata?.origin).toBe('translation')
    expect(p.metadata?.translatedFrom?.tabId).toBe('tab1')
    expect(p.annotations.map(a => [a.name, a.start, a.end, a.color])).toEqual([['site', 1, 2, '#123456']])
  })

  it('translates a reverse selection off the other strand', () => {
    // Reverse complement of ATGAAACGTTAA is TTAACGTTTCAT: L T F H.
    const req = { start: 3, end: 15, reverse: true }
    const src = translationSource(doc, 'tab1', req, 1)
    const p = translationDocument(doc, src, req)
    expect(p.sequence.bases).toBe('LTFH')
    expect(p.name).toBe('plasmid 4-15')
  })
})
