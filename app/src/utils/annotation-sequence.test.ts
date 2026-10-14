import { describe, it, expect } from 'vitest'
import { Annotation, type AnnotationData } from '../models/Annotation'
import { Sequence } from '../models/Sequence'
import {
  annotationBases,
  annotationCodingBases,
  annotationProtein,
  canTranslateAnnotation,
  isCodingAnnotation,
  annotationLength,
  headTail,
  translationIssues,
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
    // hold: annotationProtein is a pure translation and will happily
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

describe('translationIssues', () => {
  it('is null for a clean CDS', () => {
    const seq = new Sequence('ATGAAATTTTAA', 'linear')
    expect(translationIssues(ann({ start: 0, end: 12 }), seq)).toBeNull()
  })

  it('counts stops before the last codon, but not the last one', () => {
    const seq = new Sequence('ATGTAAAAATGATAA', 'linear')
    expect(translationIssues(ann({ start: 0, end: 15 }), seq)).toEqual({ internalStops: 2, leftover: 0, badStart: null, missingStop: false })
  })

  it('reports leftover bases and a codon that cannot start translation', () => {
    const seq = new Sequence('ACCATGATTACGC', 'linear')
    expect(translationIssues(ann({ start: 0, end: 13 }), seq)).toEqual({ internalStops: 0, leftover: 1, badStart: 'ACC', missingStop: false })
  })

  it('accepts GTG and TTG as starts, and skips the start check for a declared offset', () => {
    expect(translationIssues(ann({ start: 0, end: 9 }), new Sequence('GTGAAATAA', 'linear'))).toBeNull()
    expect(translationIssues(
      ann({ start: 0, end: 7, qualifiers: { codon_start: ['2'] } }),
      new Sequence('CACCTAA', 'linear'),
    )).toBeNull()
  })

  it('reports a CDS in frame that does not end on a stop, unless it was cut short', () => {
    const seq = new Sequence('ATGAAATTT', 'linear')
    expect(translationIssues(ann({ start: 0, end: 9 }), seq)).toEqual({ internalStops: 0, leftover: 0, badStart: null, missingStop: true })
    expect(translationIssues(ann({ start: 0, end: 9, truncated: true }), seq)).toBeNull()
    // Out of frame the last codon read is not the feature's end: no claim.
    expect(translationIssues(ann({ start: 0, end: 8 }), seq)?.missingStop).toBe(false)
  })

  it('leaves genes and ORFs alone', () => {
    const seq = new Sequence('ACCTAAAAA', 'linear')
    expect(translationIssues(ann({ type: 'gene', start: 0, end: 9 }), seq)).toBeNull()
    expect(translationIssues(ann({ id: '_orf_1', start: 0, end: 9 }), seq)).toBeNull()
  })
})

describe('headTail', () => {
  it('keeps short text whole and long text to its two ends', () => {
    expect(headTail('ACGT', 10)).toBeNull()
    expect(headTail('ABCDEFGHIJKL', 7)).toEqual({ head: 'ABC', tail: 'JKL' })
  })
})

describe('annotationLength', () => {
  it('measures a feature that wraps the origin', () => {
    expect(annotationLength(ann({ start: 8, end: 2 }), 10)).toBe(4)
    expect(annotationLength(ann({ start: 2, end: 8 }), 10)).toBe(6)
  })
})

describe('the genetic code a feature declares', () => {
  // ATG TGA AAA TAA: a stop in the middle with the standard code, W with table 2.
  const seq = new Sequence('ATGTGAAAATAA')
  const mito = ann({ start: 0, end: 12, qualifiers: { transl_table: ['2'] } })

  it('translates with /transl_table', () => {
    expect(annotationProtein(ann({ start: 0, end: 12 }), seq)).toBe('M*K*')
    expect(annotationProtein(mito, seq)).toBe('MWK*')
  })

  it('reports no internal stop when its code reads through', () => {
    expect(translationIssues(ann({ start: 0, end: 12 }), seq)?.internalStops).toBe(1)
    expect(translationIssues(mito, seq)).toBeNull()
  })

  it('falls back to the standard code for a table that does not exist', () => {
    expect(annotationProtein(ann({ start: 0, end: 12, qualifiers: { transl_table: ['99'] } }), seq)).toBe('M*K*')
  })
})

describe('the initiator codon', () => {
  // A GTG start two bases in, so the CDS does not begin at the sequence's edge.
  const seq = new Sequence('CC' + 'GTGGCTTAA' + 'CC')

  it('reads an alternative start codon as methionine, as NCBI translates a complete CDS', () => {
    expect(annotationProtein(ann({ start: 2, end: 11 }), seq)).toBe('MA*')
    // GTG is an initiator of the bacterial code too.
    expect(annotationProtein(ann({ start: 2, end: 11, qualifiers: { transl_table: ['11'] } }), seq)).toBe('MA*')
  })

  it('reads it as itself where it is not an initiator, or the CDS may be partial', () => {
    // Not an initiator in the standard code's list when the code is declared.
    expect(annotationProtein(ann({ start: 2, end: 11, qualifiers: { transl_table: ['1'] } }), seq)).toBe('VA*')
    // Read from /codon_start 2: the first codon is not the feature's first.
    expect(annotationProtein(ann({ start: 1, end: 11, qualifiers: { codon_start: ['2'] } }), seq)).toBe('VA*')
    // At the 5' edge of a linear sequence the CDS may be the end of a longer gene.
    expect(annotationProtein(ann({ start: 0, end: 9 }), new Sequence('GTGGCTTAA'))).toBe('VA*')
    expect(annotationProtein(ann({ start: 0, end: 9 }), new Sequence('GTGGCTTAA', 'circular'))).toBe('MA*')
    // Not a CDS.
    expect(annotationProtein(ann({ start: 2, end: 11, type: 'gene' }), seq)).toBe('VA*')
  })

  it('reads an ORF overlay\'s first codon as methionine whichever start the finder was given', () => {
    const ctg = new Sequence('CC' + 'CTGGCTTAA' + 'CC')
    expect(annotationProtein(ann({ id: '_orf_1:0:2:11', start: 2, end: 11 }), ctg)).toBe('MA*')
    expect(annotationProtein(ann({ start: 2, end: 11 }), ctg)).toBe('LA*')
  })

  it('does not count an alternative start as a bad start', () => {
    expect(translationIssues(ann({ start: 2, end: 11 }), seq)).toBeNull()
  })
})
