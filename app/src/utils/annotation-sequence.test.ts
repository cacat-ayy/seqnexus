import { describe, it, expect } from 'vitest'
import { Annotation, type AnnotationData } from '../models/Annotation'
import { Sequence } from '../models/Sequence'
import {
  annotationBases,
  annotationCodingBases,
  annotationProtein,
  canTranslateAnnotation,
  isCodingAnnotation,
} from './annotation-sequence'

const ann = (data: Partial<AnnotationData> = {}): Annotation =>
  new Annotation({
    id: 'a1', name: 'test', type: 'CDS', start: 0, end: 3, strand: 1, ...data,
  } as AnnotationData)

describe('isCodingAnnotation', () => {
  it.each(['CDS', 'gene', 'ORF'])('treats %s as coding', type => {
    expect(isCodingAnnotation(ann({ type }))).toBe(true)
  })

  it.each(['promoter', 'terminator', 'misc_feature', 'primer_bind'])(
    'does not treat %s as coding', type => {
      expect(isCodingAnnotation(ann({ type }))).toBe(false)
    })

  it('treats a synthesised ORF overlay as coding regardless of its type', () => {
    expect(isCodingAnnotation(ann({ id: '_orf_3', type: 'misc_feature' }))).toBe(true)
  })
})

describe('annotationBases', () => {
  it('reads a forward feature', () => {
    const seq = new Sequence('AAATGCGTAAA')
    expect(annotationBases(ann({ start: 3, end: 8 }), seq)).toBe('TGCGT')
  })

  it('reads a reverse feature in genomic orientation, not flipped', () => {
    const seq = new Sequence('AAATGCGTAAA')
    expect(annotationBases(ann({ start: 3, end: 8, strand: -1 }), seq)).toBe('TGCGT')
  })

  it('stitches a feature that wraps the origin', () => {
    const seq = new Sequence('GGGAAATTT', 'circular')
    // start 6 → end of sequence, then 0 → 3
    expect(annotationBases(ann({ start: 6, end: 3 }), seq)).toBe('TTTGGG')
  })

  it('returns empty for an empty sequence', () => {
    expect(annotationBases(ann(), new Sequence(''))).toBe('')
  })
})

describe('annotationCodingBases', () => {
  it('reverse-complements a minus-strand feature', () => {
    const seq = new Sequence('ATGCCC')
    expect(annotationCodingBases(ann({ start: 0, end: 6, strand: -1 }), seq)).toBe('GGGCAT')
  })

  it('applies codon_start=2 by skipping one base', () => {
    const seq = new Sequence('GATGAAA')
    const a = ann({ start: 0, end: 7, qualifiers: { codon_start: ['2'] } })
    expect(annotationCodingBases(a, seq)).toBe('ATGAAA')
  })

  it('applies codon_start=3 by skipping two bases', () => {
    const seq = new Sequence('GGATGAAA')
    const a = ann({ start: 0, end: 8, qualifiers: { codon_start: ['3'] } })
    expect(annotationCodingBases(a, seq)).toBe('ATGAAA')
  })

  it('ignores codon_start=1 and unparseable values', () => {
    const seq = new Sequence('ATGAAA')
    for (const raw of ['1', '', 'x', '9']) {
      const a = ann({ start: 0, end: 6, qualifiers: { codon_start: [raw] } })
      expect(annotationCodingBases(a, seq)).toBe('ATGAAA')
    }
  })

  it('offsets after reverse-complementing, not before', () => {
    // Reverse strand of 'TTTCAT' is 'ATGAAA'; codon_start=2 must cut the 'A'
    // off the translated orientation, giving 'TGAAA'.
    const seq = new Sequence('TTTCAT')
    const a = ann({ start: 0, end: 6, strand: -1, qualifiers: { codon_start: ['2'] } })
    expect(annotationCodingBases(a, seq)).toBe('TGAAA')
  })
})

describe('annotationProtein', () => {
  it('translates a forward CDS', () => {
    const seq = new Sequence('ATGGCTTAA')
    expect(annotationProtein(ann({ start: 0, end: 9 }), seq)).toBe('MA*')
  })

  it('translates a reverse CDS from the correct strand', () => {
    // reverse complement of 'TTAAGCCAT' is 'ATGGCTTAA' → MA*
    const seq = new Sequence('TTAAGCCAT')
    expect(annotationProtein(ann({ start: 0, end: 9, strand: -1 }), seq)).toBe('MA*')
  })

  it('translates across the origin', () => {
    // circular 'GCTTAAATG' (9 bp): 6..3 wraps to 'ATG' + 'GCT' = 'ATGGCT'
    const seq = new Sequence('GCTTAAATG', 'circular')
    expect(annotationProtein(ann({ start: 6, end: 3 }), seq)).toBe('MA')
  })

  it('drops a trailing partial codon rather than emitting a bad residue', () => {
    const seq = new Sequence('ATGGCTT')
    expect(annotationProtein(ann({ start: 0, end: 7 }), seq)).toBe('MA')
  })

  it('honours codon_start so the frame matches the source record', () => {
    const seq = new Sequence('GATGGCTTAA')
    const a = ann({ start: 0, end: 10, qualifiers: { codon_start: ['2'] } })
    expect(annotationProtein(a, seq)).toBe('MA*')
  })
})

describe('canTranslateAnnotation', () => {
  it('allows a coding feature with at least one codon', () => {
    expect(canTranslateAnnotation(ann({ start: 0, end: 3 }), new Sequence('ATG'))).toBe(true)
  })

  it('rejects a non-coding feature even when long enough', () => {
    const a = ann({ type: 'promoter', start: 0, end: 9 })
    expect(canTranslateAnnotation(a, new Sequence('ATGGCTTAA'))).toBe(false)
  })

  it('rejects a coding feature shorter than one codon', () => {
    expect(canTranslateAnnotation(ann({ start: 0, end: 2 }), new Sequence('AT'))).toBe(false)
  })

  it('rejects when codon_start leaves less than a full codon', () => {
    const a = ann({ start: 0, end: 3, qualifiers: { codon_start: ['2'] } })
    expect(canTranslateAnnotation(a, new Sequence('ATG'))).toBe(false)
  })

  it('never passes a feature whose translation would be empty', () => {
    // This is the property the context menu depends on: if the item is shown,
    // clicking it must put something on the clipboard. The converse does not
    // hold — annotationProtein is a pure translation and will happily
    // translate a promoter; it is this gate that decides not to offer it.
    const seq = new Sequence('ATGGCTTAA')
    const cases = [
      ann({ start: 0, end: 2 }),
      ann({ type: 'promoter', start: 0, end: 9 }),
      ann({ start: 0, end: 9 }),
      ann({ start: 0, end: 3, qualifiers: { codon_start: ['2'] } }),
      ann({ start: 0, end: 9, strand: -1 }),
    ]
    for (const a of cases) {
      if (canTranslateAnnotation(a, seq)) {
        expect(annotationProtein(a, seq).length).toBeGreaterThan(0)
      }
    }
  })
})
